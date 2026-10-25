import { checkSessionFreshness, getSessionContextTimeline } from "@tracepilot/client";
import type { ContextTimelineResponse } from "@tracepilot/types";

const MAX_CACHE_ENTRIES = 8;
const cache = new Map<string, ContextTimelineResponse>();
/** The request each cached timeline came from, so an older build can't replace a newer one. */
const cachedFrom = new Map<string, number>();
const inFlight = new Map<
  string,
  { key: string | undefined; request: Promise<ContextTimelineResponse> }
>();
let requestSequence = 0;

export function getCachedContextTimeline(sessionId: string): ContextTimelineResponse | null {
  const entry = cache.get(sessionId);
  if (!entry) return null;
  cache.delete(sessionId);
  cache.set(sessionId, entry);
  return entry;
}

/**
 * Loads a session's context timeline, reusing the cached one while the events
 * file is unchanged. Callers passing the same `key` (the session state they
 * want it for) share one request; a different key starts its own, since a
 * request begun for an older state may miss what changed since.
 */
export async function loadContextTimeline(
  sessionId: string,
  key?: string,
): Promise<ContextTimelineResponse> {
  const existing = inFlight.get(sessionId);
  if (existing && existing.key === key) return existing.request;

  const sequence = ++requestSequence;
  const request = (async () => {
    const cached = cache.get(sessionId);
    if (cached) {
      try {
        const freshness = await checkSessionFreshness(sessionId);
        if (
          freshness.eventsFileSize === cached.eventsFileSize &&
          freshness.eventsFileMtime === cached.eventsFileMtime
        ) {
          return cached;
        }
      } catch {
        // A freshness probe is an optimization. Fall through to the normal
        // command so a transient metadata failure does not hide usable data.
      }
    }

    const response = await getSessionContextTimeline(sessionId);
    if (sequence < (cachedFrom.get(sessionId) ?? 0)) return response;
    cache.delete(sessionId);
    cache.set(sessionId, response);
    cachedFrom.set(sessionId, sequence);
    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
      cachedFrom.delete(oldest);
    }
    return response;
  })();

  const entry = { key, request };
  inFlight.set(sessionId, entry);
  try {
    return await request;
  } finally {
    if (inFlight.get(sessionId) === entry) inFlight.delete(sessionId);
  }
}

export function clearContextTimelineCache() {
  cache.clear();
  cachedFrom.clear();
}
