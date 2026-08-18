/**
 * Shared truncation utilities for tool outputs.
 *
 * Truncation is based on two independent limits — whichever is hit first wins:
 * - a line limit (default 2000 lines)
 * - a byte limit (default 50KB)
 *
 * Never returns partial lines (head truncation); tail truncation may return a
 * partial first line only when a single line exceeds the byte budget.
 *
 * Ported in spirit from pi's `harness/utils/truncate.ts`, but dependency-free
 * (uses Node's Buffer for UTF-8 byte lengths) and trimmed to what these tools
 * need.
 */

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
export const GREP_MAX_LINE_LENGTH = 500; // max chars per grep match/context line

export interface TruncationResult {
  /** The truncated (or untruncated) content. */
  content: string;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
  /** True only for tail truncation when a single line exceeded the byte budget. */
  lastLinePartial: boolean;
  /** True only for head truncation when the first line alone exceeds the byte budget. */
  firstLineExceedsLimit: boolean;
  maxLines: number;
  maxBytes: number;
}

export interface TruncationOptions {
  maxLines?: number;
  maxBytes?: number;
}

/** Human-readable byte size, e.g. `48.0KB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function utf8ByteLength(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

function splitLinesForCounting(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

/**
 * Truncate from the head (keep the first N lines/bytes). Suitable for file
 * reads and search output where you want the beginning. Never returns partial
 * lines; if the first line alone exceeds the byte budget, returns empty content
 * with `firstLineExceedsLimit: true`.
 */
export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const totalBytes = utf8ByteLength(content);
  const lines = splitLinesForCounting(content);
  const totalLines = lines.length;

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    };
  }

  const firstLineBytes = utf8ByteLength(lines[0] ?? "");
  if (firstLineBytes > maxBytes) {
    return {
      content: "",
      truncated: true,
      truncatedBy: "bytes",
      totalLines,
      totalBytes,
      outputLines: 0,
      outputBytes: 0,
      lastLinePartial: false,
      firstLineExceedsLimit: true,
      maxLines,
      maxBytes,
    };
  }

  const out: string[] = [];
  let outBytes = 0;
  let truncatedBy: "lines" | "bytes" = "lines";

  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const line = lines[i];
    const lineBytes = utf8ByteLength(line) + (i > 0 ? 1 : 0); // +1 for newline
    if (outBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }
    out.push(line);
    outBytes += lineBytes;
  }

  if (out.length >= maxLines && outBytes <= maxBytes) truncatedBy = "lines";

  const contentOut = out.join("\n");
  return {
    content: contentOut,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: out.length,
    outputBytes: utf8ByteLength(contentOut),
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  };
}

/**
 * Truncate from the tail (keep the last N lines/bytes). Suitable for shell
 * output where the result/error is at the end. May return a partial first line
 * only when a single line exceeds the byte budget.
 */
export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const totalBytes = utf8ByteLength(content);
  const lines = splitLinesForCounting(content);
  const totalLines = lines.length;

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    };
  }

  const out: string[] = [];
  let outBytes = 0;
  let truncatedBy: "lines" | "bytes" = "lines";
  let lastLinePartial = false;

  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const line = lines[i];
    const lineBytes = utf8ByteLength(line) + (out.length > 0 ? 1 : 0);
    if (outBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      // Single line larger than the whole budget: keep its tail (partial).
      if (out.length === 0) {
        const bytes = Buffer.from(line, "utf8");
        let start = bytes.length - maxBytes;
        if (start < 0) start = 0;
        while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
        const partial = bytes.subarray(start).toString("utf8");
        out.unshift(partial);
        outBytes = utf8ByteLength(partial);
        lastLinePartial = true;
      }
      break;
    }
    out.unshift(line);
    outBytes += lineBytes;
  }

  if (out.length >= maxLines && outBytes <= maxBytes) truncatedBy = "lines";

  const contentOut = out.join("\n");
  return {
    content: contentOut,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: out.length,
    outputBytes: utf8ByteLength(contentOut),
    lastLinePartial,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  };
}

/**
 * Truncate a single line to `maxChars`, marking whether it was shortened. Used
 * by grep so a minified file can't flood the context with one giant line.
 */
export function truncateLine(line: string, maxChars = GREP_MAX_LINE_LENGTH): { text: string; wasTruncated: boolean } {
  if (line.length <= maxChars) return { text: line, wasTruncated: false };
  return { text: `${line.slice(0, maxChars)}…`, wasTruncated: true };
}

/**
 * Strip non-printable control characters (except \t \n \r) so binary command
 * output doesn't confuse the model or corrupt the transcript. Ported from pi's
 * `sanitizeBinaryOutput`.
 */
export function sanitizeBinaryOutput(str: string): string {
  let out = "";
  for (const char of str) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += char;
      continue;
    }
    if (code <= 0x1f) continue; // C0 control chars
    if (code >= 0xfff9 && code <= 0xfffb) continue; // interlinear annotation
    out += char;
  }
  return out;
}
