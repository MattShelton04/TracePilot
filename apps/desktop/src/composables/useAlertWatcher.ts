// ─── Alert Watcher ────────────────────────────────────────────────
// Monitors Copilot SDK live state and fires alerts only for SDK-steered
// sessions. Non-SDK sessions are left to the regular session UI rather than a
// background polling path.

import { onScopeDispose, watch } from "vue";
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
 * Start the alert watcher. Call once in App.vue (main window only).
 * @param router — Pass the Router captured during synchronous setup.
 *   `useRouter()` cannot be called here because this runs after `await`
 *   in `onMounted`, where Vue's component instance is no longer active.
 * Automatically cleans up on scope disposal.
 */
export function useAlertWatcher(router: Router) {
  const sdkStore = useSdkStore();
  const prefs = usePreferencesStore();
  const store = useAlertWatcherStore();

  logInfo(
    `[alert-watcher] Initializing SDK-only alerts — alertsEnabled=${prefs.alertsEnabled}, scope=${prefs.alertsScope}`,
  );

  store.setCapturedRoute(router.currentRoute.value);
  // Keep capturedRoute in sync reactively
  const stopRouteWatch = watch(
    () => router.currentRoute.value,
    (r) => {
      store.setCapturedRoute(r);
    },
  );

  checkSdkSessionStateAlerts(sdkStore.sessionStatesById, { baselineOnly: true });

  const stopSdkSessionWatch = watch(
    () => [sdkStore.sessionStatesById, sdkStore.sessions, prefs.alertsScope] as const,
    ([statesById]) => {
      checkSdkSessionStateAlerts(statesById);
    },
    { deep: false },
  );

  const stopSdkMetricsWatch = watch(
    () => sdkStore.bridgeMetrics,
    (metrics) => {
      checkSdkBridgeMetricsAlerts(metrics);
    },
    { deep: false },
  );

  const stopPrefsWatch = watch(
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

  // Cleanup
  onScopeDispose(() => {
    stopRouteWatch();
    stopSdkSessionWatch();
    stopSdkMetricsWatch();
    stopPrefsWatch();
    store.$reset();
  });
}
