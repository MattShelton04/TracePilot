import { IPC_EVENTS } from "@tracepilot/client";
import { onScopeDispose } from "vue";
import { tauriListen } from "@/lib/tauri";
import { logWarn } from "@/utils/logger";

/** Reload optional evidence after a sweep, including availability changes. */
export function useSessionStoreEvents(refresh: () => void | Promise<void>) {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  onScopeDispose(() => {
    disposed = true;
    unlisten?.();
  });
  void tauriListen(IPC_EVENTS.ENRICHMENT_FINISHED, () => {
    if (!disposed) void refresh();
  })
    .then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    })
    .catch((error) => logWarn("Failed to listen for session-store refreshes:", error));
}
