/**
 * Typed gateway for `@tauri-apps/api/app`. See w94.
 */

import { isTauri } from "@/lib/mocks";

/**
 * Return the Tauri app version, or `null` outside Tauri.
 */
export async function getTauriAppVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}
