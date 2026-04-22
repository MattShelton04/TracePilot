/**
 * Typed gateway for `@tauri-apps/plugin-dialog`.
 *
 * Callers should still guard with `isTauri()` and use
 * `promptForPath()` from `@/lib/mocks` as the browser fallback —
 * this gateway only centralises the dynamic import + types so each
 * dialog call-site stops duplicating the `await import(...)` noise.
 * See w94.
 */

import type { OpenDialogOptions, SaveDialogOptions } from "@tauri-apps/plugin-dialog";

export type { OpenDialogOptions, SaveDialogOptions };

/**
 * Open the native file / directory picker. Must only be called inside
 * Tauri; guard with `isTauri()` first.
 */
export async function tauriDialogOpen(
  options?: OpenDialogOptions,
): Promise<string | string[] | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  return (await open(options)) ?? null;
}

/**
 * Open the native file save dialog. Must only be called inside Tauri;
 * guard with `isTauri()` first.
 */
export async function tauriDialogSave(
  options?: SaveDialogOptions,
): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return (await save(options)) ?? null;
}
