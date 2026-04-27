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
  capturedRoute: Ref<RouteLocationNormalizedLoaded | null>;
  hasAlertedSdkState: (stateKey: string) => boolean;
  markSdkStateAlerted: (stateKey: string) => void;
  getLastSdkStatus: (sessionId: string) => string | null;
  setLastSdkStatus: (sessionId: string, status: string) => void;
  pruneSdkEntries: (activeSdkSessions: Set<string>) => void;
  setCapturedRoute: (route: RouteLocationNormalizedLoaded | null) => void;
  $reset: () => void;
}

export const useAlertWatcherStore = defineStore("alertWatcher", (): AlertWatcherStore => {
  // ── Non-reactive dedup state ──────────────────────────────────
  // Closure-owned — not returned as refs, so Vue does not track them.
  let alertedSdkStateKeys = new Set<string>();
  let lastSeenSdkStatus = new Map<string, string>();

  // ── Captured route ────────────────────────────────────────────
  const capturedRoute = ref<RouteLocationNormalizedLoaded | null>(null);

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
    alertedSdkStateKeys = new Set();
    lastSeenSdkStatus = new Map();
    capturedRoute.value = null;
  }

  return {
    capturedRoute,
    hasAlertedSdkState,
    markSdkStateAlerted,
    getLastSdkStatus,
    setLastSdkStatus,
    pruneSdkEntries,
    setCapturedRoute,
    $reset,
  };
});
