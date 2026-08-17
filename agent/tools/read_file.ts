import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  displayPath,
  numberLines,
  readTextFileCap,
  resolveToRoot,
  workspaceRoot,
} from "../lib/workspace.js";

const MAX_LINES = 2000;

export default defineTool({
  description: `Read a file from the local filesystem and print its contents with line numbers.
Relative paths resolve against the workspace root (${workspaceRoot}); absolute paths are used as-is.
Use offset/limit to page through large files a chunk at a time (1-based line numbers).
Use ls to list a directory instead of reading it.`,
  inputSchema: z.object({
    path: z.string().min(1).describe("File path, relative to the workspace root or absolute."),
    offset: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("1-based line number to start reading from."),
    limit: z
      .number()
      .int()
      .positive()
      .describe("Maximum number of lines to read."),
  }),
  async execute({ path, offset, limit }) {
    const abs = resolveToRoot(path);
    const info = await stat(abs).catch(() => null);
    if (!info) {
      throw new Error(`File not found: ${path} (resolved to ${abs}). Use glob/ls to discover files.`);
    }
    if (info.isDirectory()) {
      throw new Error(`${path} is a directory. Use ls to list its contents.`);
    }
    const text = await readTextFileCap(abs);
    if (text === null) {
      return { path: displayPath(abs), absolutePath: abs, binary: true };
    }
    const allLines = text.split("\n");
    if (info.size > 0 && allLines[allLines.length - 1] === "") allLines.pop();
    const start = offset ? Math.min(Math.max(offset, 1), allLines.length + 1) : 1;
    const count = limit ? Math.max(1, limit) : MAX_LINES;
    const slice = allLines.slice(start - 1, start - 1 + count);
    return {
      path: displayPath(abs),
      absolutePath: abs,
      totalLines: allLines.length,
      startLine: start,
      lines: slice.length,
      truncated: start - 1 + count < allLines.length,
      content: numberLines(slice.join("\n"), start),
    };
  },
});
