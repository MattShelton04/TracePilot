import type { AnalyticsData } from "@tracepilot/types";

export type AnalyticsCostBasis = "legacy" | "directApi";

export interface CostPoint {
  date: string;
  cost: number;
}

type ComputeWholesaleCost = (
  model: string,
  inputTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
  cacheWriteTokens?: number,
) => number | null;

export function buildAnalyticsCostSeries(
  data: AnalyticsData,
  basis: AnalyticsCostBasis,
  costPerPremiumRequest: number,
  computeWholesaleCost: ComputeWholesaleCost,
): CostPoint[] {
  if (basis === "legacy") {
    return data.costByDay.map((p) => ({
      date: p.date,
      cost: p.cost * costPerPremiumRequest,
    }));
  }

  const totalsByDate = new Map<string, number>();
  for (const usage of data.modelUsageByDay) {
    const cost =
      computeWholesaleCost(
        usage.model,
        usage.inputTokens,
        usage.cacheReadTokens,
        usage.outputTokens,
        usage.cacheWriteTokens,
      ) ?? 0;
    totalsByDate.set(usage.date, (totalsByDate.get(usage.date) ?? 0) + cost);
  }

  return Array.from(totalsByDate, ([date, cost]) => ({ date, cost })).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}
