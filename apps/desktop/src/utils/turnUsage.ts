import type { ConversationTurn } from "@tracepilot/types";
import { formatNumber } from "@tracepilot/ui";

/** Tooltip for a turn's token badge: the full breakdown of its recorded
 *  model calls, when the source records usage per call. */
export function turnUsageTitle(turn: Pick<ConversationTurn, "usage">): string | undefined {
  const usage = turn.usage;
  if (!usage) return undefined;
  const calls = `${usage.modelCalls} model call${usage.modelCalls === 1 ? "" : "s"}`;
  return [
    `Output ${formatNumber(usage.outputTokens)}`,
    `input ${formatNumber(usage.inputTokens)} (cache read ${formatNumber(usage.cacheReadTokens)}, cache write ${formatNumber(usage.cacheWriteTokens)})`,
    calls,
  ].join(" · ");
}
