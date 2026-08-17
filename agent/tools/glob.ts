import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  DEFAULT_IGNORED,
  displayPath,
  globFiles,
  resolveToRoot,
  workspaceRoot,
} from "../lib/workspace.js";

export default defineTool({
  description: `Find files on the local filesystem by glob pattern, relative to the workspace root
(${workspaceRoot}). Patterns without a "/" match recursively by name (e.g. "*.ts" finds TypeScript files
at any depth); use "**/..." for explicit recursion and "dir/*.ts" for top-level only. Supports **, *, ?,
[...], and {a,b}. Ignores node_modules, .git, dist, .eve, .next, .output by default.`,
  inputSchema: z.object({
    pattern: z.string().min(1).describe("Glob pattern to match relative paths against."),
    cwd: z.string().optional().describe("Base directory, relative to the workspace root or absolute."),
    ignore: z.array(z.string()).optional().describe("Extra directory names/segments to skip during the walk."),
  }),
  async execute({ pattern, cwd, ignore }) {
    const ignored = new Set(DEFAULT_IGNORED);
    for (const name of ignore ?? []) ignored.add(name.replace(/^\/+|\/+$/g, "").split("/").pop() ?? name);
    const files = await globFiles(cwd ?? "", pattern, { ignored });
    return {
      pattern,
      baseDir: displayPath(cwd ? resolveToRoot(cwd) : workspaceRoot),
      matches: files.length,
      files: files.map((f) => displayPath(f)),
    };
  },
});
