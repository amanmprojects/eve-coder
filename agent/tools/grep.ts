import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { findBin } from "../lib/bin.js";
import { makeIgnorePredicate } from "../lib/gitignore.js";
import { DEFAULT_MAX_BYTES, truncateHead, truncateLine } from "../lib/truncate.js";
import {
  DEFAULT_IGNORED,
  displayPath,
  globFiles,
  readTextFileCap,
  resolveToRoot,
  walk,
  workspaceRoot,
} from "../lib/workspace.js";

export interface GrepHit {
  file: string;
  lines: string[]; // "lineNumber<TAB>content" (match); "lineNumber<TAB>· content" (context)
}

interface MatchLine {
  file: string; // display path
  lineNo: number;
  text: string;
  isMatch: boolean;
}

function formatLine(file: string, lineNo: number, text: string, isMatch: boolean, linesTruncated: () => void): string {
  const { text: t, wasTruncated } = truncateLine(text.replace(/\r/g, ""));
  if (wasTruncated) linesTruncated();
  return isMatch ? `${lineNo}\t${t}` : `${lineNo}\t· ${t}`;
}

/**
 * Group a flat list of (file, line) hits into the per-file shape the TUI renders.
 * Keeps first-appearance order of files; within a file, lines stay in order.
 */
function groupHits(matchLines: MatchLine[], linesTruncated: () => void): GrepHit[] {
  const order: string[] = [];
  const byFile = new Map<string, string[]>();
  for (const m of matchLines) {
    if (!byFile.has(m.file)) {
      byFile.set(m.file, []);
      order.push(m.file);
    }
    byFile.get(m.file)!.push(formatLine(m.file, m.lineNo, m.text, m.isMatch, linesTruncated));
  }
  return order.map((file) => ({ file, lines: byFile.get(file)! }));
}

export default defineTool({
  description: `Search file contents on the local filesystem with a regular expression.
Returns matching lines grouped by file, formatted as "lineNumber<TAB>content". Relative paths resolve
against the workspace root (${workspaceRoot}). Uses ripgrep when available (respects .gitignore); falls
back to a pure-JS scan otherwise. Use globPattern to narrow which files are searched; literal:true to
treat the pattern as plain text; context:N to show N lines of surrounding context; multiline:true for
cross-line patterns. Long matching lines are truncated. Ignores node_modules, .git, dist, .eve, .next,
.output and binary files by default.`,
  inputSchema: z.object({
    pattern: z.string().min(1).describe("Regular expression (or literal text when literal:true)."),
    cwd: z.string().optional().describe("Base directory to search, relative to the workspace root or absolute."),
    globPattern: z
      .string()
      .optional()
      .describe("Glob pattern to select which files to search (e.g. '**/*.ts')."),
    caseSensitive: z.boolean().optional().describe("Case-sensitive search. Default: false."),
    literal: z.boolean().optional().describe("Treat pattern as a literal string, not a regex. Default: false."),
    context: z
      .number()
      .int()
      .min(0)
      .max(50)
      .optional()
      .describe("Lines of context to show before and after each match. Default: 0."),
    multiline: z.boolean().optional().describe("Allow patterns to match across newlines. Default: false."),
    maxResults: z.number().int().positive().max(500).optional().describe("Max matching lines to return (default 200)."),
  }),
  async execute({ pattern, cwd, globPattern, caseSensitive, literal, context: contextLines = 0, multiline, maxResults = 200 }, ctx) {
    const baseAbs = resolveToRoot(cwd ?? "");
    const { skip } = await makeIgnorePredicate(baseAbs, DEFAULT_IGNORED);
    let linesWereTruncated = false;
    const markTruncated = () => {
      linesWereTruncated = true;
    };

    const rgPath = await findBin("rg");
    if (rgPath) {
      try {
        const result = await runRipgrep(rgPath, {
          pattern,
          baseAbs,
          displayBase: cwd ?? "",
          globPattern,
          caseSensitive: caseSensitive ?? false,
          literal: literal ?? false,
          contextLines,
          multiline: multiline ?? false,
          maxResults,
          abortSignal: ctx.abortSignal,
        });
        const hits = groupHits(result.matchLines, markTruncated);
        return {
          pattern,
          baseDir: displayPath(baseAbs),
          engine: "ripgrep",
          filesExamined: new Set(result.matchLines.map((m) => m.file)).size,
          matches: result.matchLines.filter((m) => m.isMatch).length,
          maxResultsReached: result.limitReached,
          linesTruncated: linesWereTruncated,
          hits,
        };
      } catch (err) {
        // Fall through to the in-memory implementation if ripgrep misbehaves.
        if (process.env.EVE_CODER_DEBUG) console.error("rg fallback:", (err as Error).message);
      }
    }

    // --- pure-JS fallback ---
    let re: RegExp;
    const flags = `${caseSensitive ? "" : "i"}${multiline ? "s" : ""}m`;
    try {
      re = literal ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags) : new RegExp(pattern, flags);
    } catch {
      re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    }

    const targets = globPattern
      ? await globFiles(cwd ?? "", globPattern, { skip })
      : await walk(baseAbs, { ignored: DEFAULT_IGNORED, skip });

    const matchLines: MatchLine[] = [];
    let total = 0;
    let examined = 0;

    for (const target of targets) {
      if (total >= maxResults) break;
      if (ctx.abortSignal.aborted) break;
      const rel = displayPath(target);
      const text = await readTextFileCap(target);
      if (text === null) continue;
      examined++;
      const lines = text.split("\n");
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

      if (contextLines > 0) {
        // Collect match line numbers, then emit merged context windows.
        const matchNos: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            matchNos.push(i + 1);
            total++;
            if (total >= maxResults) break;
          }
        }
        for (const groups of mergeWindows(matchNos, contextLines, lines.length)) {
          for (const ln of groups) {
            matchLines.push({ file: rel, lineNo: ln, text: lines[ln - 1] ?? "", isMatch: matchNos.includes(ln) });
          }
        }
      } else {
        let lineNo = 0;
        for (const line of lines) {
          lineNo++;
          if (re.test(line)) {
            matchLines.push({ file: rel, lineNo, text: line, isMatch: true });
            total++;
            if (total >= maxResults) break;
          }
        }
      }
    }

    const hits = groupHits(matchLines, markTruncated);
    return {
      pattern,
      baseDir: displayPath(baseAbs),
      engine: "js",
      filesExamined: examined,
      matches: total,
      maxResultsReached: total >= maxResults,
      linesTruncated: linesWereTruncated,
      hits,
    };
  },
});

