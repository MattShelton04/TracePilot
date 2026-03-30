import type { EventCallback, UnlistenFn } from "@tauri-apps/api/event";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Browser-safe wrapper around Tauri's `listen()`.
 * Returns a no-op unlisten function when running outside Tauri (e.g. browser dev mode).
 */
export async function safeListen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, handler);
}
