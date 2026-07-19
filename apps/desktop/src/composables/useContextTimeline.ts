import { checkSessionFreshness, getSessionContextTimeline } from "@tracepilot/client";
import type { ContextTimelineResponse } from "@tracepilot/types";

const MAX_CACHE_ENTRIES = 8;
const cache = new Map<string, ContextTimelineResponse>();
const inFlight = new Map<string, Promise<ContextTimelineResponse>>();

export function getCachedContextTimeline(sessionId: string): ContextTimelineResponse | null {
  const entry = cache.get(sessionId);
  if (!entry) return null;
  cache.delete(sessionId);
  cache.set(sessionId, entry);
  return entry;
}

export async function loadContextTimeline(sessionId: string): Promise<ContextTimelineResponse> {
  const existingRequest = inFlight.get(sessionId);
  if (existingRequest) return existingRequest;

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
    cache.delete(sessionId);
    cache.set(sessionId, response);
    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return response;
  })();

  inFlight.set(sessionId, request);
  try {
    return await request;
  } finally {
    inFlight.delete(sessionId);
  }
}

export function clearContextTimelineCache() {
  cache.clear();
}
