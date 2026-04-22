/**
 * Central gateway for dynamic `@tauri-apps/*` imports (w94).
 *
 * Every dynamic `await import("@tauri-apps/api/...")` that used to be
 * scattered across composables now flows through a typed helper in this
 * folder. Each helper:
 *
 *   - guards with `isTauri()` from `@/lib/mocks` (single source of truth);
 *   - keeps the `@tauri-apps/*` import dynamic so the bundler can tree-shake
 *     it out of non-Tauri bundles;
 *   - returns a typed value (or a `null` / no-op sentinel outside Tauri)
 *     so call-sites don't re-declare the types.
 *
 * The `@tauri-apps/plugin-*` packages (notification, updater, process,
 * opener, log) are still imported directly at their call-sites for now —
 * they're single-use enough that a gateway would just add indirection. See
 * the w94 FI log for the remaining scattered plugins.
 */

export { tauriEmit, tauriListen } from "./event";
export { getAllTauriWindows, getCurrentTauriWindow, type TauriWindow } from "./window";
export { getCurrentTauriWebviewWindow } from "./webviewWindow";
export { getTauriAppVersion } from "./app";
export {
  type OpenDialogOptions,
  type SaveDialogOptions,
  tauriDialogOpen,
  tauriDialogSave,
} from "./dialog";
