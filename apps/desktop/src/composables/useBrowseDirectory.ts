/**
 * Shared composable for native directory/file browsing via Tauri dialog.
 * Falls back to browser prompt() when running outside Tauri (dev mode).
 */

import { isTauri, promptForPath } from "@/lib/mocks";
import { logWarn } from "@/utils/logger";

/**
 * Opens a native directory picker dialog (Tauri) or falls back to prompt().
 * Returns the selected path or null if cancelled.
 */
export async function browseForDirectory(options?: {
  title?: string;
  defaultPath?: string;
}): Promise<string | null> {
  const title = options?.title ?? "Select directory:";
  const defaultPath = options?.defaultPath ?? "";

  if (!isTauri()) {
    return promptForPath(title, defaultPath);
  }
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      title: options?.title ?? "Select directory",
      defaultPath: options?.defaultPath,
    });
    return selected ?? null;
  } catch (e) {
    logWarn("[useBrowseDirectory] Tauri directory dialog failed, falling back to prompt", e);
    return promptForPath(title, defaultPath);
  }
}

/**
 * Opens a native file save dialog (Tauri) or falls back to prompt().
 * Returns the selected path or null if cancelled.
 */
export async function browseForSavePath(options?: {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  const title = options?.title ?? "Select file path:";
  const defaultPath = options?.defaultPath ?? "";

  if (!isTauri()) {
    return promptForPath(title, defaultPath);
  }
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const selected = await save({
      title: options?.title ?? "Choose file location",
      defaultPath: options?.defaultPath,
      filters: options?.filters,
    });
    return selected ?? null;
  } catch (e) {
    logWarn("[useBrowseDirectory] Tauri save dialog failed, falling back to prompt", e);
    return promptForPath(title, defaultPath);
  }
}

/**
 * Opens a native file picker dialog (Tauri) or falls back to prompt().
 * Returns the selected file path or null if cancelled.
 */
export async function browseForFile(options?: {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  const title = options?.title ?? "Select file:";
  const defaultPath = options?.defaultPath ?? "";

  if (!isTauri()) {
    return promptForPath(title, defaultPath);
  }
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({
      title: options?.title ?? "Select file",
      defaultPath: options?.defaultPath,
      filters: options?.filters,
      directory: false,
      multiple: false,
    });
    if (typeof result === "string") return result;
    if (result && typeof result === "object" && "length" in result) {
      return (result as string[])[0] ?? null;
    }
    return null;
  } catch (e) {
    logWarn("[useBrowseDirectory] Tauri file picker dialog failed, falling back to prompt", e);
    return promptForPath(title, defaultPath);
  }
}
