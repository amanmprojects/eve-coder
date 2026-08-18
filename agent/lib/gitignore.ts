/**
 * Minimal `.gitignore` support for the in-memory search fallbacks (grep/glob).
 *
 * `rg` and `fd` honour `.gitignore` natively; this module gives the pure-JS
 * fallback a decent approximation so project-specific ignores are respected too.
 *
 * Supports the common subset: blank/comment lines, leading `/` (anchor to the
 * base dir), trailing `/` (directory-only), `*`, `**`, `?`, `[...]`, and `!`
 * negation. Patterns apply relative to the `.gitignore` file's directory.
 *
 * This is intentionally not a full git engine — nested `.gitignore` files are
 * not read during the walk (only the base/nearest one), which covers the
 * overwhelming majority of real repos.
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

interface GitignorePattern {
  /** Glob source with `**` etc., already in POSIX form, anchored to the base. */
  source: string;
  negate: boolean;
  dirOnly: boolean;
  /** True when the pattern starts with `/` (anchored to the base dir). */
  anchored: boolean;
}

const POSIX_SEP = "/";

function toPosix(p: string): string {
  return sep === "\\" ? p.split("\\").join(POSIX_SEP) : p;
}

/** Convert a single gitignore pattern body (no leading `!`) to a RegExp source. */
function patternToRegExp(body: string, anchored: boolean): string {
  let re = "";
  let i = 0;
  const n = body.length;
  while (i < n) {
    const c = body[i];
    if (c === "*") {
      if (body[i + 1] === "*") {
        // **/  → match any number of leading dirs
        if (body[i + 2] === POSIX_SEP) {
          re += "(?:[^/]+/)*";
          i += 3;
          continue;
        }
        // /**  → match everything (including slashes)
        if (i > 0 && body[i - 1] === POSIX_SEP) {
          re += ".*";
          i += 2;
          continue;
        }
        // bare ** → match anything (including slashes)
        re += ".*";
        i += 2;
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
      if (body[j] === "!") {
        cls = "^";
        j++;
      }
      while (j < n && body[j] !== "]") {
        cls += body[j];
        j++;
      }
      if (j < n) {
        re += `[${cls}]`;
        i = j + 1;
      } else {
        re += "\\[";
        i++;
      }
    } else {
      re += c.replace(/[.+^${}()|\\]/g, "\\$&");
      i++;
    }
  }
  // Unanchored patterns match at any depth. gitignore also matches a pattern
  // that names a directory against everything beneath it (foo matches foo/...).
  const tail = anchored ? "" : "(?:$|/)";
  return `${re}${tail}`;
}

export interface GitignoreMatcher {
  /** Returns true if `relPosixPath` (relative to base, POSIX) is ignored. */
  isIgnored(relPosixPath: string, isDir: boolean): boolean;
  readonly baseDir: string;
  readonly patternCount: number;
}

export function compilePatterns(patterns: GitignorePattern[], baseDir: string): GitignoreMatcher {
  const compiled = patterns.map((p) => ({
    negate: p.negate,
    dirOnly: p.dirOnly,
    anchored: p.anchored,
    re: new RegExp(`^(?:.*/)?${patternToRegExp(p.source, p.anchored)}`),
    reAnchored: new RegExp(`^${patternToRegExp(p.source, p.anchored)}`),
  }));
  return {
    baseDir,
    patternCount: patterns.length,
    isIgnored(relPosixPath: string, isDir: boolean) {
      const path = toPosix(relPosixPath).replace(/\/+$/, "");
      if (!path) return false;
      let ignored = false;
      for (const c of compiled) {
        if (c.dirOnly && !isDir) {
          // A dir-only pattern still ignores a file *inside* an ignored dir:
          // "build/" ignores "build/x". Match path or any ancestor segment.
          if (!path.includes("/")) continue;
          const parent = path.slice(0, path.lastIndexOf("/"));
          if (!c.re.test(parent) && !c.reAnchored.test(parent)) continue;
        } else {
          if (!c.re.test(path) && !c.reAnchored.test(path)) continue;
        }
        ignored = !c.negate;
      }
      return ignored;
    },
  };
}

function parseGitignore(text: string): GitignorePattern[] {
  const out: GitignorePattern[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    let body = line;
    let negate = false;
    if (body.startsWith("!")) {
      negate = true;
      body = body.slice(1);
    }
    // Unescape `\#` / `\!` escapes.
    if (body.startsWith("\\#") || body.startsWith("\\!")) body = body.slice(1);
    if (!body) continue;
    const dirOnly = body.endsWith(POSIX_SEP);
    if (dirOnly) body = body.slice(0, -1);
    const anchored = body.startsWith(POSIX_SEP);
    if (anchored) body = body.slice(1);
    if (!body) continue;
    out.push({ source: body, negate, dirOnly, anchored });
  }
  return out;
}

/**
 * Load the nearest `.gitignore` at or above `startDir`. Returns a matcher
 * whose `isIgnored` expects paths relative to that `.gitignore`'s directory.
 * Returns null when no `.gitignore` is found.
 */
export async function loadNearestGitignore(startDir: string): Promise<GitignoreMatcher | null> {
  let dir = startDir;
  // Walk up a bounded number of levels looking for a .gitignore.
  for (let i = 0; i < 24; i++) {
    const candidate = join(dir, ".gitignore");
    try {
      const text = await readFile(candidate, "utf8");
      return compilePatterns(parseGitignore(text), dir);
    } catch {
      // not present here; try parent
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Build a predicate over absolute paths: returns true if a path should be
 * skipped during a walk. Combines the directory-name ignore set with the
 * nearest `.gitignore` matcher.
 */
export async function makeIgnorePredicate(
  baseAbs: string,
  ignoredNames: Set<string>,
): Promise<{ skip: (absPath: string, isDir: boolean) => boolean; gitignoreBaseDir: string | null }> {
  const matcher = await loadNearestGitignore(baseAbs);
  const baseDir = matcher?.baseDir ?? null;
  return {
    gitignoreBaseDir: baseDir,
    skip(absPath: string, isDir: boolean) {
      const base = absPath.split(sep).pop() ?? "";
      if (ignoredNames.has(base)) return true;
      if (!matcher) return false;
      const rel = toPosix(relative(matcher.baseDir, absPath));
      if (!rel || rel.startsWith("..")) return false;
      return matcher.isIgnored(rel, isDir);
    },
  };
}
