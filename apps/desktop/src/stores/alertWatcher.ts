/**
 * Alert Watcher Store — owns the dedup / baseline state for the alert
 * watcher composable. The Sets and Maps here intentionally live outside
 * Vue's reactivity system (they are closure-owned, not exposed as refs)
 * because we only need high-water-mark / membership semantics; we never
 * want components to re-render on membership changes.
 *
 * Exposed actions give the composable (and tests) a narrow, observable,
 * resettable surface over that state.
 */
import { defineStore } from "pinia";
import { type Ref, ref } from "vue";
import type { RouteLocationNormalizedLoaded } from "vue-router";

export interface AlertWatcherStore {
  askUserPollInFlight: Ref<boolean>;
  seedInFlight: Ref<boolean>;
  capturedRoute: Ref<RouteLocationNormalizedLoaded | null>;
  seenRunning: (sessionId: string) => boolean;
  markRunning: (sessionId: string) => void;
  unmarkRunning: (sessionId: string) => void;
  replaceRunning: (ids: Iterable<string>) => void;
  hasTurnCount: (sessionId: string) => boolean;
  getLastTurnCount: (sessionId: string) => number;
  setLastTurnCount: (sessionId: string, n: number) => void;
  hasAlertedAskUser: (callKey: string) => boolean;
  markAskUserAlerted: (callKey: string) => void;
  hasAlertedSdkState: (stateKey: string) => boolean;
  markSdkStateAlerted: (stateKey: string) => void;
  getLastSdkStatus: (sessionId: string) => string | null;
  setLastSdkStatus: (sessionId: string, status: string) => void;
  pruneSdkEntries: (activeSdkSessions: Set<string>) => void;
  isErrorBaselineEstablished: (sessionId: string) => boolean;
  establishErrorBaseline: (sessionId: string) => void;
  getLastErrorCount: (sessionId: string) => number;
  setLastErrorCount: (sessionId: string, n: number) => void;
  pruneStaleEntries: (currentlyRunning: Set<string>) => void;
  setCapturedRoute: (route: RouteLocationNormalizedLoaded | null) => void;
  $reset: () => void;
}

