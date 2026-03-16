/**
 * Shared composable for native directory/file browsing via Tauri dialog.
 * Falls back to browser prompt() when running outside Tauri (dev mode).
 */

/**
 * Opens a native directory picker dialog (Tauri) or falls back to prompt().
 * Returns the selected path or null if cancelled.
 */
export async function browseForDirectory(options?: {
  title?: string;
  defaultPath?: string;
}): Promise<string | null> {
  if (!('__TAURI_INTERNALS__' in window)) {
    const input = prompt(
      options?.title ?? 'Select directory:',
      options?.defaultPath ?? '',
    );
    return input || null;
  }
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      title: options?.title ?? 'Select directory',
      defaultPath: options?.defaultPath,
    });
    return selected ?? null;
  } catch {
    const input = prompt(
      options?.title ?? 'Select directory:',
      options?.defaultPath ?? '',
    );
    return input || null;
  }
}

/**
 * Opens a native file save dialog (Tauri) or falls back to prompt().
 * Returns the selected path or null if cancelled.
 */
export async function browseForSavePath(options?: {
  title?: string;
  defaultPath?: string;
}): Promise<string | null> {
  if (!('__TAURI_INTERNALS__' in window)) {
    const input = prompt(
      options?.title ?? 'Select file path:',
      options?.defaultPath ?? '',
    );
    return input || null;
  }
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const selected = await save({
      title: options?.title ?? 'Choose file location',
      defaultPath: options?.defaultPath,
    });
    return selected ?? null;
  } catch {
    const input = prompt(
      options?.title ?? 'Select file path:',
      options?.defaultPath ?? '',
    );
    return input || null;
  }
}
