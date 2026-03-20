/**
 * Open a URL in the user's default system browser.
 * Works in both Tauri (via the opener plugin) and plain browser contexts.
 */
export async function openExternal(url: string): Promise<void> {
  try {
    const { isTauri } = await import('@tauri-apps/api/core');
    if (isTauri()) {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    }
  } catch {
    // Not in Tauri context — fall through to browser fallback
  }
  window.open(url, '_blank', 'noopener');
}
