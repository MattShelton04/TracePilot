/**
 * Alert Watcher Store — owns the dedup state for the SDK-event-driven
 * alert watcher composable.
 *
 * State is intentionally closure-owned (not exposed as reactive refs) so
 * that components never re-render on membership changes. Actions give the
 * composable (and tests) a narrow, observable, resettable surface.
 *
 * All alert detection now happens via Copilot SDK bridge events
 * (`session.idle`, `session.error`) forwarded through `useSdkStore`.
 */
import { defineStore } from "pinia";
import { type Ref, ref } from "vue";
import type { RouteLocationNormalizedLoaded } from "vue-router";

export interface AlertWatcherStore {
  capturedRoute: Ref<RouteLocationNormalizedLoaded | null>;
  hasSeenSdkEvent: (sessionId: string, eventKey: string) => boolean;
  markSdkEventSeen: (sessionId: string, eventKey: string) => void;
  pruneSdkEvents: (activeSessions: Set<string>) => void;
  setCapturedRoute: (route: RouteLocationNormalizedLoaded | null) => void;
  $reset: () => void;
}

export const useAlertWatcherStore = defineStore("alertWatcher", (): AlertWatcherStore => {
  // Closure-owned dedup set for SDK bridge events.
  // Keys are stored as "sessionId:eventKey" to allow pruning by session.
  // UUID session IDs never contain ":", so splitting on the first ":" is safe.
  let seenSdkEvents = new Set<string>();

  // ── Captured route ────────────────────────────────────────────
  const capturedRoute = ref<RouteLocationNormalizedLoaded | null>(null);

  // ── SDK event dedup ───────────────────────────────────────────
  function hasSeenSdkEvent(sessionId: string, eventKey: string): boolean {
    return seenSdkEvents.has(`${sessionId}:${eventKey}`);
  }

  function markSdkEventSeen(sessionId: string, eventKey: string): void {
    seenSdkEvents.add(`${sessionId}:${eventKey}`);
  }

  /**
   * Remove seen-event entries for sessions no longer in `activeSessions`.
   * Prevents unbounded growth as sessions come and go.
   */
  function pruneSdkEvents(activeSessions: Set<string>): void {
    for (const key of seenSdkEvents) {
      // Key format: "sessionId:rest" — sessionId is always a UUID (no colons).
      const colonIdx = key.indexOf(":");
      const sessionId = colonIdx >= 0 ? key.slice(0, colonIdx) : key;
      if (!activeSessions.has(sessionId)) {
        seenSdkEvents.delete(key);
      }
    }
  }

  // ── Route ─────────────────────────────────────────────────────
  function setCapturedRoute(route: RouteLocationNormalizedLoaded | null): void {
    capturedRoute.value = route;
  }

  // ── Reset ─────────────────────────────────────────────────────
  /** Clear all dedup state. Called on composable disposal and SDK disconnect. */
  function $reset(): void {
    seenSdkEvents = new Set();
    capturedRoute.value = null;
  }

  return {
    capturedRoute,
    hasSeenSdkEvent,
    markSdkEventSeen,
    pruneSdkEvents,
    setCapturedRoute,
    $reset,
  };
});
