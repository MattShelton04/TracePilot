/**
 * useRequestLedger — one session's recorded model requests from the Copilot
 * CLI's own session store.
 *
 * The source is optional, so the composable keeps "the feature is off", "no
 * source is available" and "the source recorded nothing" apart rather than
 * collapsing them into an empty table. Paging is cursor-based and the cursor
 * belongs to a source generation: when the source is replaced mid-paging the
 * ledger restarts at page one instead of stitching two versions together.
 */

import {
  getRequestPerformance,
  getSessionRequestUsage,
  getSessionStoreStatus,
} from "@tracepilot/client";
import type {
  RequestLedgerPage,
  RequestPerformance,
  RequestUsageFilters,
  SessionCoverageRow,
  StoredRequest,
  StoreSourceStatus,
} from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/types";
import { useAsyncGuard } from "@tracepilot/ui";
import { computed, reactive, ref, watch } from "vue";
import { usePreferencesStore } from "@/stores/preferences";
import { sumNanoAiu } from "@/utils/requestLedger";

export const REQUEST_LEDGER_PAGE_SIZE = 25;

/** `any` is not a filter: it is the absence of one. */
export type CacheReuseFilter = "any" | "recorded" | "none";

export interface RequestLedgerFilterState {
  model: string | null;
  agentId: string | null;
  initiator: string | null;
  reasoningEffort: string | null;
  finishReason: string | null;
  cacheReuse: CacheReuseFilter;
}

export interface RequestLedgerFilterOptions {
  models: string[];
  agentIds: string[];
  initiators: string[];
  reasoningEfforts: string[];
  finishReasons: string[];
}

function emptyFilters(): RequestLedgerFilterState {
  return {
    model: null,
    agentId: null,
    initiator: null,
    reasoningEffort: null,
    finishReason: null,
    cacheReuse: "any",
  };
}

function toRequestFilters(state: RequestLedgerFilterState): RequestUsageFilters | undefined {
  const filters: RequestUsageFilters = {};
  if (state.model) filters.models = [state.model];
  if (state.agentId) filters.agentIds = [state.agentId];
  if (state.initiator) filters.initiators = [state.initiator];
  if (state.reasoningEffort) filters.reasoningEfforts = [state.reasoningEffort];
  if (state.finishReason) filters.finishReasons = [state.finishReason];
  // Requests that never recorded the counter belong to neither population,
  // so `any` must send no predicate at all rather than `null`.
  if (state.cacheReuse !== "any") filters.reportsCacheReuse = state.cacheReuse === "recorded";
  return Object.keys(filters).length > 0 ? filters : undefined;
}

