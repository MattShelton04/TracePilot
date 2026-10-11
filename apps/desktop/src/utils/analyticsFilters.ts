/**
 * Analytics filters: the parameters every analytics request takes, the dates
 * a preset range covers, and the cache keys built from them.
 */
import type { SessionSource } from "@tracepilot/types";

/** Parameters for analytics fetch operations */
export interface AnalyticsFetchParams {
  fromDate?: string;
  toDate?: string;
  repo?: string;
  hideEmpty?: boolean;
  source?: SessionSource;
}

export type AnalyticsTimeRange = "all" | "7d" | "30d" | "90d" | "month-to-date" | "custom";

/** Datasets an analytics page can load and prefetch. */
export type AnalyticsDatasetName =
  | "analytics"
  | "toolAnalysis"
  | "codeImpact"
  | "agents"
  | "skills";

export interface AnalyticsDateRange {
  fromDate?: string;
  toDate?: string;
}

/** Preset ranges prefetched around the current filters. */
export const PREFETCH_RANGES = ["all", "7d", "30d", "90d"] as const;

/** The dates a preset range covers today. */
export function presetRange(range: Exclude<AnalyticsTimeRange, "custom">): AnalyticsDateRange {
  if (range === "all") return {};
  if (range === "month-to-date") {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    return { fromDate: `${yyyy}-${mm}-01` };
  }
  const days = { "7d": 7, "30d": 30, "90d": 90 }[range];
  const from = new Date();
  from.setDate(from.getDate() - days);
  const yyyy = from.getFullYear();
  const mm = String(from.getMonth() + 1).padStart(2, "0");
  const dd = String(from.getDate()).padStart(2, "0");
  return { fromDate: `${yyyy}-${mm}-${dd}` };
}

export const filterKey = (params: AnalyticsFetchParams) =>
  `${params.fromDate ?? ""}:${params.toDate ?? ""}:${params.repo ?? ""}:${params.hideEmpty ?? ""}:${params.source ?? ""}`;

export const cacheKey = (dataset: AnalyticsDatasetName) => (params: AnalyticsFetchParams) =>
  `${dataset}:${filterKey(params)}`;
