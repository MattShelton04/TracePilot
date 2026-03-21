/**
 * Shared Tauri invoke helper — single source of truth for calling the
 * `plugin:tracepilot|*` Tauri plugin commands with automatic mock fallback
 * when running outside the Tauri webview (dev/test mode).
 */

/** Detect whether we are running inside Tauri's webview. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Call a Tauri plugin command.  Use this only when inside Tauri;
 * guard with `isTauri()` first.
 */
export async function invokePlugin<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(`plugin:tracepilot|${cmd}`, args);
}