export function useRequestLedger(
  sessionId: () => string | null,
  isActive: () => boolean = () => true,
) {
  const prefs = usePreferencesStore();
  const enabled = computed(() => prefs.isFeatureEnabled("sessionStoreEnrichment"));

  const page = ref<RequestLedgerPage | null>(null);
  const coverage = ref<SessionCoverageRow | null>(null);
  const source = ref<StoreSourceStatus | null>(null);
  const performance = ref<RequestPerformance | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const loaded = ref(false);
  /** Set when a cursor outlived its source generation and paging restarted. */
  const cursorReset = ref(false);

  const filters = reactive<RequestLedgerFilterState>(emptyFilters());
  const seen = reactive({
    models: new Set<string>(),
    agentIds: new Set<string>(),
    initiators: new Set<string>(),
    reasoningEfforts: new Set<string>(),
    finishReasons: new Set<string>(),
  });

  /** `history[i]` is the cursor that loaded page `i`; page one has none. */
  const history = ref<(string | null)[]>([null]);
  const pageIndex = ref(0);
  const guard = useAsyncGuard();

  const requests = computed<StoredRequest[]>(() => page.value?.requests ?? []);
  const available = computed(() => page.value?.available ?? false);
  const isEmpty = computed(() => available.value && requests.value.length === 0);
  const hasNextPage = computed(() => Boolean(page.value?.nextCursor));
  const hasPreviousPage = computed(() => pageIndex.value > 0);
  const pageNumber = computed(() => pageIndex.value + 1);
  /** Only the rows on screen: never presented as the session's total charge. */
  const pageCredits = computed(() => sumNanoAiu(requests.value));
  const activeFilterCount = computed(
    () =>
      (filters.model ? 1 : 0) +
      (filters.agentId ? 1 : 0) +
      (filters.initiator ? 1 : 0) +
      (filters.reasoningEffort ? 1 : 0) +
      (filters.finishReason ? 1 : 0) +
      (filters.cacheReuse === "any" ? 0 : 1),
  );

  const filterOptions = computed<RequestLedgerFilterOptions>(() => ({
    models: [...seen.models].sort(),
    agentIds: [...seen.agentIds].sort(),
    initiators: [...seen.initiators].sort(),
    reasoningEfforts: [...seen.reasoningEfforts].sort(),
    finishReasons: [...seen.finishReasons].sort(),
  }));

  function rememberOptions(rows: readonly StoredRequest[]): void {
    for (const row of rows) {
      if (row.model) seen.models.add(row.model);
      if (row.agentId) seen.agentIds.add(row.agentId);
      if (row.initiator) seen.initiators.add(row.initiator);
      if (row.reasoningEffort) seen.reasoningEfforts.add(row.reasoningEffort);
      if (row.finishReason) seen.finishReasons.add(row.finishReason);
    }
  }

  function resetSession(): void {
    guard.invalidate();
    page.value = null;
    coverage.value = null;
    source.value = null;
    performance.value = null;
    error.value = null;
    loaded.value = false;
    cursorReset.value = false;
    history.value = [null];
    pageIndex.value = 0;
    seen.models.clear();
    seen.agentIds.clear();
    seen.initiators.clear();
    seen.reasoningEfforts.clear();
    seen.finishReasons.clear();
    Object.assign(filters, emptyFilters());
  }

  async function fetchPage(cursor: string | null, index: number, retried = false): Promise<void> {
    const id = sessionId();
    if (!id || !enabled.value) return;
    const token = guard.start();
    loading.value = true;
    error.value = null;
    try {
      const response = await getSessionRequestUsage(id, {
        filters: toRequestFilters(filters),
        cursor,
        limit: REQUEST_LEDGER_PAGE_SIZE,
      });
      if (!guard.isValid(token)) return;

      if (response.page.cursorExpired && !retried) {
        // The rows behind this cursor are a different version of the source.
        cursorReset.value = true;
        history.value = [null];
        pageIndex.value = 0;
        await fetchPage(null, 0, true);
        return;
      }

      page.value = response.page;
      coverage.value = response.coverage;
      pageIndex.value = index;
      const next = history.value.slice(0, index + 1);
      next[index] = cursor;
      history.value = next;
      rememberOptions(response.page.requests);
      loaded.value = true;
    } catch (e) {
      if (guard.isValid(token)) error.value = toErrorMessage(e);
    } finally {
      if (guard.isValid(token)) loading.value = false;
    }
  }

  /** Source status and latency distributions describe the whole session. */
  async function fetchContext(): Promise<void> {
    const id = sessionId();
    if (!id || !enabled.value) return;
    const [status, perf] = await Promise.allSettled([
      getSessionStoreStatus(),
      getRequestPerformance(id),
    ]);
    if (status.status === "fulfilled") source.value = status.value.source;
    if (perf.status === "fulfilled") performance.value = perf.value.performance;
  }

  async function load(): Promise<void> {
    await Promise.all([fetchPage(null, 0), fetchContext()]);
  }

  async function nextPage(): Promise<void> {
    const cursor = page.value?.nextCursor;
    if (!cursor) return;
    await fetchPage(cursor, pageIndex.value + 1);
  }

  async function previousPage(): Promise<void> {
    if (pageIndex.value === 0) return;
    await fetchPage(history.value[pageIndex.value - 1] ?? null, pageIndex.value - 1);
  }

  /** Any filter change invalidates the cursor chain it was built from. */
  async function applyFilters(): Promise<void> {
    cursorReset.value = false;
    history.value = [null];
    await fetchPage(null, 0);
  }

  async function setAgentFilter(agentId: string): Promise<void> {
    filters.agentId = agentId;
    await applyFilters();
  }

  async function clearFilters(): Promise<void> {
    Object.assign(filters, emptyFilters());
    await applyFilters();
  }

  function dismissCursorReset(): void {
    cursorReset.value = false;
  }

  watch(
    [sessionId, enabled],
    () => {
      resetSession();
      if (isActive() && enabled.value && sessionId()) void load();
    },
    { immediate: true },
  );

  watch(isActive, (active) => {
    if (active && enabled.value && sessionId() && !loaded.value && !loading.value) void load();
  });

  return {
    enabled,
    loading,
    error,
    loaded,
    page,
    requests,
    coverage,
    source,
    performance,
    available,
    isEmpty,
    cursorReset,
    filters,
    filterOptions,
    activeFilterCount,
    pageCredits,
    pageNumber,
    hasNextPage,
    hasPreviousPage,
    load,
    nextPage,
    previousPage,
    applyFilters,
    setAgentFilter,
    clearFilters,
    dismissCursorReset,
  };
}

export type RequestLedger = ReturnType<typeof useRequestLedger>;
