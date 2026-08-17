import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { displayPath, resolveToRoot } from "../lib/workspace.js";

export default defineTool({
  description: `Write a complete file to the local filesystem (creates parent directories as needed).
New files are created automatically. Overwriting an existing file requires overwrite: true so you don't
clobber contents you haven't seen — read the file first, and prefer edit_file for targeted changes to an
existing file. Relative paths resolve against the workspace root.`,
  inputSchema: z.object({
    path: z.string().min(1).describe("File path, relative to the workspace root or absolute."),
    content: z.string().describe("The full file contents to write."),
    overwrite: z
      .boolean()
      .optional()
      .describe("Set true to replace an existing file. Required when the target already exists."),
  }),
  async execute({ path, content, overwrite }) {
    const abs = resolveToRoot(path);
    const existing = await stat(abs).catch(() => null);
    if (existing) {
      if (!overwrite) {
        throw new Error(
          `${path} already exists. Read it first, then pass overwrite: true to replace it, ` +
            `or use edit_file to make targeted changes.`,
        );
      }
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    let oldBytes = null;
    if (existing) {
      try {
        oldBytes = (await readFile(abs)).length;
      } catch {
        oldBytes = null;
      }
    }
    return {
      path: displayPath(abs),
      absolutePath: abs,
      created: !existing,
      overwritten: Boolean(existing),
      wroteBytes: Buffer.byteLength(content, "utf8"),
    };
  },
});
