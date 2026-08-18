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

    // Reserve room for the right-hand side, then truncate the left to fit.
    const rightWidth = visibleWidth(right);
    const room = Math.max(1, width - rightWidth);
    const leftFitted = visibleWidth(left) > room ? truncateToWidth(left, room, "…") : left;
    const pad = " ".repeat(Math.max(0, width - visibleWidth(leftFitted) - rightWidth));
    return fillLine(leftFitted + pad + right, width, bgFn);
  }

  /** The collapsible body: streamed/finished output, or pre-run detail. */
  bodyText() {
    if (this.status === "pending") {
      const partial = this.output !== undefined
        ? renderOutput(this.toolName, this.output, this.input, false)
        : null;
      return partial ?? renderDetail(this.toolName, this.input);
    }
    return renderOutput(this.toolName, this.output, this.input, this.isError);
  }

  render(width) {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const bgFn = bgPainter(this.bgKey(), "toolOutput");
    const lines = [this.renderHeader(width, bgFn)];

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
              `  ${color("dim", `… (${skippedCount} ${where} line${skippedCount === 1 ? "" : "s"}, ctrl+o to expand)`)}`,
              width,
              bgFn,
            ),
          );
        }
      }
    }

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
      // Reasoning is prose, but models emit markdown in it; render it as
      // markdown with an italic dim default style, the way pi does.
      const md = new Markdown(this.text, 1, 0, this.mdTheme, {
        color: (t) => color("thinkingText", t),
        italic: true,
      });
      const rendered = md.render(width);
      if (this.expanded || rendered.length <= REASONING_PREVIEW_LINES) {
        lines = rendered;
      } else {
        const skipped = rendered.length - REASONING_PREVIEW_LINES;
        lines = [
          ...rendered.slice(rendered.length - REASONING_PREVIEW_LINES),
          ...new Text(
            color("dim", `… (${skipped} earlier reasoning line${skipped === 1 ? "" : "s"}, ctrl+o to expand)`),
            1,
            0,
          ).render(width),
        ];
      }
    }

    this.cachedWidth = width;
    this.cachedText = this.text;
    this.cachedLines = lines;
    return lines;
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
  }

  // --- plumbing ------------------------------------------------------------

  append(component) {
    this.container.addChild(component);
    this.requestRender();
    return component;
  }

  clear() {
    this.container.clear();
    this.liveAssistant = null;
    this.liveReasoning = null;
    this.toolBlocks.clear();
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
    this.append(
      new Text(`${sty.bold(color("accent", " › "))}${color("text", text)}`, 0, 0, bgPainter("userMsgBg")),
    );
    this.append(new Spacer(1));
  }

  /** A framework/CLI notice (not model output). */
  notice(text, role = "muted") {
    this.closeLive();
    this.append(new Text(color(role, text), 1, 0));
  }

  assistantDelta(soFar) {
    this.closeReasoning();
    if (this.liveAssistant) {
      this.liveAssistant.setText(soFar);
    } else {
      this.liveAssistant = this.append(new Markdown(soFar, 1, 0, this.mdTheme));
    }
    this.requestRender();
  }

  closeAssistant() {
    if (!this.liveAssistant) return;
    this.liveAssistant = null;
    this.append(new Spacer(1));
  }

  reasoningDelta(soFar) {
    // A new reasoning burst after assistant text belongs to the next step.
    if (this.liveAssistant) this.closeAssistant();
    if (this.liveReasoning) {
      this.liveReasoning.setText(soFar);
    } else {
      this.liveReasoning = this.append(
        new ReasoningBlock(soFar, { visible: this.showReasoning, expanded: this.expanded }),
      );
    }
    this.requestRender();
  }

  closeReasoning() {
    if (!this.liveReasoning) return;
    this.liveReasoning.finish();
    this.liveReasoning = null;
    this.append(new Spacer(1));
  }

  closeLive() {
    this.closeReasoning();
    this.closeAssistant();
  }

  // --- tools ---------------------------------------------------------------

  toolStart(callId, toolName, input) {
    this.closeLive();
    if (this.toolBlocks.has(callId)) return this.toolBlocks.get(callId);
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
