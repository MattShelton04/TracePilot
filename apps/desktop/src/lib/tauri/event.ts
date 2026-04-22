/**
 * Typed gateway for `@tauri-apps/api/event`.
 *
 * Consolidates dynamic `await import("@tauri-apps/api/event")` so the
 * `isTauri()` guard lives in exactly one place per API and the plugin
 * module tree-shakes cleanly out of non-Tauri bundles. See w94.
 */

import type { EventCallback, EventName, UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "@/lib/mocks";

/**
 * Subscribe to a Tauri event. Returns a no-op unlistener outside Tauri.
 */
export async function tauriListen<T>(
  event: EventName,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  const mod = await import("@tauri-apps/api/event");
  return mod.listen<T>(event, handler);
}

/**
 * Emit a Tauri event. No-op outside Tauri.
 */
export async function tauriEmit(event: EventName, payload?: unknown): Promise<void> {
  if (!isTauri()) return;
  const mod = await import("@tauri-apps/api/event");
  await mod.emit(event, payload);
}
