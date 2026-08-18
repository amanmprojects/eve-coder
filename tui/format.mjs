/**
 * Display formatting helpers shared by the transcript and footer.
 *
 * Token/cost formatting matches pi's footer so the two shells read the same.
 */
import { Text, visibleWidth } from "@earendil-works/pi-tui";

/** Compact token counts: 812, 3.4k, 122k, 1.2M. */
export function formatTokens(count) {
  const n = Number(count) || 0;
  if (n < 1000) return String(Math.round(n));
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
  return `${Math.round(n / 1000000)}M`;
}

/** Cost in dollars, with enough precision to be useful at fractions of a cent. */
export function formatCost(usd) {
  const n = Number(usd) || 0;
  if (n === 0) return "$0.000";
  if (n < 0.001) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(3)}`;
}

/** Elapsed wall time: 0.4s, 12.7s, 1m03s. */
export function formatDuration(ms) {
  const n = Number(ms) || 0;
  if (n < 60000) return `${(n / 1000).toFixed(1)}s`;
  const mins = Math.floor(n / 60000);
  const secs = Math.floor((n % 60000) / 1000);
  return `${mins}m${String(secs).padStart(2, "0")}s`;
}

/** Byte counts: 812 B, 4.1 KB, 2.3 MB. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Collapse a value to a single line for use in a one-line header. */
export function oneLine(value, max = 200) {
  const text = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Replace `$HOME` with `~` for display. */
export function shortenPath(p, home = process.env.HOME) {
  if (!p || !home) return p ?? "";
  return p === home ? "~" : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
}

/**
 * Truncate `text` to the last `maxVisualLines` *wrapped* lines at `width`.
 *
 * Counting wrapped lines rather than newlines is what keeps a collapsed block
 * the same visual height regardless of how long its individual lines are. This
 * mirrors pi's `visual-truncate.ts`, which measures by rendering a throwaway
 * `Text` at the target width.
 *
 * Returns the trailing slice, because for command output the end is the part
 * you want to see.
 */
export function truncateToVisualLines(text, maxVisualLines, width, paddingX = 0) {
  const probe = new Text(text, paddingX, 0);
  const rendered = probe.render(Math.max(1, width));
  if (rendered.length <= maxVisualLines) {
    return { visualLines: rendered, skippedCount: 0 };
  }
  return {
    visualLines: rendered.slice(rendered.length - maxVisualLines),
    skippedCount: rendered.length - maxVisualLines,
  };
}

/** Left-align `left` and right-align `right` on one line of `width` columns. */
export function justify(left, right, width) {
  const lw = visibleWidth(left);
  const rw = visibleWidth(right);
  if (lw + rw + 1 > width) return left;
  return left + " ".repeat(Math.max(1, width - lw - rw)) + right;
}
