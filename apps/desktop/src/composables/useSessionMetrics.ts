/**
 * Pure computation functions for session metrics.
 * Extracted from SessionComparisonView to enable reuse across views.
 */
import type { ConversationTurn, SessionDetail, ShutdownMetrics } from "@tracepilot/types";

export function totalTokens(m: ShutdownMetrics | null): number {
  if (!m?.modelMetrics) return 0;
  return Object.values(m.modelMetrics).reduce((sum, mm) => {
    return sum + (mm.usage?.inputTokens ?? 0) + (mm.usage?.outputTokens ?? 0);
  }, 0);
}

export function totalInputTokens(m: ShutdownMetrics | null): number {
  if (!m?.modelMetrics) return 0;
  return Object.values(m.modelMetrics).reduce((s, mm) => s + (mm.usage?.inputTokens ?? 0), 0);
}

export function totalOutputTokens(m: ShutdownMetrics | null): number {
  if (!m?.modelMetrics) return 0;
  return Object.values(m.modelMetrics).reduce((s, mm) => s + (mm.usage?.outputTokens ?? 0), 0);
}

export function totalCacheRead(m: ShutdownMetrics | null): number {
  if (!m?.modelMetrics) return 0;
  return Object.values(m.modelMetrics).reduce((s, mm) => s + (mm.usage?.cacheReadTokens ?? 0), 0);
}

export function wholesaleCost(
  m: ShutdownMetrics | null,
  computeWholesaleCost: (
    model: string,
    input: number,
    cache: number,
    output: number,
  ) => number | null,
): number {
  if (!m?.modelMetrics) return 0;
  return Object.entries(m.modelMetrics).reduce((sum, [model, mm]) => {
    const cost = computeWholesaleCost(
      model,
      mm.usage?.inputTokens ?? 0,
      mm.usage?.cacheReadTokens ?? 0,
      mm.usage?.outputTokens ?? 0,
    );
    return sum + (cost ?? 0);
  }, 0);
}

export function copilotCost(m: ShutdownMetrics | null, costPerPremiumRequest: number): number {
  if (!m) return 0;
  return (m.totalPremiumRequests ?? 0) * costPerPremiumRequest;
}

export function totalToolCalls(turns: ConversationTurn[]): number {
  return turns.reduce((s, t) => s + (t.toolCalls?.length ?? 0), 0);
}

export function successRate(turns: ConversationTurn[]): number {
  let total = 0;
  let success = 0;
  for (const t of turns) {
    for (const tc of t.toolCalls ?? []) {
      total++;
      if (tc.success === true) success++;
    }
  }
  return total === 0 ? 1 : success / total;
}

export function toolCounts(turns: ConversationTurn[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of turns) {
    for (const tc of t.toolCalls ?? []) {
      counts[tc.toolName] = (counts[tc.toolName] ?? 0) + 1;
    }
  }
  return counts;
}

export function sessionDurationMs(detail: SessionDetail | null): number {
  if (!detail?.createdAt || !detail?.updatedAt) return 0;
  return new Date(detail.updatedAt).getTime() - new Date(detail.createdAt).getTime();
}

export function linesChanged(m: ShutdownMetrics | null): number {
  return (m?.codeChanges?.linesAdded ?? 0) + (m?.codeChanges?.linesRemoved ?? 0);
}

export function filesModified(m: ShutdownMetrics | null): number {
  return m?.codeChanges?.filesModified?.length ?? 0;
}

export function healthScore(turns: ConversationTurn[]): number {
  if (turns.length === 0) return 0;
  const sr = successRate(turns);
  const avgToolsPerTurn = totalToolCalls(turns) / turns.length;
  const efficiencyPenalty = Math.min(avgToolsPerTurn / 20, 0.3);
  return Math.max(0, Math.min(1, sr - efficiencyPenalty));
}
