/**
 * Open a URL in the user's default system browser.
 * Works in both Tauri (via the opener plugin) and plain browser contexts.
 *
 * Loopback/localhost URLs are blocked to prevent session markdown files from
 * silently triggering requests against local services (CI dashboards, admin
 * UIs, local credential stores, etc.).
 */
export async function openExternal(url: string): Promise<void> {
  // Validate the URL is parseable and not pointing at a local service.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Malformed URL — refuse to open it.
    return;
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLoopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".localhost");

  if (isLoopback) {
    console.warn("[openExternal] Blocked loopback URL:", url);
    return;
  }

  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    if (isTauri()) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    }
  } catch {
    // Not in Tauri context — fall through to browser fallback
  }
  window.open(url, "_blank", "noopener");
}
