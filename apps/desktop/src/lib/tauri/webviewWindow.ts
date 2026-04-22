/**
 * Typed gateway for `@tauri-apps/api/webviewWindow`.
 *
 * Returns `null` outside Tauri so callers can short-circuit without a
 * try/catch wrapped around the dynamic import. See w94.
 */

import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "@/lib/mocks";

/**
 * Return the current Tauri webview-window handle, or `null` outside Tauri.
 */
export async function getCurrentTauriWebviewWindow(): Promise<WebviewWindow | null> {
  if (!isTauri()) return null;
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return getCurrentWebviewWindow();
}
