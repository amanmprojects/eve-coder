import { stat, writeFile } from "node:fs/promises";
import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  generateCompactDiff,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "../lib/edit-diff.js";
import { withFileMutationQueue } from "../lib/file-mutation-queue.js";
import { displayPath, readTextFileCap, resolveToRoot } from "../lib/workspace.js";

const editSchema = z.object({
  oldText: z.string().min(1).describe("Exact text to find. Must match exactly (whitespace-sensitive). A fuzzy fallback normalizes trailing whitespace and smart quotes."),
  newText: z.string().describe("Replacement text."),
  allowMultiple: z
    .boolean()
    .optional()
    .describe("Set true to replace every occurrence when oldText matches more than once."),
});

export default defineTool({
  description: `Make surgical, whitespace-exact replacements in a local file. Dangerous, irreversible changes are
avoided because each oldText MUST match exactly once (unless allowMultiple: true), so a stale or wrong edit
fails instead of silently corrupting the file. Read the file first. Multiple edits in one call are matched
against the original (not incrementally) and applied atomically; overlapping edits are rejected. The file's
UTF-8 BOM and original line endings (CRLF/LF) are preserved. If an exact match fails, a fuzzy fallback
(strip trailing whitespace, normalize smart quotes/dashes/spaces) is tried before erroring. Relative paths
resolve against the workspace root.`,
  inputSchema: z.object({
    path: z.string().min(1).describe("File path, relative to the workspace root or absolute."),
    edits: z
      .array(editSchema)
      .min(1)
      .describe("Ordered list of replacements to apply to the file."),
  }),
  async execute({ path, edits }) {
    const abs = resolveToRoot(path);
    return withFileMutationQueue(abs, async () => {
      const info = await stat(abs).catch(() => null);
      if (!info) throw new Error(`File not found: ${path} (resolved to ${abs}).`);
      if (info.isDirectory()) throw new Error(`${path} is a directory, not a file.`);
      const raw = await readTextFileCap(abs);
      if (raw === null) throw new Error(`${path} appears to be binary; edit_file only edits text files.`);

      // Preserve BOM and original line endings across the edit.
      const { bom, text } = stripBom(raw);
      const ending = detectLineEnding(text);
      const normalized = normalizeToLF(text);

      const { baseContent, newContent, usedFuzzyMatch, appliedCount } = applyEditsToNormalizedContent(
        normalized,
        edits,
        path,
      );

      const finalContent = bom + restoreLineEndings(newContent, ending);
      // Only write when bytes actually changed (line-ending/BOM math can make
      // newContent === baseContent while finalContent differs; guard both).
      if (finalContent === raw) {
        return {
          path: displayPath(abs),
          absolutePath: abs,
          editsApplied: 0,
          occurrences: 0,
          newBytes: Buffer.byteLength(finalContent, "utf8"),
          fuzzyMatch: usedFuzzyMatch,
          unchanged: true,
        };
      }

      await writeFile(abs, finalContent, "utf8");
      const { diff, firstChangedLine } = generateCompactDiff(baseContent, newContent);
      return {
        path: displayPath(abs),
        absolutePath: abs,
        editsApplied: edits.length,
        occurrences: appliedCount,
        newBytes: Buffer.byteLength(finalContent, "utf8"),
        fuzzyMatch: usedFuzzyMatch,
        firstChangedLine,
        diff,
      };
    });
  },
});
