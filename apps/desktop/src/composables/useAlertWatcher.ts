// ─── Alert Watcher ────────────────────────────────────────────────
// Monitors session state and fires alerts when notable events occur:
//   - Session completion (isRunning transitions true → false)
//   - ask_user tool calls in conversation turns
//   - Session errors
//
// This composable should be activated once in the main window (App.vue).
// It watches the sessions store for running-state transitions and polls
// active tab instances for new ask_user events.

import { dispatchAlert } from "@/composables/useAlertDispatcher";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionsStore } from "@/stores/sessions";
import { useSessionTabsStore } from "@/stores/sessionTabs";
import { logInfo, logWarn } from "@/utils/logger";
import { onScopeDispose, watch } from "vue";
import { useRouter } from "vue-router";
import { getSessionTurns } from "@tracepilot/client";
import type { ConversationTurn } from "@tracepilot/types";
import type { RouteLocationNormalizedLoaded } from "vue-router";

// ── State tracking ───────────────────────────────────────────────

/** Track which sessions were running in the previous refresh cycle. */
const previouslyRunning = new Set<string>();

/**
 * Track the last-seen turn count per session so we only scan new turns
 * for ask_user events. Key: sessionId, Value: number of turns last checked.
 */
const lastSeenTurnCount = new Map<string, number>();

/**
 * Track which ask_user tool call IDs we've already alerted on,
 * to avoid duplicate notifications when turns are re-fetched.
 */
const alertedAskUserCalls = new Set<string>();

/**
 * Sessions whose error baseline has been established. We skip the first
 * observation so that pre-existing errors on startup don't trigger alerts.
 * Value: true once baseline has been recorded.
 */
const errorBaselineEstablished = new Set<string>();

/** Track previously seen error counts per session. */
const lastSeenErrorCount = new Map<string, number>();

/** Guard flag to prevent overlapping ask_user poll cycles. */
let askUserPollInFlight = false;

/** Guard flag to prevent overlapping seed operations. */
let seedInFlight = false;

/**
 * Captured route reference — set once during useAlertWatcher() setup (within
 * Vue's injection scope). Read by getMonitoredSessionIds() from any context
 * (timer callbacks, watchers) without needing inject().
 */
let capturedRoute: RouteLocationNormalizedLoaded | null = null;

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
  } catch { /* tab store not available */ }

  // Current route (captured during setup — safe to read from any context)
  if (capturedRoute) {
    const routeId = capturedRoute.params?.id;
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
  sessions: Array<{ id: string; isRunning: boolean; summary?: string }>,
) {
  const prefs = usePreferencesStore();

  // Build the full set of currently running session IDs — used for pruning
  // regardless of whether alerts are enabled or scoped.
  const allRunning = new Set(sessions.filter((s) => s.isRunning).map((s) => s.id));

  // Only dispatch alerts when enabled
  if (prefs.alertsEnabled && prefs.alertsOnSessionEnd) {
    const scopedSessions = filterSessionsByScope(sessions);

    for (const session of scopedSessions) {
      if (session.isRunning) continue;
      if (!previouslyRunning.has(session.id)) continue;

      const shortId = session.id.slice(0, 8);
      const label = session.summary || `Session ${shortId}`;
      logInfo(`[alert-watcher] Session ended: ${session.id}`);

      dispatchAlert({
        type: "session-end",
        sessionId: session.id,
        sessionSummary: session.summary,
        title: "Session Completed",
        body: label,
      });
    }
  }

  // Update tracking state — always use ALL running sessions, not scoped.
  // This prevents pruneStaleEntries from evicting dedup keys for sessions
  // that are running but out of scope.
  previouslyRunning.clear();
  for (const id of allRunning) {
    previouslyRunning.add(id);
  }

  pruneStaleEntries(allRunning);
}

// ── ask_user detection ───────────────────────────────────────────

