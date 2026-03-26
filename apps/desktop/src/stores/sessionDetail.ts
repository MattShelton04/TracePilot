import { defineStore } from "pinia";
import { ref, type Ref } from "vue";
import type {
  SessionDetail,
  ConversationTurn,
  EventsResponse,
  TodosResponse,
  CheckpointEntry,
  ShutdownMetrics,
  SessionIncident,
  SessionPlan,
} from "@tracepilot/types";
import {
  getSessionDetail,
  getSessionTurns,
  checkSessionFreshness,
  getSessionEvents,
  getSessionTodos,
  getSessionCheckpoints,
  getSessionPlan,
  getShutdownMetrics,
  getSessionIncidents,
} from "@tracepilot/client";
import { toErrorMessage } from "@tracepilot/ui";
import { logError, logWarn } from "@/utils/logger";
import { useAsyncGuard, type AsyncGuardToken } from "@/composables/useAsyncGuard";

export const useSessionDetailStore = defineStore("sessionDetail", () => {
  const sessionId = ref<string | null>(null);
  const detail = ref<SessionDetail | null>(null);
  const turns = ref<ConversationTurn[]>([]);
  const events = ref<EventsResponse | null>(null);
  const todos = ref<TodosResponse | null>(null);
  const checkpoints = ref<CheckpointEntry[]>([]);
  const plan = ref<SessionPlan | null>(null);
  const shutdownMetrics = ref<ShutdownMetrics | null>(null);
  const incidents = ref<SessionIncident[]>([]);

  const loading = ref(false);
  const error = ref<string | null>(null);
  const loaded = ref<Set<string>>(new Set());

  // Per-section error state — surfaces failures to the UI instead of silent console.error
  const turnsError = ref<string | null>(null);
  const eventsError = ref<string | null>(null);
  const todosError = ref<string | null>(null);
  const checkpointsError = ref<string | null>(null);
  const planError = ref<string | null>(null);
  const metricsError = ref<string | null>(null);
  const incidentsError = ref<string | null>(null);

  // Track file size for freshness detection (avoids redundant turn re-fetches)
  let lastEventsFileSize = 0;

  // ── Frontend session cache (last 5 sessions) ────────────────────────
  // Caches all loaded section data so switching between recently viewed
  // sessions restores the UI instantly without any IPC roundtrip.
  interface CachedSession {
    detail: SessionDetail;
    turns: ConversationTurn[];
    eventsFileSize: number;
    checkpoints: CheckpointEntry[];
    plan: SessionPlan | null;
    shutdownMetrics: ShutdownMetrics | null;
    incidents: SessionIncident[];
    loadedSections: Set<string>;
  }
  const SESSION_CACHE_SIZE = 10;
  const sessionCache = new Map<string, CachedSession>();

  function saveToCache(id: string) {
    if (!detail.value) return;
    sessionCache.set(id, {
      detail: detail.value,
      turns: turns.value,
      eventsFileSize: lastEventsFileSize,
      checkpoints: checkpoints.value,
      plan: plan.value,
      shutdownMetrics: shutdownMetrics.value,
      incidents: incidents.value,
      loadedSections: new Set(loaded.value),
    });
    if (sessionCache.size > SESSION_CACHE_SIZE) {
      const oldest = sessionCache.keys().next().value;
      if (oldest) sessionCache.delete(oldest);
    }
  }

  // Guard against stale async responses when user switches sessions quickly
  const sessionGuard = useAsyncGuard();
  const eventsGuard = useAsyncGuard();

  // ── Section loader factory ───────────────────────────────────────────
  // Eliminates boilerplate across load functions that share identical
  // guard / fetch / stale-token / error-handling logic.
  function buildSectionLoader<T>(opts: {
    key: string;
    errorRef: Ref<string | null>;
    fetchFn: (id: string) => Promise<T>;
    onResult: (result: T) => void;
    logLevel?: 'error' | 'warn';
  }) {
    return async () => {
      const id = sessionId.value;
      if (!id || loaded.value.has(opts.key)) return;
      const token = sessionGuard.current();
      opts.errorRef.value = null;

      try {
        const result = await opts.fetchFn(id);
        if (!sessionGuard.isValid(token)) return;
        opts.onResult(result);
        loaded.value.add(opts.key);
      } catch (e) {
        if (!sessionGuard.isValid(token)) return;
        opts.errorRef.value = toErrorMessage(e);
        const logFn = opts.logLevel === 'warn' ? logWarn : logError;
        logFn(`[sessionDetail] Failed to load ${opts.key}:`, e);
      }
    };
  }

  // ── Section refresh helper ──────────────────────────────────────────
  // Used by refreshAll() for sections that follow the simple pattern:
  // fetch → assign result → clear error (on success).
  // Unlike buildSectionLoader, this clears errorRef on *success* (not before
  // the fetch), preserving the previous error during the refresh attempt.
  function buildRefreshPromise(
    cfg: {
      key: string;
      errorRef: Ref<string | null>;
      fetchFn: (id: string) => Promise<unknown>;
      onResult: (result: unknown) => void;
      logLevel?: 'error' | 'warn';
    },
    id: string,
    token: AsyncGuardToken,
  ): Promise<void> {
    return cfg.fetchFn(id).then((result) => {
      if (!sessionGuard.isValid(token)) return;
      cfg.onResult(result);
      cfg.errorRef.value = null;
    }).catch((e) => {
      if (!sessionGuard.isValid(token)) return;
      cfg.errorRef.value = toErrorMessage(e);
      const logFn = cfg.logLevel === 'warn' ? logWarn : logError;
      logFn(`[sessionDetail] Failed to refresh ${cfg.key}:`, e);
    });
  }

  // ── Section registry ────────────────────────────────────────────────
  // Defines standard section config ONCE. Used by loaders, refreshAll,
  // clearSectionErrors, and resetSectionData — eliminating duplicate
  // key/errorRef/fetchFn/onResult mappings.
  //
  // Sections NOT in this registry (require custom logic):
  //   detail — uses global `error` ref + loading spinner + cache
  //   turns  — has lastEventsFileSize side-effect + freshness check
  //   events — uses eventsGuard + pagination args
  //
  // NOTE: Cache save/restore paths (saveToCache, loadDetail cache-hit,
  // prefetchSession) still enumerate fields manually because CachedSession
  // has a different shape. Update those when adding a new cached section.
  function defineSection<T>(config: {
    key: string;
    errorRef: Ref<string | null>;
    dataRef: Ref<T>;
    defaultValue: () => T;
    fetchFn: (id: string) => Promise<T>;
    logLevel?: 'error' | 'warn';
  }) {
    const load = buildSectionLoader({
      key: config.key,
      errorRef: config.errorRef,
      fetchFn: config.fetchFn,
      onResult: (result) => { config.dataRef.value = result; },
      logLevel: config.logLevel,
    });

    return {
      key: config.key,
      errorRef: config.errorRef,
      load,
      clearError: () => { config.errorRef.value = null; },
      resetData: () => { config.dataRef.value = config.defaultValue(); },
      buildRefresh: (id: string, token: number) =>
        buildRefreshPromise({
          key: config.key,
          errorRef: config.errorRef,
          fetchFn: config.fetchFn,
          onResult: (r) => { config.dataRef.value = r as T; },
          logLevel: config.logLevel,
        }, id, token),
    };
  }

  const todosDef = defineSection({
    key: 'todos', errorRef: todosError, dataRef: todos,
    defaultValue: () => null as TodosResponse | null,
    fetchFn: (id) => getSessionTodos(id),
  });

  const checkpointsDef = defineSection({
    key: 'checkpoints', errorRef: checkpointsError, dataRef: checkpoints,
    defaultValue: () => [] as CheckpointEntry[],
    fetchFn: (id) => getSessionCheckpoints(id),
  });

  const planDef = defineSection({
    key: 'plan', errorRef: planError, dataRef: plan,
    defaultValue: () => null as SessionPlan | null,
    fetchFn: (id) => getSessionPlan(id),
  });

  const metricsDef = defineSection({
    key: 'metrics', errorRef: metricsError, dataRef: shutdownMetrics,
    defaultValue: () => null as ShutdownMetrics | null,
    fetchFn: (id) => getShutdownMetrics(id),
  });

  const incidentsDef = defineSection({
    key: 'incidents', errorRef: incidentsError, dataRef: incidents,
    defaultValue: () => [] as SessionIncident[],
    fetchFn: (id) => getSessionIncidents(id),
    logLevel: 'warn',
  });

  const standardSections = [todosDef, checkpointsDef, planDef, metricsDef, incidentsDef];

  /** Clear all per-section error refs (used on session switch / reset). */
  function clearSectionErrors() {
    turnsError.value = null;   // special case: custom loader with lastEventsFileSize
    eventsError.value = null;  // special case: uses eventsGuard + pagination
    for (const sec of standardSections) {
      sec.clearError();
    }
  }

  /** Reset all section data refs to their initial (empty) state.
   *  Used on full session switch (cache miss) and on store reset.
   *  Do NOT use in the cache-hit path — that restores specific fields. */
  function resetSectionData() {
    detail.value = null;
    turns.value = [];
    events.value = null;
    for (const sec of standardSections) {
      sec.resetData();
    }
    loaded.value.clear();
    lastEventsFileSize = 0;
  }

  async function loadDetail(id: string) {
    if (sessionId.value === id && loaded.value.has("detail")) {
      return;
    }

    // Save current session before switching
    if (sessionId.value && loaded.value.has("detail")) {
      saveToCache(sessionId.value);
    }

    const token = sessionGuard.start();
    sessionId.value = id;
    error.value = null;
    clearSectionErrors();

    // Check frontend cache for instant restore
    const cached = sessionCache.get(id);
    if (cached) {
      // Restore ALL sections immediately — zero IPC, zero spinner
      detail.value = cached.detail;
      turns.value = cached.turns;
      lastEventsFileSize = cached.eventsFileSize;
      checkpoints.value = cached.checkpoints;
      plan.value = cached.plan;
      shutdownMetrics.value = cached.shutdownMetrics;
      incidents.value = cached.incidents;
      loaded.value = new Set(cached.loadedSections);
      loading.value = false;
      // Events & todos intentionally NOT cached (paginated / rarely viewed)
      events.value = null;
      todos.value = null;

      // Background refresh: silently update stale data
      getSessionDetail(id).then((result) => {
        if (!sessionGuard.isValid(token)) return;
        detail.value = result;
      }).catch(() => {});
      checkSessionFreshness(id).then(async (freshness) => {
        if (!sessionGuard.isValid(token)) return;
        if (freshness.eventsFileSize === lastEventsFileSize) return;
        const result = await getSessionTurns(id);
        if (!sessionGuard.isValid(token)) return;
        turns.value = result.turns;
        lastEventsFileSize = result.eventsFileSize;
      }).catch(() => {});
      if (loaded.value.has("plan")) {
        getSessionPlan(id).then((result) => {
          if (!sessionGuard.isValid(token)) return;
          plan.value = result;
        }).catch(() => {});
      }
      return;
    }

    // Cache miss — full load with loading spinner
    loading.value = true;
    resetSectionData();

    try {
      const result = await getSessionDetail(id);
      if (!sessionGuard.isValid(token)) return;
      detail.value = result;
      loaded.value.add("detail");
    } catch (e) {
      if (!sessionGuard.isValid(token)) return;
      detail.value = null;
      error.value = toErrorMessage(e);
    } finally {
      if (sessionGuard.isValid(token)) loading.value = false;
    }
  }

  const loadTurns = buildSectionLoader({
    key: 'turns',
    errorRef: turnsError,
    fetchFn: (id) => getSessionTurns(id),
    onResult: (result) => {
      turns.value = result.turns;
      lastEventsFileSize = result.eventsFileSize;
    },
  });

  async function loadEvents(offset = 0, limit = 100, eventType?: string) {
    const id = sessionId.value;
    if (!id) return;
    const sessionToken = sessionGuard.current();
    const eventsToken = eventsGuard.start();
    eventsError.value = null;

    try {
      const result = await getSessionEvents(id, offset, limit, eventType);
      if (!sessionGuard.isValid(sessionToken) || !eventsGuard.isValid(eventsToken)) return;
      events.value = result;
      loaded.value.add("events");
    } catch (e) {
      if (!sessionGuard.isValid(sessionToken) || !eventsGuard.isValid(eventsToken)) return;
      eventsError.value = toErrorMessage(e);
      logError("[sessionDetail] Failed to load events:", e);
    }
  }


  function reset() {
    sessionGuard.invalidate();
    eventsGuard.invalidate();
    sessionId.value = null;
    resetSectionData();
    loading.value = false;
    error.value = null;
    clearSectionErrors();
    sessionCache.clear();
  }

  /**
   * Soft-refresh all previously loaded sections without clearing existing data.
   * Preserves UI state (selections, scroll, pagination) by not resetting refs.
   */
  async function refreshAll() {
    const id = sessionId.value;
    if (!id) return;
    const token = sessionGuard.current();
    const sections = new Set(loaded.value);

    const promises: Promise<void>[] = [];

    // Detail uses the global `error` ref (not a section errorRef), so it
    // stays as a one-off instead of going through buildRefreshPromise.
    if (sections.has("detail")) {
      promises.push(
        getSessionDetail(id).then((result) => {
          if (!sessionGuard.isValid(token)) return;
          detail.value = result;
        }).catch((e) => {
          if (!sessionGuard.isValid(token)) return;
          logError("[sessionDetail] Failed to refresh detail:", e);
        })
      );
    }

    // Turns have a freshness-check short-circuit, so they stay as a custom block.
    if (sections.has("turns")) {
      promises.push(
        (async () => {
          // Freshness check: skip full turn fetch if events.jsonl hasn't changed
          try {
            const freshness = await checkSessionFreshness(id);
            if (!sessionGuard.isValid(token)) return;
            if (freshness.eventsFileSize === lastEventsFileSize) return;
          } catch {
            // Freshness check failed — fall through to full fetch
          }

          const result = await getSessionTurns(id);
          if (!sessionGuard.isValid(token)) return;
          turns.value = result.turns;
          turnsError.value = null;
          lastEventsFileSize = result.eventsFileSize;
        })().catch((e) => {
          if (!sessionGuard.isValid(token)) return;
          turnsError.value = toErrorMessage(e);
          logError("[sessionDetail] Failed to refresh turns:", e);
        })
      );
    }

    // Events are intentionally skipped — the EventsTab manages its own pagination
    // state (currentPage, pageSize). Refreshing here would overwrite the user's
    // current page position.

    // All remaining standard sections use the section registry — config is
    // defined once in defineSection(), eliminating duplicate mappings.
    for (const sec of standardSections) {
      if (sections.has(sec.key)) {
        promises.push(sec.buildRefresh(id, token));
      }
    }

    await Promise.allSettled(promises);
  }

  /**
   * Prefetch a session into the cache without changing the current view.
   * Used for predictive loading of likely-to-be-viewed sessions.
   */
  async function prefetchSession(id: string) {
    // Skip if already cached or if it's the currently loaded session
    if (sessionCache.has(id) || sessionId.value === id) return;

    try {
      const [detailResult, turnsResult] = await Promise.all([
        getSessionDetail(id),
        getSessionTurns(id),
      ]);

      // Don't overwrite if user navigated to this session while we were fetching
      if (sessionCache.has(id) || sessionId.value === id) return;

      sessionCache.set(id, {
        detail: detailResult,
        turns: turnsResult.turns,
        eventsFileSize: turnsResult.eventsFileSize,
        checkpoints: [],
        plan: null,
        shutdownMetrics: null,
        incidents: [],
        loadedSections: new Set(['detail', 'turns']),
      });

      // Evict oldest if over capacity
      if (sessionCache.size > SESSION_CACHE_SIZE) {
        const oldest = sessionCache.keys().next().value;
        if (oldest) sessionCache.delete(oldest);
      }
    } catch {
      // Silent — prefetch is best-effort optimization
    }
  }

  return {
    sessionId,
    detail,
    turns,
    events,
    todos,
    checkpoints,
    plan,
    shutdownMetrics,
    incidents,
    loading,
    error,
    loaded,
    turnsError,
    eventsError,
    todosError,
    checkpointsError,
    planError,
    metricsError,
    incidentsError,
    loadDetail,
    loadTurns,
    loadEvents,
    loadTodos: todosDef.load,
    loadCheckpoints: checkpointsDef.load,
    loadPlan: planDef.load,
    loadShutdownMetrics: metricsDef.load,
    loadIncidents: incidentsDef.load,
    reset,
    refreshAll,
    prefetchSession,
  };
});
