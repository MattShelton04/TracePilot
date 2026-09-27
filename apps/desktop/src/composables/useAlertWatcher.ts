// ─── Alert Watcher ────────────────────────────────────────────────
// Monitors Copilot SDK live state and fires alerts only for SDK-steered
// sessions. Non-SDK sessions are left to the regular session UI rather than a
// background polling path.

import { getCurrentScope, onScopeDispose, watch } from "vue";
import type { Router } from "vue-router";
import {
  checkSdkBridgeMetricsAlerts,
  checkSdkSessionStateAlerts,
} from "@/composables/alertWatcherSdk";
import { useAlertWatcherStore } from "@/stores/alertWatcher";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";
import { logInfo } from "@/utils/logger";

// ── Composable entry point ───────────────────────────────────────

/**
 * Start the alert watcher once in the main window, inside an active effect scope.
 * @param router — Pass the Router captured during synchronous setup.
 *   `useRouter()` cannot be called here because this runs after `await`
 *   in `onMounted`, where Vue's component instance is no longer active.
 * Delayed callers must re-enter a scope captured during synchronous setup.
 * The scope owns all watches and clears their baseline state on disposal.
 */
export function useAlertWatcher(router: Router) {
  if (!getCurrentScope()) {
    throw new Error("useAlertWatcher requires an active effect scope");
  }
  const sdkStore = useSdkStore();
  const prefs = usePreferencesStore();
  const store = useAlertWatcherStore();
  onScopeDispose(() => store.$reset());

  logInfo(
    `[alert-watcher] Initializing SDK-only alerts — alertsEnabled=${prefs.alertsEnabled}, scope=${prefs.alertsScope}`,
  );

  store.setCapturedRoute(router.currentRoute.value);
  // Keep capturedRoute in sync reactively
  watch(
    () => router.currentRoute.value,
    (r) => {
      store.setCapturedRoute(r);
    },
  );

  checkSdkSessionStateAlerts(sdkStore.sessionStatesById, { baselineOnly: true });

  watch(
    () => [sdkStore.sessionStatesById, sdkStore.sessions, prefs.alertsScope] as const,
    ([statesById]) => {
      checkSdkSessionStateAlerts(statesById);
    },
    { deep: false },
  );

  watch(
    () => sdkStore.bridgeMetrics,
    (metrics) => {
      checkSdkBridgeMetricsAlerts(metrics);
    },
    { deep: false },
  );

  watch(
    () => [
      prefs.alertsEnabled,
      prefs.alertsOnAskUser,
      prefs.alertsOnSessionEnd,
      prefs.alertsOnSessionError,
    ],
    () => {
      checkSdkSessionStateAlerts(sdkStore.sessionStatesById);
      checkSdkBridgeMetricsAlerts(sdkStore.bridgeMetrics);
    },
  );
}
