// ─── Alert Watcher ────────────────────────────────────────────────
// Monitors session state and fires alerts when notable events occur:
//   - Session completion (isRunning transitions true → false)
//   - ask_user tool calls in conversation turns
//   - Session errors
//
// This composable should be activated once in the main window (App.vue).
// It watches the sessions store for running-state transitions and polls
// active tab instances for new ask_user events.
//
// All dedup / baseline state lives in the alertWatcher Pinia store so it
// is observable, testable, and resettable.

import { getSessionTurns } from "@tracepilot/client";
import type { ConversationTurn } from "@tracepilot/types";
import { useVisibilityGatedPoll } from "@tracepilot/ui";
import { onScopeDispose, watch } from "vue";
import type { Router } from "vue-router";
import { dispatchAlert } from "@/composables/useAlertDispatcher";
import { useAlertWatcherStore } from "@/stores/alertWatcher";
import { usePreferencesStore } from "@/stores/preferences";
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

    // Session tabs
    for (const tab of tabStore.tabs) {
      ids.add(tab.sessionId);
    }

    // Sessions open in popup (viewer) windows
    for (const sid of tabStore.popupSessionIds) {
      ids.add(sid);
    }
  } catch {
    /* tab store not available */
  }

  // Current route (captured during setup — safe to read from any context)
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
 * Filter sessions based on alert scope preference.
 * "monitored" → only sessions in tabs/route view
 * "all" → all sessions (caller handles capping)
 */
function filterSessionsByScope<T extends { id: string }>(sessions: T[]): T[] {
  const prefs = usePreferencesStore();
  if (prefs.alertsScope === "all") {
    return sessions;
  }
  const monitoredIds = getMonitoredSessionIds();
  return sessions.filter((s) => monitoredIds.has(s.id));
}

// ── Session-end detection ────────────────────────────────────────

function checkSessionEndAlerts(
  sessions: Array<{ id: string; isRunning: boolean; summary?: string | null }>,
) {
  const prefs = usePreferencesStore();
  const store = useAlertWatcherStore();

  // Build the full set of currently running session IDs — used for pruning
  // regardless of whether alerts are enabled or scoped.
  const allRunning = new Set(sessions.filter((s) => s.isRunning).map((s) => s.id));

  // Only dispatch alerts when enabled
  if (prefs.alertsEnabled && prefs.alertsOnSessionEnd) {
    const scopedSessions = filterSessionsByScope(sessions);

    for (const session of scopedSessions) {
      if (session.isRunning) continue;
      if (!store.seenRunning(session.id)) continue;

      const shortId = session.id.slice(0, 8);
      const label = session.summary || `Session ${shortId}`;
      logInfo(`[alert-watcher] Session ended: ${session.id}`);

      dispatchAlert({
        type: "session-end",
        sessionId: session.id,
        sessionSummary: session.summary ?? undefined,
        title: "Session Completed",
        body: label,
      });
    }
  }

  // Update tracking state — always use ALL running sessions, not scoped.
  // This prevents pruneStaleEntries from evicting dedup keys for sessions
  // that are running but out of scope.
  store.replaceRunning(allRunning);
  store.pruneStaleEntries(allRunning);
}

// ── ask_user detection ───────────────────────────────────────────

function scanTurnsForAskUser(sessionId: string, turns: ConversationTurn[], summary?: string) {
  const prefs = usePreferencesStore();
  if (!prefs.alertsEnabled || !prefs.alertsOnAskUser) return;
  const store = useAlertWatcherStore();

  const lastCount = store.getLastTurnCount(sessionId);
  store.setLastTurnCount(sessionId, turns.length);

  // Only scan turns we haven't checked yet
  const newTurns = turns.slice(lastCount);

  for (const turn of newTurns) {
    for (const tc of turn.toolCalls) {
      if (tc.toolName !== "ask_user") continue;
      // Prefix all keys with sessionId for reliable pruning.
      // toolCallId is opaque — cannot extract sessionId from it.
      const rawKey = tc.toolCallId ?? `${turn.turnIndex}:ask_user`;
      const callKey = `${sessionId}:${rawKey}`;
      if (store.hasAlertedAskUser(callKey)) continue;
      store.markAskUserAlerted(callKey);

      const shortId = sessionId.slice(0, 8);
      const label = summary || `Session ${shortId}`;

      dispatchAlert({
        type: "ask-user",
        sessionId,
        sessionSummary: summary,
        title: "Agent Needs Input",
        body: `${label} is waiting for your response`,
      });
    }
  }
}

