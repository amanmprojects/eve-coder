import { lstat, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { displayPath, resolveToRoot } from "../lib/workspace.js";

export default defineTool({
  description: `List the contents of a local directory with type, size, and entry count per subdirectory.
Relative paths resolve against the workspace root. Use this to explore the filesystem before reading files.`,
  inputSchema: z.object({
    path: z
      .string()
      .optional()
      .describe("Directory to list, relative to the workspace root or absolute. Default: workspace root."),
    maxEntries: z.number().int().positive().max(2000).optional().describe("Cap on entries returned (default 500)."),
  }),
  async execute({ path, maxEntries = 500 }) {
    const abs = resolveToRoot(path ?? "");
    const info = await stat(abs).catch(() => null);
    if (!info) throw new Error(`Path not found: ${path ?? "."} (resolved to ${abs}).`);
    if (!info.isDirectory()) {
      return {
        path: displayPath(abs),
        isDirectory: false,
        kind: "file",
        size: info.size,
        message: "This is a file, not a directory. Use read_file to view it.",
        entries: [],
      };
    }
    let names: string[];
    try {
      names = await readdir(abs);
    } catch (err) {
      throw new Error(`Failed to list ${abs}: ${(err as Error).message}`);
    }

    const entries = [];
    for (const name of names.slice(0, maxEntries)) {
      const childAbs = join(abs, name);
      // lstat() does not follow symlinks, so a symlink is reported as a link
      // rather than the type of its target. stat() would follow the link and
      // make isSymbolicLink() always false (and throw on a broken link).
      const lstatInfo = await lstat(childAbs).catch(() => null);
      // Follow the link to report the target's size for file links (matching
      // `ls -l`, which shows the target). A broken link has no target.
      const targetInfo = lstatInfo?.isSymbolicLink() ? await stat(childAbs).catch(() => null) : lstatInfo;
      const kind = lstatInfo?.isSymbolicLink()
        ? "link"
        : lstatInfo?.isDirectory()
          ? "dir"
          : lstatInfo?.isFile()
            ? "file"
            : "other";
      entries.push({
        name,
        kind,
        isDirectory: kind === "dir",
        size: kind === "dir" || kind === "link" ? null : targetInfo ? targetInfo.size : null,
      });
    }

    return {
      path: displayPath(abs),
      isDirectory: true,
      count: entries.length,
      truncated: names.length > maxEntries,
      entries,
    };
  },
});
