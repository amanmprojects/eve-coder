import { defineTool } from "eve/tools";
import { z } from "zod";
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
  lines: string[]; // "lineNumber\tcontent"
}

export default defineTool({
  description: `Search file contents on the local filesystem with a regular expression.
Returns matching lines grouped by file, formatted as "lineNumber<TAB>content". Relative paths resolve
against the workspace root (${workspaceRoot}). Use globPattern to narrow which files are searched;
otherwise every text file under the base directory is examined. Ignores node_modules, .git, dist, .eve,
.next, .output and binary files by default.`,
  inputSchema: z.object({
    pattern: z.string().min(1).describe("Regular expression (or literal text) to search for."),
    cwd: z.string().optional().describe("Base directory to search, relative to the workspace root or absolute."),
    globPattern: z
      .string()
      .optional()
      .describe("Glob pattern to select which files to search (e.g. '**/*.ts')."),
    caseSensitive: z.boolean().optional().describe("Case-sensitive search. Default: false."),
    maxResults: z.number().int().positive().max(500).optional().describe("Max matching lines to return (default 200)."),
  }),
  async execute({ pattern, cwd, globPattern, caseSensitive, maxResults = 200 }) {
    const baseAbs = resolveToRoot(cwd ?? "");
    let re: RegExp;
    try {
      re = new RegExp(pattern, caseSensitive ? "" : "i");
    } catch {
      re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "" : "i");
    }

    let targets = globPattern
      ? await globFiles(cwd ?? "", globPattern)
      : await walk(baseAbs, { ignored: DEFAULT_IGNORED });

    const hits: GrepHit[] = [];
    let total = 0;
    let examined = 0;

    for (const target of targets) {
      if (total >= maxResults) break;
      const rel = displayPath(target);
      const text = await readTextFileCap(target);
      if (text === null) continue;
      examined++;
      const lines: string[] = [];
      let lineNo = 0;
      for (const line of text.split("\n")) {
        lineNo++;
        if (re.test(line)) {
          lines.push(`${lineNo}\t${line}`);
          total++;
          if (total >= maxResults) break;
        }
      }
      if (lines.length > 0) hits.push({ file: rel, lines });
    }

    return {
      pattern,
      baseDir: displayPath(baseAbs),
      filesExamined: examined,
      matches: total,
      maxResultsReached: total >= maxResults,
      hits,
    };
  },
});