export const useAlertWatcherStore = defineStore("alertWatcher", (): AlertWatcherStore => {
  // ── Non-reactive dedup state ──────────────────────────────────
  // Closure-owned — not returned as refs, so Vue does not track them.
  let previouslyRunning = new Set<string>();
  let lastSeenTurnCount = new Map<string, number>();
  let alertedAskUserCalls = new Set<string>();
  let alertedSdkStateKeys = new Set<string>();
  let lastSeenSdkStatus = new Map<string, string>();
  let errorBaselineEstablished = new Set<string>();
  let lastSeenErrorCount = new Map<string, number>();

  // ── Reentrancy guards ─────────────────────────────────────────
  const askUserPollInFlight = ref(false);
  const seedInFlight = ref(false);

  // ── Captured route ────────────────────────────────────────────
  const capturedRoute = ref<RouteLocationNormalizedLoaded | null>(null);

  // ── Running-state transitions ─────────────────────────────────
  function seenRunning(sessionId: string): boolean {
    return previouslyRunning.has(sessionId);
  }
  function markRunning(sessionId: string): void {
    previouslyRunning.add(sessionId);
  }
  function unmarkRunning(sessionId: string): void {
    previouslyRunning.delete(sessionId);
  }
  function replaceRunning(ids: Iterable<string>): void {
    previouslyRunning = new Set(ids);
  }

  // ── Turn-count tracking ───────────────────────────────────────
  function hasTurnCount(sessionId: string): boolean {
    return lastSeenTurnCount.has(sessionId);
  }
  function getLastTurnCount(sessionId: string): number {
    return lastSeenTurnCount.get(sessionId) ?? 0;
  }
  function setLastTurnCount(sessionId: string, n: number): void {
    lastSeenTurnCount.set(sessionId, n);
  }

  // ── ask_user dedup ────────────────────────────────────────────
  function hasAlertedAskUser(callKey: string): boolean {
    return alertedAskUserCalls.has(callKey);
  }
  function markAskUserAlerted(callKey: string): void {
    alertedAskUserCalls.add(callKey);
  }

  // ── SDK live-state dedup ────────────────────────────────────────
  function hasAlertedSdkState(stateKey: string): boolean {
    return alertedSdkStateKeys.has(stateKey);
  }
  function markSdkStateAlerted(stateKey: string): void {
    alertedSdkStateKeys.add(stateKey);
  }
  function getLastSdkStatus(sessionId: string): string | null {
    return lastSeenSdkStatus.get(sessionId) ?? null;
  }
  function setLastSdkStatus(sessionId: string, status: string): void {
    lastSeenSdkStatus.set(sessionId, status);
  }
  function pruneSdkEntries(activeSdkSessions: Set<string>): void {
    for (const id of lastSeenSdkStatus.keys()) {
      if (!activeSdkSessions.has(id)) {
        lastSeenSdkStatus.delete(id);
      }
    }
    for (const key of alertedSdkStateKeys) {
      const sessionId = key.split(":")[0];
      if (sessionId !== "sdk-bridge" && !activeSdkSessions.has(sessionId)) {
        alertedSdkStateKeys.delete(key);
      }
    }
  }

  // ── Error baseline + high-water mark ──────────────────────────
  function isErrorBaselineEstablished(sessionId: string): boolean {
    return errorBaselineEstablished.has(sessionId);
  }
  function establishErrorBaseline(sessionId: string): void {
    errorBaselineEstablished.add(sessionId);
  }
  function getLastErrorCount(sessionId: string): number {
    return lastSeenErrorCount.get(sessionId) ?? 0;
  }
  function setLastErrorCount(sessionId: string, n: number): void {
    lastSeenErrorCount.set(sessionId, n);
  }

  // ── Stale-entry pruning ───────────────────────────────────────
  /**
   * Remove tracking data for sessions that are no longer running.
   * Prevents unbounded growth of the internal Maps/Sets.
   */
  function pruneStaleEntries(currentlyRunning: Set<string>): void {
    for (const id of lastSeenTurnCount.keys()) {
      if (!currentlyRunning.has(id)) {
        lastSeenTurnCount.delete(id);
      }
    }
    for (const id of lastSeenErrorCount.keys()) {
      if (!currentlyRunning.has(id)) {
        lastSeenErrorCount.delete(id);
        errorBaselineEstablished.delete(id);
      }
    }
    for (const key of alertedAskUserCalls) {
      const sessionId = key.split(":")[0];
      if (!currentlyRunning.has(sessionId)) {
        alertedAskUserCalls.delete(key);
      }
    }
  }

  // ── Route ─────────────────────────────────────────────────────
  function setCapturedRoute(route: RouteLocationNormalizedLoaded | null): void {
    capturedRoute.value = route;
  }

  // ── Reset ─────────────────────────────────────────────────────
  /**
   * Clear every internal Set/Map and reset all flags. Required for
   * deterministic tests and for cleanup on composable scope disposal.
   */
  function $reset(): void {
    previouslyRunning = new Set();
    lastSeenTurnCount = new Map();
    alertedAskUserCalls = new Set();
    alertedSdkStateKeys = new Set();
    lastSeenSdkStatus = new Map();
    errorBaselineEstablished = new Set();
    lastSeenErrorCount = new Map();
    askUserPollInFlight.value = false;
    seedInFlight.value = false;
    capturedRoute.value = null;
  }

  return {
    askUserPollInFlight,
    seedInFlight,
    capturedRoute,
    seenRunning,
    markRunning,
    unmarkRunning,
    replaceRunning,
    hasTurnCount,
    getLastTurnCount,
    setLastTurnCount,
    hasAlertedAskUser,
    markAskUserAlerted,
    hasAlertedSdkState,
    markSdkStateAlerted,
    getLastSdkStatus,
    setLastSdkStatus,
    pruneSdkEntries,
    isErrorBaselineEstablished,
    establishErrorBaseline,
    getLastErrorCount,
    setLastErrorCount,
    pruneStaleEntries,
    setCapturedRoute,
    $reset,
  };
});
