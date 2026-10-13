import type { ContextSnippet, FtsHealthInfo } from "../../search.js";
import type { MockRoutes } from "./route.js";

/**
 * FTS maintenance commands from `search.ts`. Search queries themselves are
 * answered by `searchMockRoute` in `mock/search.ts`.
 */
export const SEARCH_ROUTES: MockRoutes = {
  fts_integrity_check: () => "ok",
  fts_optimize: () => "ok",
  fts_health: (): FtsHealthInfo => ({
    totalContentRows: 332,
    ftsIndexRows: 332,
    indexedSessions: 47,
    totalSessions: 47,
    pendingSessions: 0,
    inSync: true,
    contentTypes: [
      ["user_message", 120],
      ["assistant_message", 118],
      ["tool_result", 94],
    ],
    dbSizeBytes: 44_564_480,
  }),
  get_result_context: (): [ContextSnippet[], ContextSnippet[]] => [[], []],
};
