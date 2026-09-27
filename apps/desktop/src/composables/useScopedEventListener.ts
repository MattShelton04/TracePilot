import type { EventCallback, UnlistenFn } from "@tauri-apps/api/event";
import { onScopeDispose } from "vue";
import { safeListen } from "@/utils/tauriEvents";

/** One subscription per scope, including disposal while registration is pending. */
export function useScopedEventListener<T>(event: string, handler: EventCallback<T>) {
  let disposed = false;
  let pending: Promise<void> | null = null;
  let unlisten: UnlistenFn | null = null;

  onScopeDispose(() => {
    disposed = true;
    unlisten?.();
    unlisten = null;
  });

  function setup(): Promise<void> {
    if (disposed || unlisten) return Promise.resolve();
    if (pending) return pending;
    pending = safeListen<T>(event, (message) => {
      if (!disposed) handler(message);
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  return setup;
}
