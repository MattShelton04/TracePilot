import { refreshSessionEnrichment } from "@tracepilot/client";
import { usePreferencesStore } from "@/stores/preferences";
import { isAlreadyIndexingError } from "@/utils/backendErrors";
import { logWarn } from "@/utils/logger";

/** Minimum spacing between refreshes of one open, running session. */
export const LIVE_ENRICHMENT_INTERVAL_MS = 15_000;

/**
 * Keeps an open, in-progress session's session-store evidence current.
 *
 * The background sweep runs every few minutes, so a running session viewed
 * in detail would otherwise show its newest requests minutes late. Each
 * nudge is a single-session refresh, spaced by `LIVE_ENRICHMENT_INTERVAL_MS`;
 * the views reload themselves when it publishes a change. A busy indexing
 * gate is not an error — the next tick tries again.
 */
export function useLiveSessionEnrichment() {
  const prefs = usePreferencesStore();
  let lastRefreshAt = 0;
  let inFlight = false;

  async function nudge(sessionId: string | null | undefined): Promise<void> {
    if (!sessionId || inFlight || !prefs.isFeatureEnabled("sessionStoreEnrichment")) return;
    if (Date.now() - lastRefreshAt < LIVE_ENRICHMENT_INTERVAL_MS) return;
    inFlight = true;
    try {
      await refreshSessionEnrichment(sessionId);
      lastRefreshAt = Date.now();
    } catch (error) {
      if (!isAlreadyIndexingError(error)) {
        logWarn("[session-store] Live session refresh failed:", error);
      }
    } finally {
      inFlight = false;
    }
  }

  return { nudge };
}
