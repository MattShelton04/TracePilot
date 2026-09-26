import { onScopeDispose, watch } from "vue";
import type { SdkSteeringActions } from "./actions";
import type { SdkSteeringState } from "./state";

/** How often the open session's hosting state is re-checked. */
export const LIVE_HOST_POLL_MS = 5000;

/**
 * Keeps `sdk.liveHostsById` fresh for the open session and auto-attaches when
 * it becomes attachable (Live sessions → auto-attach preference).
 *
 * Auto-attach runs at most once per hosting terminal (session, PID and
 * address) per view, and never after the user detached, because every attach
 * appends one `session.resume` event to the session's history. A terminal
 * that is closed and started again is a new host, so it is attached again.
 */
export function useLiveHostWatcher(state: SdkSteeringState, actions: SdkSteeringActions) {
  const { sdk, prefs, sessionIdRef, isEnabled, liveHost, hasActiveSdkHandle, userUnlinked } = state;
  const autoAttempted = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    const sid = sessionIdRef.value;
    if (!sid || !isEnabled.value) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    await sdk.refreshLiveHosts([sid]);
    maybeAutoAttach();
  }

  function maybeAutoAttach() {
    const sid = sessionIdRef.value;
    const host = liveHost.value;
    if (!sid || host?.state !== "attachable") return;
    if (!prefs.liveAutoAttach || userUnlinked.value || hasActiveSdkHandle.value) return;
    const hostKey = `${sid}@${host.pid ?? "?"}/${host.address ?? "?"}`;
    if (autoAttempted.has(hostKey)) return;
    autoAttempted.add(hostKey);
    void actions.attachLive();
  }

  function start() {
    stop();
    void refresh();
    timer = setInterval(() => void refresh(), LIVE_HOST_POLL_MS);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  watch(
    [sessionIdRef, isEnabled],
    ([sid, enabled]) => {
      if (sid && enabled) start();
      else stop();
    },
    { immediate: true },
  );
  onScopeDispose(stop);

  return { refresh };
}
