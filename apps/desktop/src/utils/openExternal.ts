import { useToast } from "@tracepilot/ui";
import { isTauri } from "@/lib/mocks";
import { logWarn } from "@/utils/logger";

const { error: showError, warning: showWarning } = useToast();

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    normalized.startsWith("127.")
  );
}

export function parseExternalUrl(url: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol) || isLoopbackHost(parsed.hostname)) {
    return null;
  }

  return parsed;
}

/**
 * Open a URL in the user's default system browser.
 * Works in both Tauri (via the opener plugin) and plain browser contexts.
 *
 * Loopback/localhost URLs are blocked to prevent session markdown files from
 * silently triggering requests against local services (CI dashboards, admin
 * UIs, local credential stores, etc.).
 */
export async function openExternal(url: string): Promise<void> {
  const parsed = parseExternalUrl(url);
  if (!parsed) {
    logWarn("[openExternal] Blocked unsafe or unsupported URL:", url);
    showWarning("Link blocked", {
      description: "TracePilot only opens HTTP(S) links to non-local addresses.",
    });
    return;
  }

  if (isTauri()) {
    let openUrl: typeof import("@tauri-apps/plugin-opener").openUrl;
    try {
      ({ openUrl } = await import("@tauri-apps/plugin-opener"));
    } catch (error) {
      logWarn("[openExternal] Opener plugin unavailable; using browser fallback", error);
      window.open(parsed.href, "_blank", "noopener");
      return;
    }

    try {
      await openUrl(parsed.href);
    } catch (error) {
      logWarn("[openExternal] System browser rejected URL:", parsed.href, error);
      showError("Could not open link", {
        description: "The system browser rejected this URL.",
      });
    }
    return;
  }

  window.open(parsed.href, "_blank", "noopener");
}
