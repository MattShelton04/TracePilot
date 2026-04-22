/**
 * Typed gateway for `@tauri-apps/api/window`.
 *
 * Returns `null` / empty collections outside Tauri so callers can branch
 * on the return value rather than replicating `isTauri()` checks. See w94.
 */

import type { Window } from "@tauri-apps/api/window";
import { isTauri } from "@/lib/mocks";

export type TauriWindow = Window;

/**
 * Return the current Tauri window handle, or `null` outside Tauri.
 */
export async function getCurrentTauriWindow(): Promise<Window | null> {
  if (!isTauri()) return null;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

/**
 * Return every Tauri window handle, or an empty array outside Tauri.
 */
export async function getAllTauriWindows(): Promise<Window[]> {
  if (!isTauri()) return [];
  const { getAllWindows } = await import("@tauri-apps/api/window");
  return getAllWindows();
}
