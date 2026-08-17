// Minimal ANSI styling + a MarkdownTheme for pi-tui's Markdown renderer.
// No external color dependency; we emit raw SGR escape sequences the same way
// pi does via chalk.

const ESC = "\x1b[";
const sgr = (code, text) => `${ESC}${code}m${text}${ESC}0m`;

export const sty = {
  bold: (t) => sgr(1, t),
  dim: (t) => sgr(2, t),
  italic: (t) => sgr(3, t),
  underline: (t) => sgr(4, t),
  red: (t) => sgr(31, t),
  green: (t) => sgr(32, t),
  yellow: (t) => sgr(33, t),
  blue: (t) => sgr(34, t),
  magenta: (t) => sgr(35, t),
  cyan: (t) => sgr(36, t),
  gray: (t) => sgr(90, t),
  cyanBright: (t) => sgr(96, t),
  greenBright: (t) => sgr(92, t),
  redBright: (t) => sgr(91, t),
  yellowBright: (t) => sgr(93, t),
  bgUnderline: (t) => sgr(4, t),
};

/**
 * A MarkdownTheme for @earendil-works/pi-tui's Markdown component.
 * All style callbacks receive already-rendered content and return styled text.
 */
export function makeMarkdownTheme() {
  return {
    heading: (t) => sty.bold(sty.cyanBright(t)),
    link: (t) => sty.underline(sty.blue(t)),
    linkUrl: (t) => sty.dim(sty.gray(t)),
    code: (t) => sty.cyan(t),
    codeBlock: (t) => t,
    codeBlockBorder: (t) => sty.dim(sty.gray(t)),
    quote: (t) => sty.dim(t),
    quoteBorder: (t) => sty.dim(t),
    hr: (t) => sty.dim(t),
    listBullet: (t) => sty.cyanBright(t),
    bold: (t) => sty.bold(t),
    italic: (t) => sty.italic(t),
    strikethrough: (t) => sgr(9, t),
    underline: (t) => sty.underline(t),
    codeBlockIndent: "  ",
  };
}
