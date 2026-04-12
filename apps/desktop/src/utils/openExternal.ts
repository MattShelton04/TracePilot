/**
 * Open a URL in the user's default system browser.
 * Works in both Tauri (via the opener plugin) and plain browser contexts.
 */
import { logWarn } from "./logger";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Validate and normalize an external URL.
 * Returns a sanitized string when the protocol is allowed, otherwise null.
 */
export function sanitizeExternalUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    return ALLOWED_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function openExternal(url: string): Promise<void> {
  const sanitized = sanitizeExternalUrl(url);
  if (!sanitized) {
    logWarn("[openExternal] Blocked unsafe external URL", { url });
    return;
  }

  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    if (isTauri()) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(sanitized);
      return;
    }
  } catch {
    // Not in Tauri context — fall through to browser fallback
  }
  window.open(sanitized, "_blank", "noopener");
}
