import type { EventCallback, UnlistenFn } from "@tauri-apps/api/event";
import { tauriListen } from "@/lib/tauri";

/**
 * Browser-safe wrapper around Tauri's `listen()`.
 * Returns a no-op unlisten function when running outside Tauri (e.g. browser dev mode).
 *
 * Thin back-compat shim — new code should import `tauriListen` from `@/lib/tauri` directly.
 */
export async function safeListen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  return tauriListen<T>(event, handler);
}
