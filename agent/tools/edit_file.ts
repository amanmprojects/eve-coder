import { stat, writeFile } from "node:fs/promises";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { displayPath, readTextFileCap, resolveToRoot } from "../lib/workspace.js";

const editSchema = z.object({
  oldText: z.string().min(1).describe("Exact text to find. Must match exactly (whitespace-sensitive)."),
  newText: z.string().describe("Replacement text."),
  allowMultiple: z
    .boolean()
    .optional()
    .describe("Set true to replace every occurrence when oldText matches more than once."),
});

export default defineTool({
  description: `Make surgical, whitespace-exact replacements in a local file. Dangerous, irreversible changes are
avoided because each oldText MUST match exactly once (unless allowMultiple: true), so a stale or wrong edit
fails instead of silently corrupting the file. Read the file first. Multiple edits in one call are applied
in order to the same file. Relative paths resolve against the workspace root.`,
  inputSchema: z.object({
    path: z.string().min(1).describe("File path, relative to the workspace root or absolute."),
    edits: z
      .array(editSchema)
      .min(1)
      .describe("Ordered list of replacements to apply to the file."),
  }),
  async execute({ path, edits }) {
    const abs = resolveToRoot(path);
    const info = await stat(abs).catch(() => null);
    if (!info) throw new Error(`File not found: ${path} (resolved to ${abs}).`);
    if (info.isDirectory()) throw new Error(`${path} is a directory, not a file.`);
    const text = await readTextFileCap(abs);
    if (text === null) throw new Error(`${path} appears to be binary; edit_file only edits text files.`);

    let current = text;
    const applied = [];
    for (const edit of edits) {
      const count = current.split(edit.oldText).length - 1;
      if (count === 0) {
        throw new Error(
          `oldText ${JSON.stringify(edit.oldText)} was not found in ${path}. ` +
            `File is unchanged — no edits were written. Check whitespace/content and re-read the file.`,
        );
      }
      if (count > 1 && !edit.allowMultiple) {
        throw new Error(
          `oldText ${JSON.stringify(edit.oldText)} matches ${count} times in ${path}. ` +
            `Make oldText more specific/unique, or set allowMultiple: true. File is unchanged.`,
        );
      }
      current = edit.allowMultiple
        ? current.split(edit.oldText).join(edit.newText)
        : current.replace(edit.oldText, edit.newText);
      applied.push({ oldText: edit.oldText, newText: edit.newText, occurrences: count });
    }

    await writeFile(abs, current, "utf8");
    return {
      path: displayPath(abs),
      absolutePath: abs,
      editsApplied: applied.length,
      occurrences: applied.reduce((n, a) => n + a.occurrences, 0),
      newBytes: Buffer.byteLength(current, "utf8"),
    };
  },
});
