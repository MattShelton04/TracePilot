import type {
  EnrichmentRefreshResponse,
  RequestPerformanceResponse,
  RequestUsageFilters,
  SessionRequestUsageResponse,
  SessionStoreStatusResponse,
  SessionWorkRefsResponse,
} from "@tracepilot/types";

import { invoke } from "./internal/core.js";

/**
 * Optional enrichment read from the Copilot CLI's own `session-store.db`.
 *
 * Every response separates "the feature is off", "no source is available"
 * and "the source recorded nothing", because those are different answers and
 * the UI has to say which one it is showing.
 */

/** The bound store, its capabilities and when it was last read. */
export async function getSessionStoreStatus(): Promise<SessionStoreStatusResponse> {
  return invoke<SessionStoreStatusResponse>("get_session_store_status");
}

/**
 * One page of a session's recorded model requests.
 *
 * `cursor` is an opaque token from a previous page's `nextCursor`. Never
 * construct one: a hand-made cursor could name a source generation that no
 * longer exists, and the rows behind it would be different requests.
 */
export async function getSessionRequestUsage(
  sessionId: string,
  options?: { filters?: RequestUsageFilters; cursor?: string | null; limit?: number },
): Promise<SessionRequestUsageResponse> {
  return invoke<SessionRequestUsageResponse>("get_session_request_usage", {
    sessionId,
    filters: options?.filters ?? null,
    cursor: options?.cursor ?? null,
    limit: options?.limit ?? null,
  });
}

/** Pull requests, issues and Git refs mentioned in a session. */
export async function getSessionWorkRefs(sessionId: string): Promise<SessionWorkRefsResponse> {
  return invoke<SessionWorkRefsResponse>("get_session_work_refs", { sessionId });
}

/** Observed request latency and cache-reuse distributions for one session. */
export async function getRequestPerformance(
  sessionId: string,
): Promise<RequestPerformanceResponse> {
  return invoke<RequestPerformanceResponse>("get_request_performance", { sessionId });
}

/**
 * Re-read the store for every eligible session.
 *
 * Also the path that purges cached rows when the feature is switched off, so
 * disabling stops retention rather than merely hiding data.
 */
export async function refreshSessionEnrichment(): Promise<EnrichmentRefreshResponse> {
  return invoke<EnrichmentRefreshResponse>("refresh_session_enrichment");
}
