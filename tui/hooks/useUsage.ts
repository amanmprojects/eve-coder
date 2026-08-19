import { useMemo } from "react";
import type { MessageStreamEvent } from "eve/client";
import { formatTokens, formatCost } from "../utils/format";

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  reasoning: number;
}

function createUsageTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, reasoning: 0 };
}

function addUsage(totals: UsageTotals, usage: Record<string, unknown> | undefined): void {
  if (!usage || typeof usage !== "object") return;
  totals.input += Number(usage.inputTokens) || 0;
  totals.output += Number(usage.outputTokens) || 0;
  totals.cacheRead += Number(usage.cacheReadTokens) || 0;
  totals.cacheWrite += Number(usage.cacheWriteTokens) || 0;
  totals.cost += Number(usage.costUsd) || 0;
  totals.reasoning += Number(usage.reasoningTokens) || 0;
}

/**
 * Derive cumulative usage from the raw eve stream events.
 *
 * Scans for `step.completed` events, which carry the provider-reported usage
 * payload. The context-window percentage uses the latest step's inputTokens
 * (the current context the model was just handed), not a running sum.
 */
export function useUsage(
  events: readonly MessageStreamEvent[],
  contextWindowTokens: number,
): { totals: UsageTotals; contextTokens: number; cacheHitRate: number | undefined; statsLeft: string } {
  return useMemo(() => {
    const totals = createUsageTotals();
    let contextTokens = 0;

    for (const event of events) {
      if (event.type === "step.completed") {
        const usage = (event.data ?? {}) as Record<string, unknown>;
        addUsage(totals, usage);
        const prompt = Number(usage.inputTokens) || 0;
        if (prompt > 0) contextTokens = prompt;
      }
    }

    const cacheHitRate = totals.input > 0 ? (totals.cacheRead / totals.input) * 100 : undefined;

    const parts: string[] = [];
    if (totals.input) parts.push(`↑${formatTokens(totals.input)}`);
    if (totals.output) parts.push(`↓${formatTokens(totals.output)}`);
    if (totals.cacheRead) parts.push(`R${formatTokens(totals.cacheRead)}`);
    if (totals.cacheWrite) parts.push(`W${formatTokens(totals.cacheWrite)}`);
    if ((totals.cacheRead || totals.cacheWrite) && cacheHitRate !== undefined) {
      parts.push(`CH${cacheHitRate.toFixed(1)}%`);
    }
    if (totals.cost) parts.push(formatCost(totals.cost));

    if (contextTokens) {
      if (contextWindowTokens) {
        const pct = (contextTokens / contextWindowTokens) * 100;
        parts.push(pct > 90 ? `!${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`);
      } else {
        parts.push(`${formatTokens(contextTokens)} ctx`);
      }
    }

    return { totals, contextTokens, cacheHitRate, statsLeft: parts.join(" ") };
  }, [events, contextWindowTokens]);
}
