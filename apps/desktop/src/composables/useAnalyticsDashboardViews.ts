import { usePersistedRef } from "@tracepilot/ui";
import { effectScope, type Ref } from "vue";
import { STORAGE_KEYS } from "@/config/storageKeys";
import type { ActivityMetric } from "@/utils/analyticsDashboard";

/** The Analytics dashboard's view choices, kept across visits and restarts. */
export interface AnalyticsDashboardViews {
  activityMetric: ActivityMetric;
  activityStyle: "bars" | "lines";
  costView: "sources" | "running";
  incidentsView: "tiles" | "chart";
  incidentsScale: "count" | "per100";
}

export const DEFAULT_ANALYTICS_VIEWS: AnalyticsDashboardViews = {
  activityMetric: "cost",
  activityStyle: "bars",
  costView: "sources",
  incidentsView: "tiles",
  incidentsScale: "count",
};

const ALLOWED: { [K in keyof AnalyticsDashboardViews]: readonly AnalyticsDashboardViews[K][] } = {
  activityMetric: ["cost", "tokens", "runs"],
  activityStyle: ["bars", "lines"],
  costView: ["sources", "running"],
  incidentsView: ["tiles", "chart"],
  incidentsScale: ["count", "per100"],
};

/** Keep each stored choice that is still an option; default the rest. */
export function readAnalyticsViews(raw: string): AnalyticsDashboardViews {
  const stored = JSON.parse(raw) as Record<string, unknown> | null;
  const views = { ...DEFAULT_ANALYTICS_VIEWS };
  for (const key of Object.keys(ALLOWED) as (keyof AnalyticsDashboardViews)[]) {
    const value = stored?.[key];
    if ((ALLOWED[key] as readonly unknown[]).includes(value)) {
      (views as Record<string, unknown>)[key] = value;
    }
  }
  return views;
}

let shared: Ref<AnalyticsDashboardViews> | null = null;

/**
 * One shared ref, so every panel and every visit sees the same choices. It
 * lives in a detached scope: its write-back must outlive the first page.
 */
export function useAnalyticsDashboardViews(): Ref<AnalyticsDashboardViews> {
  shared ??=
    effectScope(true).run(() =>
      usePersistedRef(
        STORAGE_KEYS.analyticsDashboardViews,
        { ...DEFAULT_ANALYTICS_VIEWS },
        {
          serializer: { read: readAnalyticsViews, write: (value) => JSON.stringify(value) },
        },
      ),
    ) ?? null;
  return shared as Ref<AnalyticsDashboardViews>;
}

/** For tests: forget the shared ref so the next call reads storage again. */
export function resetAnalyticsDashboardViews(): void {
  shared = null;
}
