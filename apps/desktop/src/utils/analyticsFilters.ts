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

const DAY_MS = 86_400_000;
const PRESET_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;

/**
 * The dates a preset range covers today, in UTC days because that is how the
 * index buckets activity. "7 Days" is today and the six UTC days before it,
 * the same span the Agents and Skills ranges use (`usage/range.ts`).
 */
export function presetRange(
  range: Exclude<AnalyticsTimeRange, "custom">,
  now: Date = new Date(),
): AnalyticsDateRange {
  if (range === "all") return {};
  if (range === "month-to-date") {
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    return { fromDate: `${yyyy}-${mm}-01` };
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const from = new Date(today - (PRESET_DAYS[range] - 1) * DAY_MS);
  return { fromDate: from.toISOString().slice(0, 10) };
}

export const filterKey = (params: AnalyticsFetchParams) =>
  `${params.fromDate ?? ""}:${params.toDate ?? ""}:${params.repo ?? ""}:${params.hideEmpty ?? ""}:${params.source ?? ""}`;

export const cacheKey = (dataset: AnalyticsDatasetName) => (params: AnalyticsFetchParams) =>
  `${dataset}:${filterKey(params)}`;
