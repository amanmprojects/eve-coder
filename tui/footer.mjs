/**
 * Footer and status line.
 *
 * The footer is the only place cumulative usage is displayed, and it is fed
 * exclusively from `step.completed.usage` — the provider-reported numbers eve
 * forwards — so it never estimates. The model shown comes from
 * `step.started.modelId` (the model the server actually called) rather than
 * `client.info()`, which reports `routing: "dynamic"` with no id once the agent
 * selects its model at runtime.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { color, effortColor, sty } from "./theme.mjs";
import { formatCost, formatTokens, shortenPath } from "./format.mjs";
import { spinnerChar } from "./transcript.mjs";

const HINTS = [
  ["esc", "interrupt"],
  ["ctrl+c", "cancel"],
  ["ctrl+d", "exit"],
  ["/", "commands"],
  ["@", "files"],
  ["ctrl+o", "expand"],
  ["ctrl+r", "reasoning"],
];

export function createUsageTotals() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, reasoning: 0 };
}

/**
 * Fold one `step.completed` usage payload into the running totals.
 * Every field is optional in the protocol; missing values contribute nothing.
 */
export function addUsage(totals, usage) {
  if (!usage || typeof usage !== "object") return totals;
  totals.input += Number(usage.inputTokens) || 0;
  totals.output += Number(usage.outputTokens) || 0;
  totals.cacheRead += Number(usage.cacheReadTokens) || 0;
  totals.cacheWrite += Number(usage.cacheWriteTokens) || 0;
  totals.cost += Number(usage.costUsd) || 0;
  totals.reasoning += Number(usage.reasoningTokens) || 0;
  return totals;
}

/** Prompt size for the step: everything the provider billed as input. */
export function promptTokens(usage) {
  if (!usage) return 0;
  return (
    (Number(usage.inputTokens) || 0) +
    (Number(usage.cacheReadTokens) || 0) +
    (Number(usage.cacheWriteTokens) || 0)
  );
}

/**
 * Two-line footer: cumulative usage on the left, model • effort on the right,
 * key hints underneath.
 */
export class Footer {
  constructor({ model = "", effort = "", workspace = "" } = {}) {
    this.totals = createUsageTotals();
    this.model = model;
    this.effort = effort;
    this.workspace = workspace;
    this.contextTokens = 0;
    this.contextWindow = 0;
    this.cacheHitRate = undefined;
    this.sessionId = null;
  }

  invalidate() {}

  setModel(model) {
    if (model) this.model = model;
  }

  setEffort(effort) {
    this.effort = effort ?? "";
  }

  setContextWindow(tokens) {
    this.contextWindow = Number(tokens) || 0;
  }

  setSessionId(id) {
    this.sessionId = id ?? null;
  }

  reset() {
    this.totals = createUsageTotals();
    this.contextTokens = 0;
    this.cacheHitRate = undefined;
  }

  /** Record a completed step's usage. */
  recordStep(usage) {
    addUsage(this.totals, usage);
    const prompt = promptTokens(usage);
    if (prompt > 0) {
      this.contextTokens = prompt;
      const cacheRead = Number(usage?.cacheReadTokens) || 0;
      this.cacheHitRate = (cacheRead / prompt) * 100;
    }
  }

  /** `↑20k ↓3.4k R122k W2.1k CH97.6% $0.008 122k/1.0M` */
  statsLeft() {
    const t = this.totals;
    const parts = [];
    if (t.input) parts.push(`↑${formatTokens(t.input)}`);
    if (t.output) parts.push(`↓${formatTokens(t.output)}`);
    if (t.cacheRead) parts.push(`R${formatTokens(t.cacheRead)}`);
    if (t.cacheWrite) parts.push(`W${formatTokens(t.cacheWrite)}`);
    if ((t.cacheRead || t.cacheWrite) && this.cacheHitRate !== undefined) {
      parts.push(`CH${this.cacheHitRate.toFixed(1)}%`);
    }
    if (t.cost) parts.push(formatCost(t.cost));

    if (this.contextTokens) {
      // Only show a percentage when the window size is actually known; showing
      // absolute context otherwise beats inventing a denominator.
      if (this.contextWindow) {
        const pct = (this.contextTokens / this.contextWindow) * 100;
        const label = `${pct.toFixed(1)}%/${formatTokens(this.contextWindow)}`;
        parts.push(pct > 90 ? color("error", label) : pct > 70 ? color("warning", label) : label);
      } else {
        parts.push(`${formatTokens(this.contextTokens)} ctx`);
      }
    }
    return parts.join(" ");
  }

  statsRight() {
    const model = this.model || "no-model";
    if (!this.effort || this.effort === "provider-default") return model;
    return `${model} ${color("dim", "•")} ${color(effortColor(this.effort), this.effort)}`;
  }

  render(width) {
    const left = this.statsLeft();
    const right = this.statsRight();
    const lw = visibleWidth(left);
    const rw = visibleWidth(right);

    let statsLine;
    if (lw + 2 + rw <= width) {
      statsLine = color("dim", left) + " ".repeat(width - lw - rw) + right;
    } else if (rw + 2 <= width) {
      statsLine = color("dim", truncateToWidth(left, Math.max(0, width - rw - 2), "…")) + "  " + right;
    } else {
      statsLine = truncateToWidth(right, width, "…");
    }

    const hints = HINTS.map(([k, v]) => `${color("muted", k)} ${color("dim", v)}`).join(
      color("subtle", " · "),
    );
    return [statsLine, truncateToWidth(hints, width, color("dim", "…"))];
  }
}

/**
 * The one-line activity indicator above the editor.
 *
 * Animates off the transcript's shared spinner clock so there is a single timer
 * for the whole UI.
 */
export class StatusLine {
  constructor() {
    this.message = "";
    this.busy = false;
    this.detail = "";
  }

  invalidate() {}

  set(message, { busy = false, detail = "" } = {}) {
    this.message = message ?? "";
    this.busy = busy;
    this.detail = detail;
  }

  clear() {
    this.message = "";
    this.busy = false;
    this.detail = "";
  }

  render(width) {
    if (!this.message) return [];
    const lead = this.busy ? `${color("accent", spinnerChar())} ` : "";
    const detail = this.detail ? ` ${color("dim", this.detail)}` : "";
    return [truncateToWidth(` ${lead}${this.message}${detail}`, width, color("dim", "…"))];
  }
}

/** Startup banner shown once, above the first turn. */
export function banner(model, effort, workspace) {
  const where = shortenPath(workspace) || "no workspace";
  return [
    `${color("accent", sty.bold("eve-coder"))} ${color("dim", "·")} ${color("text", model || "model")}`,
    `${color("dim", where)}  ${color("subtle", "·")}  ${color("dim", `effort ${effort}`)}  ${color("subtle", "·")}  ${color("muted", "/help")}`,
  ].join("\n");
}
