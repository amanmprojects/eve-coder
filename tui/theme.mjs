// pi "dark" theme, ported to dependency-free 24-bit ANSI.
// Color values and roles from
//   packages/coding-agent/src/modes/interactive/theme/dark.json
// Rendered without chalk so the TUI has zero color deps at runtime.

import { visibleWidth } from "@earendil-works/pi-tui";

const RESET = "\x1b[0m";

/** pi dark.json `vars` + the markdown/syntax colors we use in the shell. */
const palette = {
  // vars
  cyan: "#00d7ff",
  blue: "#5f87ff",
  green: "#b5bd68",
  red: "#cc6666",
  yellow: "#ffff00",
  text: "#d4d4d4",
  gray: "#808080",
  dimGray: "#666666",
  darkGray: "#505050",
  accent: "#8abeb7",
  selectedBg: "#3a3a4a",
  userMsgBg: "#343541",
  toolPendingBg: "#282832",
  toolSuccessBg: "#283228",
  toolErrorBg: "#3c2828",
  customMsgBg: "#2d2838",
  customMsgLabel: "#9575cd",
  // markdown
  mdHeading: "#f0c674",
  mdLink: "#81a2be",
  mdCode: "#8abeb7",
  mdCodeBlock: "#b5bd68",
  mdQuote: "#808080",
  mdListBullet: "#8abeb7",
  // reasoning-effort indicator (dark.json `thinking*`)
  thinkingOff: "#505050",
  thinkingMinimal: "#6e6e6e",
  thinkingLow: "#5f87af",
  thinkingMedium: "#81a2be",
  thinkingHigh: "#b294bb",
  thinkingXhigh: "#d183e8",
  thinkingMax: "#ff5fff",
};

/** Semantic role → palette key (mirrors dark.json `colors` we use). */
export const theme = {
  accent: "accent",
  text: "text",
  muted: "gray",
  dim: "dimGray",
  subtle: "darkGray",
  success: "green",
  error: "red",
  warning: "yellow",
  cyan: "cyan",
  blue: "blue",
  border: "blue",
  borderAccent: "cyan",
  borderMuted: "darkGray",
  userBg: "userMsgBg",
  userMessageBg: "userMsgBg",
  customMessageBg: "customMsgBg",
  customMessageLabel: "customMsgLabel",
  toolPendingBg: "toolPendingBg",
  toolSuccessBg: "toolSuccessBg",
  toolErrorBg: "toolErrorBg",
  toolTitle: "text",
  toolOutput: "gray",
  toolDiffAdded: "green",
  toolDiffRemoved: "red",
  toolDiffContext: "gray",
  bashMode: "green",
  thinking: "dimGray",
  thinkingText: "gray",
  mdHeading: "mdHeading",
  mdLink: "mdLink",
  mdCode: "mdCode",
  mdCodeBlock: "mdCodeBlock",
  mdQuote: "mdQuote",
  mdListBullet: "mdListBullet",
};

/** Reasoning-effort level → palette key, for the footer indicator. */
const EFFORT_COLORS = {
  "provider-default": "gray",
  none: "thinkingOff",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
};

/** Paint a reasoning-effort label in its level color. */
export function effortColor(level) {
  return EFFORT_COLORS[level] ?? "gray";
}

function rgb16(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Resolve a color name to a hex value.
 *
 * Accepts a semantic role (`"error"`), a raw palette key (`"red"`), or a literal
 * hex string. Roles resolve through `theme` first so `color("error", …)` picks
 * up `palette.red` rather than silently falling back to the default text color.
 */
function resolveHex(key, fallback) {
  if (!key) return fallback;
  if (key.startsWith("#")) return key;
  const viaRole = theme[key];
  if (viaRole) {
    if (viaRole.startsWith("#")) return viaRole;
    if (palette[viaRole]) return palette[viaRole];
  }
  return palette[key] ?? fallback;
}

/** Foreground code for a role, palette key, or hex string. */
export function fgCode(key) {
  const [r, g, b] = rgb16(resolveHex(key, palette.text));
  return `\x1b[38;2;${r};${g};${b}m`;
}
/** Background code for a role, palette key, or hex string. */
export function bgCode(key) {
  const [r, g, b] = rgb16(resolveHex(key, palette.selectedBg));
  return `\x1b[48;2;${r};${g};${b}m`;
}

/** Paint `text` in a named color (resets at the end). */
export function color(key, text) {
  return `${fgCode(key)}${text}${RESET}`;
}

/**
 * Build a full-line background painter for `Text`'s `customBgFn` slot.
 *
 * Nested styling (`sty.bold`, `color`) emits `\x1b[0m`, which would otherwise
 * drop the background for the rest of the line. Re-opening the background after
 * every inner reset is what chalk does for nested styles, and it is required for
 * the filled tool/user blocks to render as solid bands.
 */
export function bgPainter(bgKey, fgKey) {
  const open = `${bgCode(bgKey)}${fgKey ? fgCode(fgKey) : ""}`;
  return (text) => `${open}${String(text).split(RESET).join(RESET + open)}${RESET}`;
}

/** Paint `text` on a background + optional fg. */
export function paintOn(bgKey, text, fgKey) {
  return bgPainter(bgKey, fgKey)(text);
}

/**
 * Pad `line` to `width` visible columns and paint it with `bgFn`.
 * Mirrors pi-tui's internal `applyBackgroundToLine`, which is not exported.
 */
export function fillLine(line, width, bgFn) {
  const padding = " ".repeat(Math.max(0, width - visibleWidth(line)));
  return bgFn(line + padding);
}

// Named SGR helpers (compatible with the old `sty` API).
const paint = (code, text) => `${code}${text}${RESET}`;
export const sty = {
  bold: (t) => paint("\x1b[1m", t),
  dim: (t) => paint("\x1b[2m", t),
  italic: (t) => paint("\x1b[3m", t),
  underline: (t) => paint("\x1b[4m", t),
  reverse: (t) => paint("\x1b[7m", t),
  red: (t) => color("error", t),
  green: (t) => color("success", t),
  yellow: (t) => color("warning", t),
  blue: (t) => color("blue", t),
  cyan: (t) => color("cyan", t),
  magenta: (t) => paint("\x1b[35m", t),
  gray: (t) => color("muted", t),
};

/**
 * A MarkdownTheme for @earendil-works/pi-tui's Markdown component, mapped to
 * pi's dark palette.
 */
export function makeMarkdownTheme() {
  return {
    heading: (t) => color("mdHeading", sty.bold(t)),
    link: (t) => color("mdLink", sty.underline(t)),
    linkUrl: (t) => color("dim", t),
    code: (t) => color("mdCode", t),
    codeBlock: (t) => color("mdCodeBlock", t),
    codeBlockBorder: (t) => color("muted", t),
    quote: (t) => color("mdQuote", t),
    quoteBorder: (t) => color("mdQuote", t),
    hr: (t) => color("muted", t),
    listBullet: (t) => color("mdListBullet", t),
    bold: (t) => sty.bold(t),
    italic: (t) => sty.italic(t),
    strikethrough: (t) => `[9m${t}${RESET}`,
    underline: (t) => sty.underline(t),
    codeBlockIndent: "  ",
  };
}
