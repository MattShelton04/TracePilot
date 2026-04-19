// ─── Alert Watcher ────────────────────────────────────────────────
// Monitors the Copilot SDK bridge event stream and fires alerts when
// notable events occur for SDK-steered sessions:
//   - session.idle  → agent finished its turn, waiting for user input
//   - session.error → session encountered an error
//
// This composable must be activated once in the main window (App.vue).
// It requires the Copilot SDK feature to be enabled and connected.
// Non-SDK sessions are intentionally not monitored — file-system polling
// cannot reliably infer "needs input" semantics.

import { getCurrentScope, onScopeDispose, watch } from "vue";
import type { Router } from "vue-router";
import { dispatchAlert } from "@/composables/useAlertDispatcher";
import { useAlertWatcherStore } from "@/stores/alertWatcher";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";
import { useSessionsStore } from "@/stores/sessions";
import { useSessionTabsStore } from "@/stores/sessionTabs";
import { logInfo, logWarn } from "@/utils/logger";

// ── Monitored session resolution ─────────────────────────────────

/**
 * Returns the set of session IDs the user is actively monitoring.
 * "Monitored" means: open in a tab, or currently viewed via route.
 */
function getMonitoredSessionIds(): Set<string> {
  const ids = new Set<string>();

  try {
    const tabStore = useSessionTabsStore();

    for (const tab of tabStore.tabs) {
      ids.add(tab.sessionId);
    }

    for (const sid of tabStore.popupSessionIds) {
      ids.add(sid);
    }
  } catch {
    /* tab store not available */
  }

  const store = useAlertWatcherStore();
  const route = store.capturedRoute;
  if (route) {
    const routeId = route.params?.id;
    if (typeof routeId === "string" && routeId) {
      ids.add(routeId);
    }
  }

  return ids;
}

/**
 * Returns true if the given SDK session ID is within the user's alert scope.
 */
function isSdkSessionInScope(sessionId: string): boolean {
  const prefs = usePreferencesStore();
  if (prefs.alertsScope === "all") return true;
  return getMonitoredSessionIds().has(sessionId);
}

/**
 * Returns a human-readable label for a session, preferring the TracePilot
 * session summary, then the SDK working-directory basename, then a short ID.
 */
function getSessionLabel(sessionId: string): string {
  try {
    const sessionsStore = useSessionsStore();
    const tracepilot = sessionsStore.sessions.find((s) => s.id === sessionId);
    if (tracepilot?.summary) return tracepilot.summary;
  } catch {
    /* sessions store unavailable */
  }

  const sdk = useSdkStore();
  const sdkSession = sdk.sessions.find((s) => s.sessionId === sessionId);
  if (sdkSession?.workingDirectory) {
    const parts = sdkSession.workingDirectory.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }

  return `Session ${sessionId.slice(0, 8)}`;
}

// ── Null-ID event key helper ─────────────────────────────────────

/**
 * Returns a stable dedup key for a BridgeEvent.
 *
 * When `event.id` is provided (the common case) it is used directly — it is
 * the SDK's own unique identifier and is guaranteed stable.
 *
 * When `event.id` is null we fall back to a WeakMap-backed assignment so each
 * distinct event *object* gets a unique key regardless of whether its
 * `eventType` and `timestamp` fields happen to collide with another event (e.g.
 * two rapid turns with second-precision timestamps).  The WeakMap lives inside
 * the composable closure: event objects referenced by `sdk.recentEvents` are
 * stable (the SDK appends via `[...current, newEvent]` — existing elements keep
 * their identity), so the same object always maps to the same key.  When an
 * event is eventually evicted from the sliding window its WeakMap entry is
 * garbage-collected automatically.
 */
function makeGetEventKey() {
  const cache = new WeakMap<object, string>();
  let seq = 0;
  return function getEventKey(event: { id: string | null; eventType: string; timestamp: string }): string {
    if (event.id) return event.id;
    if (cache.has(event)) return cache.get(event)!;
    const key = `null:${++seq}:${event.eventType}:${event.timestamp}`;
    cache.set(event, key);
    return key;
  };
}

// ── Composable entry point ───────────────────────────────────────

/**
 * Start the alert watcher. Call once in App.vue (main window only).
 * @param router — Pass the Router captured during synchronous setup.
 *   `useRouter()` cannot be called here because this runs after `await`
 *   in `onMounted`, where Vue's component instance is no longer active.
 * Returns a cleanup function. If called inside an active Vue effect scope,
 * cleanup is also registered via onScopeDispose automatically.
 */
