/**
 * Alert preferences slice.
 *
 * Exposes reactive refs for the alerting system (enabled, scope, notification
 * channels, per-event toggles, cooldown). Defaults match the original store.
 */

import { ref } from "vue";

export type AlertScope = "monitored" | "all";

export function createAlertsSlice() {
  const alertsEnabled = ref(false);
  const alertsScope = ref<AlertScope>("monitored");
  const alertsNativeNotifications = ref(true);
  const alertsTaskbarFlash = ref(true);
  const alertsSoundEnabled = ref(false);
  const alertsOnAskUser = ref(true);
  const alertsOnSessionError = ref(false);
  const alertsCooldownSeconds = ref(20);

  return {
    alertsEnabled,
    alertsScope,
    alertsNativeNotifications,
    alertsTaskbarFlash,
    alertsSoundEnabled,
    alertsOnAskUser,
    alertsOnSessionError,
    alertsCooldownSeconds,
  };
}

export type AlertsSlice = ReturnType<typeof createAlertsSlice>;
