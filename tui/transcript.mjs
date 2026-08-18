/**
 * Transcript components.
 *
 * The transcript is a `Container` of retained components. Live components
 * (streaming assistant text, the open reasoning block, in-flight tool blocks)
 * are mutated in place and re-rendered rather than rebuilt, so a long turn does
 * not churn the component list.
 *
 * Tool blocks are keyed by the eve `callId` that correlates
 * `actions.requested` → `action.partial` → `action.result`.
 */
import {
  Container,
  Markdown,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { bgPainter, color, fillLine, makeMarkdownTheme, sty } from "./theme.mjs";
import { formatDuration, truncateToVisualLines } from "./format.mjs";
import {
  prefersTail,
  renderDetail,
  renderOutput,
  renderStatus,
  renderTitle,
  toolLabel,
} from "./tools.mjs";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/** Wrapped-line budget for a collapsed tool block's body. */
const PREVIEW_LINES = 12;
/** Wrapped-line budget for a collapsed reasoning block. */
const REASONING_PREVIEW_LINES = 8;
/**
 * Maximum number of *raw* reasoning lines parsed as markdown per delta while
 * collapsed. The collapsed block only ever shows the last
 * `REASONING_PREVIEW_LINES` wrapped lines, so feeding the whole trace through
 * the markdown parser on every token is pure waste — and on a multi-thousand-
 * line trace it froze the TUI for over a second per render. Rendering only a
 * bounded tail makes the per-token cost constant regardless of trace length.
 * Expanded view still parses the full text (user-initiated and rare).
 */
const REASONING_TAIL_RAW_LINES = 48;

/** Shared animation clock so one timer drives every pending block. */
export const spinner = { frame: 0 };
export function spinnerChar() {
  return SPINNER_FRAMES[spinner.frame % SPINNER_FRAMES.length];
}

// ---------------------------------------------------------------------------
// Tool block
// ---------------------------------------------------------------------------

/**
 * One tool call: a filled band whose background encodes state (pending →
 * success/error), a one-line header, and a collapsible body.
 */
export class ToolBlock {
  constructor(callId, toolName, input, { expanded = false } = {}) {
    this.callId = callId;
    this.toolName = toolName ?? "tool";
    this.input = input;
    this.output = undefined;
    this.status = "pending"; // pending | completed | failed | rejected
    this.isError = false;
    this.error = null;
    this.expanded = expanded;
    this.startedAt = Date.now();
    this.endedAt = null;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  /** Streamed partial output while the tool is still running. */
  setPartial(output) {
    this.output = output;
    this.invalidate();
  }

  /** Terminal result for this call. */
  settle({ output, status, isError, error }) {
    if (output !== undefined) this.output = output;
    this.status = status ?? "completed";
    this.isError = Boolean(isError) || this.status === "failed" || this.status === "rejected";
    this.error = error ?? null;
    this.endedAt = Date.now();
    this.invalidate();
  }

  setExpanded(expanded) {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.invalidate();
  }

  get pending() {
    return this.status === "pending";
  }

  invalidate() {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  bgKey() {
    if (this.pending) return "toolPendingBg";
    return this.isError ? "toolErrorBg" : "toolSuccessBg";
  }

  /** `label` + args summary, with a spinner or duration on the right. */
  renderHeader(width, bgFn) {
    const label = toolLabel(this.toolName);
    const labelStyled = this.toolName === "bash"
      ? color("bashMode", sty.bold(label))
      : color("accent", sty.bold(label));

    const title = renderTitle(this.toolName, this.input);
    const left = ` ${labelStyled}${title ? ` ${color("toolTitle", title)}` : ""}`;

    const rightParts = [];
    if (this.pending) {
      rightParts.push(color("accent", spinnerChar()));
    } else {
      const toolStatus = this.error
        ? color("error", this.error.message ?? this.error.code ?? "failed")
        : renderStatus(this.toolName, this.output, this.input);
      if (toolStatus) rightParts.push(toolStatus);
      // A duration is only information if the call took long enough to notice.
      if (this.endedAt && this.endedAt - this.startedAt >= 100) {
        rightParts.push(color("dim", formatDuration(this.endedAt - this.startedAt)));
      }
    }
    const right = rightParts.length ? `${rightParts.join(" ")} ` : "";

    // The right side can carry an arbitrary-length error message, which must
    // never push the line past the terminal width (that crashed the TUI). Cap
    // it at half the line — ellipsizing the tail — so the tool name on the
    // left always stays visible; the full message remains readable in the body.
    const rightBudget = Math.max(1, Math.floor(width / 2) - 1);
    const rightFitted =
      visibleWidth(right) > rightBudget ? truncateToWidth(right, rightBudget, "…") : right;
    const rightWidth = visibleWidth(rightFitted);

    // Reserve room for the right-hand side, then truncate the left to fit.
    const room = Math.max(1, width - rightWidth);
    const leftFitted = visibleWidth(left) > room ? truncateToWidth(left, room, "…") : left;
    const pad = " ".repeat(Math.max(0, width - visibleWidth(leftFitted) - rightWidth));
    return fillLine(leftFitted + pad + rightFitted, width, bgFn);
  }

  /** The collapsible body: streamed/finished output, or pre-run detail. */
  bodyText() {
    if (this.status === "pending") {
      const partial = this.output !== undefined
        ? renderOutput(this.toolName, this.output, this.input, false)
        : null;
      return partial ?? renderDetail(this.toolName, this.input);
    }
    const rendered = renderOutput(this.toolName, this.output, this.input, this.isError);
    // A failed call may carry no output at all (the message lives only in the
    // header, where it is now truncated), so surface the message in the body
    // where it can wrap instead of vanishing.
    if (this.isError && this.error?.message) {
      const out = this.output;
      const empty =
        out == null ||
        String(out).trim() === "" ||
        (typeof out === "object" && Object.keys(out).length === 0);
      if (empty) return color("error", this.error.message);
    }
    return rendered;
  }

  render(width) {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const bgFn = bgPainter(this.bgKey(), "toolOutput");
    // pi wraps each tool call in a `Box(1,1)`: one bg-painted blank line above
    // and below the content. That pad is the block's own padding — separate
    // from the leading `Spacer(1)` the transcript prepends — and it is what
    // makes consecutive tools sit three blank lines apart while a tool next to
    // an assistant sits two.
    const lines = [fillLine("", width, bgFn), this.renderHeader(width, bgFn)];

    const body = this.bodyText();
    if (body && String(body).trim() !== "") {
      const text = String(body);
      if (this.expanded) {
        lines.push(...new Text(text, 2, 0, bgFn).render(width));
      } else {
        const { visualLines, skippedCount } = truncateToVisualLines(
          text,
          PREVIEW_LINES,
          width,
          2,
        );
        // truncateToVisualLines keeps the tail; re-slice from the head for
        // tools whose interesting part is the beginning.
        let shown = visualLines;
        if (skippedCount > 0 && !prefersTail(this.toolName)) {
          shown = new Text(text, 2, 0).render(width).slice(0, PREVIEW_LINES);
        }
        for (const line of shown) lines.push(fillLine(line, width, bgFn));
        if (skippedCount > 0) {
          const where = prefersTail(this.toolName) ? "earlier" : "more";
          lines.push(
            fillLine(
              truncateToWidth(
                `  ${color("dim", `… (${skippedCount} ${where} line${skippedCount === 1 ? "" : "s"}, ctrl+o to expand)`)}`,
                width,
                "…",
              ),
              width,
              bgFn,
            ),
          );
        }
      }
    }

    lines.push(fillLine("", width, bgFn));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}

// ---------------------------------------------------------------------------
// Reasoning block
// ---------------------------------------------------------------------------

/**
 * A model reasoning trace.
 *
 * `visible` collapses the whole trace to a single "Thinking…" line without
 * discarding the text, so toggling `/reasoning` reveals traces that already
 * streamed in.
 */
export class ReasoningBlock {
  constructor(text = "", { visible = true, expanded = false } = {}) {
    this.text = text;
    this.visible = visible;
    this.expanded = expanded;
    this.done = false;
    this.mdTheme = makeMarkdownTheme();
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.cachedText = undefined;
  }

  setText(text) {
    this.text = text;
    this.invalidate();
  }

  setVisible(visible) {
    if (this.visible === visible) return;
    this.visible = visible;
    this.invalidate();
  }

  setExpanded(expanded) {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.invalidate();
  }

  finish() {
    this.done = true;
    this.invalidate();
  }

  invalidate() {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.cachedText = undefined;
  }

  render(width) {
    if (this.cachedLines && this.cachedWidth === width && this.cachedText === this.text) {
      return this.cachedLines;
    }

    let lines;
    if (!this.text.trim()) {
      lines = [];
    } else if (!this.visible) {
      const label = this.done ? "✻ reasoning hidden (/reasoning to show)" : "✻ thinking…";
      lines = new Text(color("thinkingText", sty.italic(label)), 1, 0).render(width);
    } else {
      lines = this.renderReasoning(width);
    }

    this.cachedWidth = width;
    this.cachedText = this.text;
    this.cachedLines = lines;
    return lines;
  }

  /**
   * Render the visible reasoning trace as markdown.
   *
   * Reasoning is prose, but models emit markdown in it; it is rendered with an
   * italic dim default style, the way pi does. The expensive part is
   * `Markdown.render`, which re-parses its whole input on every change. While
   * streaming, the block only ever shows the last `REASONING_PREVIEW_LINES`
   * visual lines, so when collapsed we parse only a bounded tail of the raw
   * text — keeping the per-token cost constant regardless of how long the
   * trace has grown. Expanding (`ctrl+o`) still renders the full text.
   */
  renderReasoning(width) {
    const rawLines = this.text.split("\n");
    // Short traces, and any expanded view, render the whole text.
    const source =
      this.expanded || rawLines.length <= REASONING_TAIL_RAW_LINES
        ? this.text
        : rawLines.slice(rawLines.length - REASONING_TAIL_RAW_LINES).join("\n");

    const rendered = new Markdown(source, 1, 0, this.mdTheme, {
      color: (t) => color("thinkingText", t),
      italic: true,
    }).render(width);

    if (this.expanded || rendered.length <= REASONING_PREVIEW_LINES) {
      return rendered;
    }
    // Count hidden lines from the raw trace so the summary is cheap to compute
    // (a full visual re-render just to count would reintroduce the cliff).
    const skipped = Math.max(0, rawLines.length - REASONING_PREVIEW_LINES);
    return [
      ...rendered.slice(rendered.length - REASONING_PREVIEW_LINES),
      ...new Text(
        color("dim", `… (${skipped} earlier reasoning line${skipped === 1 ? "" : "s"}, ctrl+o to expand)`),
        1,
        0,
      ).render(width),
    ];
  }
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

/**
 * Owns the scrollback container and the live-component bookkeeping.
 *
 * `requestRender` is injected rather than reaching for a module-level TUI so
 * the transcript stays testable and has no import cycle with the client.
 */
export class Transcript {
  constructor(requestRender) {
    this.container = new Container();
    this.requestRender = requestRender ?? (() => {});
    this.mdTheme = makeMarkdownTheme();
    this.liveAssistant = null;
    this.liveReasoning = null;
    this.toolBlocks = new Map(); // callId → ToolBlock
    this.showReasoning = true;
    this.expanded = false;
    /** Tracks whether the last appended line was a notice, so a run of notices
     *  shares a single leading blank line the way pi's `showStatus` does. */
    this.lastWasNotice = false;
  }

  // --- plumbing ------------------------------------------------------------

  append(component) {
    this.container.addChild(component);
    this.requestRender();
    return component;
  }

  /**
   * Add a leading `Spacer(1)` before the next block, mirroring pi.
   *
   * pi gives every block (user, reasoning, tool, assistant) its own leading
   * `Spacer(1)` and never collapses it against the previous block's trailing
   * space. User and tool blocks *additionally* carry a top/bottom padding blank
   * (pi's `Box(paddingY=1)`); assistant/reasoning carry none. Composing those
   * yields pi's exact spacing:
   *   - two blank lines between most blocks (prev trailing pad + leading spacer,
   *     or leading spacer + next top pad),
   *   - three between consecutive tools (prev bottom pad + leading spacer +
   *     top pad),
   *   - one between adjacent assistant/reasoning (leading spacer only).
   */
  leadingSpacer() {
    if (this.container.children.length === 0) return;
    this.container.addChild(new Spacer(1));
  }

  clear() {
    this.container.clear();
    this.liveAssistant = null;
    this.liveReasoning = null;
    this.toolBlocks.clear();
    this.lastWasNotice = false;
    this.requestRender();
  }

  /** True while any tool block is still running (drives the spinner timer). */
  hasPending() {
    for (const block of this.toolBlocks.values()) if (block.pending) return true;
    return false;
  }

  // --- settings ------------------------------------------------------------

  setShowReasoning(visible) {
    this.showReasoning = visible;
    for (const child of this.container.children) {
      if (child instanceof ReasoningBlock) child.setVisible(visible);
    }
    this.requestRender();
  }

  setExpanded(expanded) {
    this.expanded = expanded;
    for (const child of this.container.children) {
      if (child instanceof ToolBlock || child instanceof ReasoningBlock) {
        child.setExpanded(expanded);
      }
    }
    this.requestRender();
  }

  // --- messages ------------------------------------------------------------

  addUser(text) {
    this.closeLive();
    this.leadingSpacer();
    this.lastWasNotice = false;
    // padY=1 reproduces pi's `Box(1,1)` around the user message: a bg-painted
    // blank line above and below the text. That top/bottom pad is what makes
    // the block sit two blank lines from its neighbours, matching pi.
    this.append(
      new Text(`${sty.bold(color("accent", " › "))}${color("text", text)}`, 0, 1, bgPainter("userMsgBg")),
    );
  }

  /** A framework/CLI notice (not model output). */
  notice(text, role = "muted") {
    this.closeLive();
    // A run of back-to-back notices shares one leading blank line; a notice
    // after any other block gets its own. Mirrors pi's `showStatus` coalescing.
    const kids = this.container.children;
    const last = kids.length > 0 ? kids[kids.length - 1] : undefined;
    if (kids.length > 0 && !(last instanceof Spacer) && !this.lastWasNotice) {
      this.container.addChild(new Spacer(1));
    }
    this.append(new Text(color(role, text), 1, 0));
    this.lastWasNotice = true;
  }

  assistantDelta(soFar) {
    this.closeReasoning();
    if (this.liveAssistant) {
      this.liveAssistant.setText(soFar);
    } else {
      this.leadingSpacer();
      this.liveAssistant = this.append(new Markdown(soFar, 1, 0, this.mdTheme));
    }
    this.lastWasNotice = false;
    this.requestRender();
  }

  closeAssistant() {
    if (!this.liveAssistant) return;
    this.liveAssistant = null;
  }

  reasoningDelta(soFar) {
    // A new reasoning burst after assistant text belongs to the next step.
    if (this.liveAssistant) this.closeAssistant();
    if (this.liveReasoning) {
      this.liveReasoning.setText(soFar);
    } else {
      this.leadingSpacer();
      this.liveReasoning = this.append(
        new ReasoningBlock(soFar, { visible: this.showReasoning, expanded: this.expanded }),
      );
    }
    this.lastWasNotice = false;
    this.requestRender();
  }

  closeReasoning() {
    if (!this.liveReasoning) return;
    this.liveReasoning.finish();
    this.liveReasoning = null;
  }

  closeLive() {
    this.closeReasoning();
    this.closeAssistant();
  }

  // --- tools ---------------------------------------------------------------

  toolStart(callId, toolName, input) {
    this.closeLive();
    if (this.toolBlocks.has(callId)) return this.toolBlocks.get(callId);
    this.leadingSpacer();
    this.lastWasNotice = false;
    const block = new ToolBlock(callId, toolName, input, { expanded: this.expanded });
    this.toolBlocks.set(callId, block);
    return this.append(block);
  }

  /**
   * Adopt a partial/result for a call we never saw requested.
   *
   * `action.partial` can arrive first on a reattach, where the snapshot starts
   * mid-turn, so the block is created on demand rather than dropped.
   */
  ensureBlock(callId, toolName, input) {
    return this.toolBlocks.get(callId) ?? this.toolStart(callId, toolName, input);
  }

  toolPartial(callId, toolName, output) {
    const block = this.ensureBlock(callId, toolName, undefined);
    block.setPartial(output);
    this.requestRender();
  }

  toolResult(callId, toolName, { output, status, isError, error }) {
    const block = this.ensureBlock(callId, toolName, undefined);
    block.settle({ output, status, isError, error });
    this.requestRender();
  }
}
