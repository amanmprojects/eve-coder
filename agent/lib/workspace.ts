import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { isAbsolute, join, posix, relative, resolve } from "node:path";

/**
 * Shared helpers for the fully-local started tools (`agent/tools/*.ts`).
 *
 * There is no sandbox: every path helper and walker operates on the real host
 * filesystem. The working root is `$LOCAL_CODER_ROOT` when set (put it in
 * `.env.local`), otherwise the directory the agent process was launched from.
 */

export const workspaceRoot: string = resolve(
  process.env.LOCAL_CODER_ROOT ?? process.cwd(),
);

/** Anchor a user-supplied path to the workspace root; absolute paths pass through. */
export function resolveToRoot(p: string): string {
  return isAbsolute(p) ? p : resolve(workspaceRoot, p);
}

/** Human-friendly form: relative to the workspace root when possible, else absolute. */
export function displayPath(abs: string): string {
  const rel = relative(workspaceRoot, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return abs;
  return rel;
}

/** Directories/files never descended into during walks. */
export const DEFAULT_IGNORED = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".eve",
  ".next",
  ".output",
  ".nitro",
  "dist",
  ".venv",
  "__pycache__",
  ".DS_Store",
]);

/** Read a file as UTF-8 text, or return null when it looks binary (NUL bytes). */
export async function readTextFileCap(abs: string): Promise<string | null> {
  const buf = await readFile(abs);
  if (buf.subarray(0, 8192).includes(0)) return null;
  return buf.toString("utf8");
}

/** Uppercase every line with a 1-based line number: `12\tcontent`. */
export function numberLines(text: string, start = 1): string {
  return text
    .split("\n")
    .map((line, idx) => `${start + idx}\t${line}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Glob + walk
// ---------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/** Expand `{a,b}` alternations into separate patterns (no nesting beyond depth 1 in practice). */
function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open === -1) return [pattern];
  let depth = 0;
  let close = -1;
  for (let i = open; i < pattern.length; i++) {
    if (pattern[i] === "{") depth++;
    else if (pattern[i] === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return [pattern];
  const pre = pattern.slice(0, open);
  const body = pattern.slice(open + 1, close);
  const post = pattern.slice(close + 1);
  const out: string[] = [];
  for (const part of body.split(",")) {
    for (const sub of expandBraces(pre + part + post)) out.push(sub);
  }
  return out;
}

/** Convert one glob pattern (no braces) to a RegExp source. Supports `**`, `*`, `?`, `[...]`. */
function globToSegmentRegExpSource(pattern: string): string {
  let re = "";
  let i = 0;
  const n = pattern.length;
  while (i < n) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          re += "(?:[^/]+/)*";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
        continue;
      }
      re += "[^/]*";
      i++;
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if (c === "[") {
      let j = i + 1;
      let cls = "";
      if (pattern[j] === "!" || pattern[j] === "^") {
        cls = "^";
        j++;
      }
      while (j < n && pattern[j] !== "]") {
        cls += pattern[j];
        j++;
      }
      if (j < n) {
        re += "[" + cls + "]";
        i = j + 1;
      } else {
        re += "\\[";
        i++;
      }
    } else {
      re += escapeRe(c);
      i++;
    }
  }
  return re;
}

/** A glob pattern → RegExp. A pattern with no slash matches recursively (globstar prefix). */
export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.includes("/") ? pattern : `**/${pattern}`;
  const sources = expandBraces(normalized).map(globToSegmentRegExpSource);
  return new RegExp(`^(${sources.join("|")})$`);
}

export interface WalkOptions {
  ignored?: Set<string>;
  includeDirs?: boolean;
  maxDepth?: number;
}

export async function walk(
  root: string,
  opts: WalkOptions = {},
): Promise<string[]> {
  const ignored = opts.ignored ?? DEFAULT_IGNORED;
  const includeDirs = opts.includeDirs ?? false;
  const maxDepth = opts.maxDepth ?? 64;
  const out: string[] = [];

  async function rec(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ignored.has(ent.name)) continue;
      const abs = join(dir, ent.name);
      const isDir = ent.isDirectory();
      if (!isDir && !ent.isFile()) continue; // skip symlinks/sockets/fifos
      if (isDir) {
        if (includeDirs) out.push(abs);
        await rec(abs, depth + 1);
      } else {
        out.push(abs);
      }
    }
  }

  await rec(root, 0);
  return out;
}

/** List files under `base` (relative to root) matching a glob pattern. */
export async function globFiles(
  base: string,
  pattern: string,
  opts: { ignored?: Set<string> } = {},
): Promise<string[]> {
  const baseAbs = resolveToRoot(base);
  const re = globToRegExp(pattern);
  const files = await walk(baseAbs, { ignored: opts.ignored });
  const out: string[] = [];
  for (const f of files) {
    if (re.test(posix.relative(baseAbs, f))) out.push(f);
  }
  out.sort();
  return out;
}