function scanTurnsForAskUser(sessionId: string, turns: ConversationTurn[], summary?: string) {
  const prefs = usePreferencesStore();
  if (!prefs.alertsEnabled || !prefs.alertsOnAskUser) return;

  const lastCount = lastSeenTurnCount.get(sessionId) ?? 0;
  lastSeenTurnCount.set(sessionId, turns.length);

  // Only scan turns we haven't checked yet
  const newTurns = turns.slice(lastCount);

  for (const turn of newTurns) {
    for (const tc of turn.toolCalls) {
      if (tc.toolName !== "ask_user") continue;
      // Prefix all keys with sessionId for reliable pruning.
      // toolCallId is opaque — cannot extract sessionId from it.
      const rawKey = tc.toolCallId ?? `${turn.turnIndex}:ask_user`;
      const callKey = `${sessionId}:${rawKey}`;
      if (alertedAskUserCalls.has(callKey)) continue;
      alertedAskUserCalls.add(callKey);

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
  sessions: Array<{ id: string; isRunning: boolean; summary?: string; errorCount?: number }>,
) {
  const prefs = usePreferencesStore();
  if (!prefs.alertsEnabled || !prefs.alertsOnSessionError) return;

  const scopedSessions = filterSessionsByScope(sessions);

  for (const session of scopedSessions) {
    if (!session.isRunning) continue;
    const currentErrors = session.errorCount ?? 0;

    if (!errorBaselineEstablished.has(session.id)) {
      // First observation — record baseline, don't alert
      errorBaselineEstablished.add(session.id);
      lastSeenErrorCount.set(session.id, currentErrors);
      continue;
    }

    const lastErrors = lastSeenErrorCount.get(session.id) ?? 0;

    if (currentErrors > lastErrors) {
      const shortId = session.id.slice(0, 8);
      const label = session.summary || `Session ${shortId}`;
      const newErrors = currentErrors - lastErrors;

      dispatchAlert({
        type: "session-error",
        sessionId: session.id,
        sessionSummary: session.summary,
        title: "Session Error",
        body: `${label} encountered ${newErrors} new error${newErrors > 1 ? "s" : ""}`,
      });
    }

    lastSeenErrorCount.set(session.id, currentErrors);
  }
}

// ── Stale entry cleanup ──────────────────────────────────────────

/**
 * Remove tracking data for sessions that are no longer running.
 * Prevents unbounded growth of module-level Maps/Sets.
 */
function pruneStaleEntries(currentlyRunning: Set<string>) {
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
  // Prune alerted ask_user calls for sessions that are no longer running
  for (const key of alertedAskUserCalls) {
    const sessionId = key.split(":")[0];
    if (!currentlyRunning.has(sessionId)) {
      alertedAskUserCalls.delete(key);
    }
  }
}

// ── Polling for ask_user in running sessions ─────────────────────

let pollTimer: ReturnType<typeof setInterval> | null = null;

async function pollRunningSessionsForAskUser() {
  const prefs = usePreferencesStore();
  if (!prefs.alertsEnabled || !prefs.alertsOnAskUser) return;

  // Prevent overlapping poll cycles or polls during seeding
  if (askUserPollInFlight || seedInFlight) return;
  askUserPollInFlight = true;

  try {
    const sessionsStore = useSessionsStore();

    // Filter by scope and cap at 5 most recent to limit network traffic.
    const allRunning = sessionsStore.sessions.filter((s) => s.isRunning);
    const scopedRunning = filterSessionsByScope(allRunning).slice(0, 5);

    for (const session of scopedRunning) {
      try {
        const result = await getSessionTurns(session.id);
        scanTurnsForAskUser(session.id, result.turns, session.summary);
      } catch (e) {
        logWarn(`[alert-watcher] Failed to poll turns for ${session.id}:`, e);
      }
    }
  } finally {
    askUserPollInFlight = false;
  }
}

// ── Turn baseline seeding ────────────────────────────────────────

/**
 * Seed lastSeenTurnCount for all currently running sessions so that existing
 * ask_user calls from before app startup don't fire stale alerts.
 */
async function seedTurnBaselines() {
  if (seedInFlight) return;
  seedInFlight = true;

  try {
    const sessionsStore = useSessionsStore();
    const allRunning = sessionsStore.sessions.filter((s) => s.isRunning);
    const runningSessions = filterSessionsByScope(allRunning).slice(0, 5);

    for (const session of runningSessions) {
      if (lastSeenTurnCount.has(session.id)) continue;

      try {
        const result = await getSessionTurns(session.id);
        lastSeenTurnCount.set(session.id, result.turns.length);

        // Also mark any existing ask_user calls as already seen
        for (const turn of result.turns) {
          for (const tc of turn.toolCalls) {
            if (tc.toolName !== "ask_user") continue;
            const rawKey = tc.toolCallId ?? `${turn.turnIndex}:ask_user`;
            const callKey = `${session.id}:${rawKey}`;
            alertedAskUserCalls.add(callKey);
          }
        }
      } catch (e) {
        logWarn(`[alert-watcher] Failed to seed baseline for ${session.id}:`, e);
      }
    }
  } finally {
    seedInFlight = false;
  }
}

// ── Composable entry point ───────────────────────────────────────

/**
 * Start the alert watcher. Call once in App.vue (main window only).
 * Automatically cleans up on scope disposal.
 */
export function useAlertWatcher() {
  const sessionsStore = useSessionsStore();
  const prefs = usePreferencesStore();

  // Capture route ref within Vue's injection scope — safe to read later
  // from timer callbacks and watchers without inject().
  const router = useRouter();
  capturedRoute = router.currentRoute.value;
  // Keep capturedRoute in sync reactively
  watch(() => router.currentRoute.value, (r) => { capturedRoute = r; });

  // Initialize tracking from current state (don't alert on app startup)
  for (const session of sessionsStore.sessions) {
    if (session.isRunning) {
      previouslyRunning.add(session.id);
    }
    // Record baseline error counts — mark as established so the first
    // real increase triggers an alert
    if (session.errorCount) {
      lastSeenErrorCount.set(session.id, session.errorCount);
    }
    errorBaselineEstablished.add(session.id);
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

  // Poll open tabs for ask_user events every 10 seconds
  function startPolling() {
    stopPolling();
    if (prefs.alertsEnabled && prefs.alertsOnAskUser) {
      pollTimer = setInterval(pollRunningSessionsForAskUser, 10_000);
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // React to preference changes — start/stop polling
  const stopPrefsWatch = watch(
    () => [prefs.alertsEnabled, prefs.alertsOnAskUser, prefs.alertsScope],
    () => {
      startPolling();
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
    // Clear module-level state on scope disposal
    previouslyRunning.clear();
    lastSeenTurnCount.clear();
    lastSeenErrorCount.clear();
    alertedAskUserCalls.clear();
    errorBaselineEstablished.clear();
  });
}