// ── Error detection ──────────────────────────────────────────────

function checkSessionErrorAlerts(
  sessions: Array<{
    id: string;
    isRunning: boolean;
    summary?: string | null;
    errorCount?: number | null;
  }>,
) {
  const prefs = usePreferencesStore();
  if (!prefs.alertsEnabled || !prefs.alertsOnSessionError) return;
  const store = useAlertWatcherStore();

  const scopedSessions = filterSessionsByScope(sessions);

  for (const session of scopedSessions) {
    if (!session.isRunning) continue;
    const currentErrors = session.errorCount ?? 0;

    if (!store.isErrorBaselineEstablished(session.id)) {
      // First observation — record baseline, don't alert
      store.establishErrorBaseline(session.id);
      store.setLastErrorCount(session.id, currentErrors);
      continue;
    }

    const lastErrors = store.getLastErrorCount(session.id);

    if (currentErrors > lastErrors) {
      const shortId = session.id.slice(0, 8);
      const label = session.summary || `Session ${shortId}`;
      const newErrors = currentErrors - lastErrors;

      dispatchAlert({
        type: "session-error",
        sessionId: session.id,
        sessionSummary: session.summary ?? undefined,
        title: "Session Error",
        body: `${label} encountered ${newErrors} new error${newErrors > 1 ? "s" : ""}`,
      });
    }

    store.setLastErrorCount(session.id, currentErrors);
  }
}

// ── Polling for ask_user in running sessions ─────────────────────

async function pollRunningSessionsForAskUser() {
  const prefs = usePreferencesStore();
  if (!prefs.alertsEnabled || !prefs.alertsOnAskUser) return;
  const store = useAlertWatcherStore();

  // Prevent overlapping poll cycles or polls during seeding
  if (store.askUserPollInFlight || store.seedInFlight) return;
  store.askUserPollInFlight = true;

  try {
    const sessionsStore = useSessionsStore();

    // Filter by scope — no hard cap. Each poll is a lightweight JSON fetch.
    const allRunning = sessionsStore.sessions.filter((s) => s.isRunning);
    const scopedRunning = filterSessionsByScope(allRunning);
    logInfo(
      `[alert-watcher] ask_user poll: ${allRunning.length} running, ${scopedRunning.length} in scope`,
    );

    for (const session of scopedRunning) {
      try {
        // Inline seeding: if we have no baseline for this session, record the
        // current turn count and mark ALL existing ask_user calls as already-seen.
        // Only ask_user events that appear in FUTURE turns will trigger alerts.
        if (!store.hasTurnCount(session.id)) {
          const result = await getSessionTurns(session.id);
          store.setLastTurnCount(session.id, result.turns.length);
          for (const turn of result.turns) {
            for (const tc of turn.toolCalls) {
              if (tc.toolName !== "ask_user") continue;
              const rawKey = tc.toolCallId ?? `${turn.turnIndex}:ask_user`;
              store.markAskUserAlerted(`${session.id}:${rawKey}`);
            }
          }
          continue;
        }
        const result = await getSessionTurns(session.id);
        scanTurnsForAskUser(session.id, result.turns, session.summary ?? undefined);
      } catch (e) {
        logWarn(`[alert-watcher] Failed to poll turns for ${session.id}:`, e);
      }
    }
  } finally {
    store.askUserPollInFlight = false;
  }
}

// ── Turn baseline seeding ────────────────────────────────────────

/**
 * Seed lastSeenTurnCount for all currently running sessions so that existing
 * ask_user calls from before app startup don't fire stale alerts.
 */