/** Merge overlapping [line-ctx, line+ctx] windows into disjoint ranges. */
function mergeWindows(matchNos: number[], ctx: number, total: number): number[][] {
  if (matchNos.length === 0) return [];
  const ranges: Array<{ start: number; end: number }> = [];
  for (const n of matchNos) {
    const start = Math.max(1, n - ctx);
    const end = Math.min(total, n + ctx);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }
  return ranges.map((r) => {
    const out: number[] = [];
    for (let i = r.start; i <= r.end; i++) out.push(i);
    return out;
  });
}

interface RgResult {
  matchLines: MatchLine[];
  limitReached: boolean;
}

/** Stream ripgrep's --json output and convert to MatchLine[]. */
function runRipgrep(rgPath: string, opts: {
  pattern: string;
  baseAbs: string;
  displayBase: string;
  globPattern?: string;
  caseSensitive: boolean;
  literal: boolean;
  contextLines: number;
  multiline: boolean;
  maxResults: number;
  abortSignal: AbortSignal;
}): Promise<RgResult> {
  return new Promise((resolve, reject) => {
    const args = ["--json", "--line-number", "--color=never", "--hidden", "--no-heading"];
    // rg honours .gitignore, but DEFAULT_IGNORED (.venv, .next, .output, …) may
    // not be gitignored, so exclude them explicitly to match the JS fallback.
    for (const name of DEFAULT_IGNORED) args.push("--glob", `!${name}`);
    if (!opts.caseSensitive) args.push("--ignore-case");
    if (opts.literal) args.push("--fixed-strings");
    if (opts.multiline) args.push("--multiline", "--multiline-dotall");
    if (opts.contextLines > 0) args.push("--context", String(opts.contextLines));
    if (opts.globPattern) args.push("--glob", opts.globPattern);
    args.push("--", opts.pattern, opts.baseAbs);

    const child = spawn(rgPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const rl = createInterface({ input: child.stdout });
    let stderr = "";
    const matchLines: MatchLine[] = [];
    let matchCount = 0;
    let limitReached = false;
    let aborted = false;
    let killedForLimit = false;

    const cleanup = () => {
      rl.close();
      opts.abortSignal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      aborted = true;
      if (!child.killed) child.kill();
    };
    opts.abortSignal.addEventListener("abort", onAbort, { once: true });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });

    rl.on("line", (line) => {
      if (aborted || !line.trim()) return;
      let event: { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      const type = event.type;
      if (type !== "match" && type !== "context") return;
      const file = event.data?.path?.text;
      const lineNo = event.data?.line_number;
      const text = event.data?.lines?.text ?? "";
      if (!file || typeof lineNo !== "number") return;

      if (type === "match") {
        matchCount++;
        if (matchCount > opts.maxResults) {
          limitReached = true;
          killedForLimit = true;
          if (!child.killed) child.kill();
          return;
        }
      }
      matchLines.push({ file: displayPath(file), lineNo, text: text.replace(/\n$/, ""), isMatch: type === "match" });
    });

    child.on("error", (err) => {
      cleanup();
      reject(new Error(`Failed to run ripgrep: ${err.message}`));
    });
    child.on("close", (code) => {
      cleanup();
      if (aborted) return reject(new Error("Operation aborted"));
      // rg: 0 = matches, 1 = no matches, 2 = error.
      if (code !== 0 && code !== 1 && !killedForLimit) {
        return reject(new Error(stderr.trim() || `ripgrep exited with code ${code}`));
      }
      resolve({ matchLines, limitReached });
    });
  });
}
