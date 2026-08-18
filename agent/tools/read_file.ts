import { readFile, stat } from "node:fs/promises";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { detectSupportedImageMimeType } from "../lib/image-detect.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "../lib/truncate.js";
import { displayPath, numberLines, resolveToRoot, workspaceRoot } from "../lib/workspace.js";

export default defineTool({
  description: `Read a file from the local filesystem and print its contents with line numbers.
Relative paths resolve against the workspace root (${workspaceRoot}); absolute paths are used as-is.
Use offset/limit to page through large files a chunk at a time (1-based line numbers). Output is capped at
${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first); when truncated, a
next offset is suggested. Images are detected by signature and reported as such (not silently "binary").
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
      .optional()
      .describe("Maximum number of lines to read (default 2000)."),
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

    const buf = await readFile(abs);

    // Image files: report the type rather than treating them as opaque binary.
    const imageMime = detectSupportedImageMimeType(buf);
    if (imageMime) {
      return {
        path: displayPath(abs),
        absolutePath: abs,
        binary: true,
        image: true,
        mimeType: imageMime,
        size: buf.length,
        message: `Image file (${imageMime}, ${formatSize(buf.length)}). Not shown as text — inspect with bash if needed.`,
      };
    }

    // Binary guard: a NUL byte in the leading 8KB indicates non-text content.
    if (buf.subarray(0, 8192).includes(0)) {
      return {
        path: displayPath(abs),
        absolutePath: abs,
        binary: true,
        size: buf.length,
      };
    }

    const text = buf.toString("utf8");
    const allLines = text.split("\n");
    if (allLines.length > 0 && allLines[allLines.length - 1] === "") allLines.pop();
    const totalLines = allLines.length;

    const start = offset ? Math.min(Math.max(offset, 1), totalLines) : 1;
    if (offset && offset > totalLines) {
      throw new Error(`offset ${offset} is beyond end of file (${totalLines} lines).`);
    }

    const count = limit ? Math.max(1, limit) : DEFAULT_MAX_LINES;
    const desiredEnd = start - 1 + count;
    const slice = allLines.slice(start - 1, desiredEnd);
    const sliceText = slice.join("\n");

    // Cap by both the requested line count and the byte budget.
    const trunc = truncateHead(sliceText, { maxLines: count, maxBytes: DEFAULT_MAX_BYTES });

    if (trunc.firstLineExceedsLimit) {
      // The very first requested line is larger than the whole byte budget.
      return {
        path: displayPath(abs),
        absolutePath: abs,
        totalLines,
        startLine: start,
        lines: 0,
        truncated: true,
        truncatedBy: "bytes" as const,
        note: `Line ${start} is ${formatSize(Buffer.byteLength(allLines[start - 1] ?? "", "utf8"))}, exceeding the ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${start}p' ${path} | head -c ${DEFAULT_MAX_BYTES}`,
      };
    }

    const returnedLines = trunc.outputLines;
    const moreAfter = start - 1 + returnedLines < totalLines; // more lines remain below
    const cappedByBudget = trunc.truncated; // stopped early due to byte/line cap within the slice
    const truncated = moreAfter || cappedByBudget;
    const nextOffset = start + returnedLines;

    return {
      path: displayPath(abs),
      absolutePath: abs,
      totalLines,
      startLine: start,
      lines: returnedLines,
      truncated,
      truncatedBy: truncated ? (cappedByBudget ? trunc.truncatedBy ?? "bytes" : ("limit" as const)) : undefined,
      nextOffset: truncated ? nextOffset : undefined,
      note: truncated
        ? cappedByBudget
          ? `Showing ${returnedLines} of ${totalLines} lines from line ${start} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.`
          : `${totalLines - (start - 1 + returnedLines)} more lines remain. Use offset=${nextOffset} to continue.`
        : undefined,
      content: numberLines(trunc.content, start),
    };
  },
});