export function useAlertWatcher(router: Router): () => void {
  const prefs = usePreferencesStore();
  const store = useAlertWatcherStore();
  const sdk = useSdkStore();

  logInfo(
    `[alert-watcher] Initializing (SDK mode) — alertsEnabled=${prefs.alertsEnabled}, scope=${prefs.alertsScope}, sdkConnected=${sdk.connectionState}`,
  );

  // Per-composable-instance key helper — WeakMap lifetime is tied to this closure.
  const getEventKey = makeGetEventKey();

  // Keep capturedRoute in sync for scope filtering.
  store.setCapturedRoute(router.currentRoute.value);
  const stopRouteWatch = watch(
    () => router.currentRoute.value,
    (r) => store.setCapturedRoute(r),
  );

  // ── Seed existing events ─────────────────────────────────────
  // Mark all events currently buffered in recentEvents as already-seen so
  // we don't alert on events that arrived before the watcher initialized.
  function seedCurrentEvents() {
    for (const event of sdk.recentEvents) {
      store.markSdkEventSeen(event.sessionId, getEventKey(event));
    }
  }
  seedCurrentEvents();

  // ── Watch for new SDK bridge events ─────────────────────────
  // The SDK store replaces the recentEvents array on each new event
  // ([...current, newEvent]), so this watcher fires on every incoming event.
  // Use a getter so Vue tracks the reactive store property correctly.
  const stopEventsWatch = watch(() => sdk.recentEvents, (events) => {
    for (const event of events) {
      const key = getEventKey(event);

      if (store.hasSeenSdkEvent(event.sessionId, key)) continue;
      // Always mark as seen — even when alerts are disabled — so that
      // re-enabling alerts doesn't produce a burst of stale notifications.
      store.markSdkEventSeen(event.sessionId, key);

      if (!prefs.alertsEnabled) continue;

      // Ephemeral events are streaming fragments (not actionable state changes).
      if (event.ephemeral) continue;

      // Scope check — respect "monitored" vs "all" preference.
      if (!isSdkSessionInScope(event.sessionId)) continue;

      const label = getSessionLabel(event.sessionId);

      if (event.eventType === "userInput.request" && prefs.alertsOnAskUser) {
        const d = event.data;
        const question =
          d !== null && typeof d === "object" && "question" in d && typeof (d as Record<string, unknown>).question === "string"
            ? (d as Record<string, unknown>).question as string
            : "Your response is needed";
        logInfo(`[alert-watcher] userInput.request — alerting for ${event.sessionId}`);
        dispatchAlert({
          type: "ask-user",
          sessionId: event.sessionId,
          title: "Input Required",
          body: `${label}: ${question}`,
        });
      } else if (event.eventType === "session.idle" && prefs.alertsOnAskUser) {
        logInfo(`[alert-watcher] session.idle — alerting for ${event.sessionId}`);
        dispatchAlert({
          type: "ask-user",
          sessionId: event.sessionId,
          title: "Agent Waiting",
          body: `${label} has finished and is waiting for your next message`,
        });
      } else if (event.eventType === "session.error" && prefs.alertsOnSessionError) {
        logInfo(`[alert-watcher] session.error — alerting for ${event.sessionId}`);
        dispatchAlert({
          type: "session-error",
          sessionId: event.sessionId,
          title: "Session Error",
          body: `${label} encountered an error`,
        });
      }
    }
  });

  // Prune seen-event entries when the SDK session list shrinks so the
  // dedup set doesn't grow unboundedly across a long app session.
  const stopSdkSessionsWatch = watch(
    () => sdk.sessions,
    (sessions) => {
      const activeIds = new Set(sessions.map((s) => s.sessionId));
      store.pruneSdkEvents(activeIds);
    },
    { deep: false },
  );

  // On SDK disconnect, reset dedup state and re-seed the surviving buffer.
  // Re-seeding is critical: recentEvents is NOT cleared on disconnect, so
  // without re-seeding, the first post-reconnect event would cause the watcher
  // to iterate the full pre-disconnect buffer (now all "unseen") and fire
  // stale alerts for every historical session.idle / session.error event.
  const stopConnectionWatch = watch(
    () => sdk.connectionState,
    (state) => {
      if (state === "disconnected") {
        store.$reset();
        seedCurrentEvents();
        // Restore the captured route so scope filtering keeps working.
        store.setCapturedRoute(router.currentRoute.value);
      }
    },
  );

  // ── Cleanup ──────────────────────────────────────────────────
  function cleanup() {
    stopRouteWatch();
    stopEventsWatch();
    stopSdkSessionsWatch();
    stopConnectionWatch();
    store.$reset();
  }

  const scope = getCurrentScope();
  if (scope) {
    onScopeDispose(cleanup);
  } else {
    logWarn(
      "[alert-watcher] Initialized outside an active Vue effect scope. " +
        "Cleanup will not run automatically — call the returned dispose function to clean up.",
    );
  }

  return cleanup;
}
