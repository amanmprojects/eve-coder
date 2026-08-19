import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { MAX_FILE_SIZE_BYTES } from "../lib/file-safety.js";
import { withFileMutationQueue } from "../lib/file-mutation-queue.js";
import { isBlockedDevicePath, isUNCPath } from "../lib/path-guards.js";
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

    if (isUNCPath(abs)) {
      throw new Error(`Cannot write to UNC path: ${path}. Use a local path instead.`);
    }
    if (await isBlockedDevicePath(abs)) {
      throw new Error(`Cannot write to device file: ${path}.`);
    }

    const contentBytes = Buffer.byteLength(content, "utf8");
    if (contentBytes > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `File would be too large (${(contentBytes / 1024).toFixed(1)}KB). Maximum size is ${MAX_FILE_SIZE_BYTES / 1024}KB.`,
      );
    }

    return withFileMutationQueue(abs, async () => {
      const existing = await stat(abs).catch(() => null);
      if (existing) {
        if (!overwrite) {
          throw new Error(
            `${path} already exists. Read it first, then pass overwrite: true to replace it, ` +
              `or use edit_file to make targeted changes.`,
          );
        }
      }
      // Capture the previous size *before* writing — reading afterwards would
      // return the new content's length, not the old file's.
      let oldBytes = null;
      if (existing) {
        oldBytes = await readFile(abs).then((b) => b.length).catch(() => null);
      }
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
      return {
        path: displayPath(abs),
        absolutePath: abs,
        created: !existing,
        overwritten: Boolean(existing),
        wroteBytes: Buffer.byteLength(content, "utf8"),
        oldBytes,
      };
    });
  },
});
