import { getCurrentScope, onScopeDispose } from "vue";
import { getAllTauriWindows, getCurrentTauriWindow, tauriListen } from "@/lib/tauri";

export interface WindowLifecycleOptions {
  /** Gate: only attach listeners when this returns true. Evaluated once. */
  enabled?: () => boolean;
  /** Called when the main window is about to close (pre-destroy hook). */
  onBeforeMainClose?: () => void | Promise<void>;
  /** Called when a popup session window emits `popup-session-closed`. */
  onPopupClosed?: (sessionId: string) => void;
}

/**
 * Own the lifecycle of Tauri window + event listeners in the main window.
 *
 * Previously `App.vue` registered these listeners with no `unlisten` retention;
 * on HMR or component teardown we leaked handlers (Phase 1A.7).
 *
 * ### Critical usage requirement
 *
 * Call this composable **synchronously from `<script setup>`** (i.e. not from
 * inside an `await`ed `onMounted` callback). Vue's `onScopeDispose` only
 * attaches to the active effect scope at the call site; after any `await` the
 * scope context is lost and the cleanup silently becomes a no-op. We assert
 * that an active scope exists up front and log + refuse to attach if not.
 *
 * The returned `dispose` function is an escape hatch for tests / manual
 * teardown. Under normal component use you should not need to call it.
 */
export function useWindowLifecycle(
  options: WindowLifecycleOptions = {},
): () => void {
  const disposers: Array<() => void | Promise<void>> = [];

  const dispose = () => {
    while (disposers.length > 0) {
      const d = disposers.pop();
      try {
        void d?.();
      } catch {
        /* best-effort */
      }
    }
  };

  // Register teardown *synchronously* against the active effect scope.
  // If we're called outside a scope (e.g. from inside an awaited onMounted
  // arrow), this call would otherwise silently no-op — warn instead of
  // pretending we attached successfully.
  const scope = getCurrentScope();
  if (scope) {
    onScopeDispose(dispose);
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      "[useWindowLifecycle] called outside an active effect scope; " +
        "listeners will NOT be cleaned up on teardown. Call this from the " +
        "top of <script setup> rather than inside an async onMounted.",
    );
  }

  if (options.enabled && !options.enabled()) {
    // Gate evaluated — nothing to attach. `dispose` is idempotent.
    return dispose;
  }

  // Kick off async attach; register each unlisten as it arrives so even a
  // mid-flight teardown cancels pending work.
  let cancelled = false;
  disposers.push(() => {
    cancelled = true;
  });

  void (async () => {
    try {
      const mainWin = await getCurrentTauriWindow();
      if (cancelled) return;
      if (!mainWin) return; // Browser / non-Tauri — nothing to attach.

      // ── Main-window close → cascade close viewer windows ───────
      const unlistenClose = await mainWin.onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          await options.onBeforeMainClose?.();
        } catch {
          /* best-effort — don't block destroy */
        }
        try {
          const all = await getAllTauriWindows();
          await Promise.allSettled(
            all
              .filter((w) => w.label.startsWith("viewer-"))
              .map((w) => w.close()),
          );
        } catch {
          /* best-effort */
        }
        await mainWin.destroy();
      });
      if (cancelled) {
        unlistenClose();
        return;
      }
      disposers.push(unlistenClose);

      // ── Popup session close → update monitored session set ─────
      if (options.onPopupClosed) {
        const unlistenPopup = await tauriListen<{ sessionId: string }>(
          "popup-session-closed",
          (event) => {
            options.onPopupClosed?.(event.payload.sessionId);
          },
        );
        if (cancelled) {
          unlistenPopup();
          return;
        }
        disposers.push(unlistenPopup);
      }
    } catch (e) {
      // Don't throw — the app must still run if Tauri APIs are unavailable
      // (e.g. browser dev mode).
      console.warn("[useWindowLifecycle] failed to attach listeners:", e);
    }
  })();

  return dispose;
}
