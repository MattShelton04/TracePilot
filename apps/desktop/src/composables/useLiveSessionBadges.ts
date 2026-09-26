import type { SessionListItem } from "@tracepilot/types";
import { computed, onScopeDispose, type Ref, watch } from "vue";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";

/** Session-list poll cadence for hosting state (running sessions only). */
const LIVE_BADGE_POLL_MS = 10_000;

export type LiveBadge = "attachable" | "watching" | null;

/**
 * Live attach badges for a session list (ADR-0016). While live sessions are
 * enabled, the running sessions in `sessions` are located every few seconds
 * so cards can show which ones TracePilot can stream (`attachable`) or is
 * streaming (`watching`). Idle sessions are never queried.
 */
export function useLiveSessionBadges(sessions: Ref<readonly SessionListItem[]>) {
  const sdk = useSdkStore();
  const prefs = usePreferencesStore();
  const enabled = computed(() => prefs.isFeatureEnabled("copilotSdk"));
  const runningIds = computed(() => sessions.value.filter((s) => s.isRunning).map((s) => s.id));
  let timer: ReturnType<typeof setInterval> | null = null;

  function refresh() {
    if (!enabled.value || runningIds.value.length === 0) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void sdk.refreshLiveHosts(runningIds.value);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  watch(
    [enabled, () => runningIds.value.join(",")],
    ([on]) => {
      stop();
      if (!on || runningIds.value.length === 0) return;
      refresh();
      timer = setInterval(refresh, LIVE_BADGE_POLL_MS);
    },
    { immediate: true },
  );
  onScopeDispose(stop);

  function liveBadge(sessionId: string): LiveBadge {
    if (!enabled.value) return null;
    const host = sdk.liveHostsById[sessionId];
    if (host?.attached || sdk.isAttached(sessionId)) return "watching";
    return host?.state === "attachable" ? "attachable" : null;
  }

  return { liveBadge };
}
