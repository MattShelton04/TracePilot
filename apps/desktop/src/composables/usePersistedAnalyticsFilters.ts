import { SESSION_SOURCES, type SessionSource } from "@tracepilot/types";
import { usePersistedRef } from "@tracepilot/ui";
import { ref, watch } from "vue";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { useSessionsStore } from "@/stores/sessions";
import type { AnalyticsTimeRange } from "@/utils/analyticsFilters";

/** The analytics pages' filters, kept across visits and restarts. */
export interface AnalyticsFilters {
  repo: string | null;
  source: SessionSource | null;
  range: AnalyticsTimeRange;
  /** The custom range's bounds, kept while a preset is selected. */
  fromDate?: string;
  toDate?: string;
}

const DEFAULT_ANALYTICS_FILTERS: AnalyticsFilters = {
  repo: null,
  source: null,
  range: "all",
};

const RANGES: readonly AnalyticsTimeRange[] = [
  "all",
  "7d",
  "30d",
  "90d",
  "month-to-date",
  "custom",
];

function readDate(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}

/** Keep each stored filter that is still valid; default the rest. */
export function readAnalyticsFilters(raw: string): AnalyticsFilters {
  const stored = JSON.parse(raw) as Record<string, unknown> | null;
  let range = RANGES.find((r) => r === stored?.range) ?? "all";
  let fromDate = readDate(stored?.fromDate);
  let toDate = readDate(stored?.toDate);
  if (fromDate && toDate && fromDate > toDate) {
    fromDate = undefined;
    toDate = undefined;
    if (range === "custom") range = "all";
  }
  return {
    repo: typeof stored?.repo === "string" && stored.repo ? stored.repo : null,
    source: SESSION_SOURCES.find((s) => s === stored?.source) ?? null,
    range,
    fromDate,
    toDate,
  };
}

/**
 * The analytics store's filter refs, restored from storage and written back
 * on every change. A remembered repository or source that no session has any
 * more is dropped, but only once the session list is known: before it loads,
 * every repository would look missing.
 */
export function usePersistedAnalyticsFilters() {
  const stored = usePersistedRef(
    STORAGE_KEYS.analyticsFilters,
    { ...DEFAULT_ANALYTICS_FILTERS },
    { serializer: { read: readAnalyticsFilters, write: (value) => JSON.stringify(value) } },
  );
  const initial = stored.value;
  const selectedRepo = ref<string | null>(initial.repo);
  const selectedSource = ref<SessionSource | null>(initial.source);
  const selectedTimeRange = ref<AnalyticsTimeRange>(initial.range);
  const customFromDate = ref<string | undefined>(initial.fromDate);
  const customToDate = ref<string | undefined>(initial.toDate);

  watch(
    [selectedRepo, selectedSource, selectedTimeRange, customFromDate, customToDate],
    ([repo, source, range, fromDate, toDate]) => {
      stored.value = { repo, source, range, fromDate, toDate };
    },
  );

  if (selectedRepo.value !== null || selectedSource.value !== null) {
    const sessions = useSessionsStore();
    // Sync, so a page waiting on the session list loads without the stale filter.
    const dropMissing = () => {
      if (selectedRepo.value !== null && !sessions.repositories.includes(selectedRepo.value)) {
        selectedRepo.value = null;
      }
      if (selectedSource.value !== null && !sessions.sources.includes(selectedSource.value)) {
        selectedSource.value = null;
      }
    };
    if (sessions.sessions.length > 0) dropMissing();
    else watch(() => sessions.sessions, dropMissing, { once: true, flush: "sync" });
  }

  return { selectedRepo, selectedSource, selectedTimeRange, customFromDate, customToDate };
}