async function seedTurnBaselines() {
  const store = useAlertWatcherStore();
  if (store.seedInFlight) return;
  store.seedInFlight = true;

  try {
    const sessionsStore = useSessionsStore();
    const allRunning = sessionsStore.sessions.filter((s) => s.isRunning);
    const runningSessions = filterSessionsByScope(allRunning);

    for (const session of runningSessions) {
      if (store.hasTurnCount(session.id)) continue;

      try {
        const result = await getSessionTurns(session.id);
        store.setLastTurnCount(session.id, result.turns.length);

        // Mark ALL existing ask_user calls as already seen so only future
        // events trigger alerts after app startup.
        for (const turn of result.turns) {
          for (const tc of turn.toolCalls) {
            if (tc.toolName !== "ask_user") continue;
            const rawKey = tc.toolCallId ?? `${turn.turnIndex}:ask_user`;
            store.markAskUserAlerted(`${session.id}:${rawKey}`);
          }
        }
      } catch (e) {
        logWarn(`[alert-watcher] Failed to seed baseline for ${session.id}:`, e);
      }
    }
  } finally {
    store.seedInFlight = false;
  }
}

// ── Composable entry point ───────────────────────────────────────

/**
 * Start the alert watcher. Call once in App.vue (main window only).
 * @param router — Pass the Router captured during synchronous setup.
 *   `useRouter()` cannot be called here because this runs after `await`
 *   in `onMounted`, where Vue's component instance is no longer active.
 * Automatically cleans up on scope disposal.
 */
export function useAlertWatcher(router: Router) {
  const sessionsStore = useSessionsStore();
  const prefs = usePreferencesStore();
  const store = useAlertWatcherStore();

  logInfo(
    `[alert-watcher] Initializing — alertsEnabled=${prefs.alertsEnabled}, scope=${prefs.alertsScope}, sessions=${sessionsStore.sessions.length}, running=${sessionsStore.sessions.filter((s) => s.isRunning).length}`,
  );

  store.setCapturedRoute(router.currentRoute.value);
  // Keep capturedRoute in sync reactively
  watch(
    () => router.currentRoute.value,
    (r) => {
      store.setCapturedRoute(r);
    },
  );

  // Initialize tracking from current state (don't alert on app startup)
  for (const session of sessionsStore.sessions) {
    if (session.isRunning) {
      store.markRunning(session.id);
    }
    // Record baseline error counts — mark as established so the first
    // real increase triggers an alert
    if (session.errorCount) {
      store.setLastErrorCount(session.id, session.errorCount);
    }
    store.establishErrorBaseline(session.id);
  }

  // Seed turn baselines — the prefs watcher below handles this
  // via { immediate: true }, so no explicit call needed here.

  // Watch for session list changes → check for ended sessions + errors
  const stopSessionWatch = watch(
    () => sessionsStore.sessions,
    (sessions) => {
      checkSessionEndAlerts(sessions);
      checkSessionErrorAlerts(sessions);
    },
    { deep: false },
  );

  // ── Periodic session refresh ─────────────────────────────────
  // The session-end watcher only fires when the sessions array ref changes.
  // Nothing else refreshes the list after startup, so we poll every 30s
  // to detect isRunning transitions (agent finished / awaiting user).
  //
  // Visibility-gated: pauses while the window is hidden; an immediate
  // catch-up tick fires on regain so ended sessions are detected promptly.
  const refreshPoll = useVisibilityGatedPoll(() => sessionsStore.refreshSessions(), 30_000, {
    immediate: false,
  });

  function startRefreshPolling() {
    refreshPoll.stop();
    if (prefs.alertsEnabled) {
      refreshPoll.start();
    }
  }

  function stopRefreshPolling() {
    refreshPoll.stop();
  }

  // Poll open tabs for ask_user events every 10 seconds — visibility-gated.
  const askUserPoll = useVisibilityGatedPoll(pollRunningSessionsForAskUser, 10_000, {
    immediate: false,
  });

  function startPolling() {
    askUserPoll.stop();
    if (prefs.alertsEnabled && prefs.alertsOnAskUser) {
      askUserPoll.start();
    }
  }

  function stopPolling() {
    askUserPoll.stop();
  }

  // React to preference changes — start/stop polling
  const stopPrefsWatch = watch(
    () => [prefs.alertsEnabled, prefs.alertsOnAskUser, prefs.alertsScope],
    () => {
      startPolling();
      startRefreshPolling();
      // Re-seed baselines when scope changes (e.g. switching to "all")
      seedTurnBaselines();
    },
    { immediate: true },
  );

  // Cleanup
  onScopeDispose(() => {
    stopSessionWatch();
    stopPrefsWatch();
    stopPolling();
    stopRefreshPolling();
    // Clear dedup state on scope disposal
    store.$reset();
  });
}
