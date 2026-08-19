/** Shared palette for the OpenTUI-based TUI.
 *
 * Uses hex colors that OpenTUI renders natively, replacing the old pi-tui
 * ANSI escape-code theme. The roles mirror the old theme.mjs palette so
 * the visual identity is preserved.
 */
export const theme = {
  bg: "#000000",
  panel: "#1a1a2a",
  stripBar: "#141419",
  sidebarBg: "#0d0d12",

  accent: "#8abeb7",
  text: "#d4d4d4",
  muted: "#808080",
  dim: "#666666",
  subtle: "#505050",

  success: "#b5bd68",
  error: "#cc6666",
  warning: "#ffff00",
  cyan: "#00d7ff",
  blue: "#5f87ff",

  borderSubtle: "#333333",
  border: "#5f87ff",
  borderAccent: "#00d7ff",
  borderMuted: "#505050",
  cursor: "#ffffff",

  // User/tool block backgrounds (match pi dark theme)
  userBg: "#343541",
  toolPendingBg: "#1a1a24",
  toolSuccessBg: "#1a241a",
  toolErrorBg: "#241a1a",

  // Markdown syntax
  mdHeading: "#f0c674",
  mdLink: "#81a2be",
  mdCode: "#8abeb7",
  mdCodeBlock: "#b5bd68",
  mdQuote: "#808080",
  mdListBullet: "#8abeb7",

  // Reasoning effort colors
  thinkingOff: "#505050",
  thinkingMinimal: "#6e6e6e",
  thinkingLow: "#5f87af",
  thinkingMedium: "#81a2be",
  thinkingHigh: "#b294bb",
  thinkingXhigh: "#d183e8",
  thinkingMax: "#ff5fff",
} as const;

/** Reasoning-effort level → color, for the footer indicator. */
export function effortColor(level: string): string {
  const map: Record<string, string> = {
    "provider-default": theme.muted,
    none: theme.thinkingOff,
    minimal: theme.thinkingMinimal,
    low: theme.thinkingLow,
    medium: theme.thinkingMedium,
    high: theme.thinkingHigh,
    xhigh: theme.thinkingXhigh,
  };
  return map[level] ?? theme.muted;
}
