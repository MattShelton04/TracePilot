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

  /** Clear all per-section error refs (used on session switch / reset). */
  function clearSectionErrors() {
    turnsError.value = null;
    eventsError.value = null;
    todosError.value = null;
    checkpointsError.value = null;
    planError.value = null;
    metricsError.value = null;
    incidentsError.value = null;
  }

  // Guard against stale async responses when user switches sessions quickly
  let requestToken = 0;
  // Separate token for events requests (filter/pagination within same session)
  let eventsRequestToken = 0;

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
      const token = requestToken;
      opts.errorRef.value = null;

      try {
        const result = await opts.fetchFn(id);
        if (requestToken !== token) return;
        opts.onResult(result);
        loaded.value.add(opts.key);
      } catch (e) {
        if (requestToken !== token) return;
        opts.errorRef.value = toErrorMessage(e);
        const logFn = opts.logLevel === 'warn' ? console.warn : console.error;
        logFn(`Failed to load ${opts.key}:`, e);
      }
    };
  }

  async function loadDetail(id: string) {
    if (sessionId.value === id && loaded.value.has("detail")) {
      return;
    }

    // Save current session before switching
    if (sessionId.value && loaded.value.has("detail")) {
      saveToCache(sessionId.value);
    }

    const token = ++requestToken;
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
        if (requestToken !== token) return;
        detail.value = result;
      }).catch(() => {});
      checkSessionFreshness(id).then(async (freshness) => {
        if (requestToken !== token) return;
        if (freshness.eventsFileSize === lastEventsFileSize) return;
        const result = await getSessionTurns(id);
        if (requestToken !== token) return;
        turns.value = result.turns;
        lastEventsFileSize = result.eventsFileSize;
      }).catch(() => {});
      if (loaded.value.has("plan")) {
        getSessionPlan(id).then((result) => {
          if (requestToken !== token) return;
          plan.value = result;
        }).catch(() => {});
      }
      return;
    }

    // Cache miss — full load with loading spinner
    loading.value = true;
    detail.value = null;
    turns.value = [];
    events.value = null;
    todos.value = null;
    checkpoints.value = [];
    plan.value = null;
    shutdownMetrics.value = null;
    incidents.value = [];
    loaded.value.clear();
    lastEventsFileSize = 0;

    try {
      const result = await getSessionDetail(id);
      if (requestToken !== token) return;
      detail.value = result;
      loaded.value.add("detail");
    } catch (e) {
      if (requestToken !== token) return;
      detail.value = null;
      error.value = toErrorMessage(e);
    } finally {
      if (requestToken === token) loading.value = false;
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
    const sessionToken = requestToken;
    const eventsToken = ++eventsRequestToken;
    eventsError.value = null;

    try {
      const result = await getSessionEvents(id, offset, limit, eventType);
      if (requestToken !== sessionToken || eventsRequestToken !== eventsToken) return;
      events.value = result;
      loaded.value.add("events");
    } catch (e) {
      if (requestToken !== sessionToken || eventsRequestToken !== eventsToken) return;
      eventsError.value = toErrorMessage(e);
      console.error("Failed to load events:", e);
    }
  }

  const loadTodos = buildSectionLoader({
    key: 'todos',
    errorRef: todosError,
    fetchFn: (id) => getSessionTodos(id),
    onResult: (result) => { todos.value = result; },
  });

  const loadCheckpoints = buildSectionLoader({
    key: 'checkpoints',
    errorRef: checkpointsError,
    fetchFn: (id) => getSessionCheckpoints(id),
    onResult: (result) => { checkpoints.value = result; },
  });

  const loadPlan = buildSectionLoader({
    key: 'plan',
    errorRef: planError,
    fetchFn: (id) => getSessionPlan(id),
    onResult: (result) => { plan.value = result; },
  });

  const loadShutdownMetrics = buildSectionLoader({
    key: 'metrics',
    errorRef: metricsError,
    fetchFn: (id) => getShutdownMetrics(id),
    onResult: (result) => { shutdownMetrics.value = result; },
  });

  const loadIncidents = buildSectionLoader({
    key: 'incidents',
    errorRef: incidentsError,
    fetchFn: (id) => getSessionIncidents(id),
    onResult: (result) => { incidents.value = result; },
    logLevel: 'warn',
  });

  function reset() {
    requestToken++;
    eventsRequestToken++;
    sessionId.value = null;
    detail.value = null;
    turns.value = [];
    events.value = null;
    todos.value = null;
    checkpoints.value = [];
    plan.value = null;
    shutdownMetrics.value = null;
    incidents.value = [];
    loaded.value.clear();
    loading.value = false;
    error.value = null;
    clearSectionErrors();
    lastEventsFileSize = 0;
    sessionCache.clear();
  }

  /**
   * Soft-refresh all previously loaded sections without clearing existing data.
   * Preserves UI state (selections, scroll, pagination) by not resetting refs.
   */
  async function refreshAll() {
    const id = sessionId.value;
    if (!id) return;
    const token = requestToken;
    const sections = new Set(loaded.value);

    const promises: Promise<void>[] = [];

    if (sections.has("detail")) {
      promises.push(
        getSessionDetail(id).then((result) => {
          if (requestToken !== token) return;
          detail.value = result;
        }).catch((e) => {
          if (requestToken !== token) return;
          console.error("Failed to refresh detail:", e);
        })
      );
    }

    if (sections.has("turns")) {
      promises.push(
        (async () => {
          // Freshness check: skip full turn fetch if events.jsonl hasn't changed
          try {
            const freshness = await checkSessionFreshness(id);
            if (requestToken !== token) return;
            if (freshness.eventsFileSize === lastEventsFileSize) return;
          } catch {
            // Freshness check failed — fall through to full fetch
          }

          const result = await getSessionTurns(id);
          if (requestToken !== token) return;
          turns.value = result.turns;
          turnsError.value = null;
          lastEventsFileSize = result.eventsFileSize;
        })().catch((e) => {
          if (requestToken !== token) return;
          turnsError.value = toErrorMessage(e);
          console.error("Failed to refresh turns:", e);
        })
      );
    }

    // Events are intentionally skipped — the EventsTab manages its own pagination
    // state (currentPage, pageSize). Refreshing here would overwrite the user's
    // current page position.

    if (sections.has("todos")) {
      promises.push(
        getSessionTodos(id).then((result) => {
          if (requestToken !== token) return;
          todos.value = result;
          todosError.value = null;
        }).catch((e) => {
          if (requestToken !== token) return;
          todosError.value = toErrorMessage(e);
          console.error("Failed to refresh todos:", e);
        })
      );
    }

    if (sections.has("checkpoints")) {
      promises.push(
        getSessionCheckpoints(id).then((result) => {
          if (requestToken !== token) return;
          checkpoints.value = result;
          checkpointsError.value = null;
        }).catch((e) => {
          if (requestToken !== token) return;
          checkpointsError.value = toErrorMessage(e);
          console.error("Failed to refresh checkpoints:", e);
        })
      );
    }

    if (sections.has("plan")) {
      promises.push(
        getSessionPlan(id).then((result) => {
          if (requestToken !== token) return;
          plan.value = result;
          planError.value = null;
        }).catch((e) => {
          if (requestToken !== token) return;
          planError.value = toErrorMessage(e);
          console.error("Failed to refresh plan:", e);
        })
      );
    }

    if (sections.has("metrics")) {
      promises.push(
        getShutdownMetrics(id).then((result) => {
          if (requestToken !== token) return;
          shutdownMetrics.value = result;
          metricsError.value = null;
        }).catch((e) => {
          if (requestToken !== token) return;
          metricsError.value = toErrorMessage(e);
          console.error("Failed to refresh metrics:", e);
        })
      );
    }

    if (sections.has("incidents")) {
      promises.push(
        getSessionIncidents(id).then((result) => {
          if (requestToken !== token) return;
          incidents.value = result;
          incidentsError.value = null;
        }).catch((e) => {
          if (requestToken !== token) return;
          incidentsError.value = toErrorMessage(e);
          console.warn("Failed to refresh incidents:", e);
        })
      );
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
    loadTodos,
    loadCheckpoints,
    loadPlan,
    loadShutdownMetrics,
    loadIncidents,
    reset,
    refreshAll,
    prefetchSession,
  };
});
