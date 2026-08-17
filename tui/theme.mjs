// pi "dark" theme, ported to dependency-free 24-bit ANSI.
// Color values and roles from
//   packages/coding-agent/src/modes/interactive/theme/dark.json
// Rendered without chalk so the TUI has zero color deps at runtime.

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
  // markdown
  mdHeading: "#f0c674",
  mdLink: "#81a2be",
  mdCode: "#8abeb7",
  mdCodeBlock: "#b5bd68",
  mdQuote: "#808080",
  mdListBullet: "#8abeb7",
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
  userBg: "userMsgBg",
  toolPendingBg: "toolPendingBg",
  toolSuccessBg: "toolSuccessBg",
  toolErrorBg: "toolErrorBg",
  thinking: "dimGray",
  mdHeading: "mdHeading",
  mdLink: "mdLink",
  mdCode: "mdCode",
  mdCodeBlock: "mdCodeBlock",
  mdQuote: "mdQuote",
  mdListBullet: "mdListBullet",
};

function rgb16(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Foreground code for a palette key. `key` may be a hex string too. */
export function fgCode(key) {
  const h = key?.startsWith("#") ? key : palette[key] ?? palette.text;
  const [r, g, b] = rgb16(h);
  return `\x1b[38;2;${r};${g};${b}m`;
}
/** Background code for a palette key. */
export function bgCode(key) {
  const h = key?.startsWith("#") ? key : palette[key] ?? palette.selectedBg;
  const [r, g, b] = rgb16(h);
  return `\x1b[48;2;${r};${g};${b}m`;
}

/** Paint `text` in a named color (resets at the end). */
export function color(key, text) {
  return `${fgCode(key)}${text}${RESET}`;
}
/** Paint `text` on a background + optional fg. */
export function paintOn(bgKey, text, fgKey) {
  return `${bgCode(bgKey)}${fgKey ? fgCode(fgKey) : ""}${text}${RESET}`;
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
