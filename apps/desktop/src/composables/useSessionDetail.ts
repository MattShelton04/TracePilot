/**
 * useSessionDetail — Per-instance session detail composable.
 *
 * Contains ALL the session detail state and logic previously held in the
 * Pinia `sessionDetail` store. Can be instantiated multiple times for
 * multi-tab views, or once inside the Pinia store for backward compatibility.
 *
 * ## Usage patterns
 *
 * **Legacy (singleton via Pinia store):**
 * ```ts
 * const store = useSessionDetailStore(); // unchanged
 * ```
 *
 * **Multi-tab (per-instance via provide/inject):**
 * ```ts
 * // Parent (SessionDetailView)
 * const sd = createSessionDetailInstance();
 * provide(SESSION_DETAIL_KEY, sd);
 *
 * // Child (OverviewTab, ConversationTab, etc.)
 * const sd = injectSessionDetail();
 * ```
 */
import {
  getSessionDetail,
  getSessionEvents,
  getSessionTurns,
} from "@tracepilot/client";
import type { EventsResponse, SessionDetail } from "@tracepilot/types";
import { toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
import type { InjectionKey, UnwrapNestedRefs } from "vue";
import { inject, reactive, ref } from "vue";
import { logDebug, logError, logWarn } from "@/utils/logger";
import { createSessionCache } from "./session/cache";
import {
  buildCachedSessionSnapshot,
  buildPrefetchedCachedSession,
  restoreFromCachedSession,
} from "./session/snapshot";
import { useSessionSections } from "./session/useSessionSections";
import { useSessionTurnsRefresh } from "./session/useSessionTurnsRefresh";

const LOG_PREFIX = "[sessionDetail]";
const REFRESH_THROTTLE_MS = 5_000;

/**
 * Create an independent session detail state instance.
 *
 * Each call returns a fresh, isolated set of reactive refs and methods.
 * This is the core factory used both by the Pinia singleton store and
 * by per-tab composable instances.
 */
export function createSessionDetailInstance() {
  const sessionId = ref<string | null>(null);
  const detail = ref<SessionDetail | null>(null);
  const events = ref<EventsResponse | null>(null);

  const loading = ref(false);
  const error = ref<string | null>(null);
  const loaded = ref<Set<string>>(new Set());

  const eventsError = ref<string | null>(null);

  // Guard against stale async responses when user switches sessions quickly
  const sessionGuard = useAsyncGuard();
  const eventsGuard = useAsyncGuard();

  const turnsRefresh = useSessionTurnsRefresh({
    sessionId,
    loaded,
    guard: sessionGuard,
    logPrefix: LOG_PREFIX,
  });

  const sections = useSessionSections({
    sessionId,
    loaded,
    guard: sessionGuard,
    logPrefix: LOG_PREFIX,
  });

  // Background refresh throttle
  const lastFetchTimestamp = new Map<string, number>();

  const sessionCache = createSessionCache();
  const snapshotCtx = { detail, loaded, turnsRefresh, sections };

  function saveToCache(id: string) {
    const currentDetail = detail.value;
    if (!currentDetail) return;
    sessionCache.set(id, buildCachedSessionSnapshot(snapshotCtx, currentDetail));
  }

  function clearSectionErrors() {
    turnsRefresh.clearTurnsError();
    eventsError.value = null;
    sections.clearErrors();
  }

  function resetSectionData() {
    detail.value = null;
    turnsRefresh.resetTurns();
    events.value = null;
    sections.resetData();
    loaded.value.clear();
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
      restoreFromCachedSession(snapshotCtx, cached);
      loading.value = false;
      events.value = null;
      loaded.value.delete("events");
      sections.todosSection.data.value = null;
      loaded.value.delete("todos");

      const lastFetched = lastFetchTimestamp.get(id) ?? 0;
      const shouldRefresh = Date.now() - lastFetched > REFRESH_THROTTLE_MS;
      if (shouldRefresh) {
        lastFetchTimestamp.set(id, Date.now());
        void refreshAll();
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
      logError(`${LOG_PREFIX} Failed to load events:`, e);
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

  async function refreshAll() {
    const id = sessionId.value;
    if (!id) return;
    const token = sessionGuard.current();
    const loadedSections = new Set(loaded.value);

    const promises: Promise<void>[] = [];

    if (loadedSections.has("detail")) {
      promises.push(
        (async () => {
          try {
            const result = await getSessionDetail(id);
            if (!sessionGuard.isValid(token)) return;
            detail.value = result;
            error.value = null;
          } catch (e) {
            if (!sessionGuard.isValid(token)) return;
            error.value = toErrorMessage(e);
            logError(`${LOG_PREFIX} Failed to refresh detail:`, e);
          }
        })(),
      );
    }

    if (loadedSections.has("turns")) {
      promises.push(turnsRefresh.refreshTurns(id, token));
    }

    promises.push(...sections.refreshLoaded(id, token));

    await Promise.allSettled(promises);
  }

  async function prefetchSession(id: string) {
    if (sessionCache.has(id) || sessionId.value === id) return;

    try {
      const [detailResult, turnsResult] = await Promise.all([
        getSessionDetail(id),
        getSessionTurns(id),
      ]);

      if (sessionCache.has(id) || sessionId.value === id) return;

      sessionCache.set(id, buildPrefetchedCachedSession(detailResult, turnsResult));
    } catch (e) {
      // Prefetch is best-effort; a missing on-disk events.jsonl (e.g. session
      // exists in the index but its data dir was cleaned up, or hasn't been
      // materialized yet) is the common case and not actionable. Downgrade
      // "Failed to open" errors to debug so they don't spam the WARN log;
      // anything else still surfaces as a warning.
      const msg = e instanceof Error ? e.message : String(e);
      const isMissingFile = /Failed to open|no such file|cannot find the file/i.test(msg);
      if (isMissingFile) {
        logDebug(`${LOG_PREFIX} Prefetch skipped — session data missing`, { sessionId: id });
      } else {
        logWarn(`${LOG_PREFIX} Prefetch failed (best-effort)`, { sessionId: id }, e);
      }
    }
  }

  // ── Cross-tab navigation: checkpoint focus ─────────────────────────
  const pendingCheckpointFocus = ref<number | null>(null);

  return {
    sessionId,
    detail,
    turns: turnsRefresh.turns,
    turnsVersion: turnsRefresh.turnsVersion,
    events,
    todos: sections.todosSection.data,
    checkpoints: sections.checkpointsSection.data,
    plan: sections.planSection.data,
    shutdownMetrics: sections.metricsSection.data,
    incidents: sections.incidentsSection.data,
    loading,
    error,
    loaded,
    turnsError: turnsRefresh.turnsError,
    eventsError,
    todosError: sections.todosSection.error,
    checkpointsError: sections.checkpointsSection.error,
    planError: sections.planSection.error,
    metricsError: sections.metricsSection.error,
    incidentsError: sections.incidentsSection.error,
    pendingCheckpointFocus,
    loadDetail,
    loadTurns: turnsRefresh.loadTurns,
    loadEvents,
    loadTodos: sections.todosDef.load,
    loadCheckpoints: sections.checkpointsDef.load,
    loadPlan: sections.planDef.load,
    loadShutdownMetrics: sections.metricsDef.load,
    loadIncidents: sections.incidentsDef.load,
    reset,
    refreshAll,
    prefetchSession,
  };
}

/** The return type of createSessionDetailInstance — used by provide/inject and store. */
export type SessionDetailInstance = ReturnType<typeof createSessionDetailInstance>;

/**
 * Reactive (auto-unwrapped) version of SessionDetailInstance.
 * Matches the shape consumers see through both Pinia (auto-unwraps refs)
 * and reactive() wrapping (for inject/provide in tab mode).
 */
export type SessionDetailContext = UnwrapNestedRefs<SessionDetailInstance>;

/** Vue injection key for per-tab session detail instances (reactive-wrapped). */
export const SESSION_DETAIL_KEY: InjectionKey<SessionDetailContext> =
  Symbol("sessionDetail");

/**
 * Wrap a raw composable instance in reactive() for provide/inject.
 * This ensures refs are auto-unwrapped, matching Pinia store behavior.
 */
export function toSessionDetailContext(
  instance: SessionDetailInstance,
): SessionDetailContext {
  return reactive(instance);
}

/**
 * Inject the session detail context provided by an ancestor component.
 * Throws a clear error if called outside a provider tree.
 */
export function injectSessionDetail(): SessionDetailContext {
  const instance = inject(SESSION_DETAIL_KEY);
  if (!instance) {
    throw new Error(
      "[useSessionDetail] No session detail instance provided. " +
      "Ensure this component is a descendant of a SessionDetailView or similar provider.",
    );
  }
  return instance;
}
