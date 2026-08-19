/** Display formatting helpers shared by the TUI.
 *
 * Ported from tui/format.mjs — token/cost/duration/byte formatting matches
 * the old TUI so the numbers read the same.
 */

/** Compact token counts: 812, 3.4k, 122k, 1.2M. */
export function formatTokens(count: number): string {
  const n = Number(count) || 0;
  if (n < 1000) return String(Math.round(n));
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
  return `${Math.round(n / 1000000)}M`;
}

/** Cost in dollars, with enough precision to be useful at fractions of a cent. */
export function formatCost(usd: number): string {
  const n = Number(usd) || 0;
  if (n === 0) return "$0.000";
  if (n < 0.001) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(3)}`;
}

/** Elapsed wall time: 0.4s, 12.7s, 1m03s. */
export function formatDuration(ms: number): string {
  const n = Number(ms) || 0;
  if (n < 60000) return `${(n / 1000).toFixed(1)}s`;
  const mins = Math.floor(n / 60000);
  const secs = Math.floor((n % 60000) / 1000);
  return `${mins}m${String(secs).padStart(2, "0")}s`;
}

/** Byte counts: 812 B, 4.1 KB, 2.3 MB. */
export function formatBytes(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Collapse a value to a single line for use in a one-line header. */
export function oneLine(value: unknown, max = 200): string {
  const text = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Replace `$HOME` with `~` for display. */
export function shortenPath(p: string, home = process.env.HOME): string {
  if (!p || !home) return p ?? "";
  return p === home ? "~" : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
}
