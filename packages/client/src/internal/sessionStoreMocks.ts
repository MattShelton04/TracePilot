import type {
  PromptCacheResponse,
  RequestPerformanceResponse,
  SessionRequestUsageResponse,
  SessionStoreStatusResponse,
  SessionWorkRefsResponse,
} from "@tracepilot/types";

type Mocks = typeof import("../mock/index.js");

/**
 * Mock responses for the session-store enrichment commands.
 *
 * Split out of `mockData.ts` to keep that file inside its size budget. The
 * fixtures describe a *ready* source, so the dev experience shows the fully
 * populated case; the unavailable and disabled paths are covered by tests
 * that stub the client directly rather than by a second set of mocks here.
 *
 * The prompt-cache response lives here too, because its `observations` come
 * from the same source and have to stay consistent with the ledger fixtures.
 */
export function sessionStoreMocks(mocks: Mocks, eventsFileMtime: number): Record<string, unknown> {
  const status: SessionStoreStatusResponse = {
    enabled: true,
    resolvedPath: "~/.copilot/session-store.db",
    source: mocks.MOCK_STORE_SOURCE,
  };
  const usage: SessionRequestUsageResponse = {
    enabled: true,
    page: {
      requests: mocks.MOCK_REQUEST_LEDGER,
      nextCursor: null,
      generation: "mock-generation",
      available: true,
      cursorExpired: false,
    },
    coverage: mocks.MOCK_STORE_COVERAGE,
  };
  const workRefs: SessionWorkRefsResponse = {
    enabled: true,
    available: true,
    refs: mocks.MOCK_WORK_REFS,
    sourceAvailability: "ready",
  };
  const performance: RequestPerformanceResponse = {
    enabled: true,
    available: true,
    performance: mocks.MOCK_REQUEST_PERFORMANCE,
    coverage: mocks.MOCK_STORE_COVERAGE,
  };

  const promptCache: PromptCacheResponse = {
    timeline: mocks.MOCK_PROMPT_CACHE,
    observations: mocks.MOCK_CACHE_OBSERVATIONS,
    eventsFileSize: 1024,
    eventsFileMtime,
  };

  return {
    get_session_prompt_cache: promptCache,
    get_session_store_status: status,
    get_session_request_usage: usage,
    get_session_work_refs: workRefs,
    get_request_performance: performance,
    refresh_session_enrichment: {
      availability: "ready",
      refreshed: 1,
      unchanged: 0,
      skipped: 0,
      detail: null,
    },
  };
}
