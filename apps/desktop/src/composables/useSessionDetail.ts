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
  getSessionCheckpoints,
  getSessionDetail,
  getSessionEvents,
  getSessionIncidents,
  getSessionPlan,
  getSessionTodos,
  getSessionTurns,
  getShutdownMetrics,
} from "@tracepilot/client";
import type {
  AttributedMessage,
  CheckpointEntry,
  ConversationTurn,
  EventsResponse,
  SessionDetail,
  SessionIncident,
  SessionPlan,
  ShutdownMetrics,
  TodosResponse,
  TurnToolCall,
} from "@tracepilot/types";
import { toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
import type { InjectionKey, UnwrapNestedRefs } from "vue";
import { inject, reactive, ref } from "vue";
import {
  buildSectionLoader,
  createAsyncSection,
  defineAsyncSection,
} from "@/stores/helpers/asyncSections";
import { logDebug, logError, logWarn } from "@/utils/logger";

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
  const turns = ref<ConversationTurn[]>([]);
  const turnsVersion = ref(0);
  const events = ref<EventsResponse | null>(null);

  const loading = ref(false);
  const error = ref<string | null>(null);
  const loaded = ref<Set<string>>(new Set());

  // Standard sections using AsyncSection pattern
  const todosSection = createAsyncSection<TodosResponse | null>(null);
  const checkpointsSection = createAsyncSection<CheckpointEntry[]>([]);
  const planSection = createAsyncSection<SessionPlan | null>(null);
  const metricsSection = createAsyncSection<ShutdownMetrics | null>(null);
  const incidentsSection = createAsyncSection<SessionIncident[]>([]);

  // Special-case sections (custom loaders, not in registry)
  const turnsError = ref<string | null>(null);
  const eventsError = ref<string | null>(null);

  // Track events.jsonl fingerprint (size + mtime) for freshness detection
  type EventsFingerprint = { size: number; mtime: number | null };
  let lastEventsFingerprint: EventsFingerprint = { size: 0, mtime: null };
  let turnFingerprints: string[] = [];

  // Background refresh throttle
  const lastFetchTimestamp = new Map<string, number>();
  const REFRESH_THROTTLE_MS = 5_000;

  const buildEventsFingerprint = (size: number, mtime?: number | null): EventsFingerprint => ({
    size,
    mtime: mtime ?? null,
  });

  const isSameEventsFingerprint = (a: EventsFingerprint, b: EventsFingerprint): boolean =>
    a.size === b.size && a.mtime === b.mtime;

  let deepCompareTurnIndexes = new Set<number>();

  function bumpTurnsVersion() {
    turnsVersion.value += 1;
  }

  function hashText(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash >>> 0;
  }

  function messageFingerprint(msg: AttributedMessage): string {
    return [
      msg.parentToolCallId ?? "",
      msg.agentDisplayName ?? "",
      msg.content.length,
      hashText(msg.content),
    ].join("|");
  }

  function toolCallFingerprint(tc: TurnToolCall): string {
    return [
      tc.toolCallId ?? "",
      tc.parentToolCallId ?? "",
      tc.toolName,
      tc.eventIndex ?? "",
      tc.isSubagent ? "1" : "0",
      tc.isComplete ? "1" : "0",
      tc.success == null ? "u" : tc.success ? "1" : "0",
      tc.startedAt ?? "",
      tc.completedAt ?? "",
      tc.durationMs ?? "",
      tc.error ?? "",
      tc.model ?? "",
      tc.argsSummary ?? "",
      tc.resultContent?.length ?? 0,
      tc.resultContent ? hashText(tc.resultContent) : "",
      tc.agentDisplayName ?? "",
    ].join("|");
  }

  function turnFingerprint(turn: ConversationTurn): string {
    const reasoning = turn.reasoningTexts ?? [];
    const sessionEvents = turn.sessionEvents ?? [];
    return [
      turn.turnIndex,
      turn.eventIndex ?? "",
      turn.turnId ?? "",
      turn.interactionId ?? "",
      turn.model ?? "",
      turn.timestamp ?? "",
      turn.endTimestamp ?? "",
      turn.isComplete ? "1" : "0",
      turn.durationMs ?? "",
      turn.outputTokens ?? "",
      turn.userMessage?.length ?? 0,
      turn.assistantMessages.length,
      turn.assistantMessages.map(messageFingerprint).join(","),
      reasoning.length,
      reasoning.map(messageFingerprint).join(","),
      sessionEvents.length,
      sessionEvents
        .map(
          (evt) =>
            `${evt.eventType}:${evt.severity}:${evt.summary.length}:${hashText(evt.summary)}:${evt.timestamp ?? ""}`,
        )
        .join(","),
      turn.toolCalls.length,
      turn.toolCalls.map(toolCallFingerprint).join(","),
    ].join("||");
  }

  function computeDeepCompareIndexes(turnList: ConversationTurn[]): Set<number> {
    const indexes = new Set<number>();
    if (turnList.length > 0) {
      indexes.add(turnList.length - 1);
    }
    for (let i = 0; i < turnList.length; i++) {
      if (turnList[i]?.toolCalls.some((tc) => tc.isSubagent && !tc.isComplete)) {
        indexes.add(i);
      }
    }
    return indexes;
  }

  function replaceTurns(incoming: ConversationTurn[]) {
    const hadData = turns.value.length > 0;
    const hasIncoming = incoming.length > 0;
    turns.value = incoming;
    turnFingerprints = incoming.map(turnFingerprint);
    deepCompareTurnIndexes = computeDeepCompareIndexes(incoming);
    if (hadData || hasIncoming) {
      bumpTurnsVersion();
    }
  }

  function mergeTurns(incoming: ConversationTurn[]) {
    const existing = turns.value;

    if (existing.length === 0 || incoming.length < existing.length) {
      replaceTurns(incoming);
      return;
    }

    const nextFingerprints = [...turnFingerprints];
    let changed = false;
    const overlapLength = Math.min(existing.length, incoming.length);

    const candidateIndexes = new Set<number>([
      Math.max(0, overlapLength - 1),
      ...deepCompareTurnIndexes,
    ]);
    for (const idx of candidateIndexes) {
      if (idx < 0 || idx >= overlapLength) continue;
      const nextFp = turnFingerprint(incoming[idx]);
      nextFingerprints[idx] = nextFp;
      if (turnFingerprints[idx] !== nextFp) {
        existing[idx] = incoming[idx];
        changed = true;
      }
    }

    for (let i = 0; i < overlapLength; i++) {
      if (candidateIndexes.has(i)) continue;
      const current = existing[i];
      const next = incoming[i];
      if (
        current.turnIndex !== next.turnIndex ||
        current.eventIndex !== next.eventIndex ||
        current.turnId !== next.turnId ||
        current.interactionId !== next.interactionId ||
        current.model !== next.model ||
        current.timestamp !== next.timestamp ||
        current.endTimestamp !== next.endTimestamp ||
        current.isComplete !== next.isComplete ||
        current.durationMs !== next.durationMs ||
        current.outputTokens !== next.outputTokens ||
        current.userMessage !== next.userMessage
      ) {
        existing[i] = next;
        nextFingerprints[i] = turnFingerprint(next);
        changed = true;
      }
    }

    for (let i = existing.length; i < incoming.length; i++) {
      existing.push(incoming[i]);
      nextFingerprints[i] = turnFingerprint(incoming[i]);
      changed = true;
    }

    if (turnFingerprints.length !== nextFingerprints.length) {
      changed = true;
    }

    turnFingerprints = nextFingerprints;
    deepCompareTurnIndexes = computeDeepCompareIndexes(incoming);

    if (changed) {
      bumpTurnsVersion();
    }
  }

  // ── Frontend session cache (last 10 sessions, LRU eviction) ────────────
  interface CachedSession {
    detail: SessionDetail;
    turns: ConversationTurn[];
    eventsFingerprint: EventsFingerprint;
    checkpoints: CheckpointEntry[];
    plan: SessionPlan | null;
    shutdownMetrics: ShutdownMetrics | null;
    incidents: SessionIncident[];
    loadedSections: Set<string>;
  }
  const SESSION_CACHE_SIZE = 10;
  const sessionCache = new Map<string, CachedSession>();

  function setSessionCache(id: string, cached: CachedSession) {
    sessionCache.delete(id);
    sessionCache.set(id, cached);
    if (sessionCache.size > SESSION_CACHE_SIZE) {
      const oldest = sessionCache.keys().next().value;
      if (oldest !== undefined) sessionCache.delete(oldest);
    }
  }

  function getFromSessionCache(id: string): CachedSession | undefined {
    const entry = sessionCache.get(id);
    if (entry !== undefined) {
      sessionCache.delete(id);
      sessionCache.set(id, entry);
    }
    return entry;
  }

  function buildCachedSessionSnapshot(currentDetail: SessionDetail): CachedSession {
    return {
      detail: currentDetail,
      turns: turns.value,
      eventsFingerprint: { ...lastEventsFingerprint },
      checkpoints: checkpointsSection.data.value,
      plan: planSection.data.value,
      shutdownMetrics: metricsSection.data.value,
      incidents: incidentsSection.data.value,
      loadedSections: new Set(loaded.value),
    } satisfies CachedSession;
  }

  function buildPrefetchedCachedSession(
    detailResult: SessionDetail,
    turnsResult: Awaited<ReturnType<typeof getSessionTurns>>,
  ): CachedSession {
    return {
      detail: detailResult,
      turns: turnsResult.turns,
      eventsFingerprint: buildEventsFingerprint(
        turnsResult.eventsFileSize,
        turnsResult.eventsFileMtime ?? null,
      ),
      checkpoints: [],
      plan: null,
      shutdownMetrics: null,
      incidents: [],
      loadedSections: new Set(["detail", "turns"]),
    } satisfies CachedSession;
  }

  function restoreFromCachedSession(cached: CachedSession) {
    detail.value = cached.detail;
    replaceTurns(cached.turns);
    lastEventsFingerprint = { ...cached.eventsFingerprint };
    checkpointsSection.data.value = cached.checkpoints;
    planSection.data.value = cached.plan;
    metricsSection.data.value = cached.shutdownMetrics;
    incidentsSection.data.value = cached.incidents;

    loaded.value = new Set(cached.loadedSections);
  }

  function saveToCache(id: string) {
    const currentDetail = detail.value;
    if (!currentDetail) return;
    setSessionCache(id, buildCachedSessionSnapshot(currentDetail));
  }

  // Guard against stale async responses when user switches sessions quickly
  const sessionGuard = useAsyncGuard();
  const eventsGuard = useAsyncGuard();

  // ── Section registry ────────────────────────────────────────────────
  const todosDef = defineAsyncSection({
    key: "todos",
    section: todosSection,
    defaultValue: () => null,
    fetchFn: (id) => getSessionTodos(id),
    sessionId,
    loaded,
    guard: sessionGuard,
    logPrefix: "[sessionDetail]",
  });

  const checkpointsDef = defineAsyncSection({
    key: "checkpoints",
    section: checkpointsSection,
    defaultValue: (): CheckpointEntry[] => [],
    fetchFn: (id) => getSessionCheckpoints(id),
    sessionId,
    loaded,
    guard: sessionGuard,
    logPrefix: "[sessionDetail]",
  });

  const planDef = defineAsyncSection({
    key: "plan",
    section: planSection,
    defaultValue: () => null,
    fetchFn: (id) => getSessionPlan(id),
    sessionId,
    loaded,
    guard: sessionGuard,
    logPrefix: "[sessionDetail]",
  });

  const metricsDef = defineAsyncSection({
    key: "metrics",
    section: metricsSection,
    defaultValue: () => null,
    fetchFn: (id) => getShutdownMetrics(id),
    sessionId,
    loaded,
    guard: sessionGuard,
    logPrefix: "[sessionDetail]",
  });

  const incidentsDef = defineAsyncSection({
    key: "incidents",
    section: incidentsSection,
    defaultValue: (): SessionIncident[] => [],
    fetchFn: (id) => getSessionIncidents(id),
    sessionId,
    loaded,
    guard: sessionGuard,
    logPrefix: "[sessionDetail]",
    logLevel: "warn",
  });

  const standardSections = [todosDef, checkpointsDef, planDef, metricsDef, incidentsDef];

  function clearSectionErrors() {
    turnsError.value = null;
    eventsError.value = null;
    for (const sec of standardSections) {
      sec.clearError();
    }
  }

  function resetSectionData() {
    detail.value = null;
    replaceTurns([]);
    events.value = null;
    for (const sec of standardSections) {
      sec.resetData();
    }
    loaded.value.clear();
    lastEventsFingerprint = buildEventsFingerprint(0, null);
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
    const cached = getFromSessionCache(id);
    if (cached) {
      restoreFromCachedSession(cached);
      loading.value = false;
      events.value = null;
      loaded.value.delete("events");
      todosSection.data.value = null;
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

  const loadTurns = buildSectionLoader({
    key: "turns",
    sessionId,
    loaded,
    guard: sessionGuard,
    errorRef: turnsError,
    fetchFn: (id) => getSessionTurns(id),
    onResult: (result) => {
      replaceTurns(result.turns);
      lastEventsFingerprint = buildEventsFingerprint(
        result.eventsFileSize,
        result.eventsFileMtime ?? null,
      );
    },
    logPrefix: "[sessionDetail]",
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

  async function refreshAll() {
    const id = sessionId.value;
    if (!id) return;
    const token = sessionGuard.current();
    const sections = new Set(loaded.value);

    const promises: Promise<void>[] = [];

    if (sections.has("detail")) {
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
            logError("[sessionDetail] Failed to refresh detail:", e);
          }
        })(),
      );
    }

    if (sections.has("turns")) {
      promises.push(
        (async () => {
          try {
            try {
              const freshness = await checkSessionFreshness(id);
              if (!sessionGuard.isValid(token)) return;
              const probe = buildEventsFingerprint(
                freshness.eventsFileSize,
                freshness.eventsFileMtime ?? null,
              );
              if (isSameEventsFingerprint(probe, lastEventsFingerprint)) return;
            } catch (e) {
              logWarn(
                "[sessionDetail] Freshness check failed, proceeding with full fetch",
                { sessionId: id },
                e,
              );
            }

            const result = await getSessionTurns(id);
            if (!sessionGuard.isValid(token)) return;
            mergeTurns(result.turns);
            turnsError.value = null;
            lastEventsFingerprint = buildEventsFingerprint(
              result.eventsFileSize,
              result.eventsFileMtime ?? null,
            );
          } catch (e) {
            if (!sessionGuard.isValid(token)) return;
            turnsError.value = toErrorMessage(e);
            logError("[sessionDetail] Failed to refresh turns:", e);
          }
        })(),
      );
    }

    for (const sec of standardSections) {
      if (sections.has(sec.key)) {
        promises.push(sec.buildRefresh(id, token));
      }
    }

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

      setSessionCache(id, buildPrefetchedCachedSession(detailResult, turnsResult));
    } catch (e) {
      // Prefetch is best-effort; a missing on-disk events.jsonl (e.g. session
      // exists in the index but its data dir was cleaned up, or hasn't been
      // materialized yet) is the common case and not actionable. Downgrade
      // "Failed to open" errors to debug so they don't spam the WARN log;
      // anything else still surfaces as a warning.
      const msg = e instanceof Error ? e.message : String(e);
      const isMissingFile = /Failed to open|no such file|cannot find the file/i.test(msg);
      if (isMissingFile) {
        logDebug("[sessionDetail] Prefetch skipped — session data missing", { sessionId: id });
      } else {
        logWarn("[sessionDetail] Prefetch failed (best-effort)", { sessionId: id }, e);
      }
    }
  }

  // ── Cross-tab navigation: checkpoint focus ─────────────────────────
  const pendingCheckpointFocus = ref<number | null>(null);

  return {
    sessionId,
    detail,
    turns,
    turnsVersion,
    events,
    todos: todosSection.data,
    checkpoints: checkpointsSection.data,
    plan: planSection.data,
    shutdownMetrics: metricsSection.data,
    incidents: incidentsSection.data,
    loading,
    error,
    loaded,
    turnsError,
    eventsError,
    todosError: todosSection.error,
    checkpointsError: checkpointsSection.error,
    planError: planSection.error,
    metricsError: metricsSection.error,
    incidentsError: incidentsSection.error,
    pendingCheckpointFocus,
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
