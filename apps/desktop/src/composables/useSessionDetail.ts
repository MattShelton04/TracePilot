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
  checkSessionFreshness,
  getSessionDetail,
  getSessionEvents,
  getSessionTurns,
} from "@tracepilot/client";
import type { EventsResponse, SessionDetail } from "@tracepilot/types";
import { runAction, runMutation, toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
import type { UnwrapNestedRefs } from "vue";
import { inject, reactive, ref, shallowRef } from "vue";
import { logDebug, logError, logWarn } from "@/utils/logger";
import { createSessionCache } from "./session/cache";
import { SESSION_DETAIL_KEY } from "./session/contextKey";
import {
  buildCachedSessionSnapshot,
  buildPrefetchedCachedSession,
  restoreFromCachedSession,
} from "./session/snapshot";
import { SOURCE_SECTION_KEYS, useSessionSections } from "./session/useSessionSections";
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
export function createSessionDetailInstance(initialCacheSize?: number) {
  const sessionId = ref<string | null>(null);
  // shallowRef: these large immutable payloads are always replaced wholesale.
  const detail = shallowRef<SessionDetail | null>(null);
  const events = shallowRef<EventsResponse | null>(null);

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

  const sessionCache = createSessionCache(initialCacheSize);
  const prefetchInFlight = new Set<string>();
  const detailInFlight = new Map<string, Promise<SessionDetail>>();
  const snapshotCtx = { detail, loaded, turnsRefresh, sections };

  function fetchDetail(id: string): Promise<SessionDetail> {
    const existing = detailInFlight.get(id);
    if (existing) return existing;

    const request = getSessionDetail(id).finally(() => {
      if (detailInFlight.get(id) === request) {
        detailInFlight.delete(id);
      }
    });
    detailInFlight.set(id, request);
    return request;
  }

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

    pendingConversationFocus.value = null;

    // Save current session before switching
    if (sessionId.value && loaded.value.has("detail")) {
      saveToCache(sessionId.value);
    }

    const _token = sessionGuard.start();
    // Data restored or loaded below may predate the last recorded version.
    refreshedSource = null;
    sessionId.value = id;
    error.value = null;
    clearSectionErrors();

    // Check frontend cache for instant restore
    const cached = sessionCache.get(id);
    if (cached) {
      restoreFromCachedSession(snapshotCtx, cached);
      loading.value = false;
      // Events are paginated and always refetched on the events tab
      // (they manage their own fingerprint/cursor), so clear them here.
      events.value = null;
      loaded.value.delete("events");
      // NOTE: todos are now cached alongside other sections. The subsequent
      // `void refreshAll()` below will refresh them via refreshLoaded when
      // "todos" is present in loadedSections, so we no longer need the
      // ad-hoc `todos = null; loaded.delete("todos")` reset that previously
      // caused new/updated todos to be missed until the Todos tab re-mounted.

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

    await runAction({
      loading,
      error,
      guard: sessionGuard,
      action: () => fetchDetail(id),
      onSuccess: (result) => {
        detail.value = result;
        loaded.value.add("detail");
      },
    });

    if (error.value) {
      detail.value = null;
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
    refreshedSource = null;
    sessionGuard.invalidate();
    eventsGuard.invalidate();
    sessionId.value = null;
    resetSectionData();
    loading.value = false;
    error.value = null;
    clearSectionErrors();
    sessionCache.clear();
  }

  function setCacheSize(maxSize: number) {
    sessionCache.setMaxSize(maxSize);
  }

  async function refreshAll() {
    await refreshSections();
  }

  /** Every section built only from the session's source files. */
  const SOURCE_KEYS: ReadonlySet<string> = new Set(["detail", "turns", ...SOURCE_SECTION_KEYS]);

  /**
   * The source version of the session {@link refreshIfSourceChanged} last
   * probed, and the source sections refreshed without error at that version.
   * A section that finished loading after the tick that recorded the version
   * may hold older data, so it is not in `fresh` and refreshes once.
   */
  let refreshedSource: { id: string; version: string; fresh: Set<string> } | null = null;

  /**
   * Refresh for a timer that ticks while a session runs. Source sections
   * already refreshed at the source's current version keep their data; the
   * others reload. A failed probe refreshes everything.
   */
  async function refreshIfSourceChanged() {
    const id = sessionId.value;
    if (!id) return;
    const token = sessionGuard.current();
    let version: string | null = null;
    try {
      version = (await checkSessionFreshness(id)).sourceVersion ?? null;
    } catch (e) {
      logWarn(`${LOG_PREFIX} Freshness check failed, refreshing everything`, { sessionId: id }, e);
    }
    if (!sessionGuard.isValid(token)) return;
    const previous = refreshedSource;
    const fresh =
      version !== null && previous?.id === id && previous.version === version
        ? previous.fresh
        : new Set<string>();
    const refreshed = await refreshSections(fresh);
    if (version === null || !sessionGuard.isValid(token)) return;
    // Each successful refresh describes the source at this version or later.
    for (const key of refreshed) {
      if (SOURCE_KEYS.has(key) && !sectionFailed(key)) fresh.add(key);
    }
    refreshedSource = { id, version, fresh };
  }

  function sectionFailed(key: string): boolean {
    if (key === "detail") return error.value !== null;
    if (key === "turns") return turnsRefresh.turnsError.value !== null;
    return sections.hasError(key);
  }

  /**
   * Refresh the loaded sections, except source sections in `skip`, and
   * return the keys it refreshed.
   */
  async function refreshSections(skip: ReadonlySet<string> = new Set()): Promise<string[]> {
    const id = sessionId.value;
    if (!id) return [];
    const token = sessionGuard.current();
    const loadedSections = new Set(loaded.value);

    const promises: Promise<unknown>[] = [];
    const refreshed: string[] = [];

    if (loadedSections.has("detail") && !skip.has("detail")) {
      refreshed.push("detail");
      promises.push(
        (async () => {
          const silentError = ref<string | null>(null);
          await runMutation(silentError, async () => {
            const result = await getSessionDetail(id);
            if (!sessionGuard.isValid(token)) return;
            detail.value = result;
          });
          if (sessionGuard.isValid(token)) {
            error.value = silentError.value;
            if (silentError.value) {
              logError(`${LOG_PREFIX} Failed to refresh detail:`, silentError.value);
            }
          }
        })(),
      );
    }

    if (loadedSections.has("turns") && !skip.has("turns")) {
      refreshed.push("turns");
      promises.push(turnsRefresh.refreshTurns(id, token));
    }

    for (const { key, done } of sections.refreshLoaded(id, token, skip)) {
      refreshed.push(key);
      promises.push(done);
    }

    await Promise.allSettled(promises);
    return refreshed;
  }

  async function prefetchSession(id: string) {
    if (sessionCache.has(id) || sessionId.value === id || prefetchInFlight.has(id)) return;

    prefetchInFlight.add(id);
    try {
      // Load detail first so foreground navigation can share this request.
      // Turns then reuse the backend's parsed-event cache instead of racing
      // detail and potentially parsing a large session twice.
      const detailResult = await fetchDetail(id);
      if (sessionCache.has(id) || sessionId.value === id) return;

      const turnsResult = await getSessionTurns(id);
      if (sessionCache.has(id) || sessionId.value === id) return;

      sessionCache.set(id, buildPrefetchedCachedSession(detailResult, turnsResult));
      // Just fetched: opening it now restores this rather than fetching again.
      lastFetchTimestamp.set(id, Date.now());
    } catch (e) {
      // Prefetch is best-effort; a missing on-disk events.jsonl (e.g. session
      // exists in the index but its data dir was cleaned up, or hasn't been
      // materialized yet) is the common case and not actionable. Downgrade
      // "Failed to open" errors to debug so they don't spam the WARN log;
      // anything else still surfaces as a warning.
      const msg = toErrorMessage(e);
      const isMissingFile = /Failed to open|no such file|cannot find the file/i.test(msg);
      if (isMissingFile) {
        logDebug(`${LOG_PREFIX} Prefetch skipped — session data missing`, { sessionId: id });
      } else {
        logWarn(`${LOG_PREFIX} Prefetch failed (best-effort)`, { sessionId: id }, e);
      }
    } finally {
      prefetchInFlight.delete(id);
    }
  }

  // ── Cross-tab navigation: checkpoint focus ─────────────────────────
  const pendingCheckpointFocus = ref<number | null>(null);
  const pendingConversationFocus = ref<{
    turnIndex: number;
    eventIndex: number | null;
    requestId: number;
  } | null>(null);
  let conversationFocusRequestId = 0;

  function focusCheckpoint(checkpointNumber: number | null) {
    pendingCheckpointFocus.value = checkpointNumber;
  }

  function focusConversation(turnIndex: number, eventIndex: number | null = null) {
    conversationFocusRequestId += 1;
    pendingConversationFocus.value = {
      turnIndex,
      eventIndex,
      requestId: conversationFocusRequestId,
    };
  }

  return {
    sessionId,
    detail,
    turns: turnsRefresh.turns,
    turnsVersion: turnsRefresh.turnsVersion,
    events,
    todos: sections.todosSection.data,
    checkpoints: sections.checkpointsSection.data,
    plan: sections.planSection.data,
    fileHistory: sections.fileHistorySection.data,
    shutdownMetrics: sections.metricsSection.data,
    incidents: sections.incidentsSection.data,
    promptCache: sections.promptCacheSection.data,
    turnActivity: sections.activitySection.data,
    loading,
    error,
    loaded,
    turnsError: turnsRefresh.turnsError,
    eventsError,
    todosError: sections.todosSection.error,
    checkpointsError: sections.checkpointsSection.error,
    planError: sections.planSection.error,
    fileHistoryError: sections.fileHistorySection.error,
    metricsError: sections.metricsSection.error,
    incidentsError: sections.incidentsSection.error,
    promptCacheError: sections.promptCacheSection.error,
    turnActivityError: sections.activitySection.error,
    pendingCheckpointFocus,
    pendingConversationFocus,
    focusCheckpoint,
    focusConversation,
    loadDetail,
    loadTurns: turnsRefresh.loadTurns,
    loadEvents,
    loadTodos: sections.todosDef.load,
    loadCheckpoints: sections.checkpointsDef.load,
    loadPlan: sections.planDef.load,
    loadFileHistory: sections.fileHistoryDef.load,
    loadShutdownMetrics: sections.metricsDef.load,
    loadIncidents: sections.incidentsDef.load,
    loadPromptCache: sections.promptCacheDef.load,
    loadTurnActivity: sections.activityDef.load,
    reset,
    setCacheSize,
    refreshAll,
    refreshIfSourceChanged,
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

export { SESSION_DETAIL_KEY } from "./session/contextKey";

/**
 * Wrap a raw composable instance in reactive() for provide/inject.
 * This ensures refs are auto-unwrapped, matching Pinia store behavior.
 */
export function toSessionDetailContext(instance: SessionDetailInstance): SessionDetailContext {
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
