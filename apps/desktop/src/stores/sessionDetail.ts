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
import { toErrorMessage } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { type Ref, ref } from "vue";
import { type AsyncGuardToken, useAsyncGuard } from "@/composables/useAsyncGuard";
import { logError, logWarn } from "@/utils/logger";

export const useSessionDetailStore = defineStore("sessionDetail", () => {
  const sessionId = ref<string | null>(null);
  const detail = ref<SessionDetail | null>(null);
  const turns = ref<ConversationTurn[]>([]);
  const turnsVersion = ref(0);
  const events = ref<EventsResponse | null>(null);

  const loading = ref(false);
  const error = ref<string | null>(null);
  const loaded = ref<Set<string>>(new Set());

  // ── AsyncSection helper ─────────────────────────────────────────
  // Consolidates data + error state for sections, eliminating separate
  // error ref declarations and manual error clearing across 5+ sections.
  interface AsyncSectionState<T> {
    data: Ref<T>;
    error: Ref<string | null>;
  }

  function createAsyncSection<T>(initialData: T): AsyncSectionState<T> {
    return {
      data: ref<T>(initialData) as Ref<T>,
      error: ref<string | null>(null),
    };
  }

  // Standard sections using AsyncSection pattern
  const todosSection = createAsyncSection<TodosResponse | null>(null);
  const checkpointsSection = createAsyncSection<CheckpointEntry[]>([]);
  const planSection = createAsyncSection<SessionPlan | null>(null);
  const metricsSection = createAsyncSection<ShutdownMetrics | null>(null);
  const incidentsSection = createAsyncSection<SessionIncident[]>([]);

  // Special-case sections (custom loaders, not in registry)
  const turnsError = ref<string | null>(null);
  const eventsError = ref<string | null>(null);

  // Track file size for freshness detection (avoids redundant turn re-fetches)
  let lastEventsFileSize = 0;
  let turnFingerprints: string[] = [];

  // Background refresh throttle — skip stale-while-revalidate if data was
  // fetched less than REFRESH_THROTTLE_MS ago (P1 perf fix).
  const lastFetchTimestamp = new Map<string, number>();
  const REFRESH_THROTTLE_MS = 5_000;

  // Restrict deep fingerprinting to turns likely to change retroactively:
  // any turn with an in-progress subagent, plus the tail turn.
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
    const events = turn.sessionEvents ?? [];
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
      events.length,
      events
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

  /**
   * Smart-merge incoming turns into the reactive array.
   *
   * During auto-refresh of active sessions, updates are usually append-only,
   * but subagent lifecycle events can retroactively update older turns.
   * We preserve the in-place mutation strategy for performance by replacing
   * only changed indices and appending new turns.
   *
   * Falls back to full replacement on first load or when lengths shrink.
   */
  function mergeTurns(incoming: ConversationTurn[]) {
    const existing = turns.value;

    // Full replacement: first load, reset, or truncation.
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
      const nextFingerprint = turnFingerprint(incoming[idx]);
      nextFingerprints[idx] = nextFingerprint;
      if (turnFingerprints[idx] !== nextFingerprint) {
        existing[idx] = incoming[idx];
        changed = true;
      }
    }

    // Cheap metadata compare across all turns catches changes that don't require
    // deep hashing (model, completion, timestamps, etc.).
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

    // Append any new turns
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
  // Caches all loaded section data so switching between recently viewed
  // sessions restores the UI instantly without any IPC roundtrip.
  //
  // Eviction policy: Least Recently Used (LRU). Both reads and writes
  // promote the entry to the most-recently-used position so that
  // frequently accessed sessions survive longer in the cache than sessions
  // that were only visited once a long time ago.
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

  /**
   * Write a session snapshot to the cache, promoting it to the most-recently-used
   * position. Evicts the least-recently-used entry when the cache is full.
   *
   * Uses delete-then-reinsert to update insertion order: JS Map preserves
   * insertion order and Map.set() on an existing key does NOT move the key,
   * so we must delete first to achieve LRU semantics.
   */
  function setSessionCache(id: string, cached: CachedSession) {
    // LRU: delete existing entry before reinserting to move it to MRU position
    sessionCache.delete(id);
    sessionCache.set(id, cached);
    if (sessionCache.size > SESSION_CACHE_SIZE) {
      const oldest = sessionCache.keys().next().value;
      if (oldest !== undefined) sessionCache.delete(oldest);
    }
  }

  /**
   * Read a session snapshot from the cache, promoting it to the most-recently-used
   * position (LRU read-touch). Returns undefined on a cache miss.
   */
  function getFromSessionCache(id: string): CachedSession | undefined {
    const entry = sessionCache.get(id);
    if (entry !== undefined) {
      // LRU: move to MRU position by delete-then-reinsert
      sessionCache.delete(id);
      sessionCache.set(id, entry);
    }
    return entry;
  }

  function buildCachedSessionSnapshot(currentDetail: SessionDetail): CachedSession {
    return {
      detail: currentDetail,
      turns: turns.value,
      eventsFileSize: lastEventsFileSize,
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
      eventsFileSize: turnsResult.eventsFileSize,
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
    lastEventsFileSize = cached.eventsFileSize;
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

  // ── Section loader factory ───────────────────────────────────────────
  // Eliminates boilerplate across load functions that share identical
  // guard / fetch / stale-token / error-handling logic.
  function buildSectionLoader<T>(opts: {
    key: string;
    errorRef: Ref<string | null>;
    fetchFn: (id: string) => Promise<T>;
    onResult: (result: T) => void;
    logLevel?: "error" | "warn";
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
        const logFn = opts.logLevel === "warn" ? logWarn : logError;
        logFn(`[sessionDetail] Failed to load ${opts.key}:`, e);
      }
    };
  }

  // ── Section refresh helper ──────────────────────────────────────────
  // Used by refreshAll() for sections that follow the simple pattern:
  // fetch → assign result → clear error (on success).
  // Unlike buildSectionLoader, this clears errorRef on *success* (not before
  // the fetch), preserving the previous error during the refresh attempt.
  async function buildRefreshPromise<T>(
    cfg: {
      key: string;
      errorRef: Ref<string | null>;
      fetchFn: (id: string) => Promise<T>;
      onResult: (result: T) => void;
      logLevel?: "error" | "warn";
    },
    id: string,
    token: AsyncGuardToken,
  ): Promise<void> {
    try {
      const result = await cfg.fetchFn(id);
      if (!sessionGuard.isValid(token)) return;
      cfg.onResult(result);
      cfg.errorRef.value = null;
    } catch (e) {
      if (!sessionGuard.isValid(token)) return;
      cfg.errorRef.value = toErrorMessage(e);
      const logFn = cfg.logLevel === "warn" ? logWarn : logError;
      logFn(`[sessionDetail] Failed to refresh ${cfg.key}:`, e);
    }
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
  // NOTE: CachedSession field mapping is centralized via:
  // buildCachedSessionSnapshot(), restoreFromCachedSession(), and
  // buildPrefetchedCachedSession().
  function defineSection<T>(config: {
    key: string;
    section: AsyncSectionState<T>;
    defaultValue: () => T;
    fetchFn: (id: string) => Promise<T>;
    logLevel?: "error" | "warn";
  }) {
    const load = buildSectionLoader({
      key: config.key,
      errorRef: config.section.error,
      fetchFn: config.fetchFn,
      onResult: (result) => {
        config.section.data.value = result;
      },
      logLevel: config.logLevel,
    });

    return {
      key: config.key,
      section: config.section,
      load,
      clearError: () => {
        config.section.error.value = null;
      },
      resetData: () => {
        config.section.data.value = config.defaultValue();
      },
      buildRefresh: (id: string, token: number) =>
        buildRefreshPromise(
          {
            key: config.key,
            errorRef: config.section.error,
            fetchFn: config.fetchFn,
            onResult: (r) => {
              config.section.data.value = r;
            },
            logLevel: config.logLevel,
          },
          id,
          token,
        ),
    };
  }

  const todosDef = defineSection({
    key: "todos",
    section: todosSection,
    defaultValue: () => null,
    fetchFn: (id) => getSessionTodos(id),
  });

  const checkpointsDef = defineSection({
    key: "checkpoints",
    section: checkpointsSection,
    defaultValue: (): CheckpointEntry[] => [],
    fetchFn: (id) => getSessionCheckpoints(id),
  });

  const planDef = defineSection({
    key: "plan",
    section: planSection,
    defaultValue: () => null,
    fetchFn: (id) => getSessionPlan(id),
  });

  const metricsDef = defineSection({
    key: "metrics",
    section: metricsSection,
    defaultValue: () => null,
    fetchFn: (id) => getShutdownMetrics(id),
  });

  const incidentsDef = defineSection({
    key: "incidents",
    section: incidentsSection,
    defaultValue: (): SessionIncident[] => [],
    fetchFn: (id) => getSessionIncidents(id),
    logLevel: "warn",
  });

  const standardSections = [todosDef, checkpointsDef, planDef, metricsDef, incidentsDef];

  /** Clear all per-section error refs (used on session switch / reset). */
  function clearSectionErrors() {
    turnsError.value = null; // special case: custom loader with lastEventsFileSize
    eventsError.value = null; // special case: uses eventsGuard + pagination
    for (const sec of standardSections) {
      sec.clearError();
    }
  }

  /** Reset all section data refs to their initial (empty) state.
   *  Used on full session switch (cache miss) and on store reset.
   *  Do NOT use in the cache-hit path — that restores specific fields. */
  function resetSectionData() {
    detail.value = null;
    replaceTurns([]);
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

    // Check frontend cache for instant restore — promotes session to MRU position
    const cached = getFromSessionCache(id);
    if (cached) {
      // Restore ALL sections immediately — zero IPC, zero spinner
      restoreFromCachedSession(cached);
      loading.value = false;
      // Events & todos intentionally NOT cached (paginated / rarely viewed).
      // Remove from loaded so they are fetched fresh on-demand rather than
      // eagerly background-refreshed.
      events.value = null;
      loaded.value.delete("events");
      todosSection.data.value = null;
      loaded.value.delete("todos");

      // Background refresh: silently update stale data (throttled).
      // refreshAll() leverages the section registry so ALL loaded sections
      // (including checkpoints, metrics, incidents) get refreshed.
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
    errorRef: turnsError,
    fetchFn: (id) => getSessionTurns(id),
    onResult: (result) => {
      replaceTurns(result.turns);
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

    // Turns have a freshness-check short-circuit, so they stay as a custom block.
    if (sections.has("turns")) {
      promises.push(
        (async () => {
          try {
            // Freshness check: skip full turn fetch if events.jsonl hasn't changed
            try {
              const freshness = await checkSessionFreshness(id);
              if (!sessionGuard.isValid(token)) return;
              if (freshness.eventsFileSize === lastEventsFileSize) return;
            } catch (e) {
              // Freshness check failed — fall through to full fetch
              logWarn("[sessionDetail] Freshness check failed, proceeding with full fetch", { sessionId: id }, e);
            }

            const result = await getSessionTurns(id);
            if (!sessionGuard.isValid(token)) return;
            mergeTurns(result.turns);
            turnsError.value = null;
            lastEventsFileSize = result.eventsFileSize;
          } catch (e) {
            if (!sessionGuard.isValid(token)) return;
            turnsError.value = toErrorMessage(e);
            logError("[sessionDetail] Failed to refresh turns:", e);
          }
        })(),
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

      setSessionCache(id, buildPrefetchedCachedSession(detailResult, turnsResult));
    } catch (e) {
      // Silent — prefetch is best-effort optimization
      logWarn("[sessionDetail] Prefetch failed (best-effort)", { sessionId: id }, e);
    }
  }

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
