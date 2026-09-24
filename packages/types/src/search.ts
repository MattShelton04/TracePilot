// ─── Search & Indexing Types ──────────────────────────────────────
// Types for the full-text search (FTS) index: content types, results,
// filters, facets, statistics, and indexing progress events.

/** Content types that can be indexed for full-text search. */
export type SearchContentType =
  | "user_message"
  | "assistant_message"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "tool_error"
  | "error"
  | "compaction_summary"
  | "system_message"
  | "subagent"
  | "checkpoint";

/** A single search result from the FTS index. */
export interface SearchResult {
  id: number;
  sessionId: string;
  contentType: SearchContentType;
  turnNumber: number | null;
  eventIndex: number | null;
  timestampUnix: number | null;
  toolName: string | null;
  /** Highlighted snippet with <mark> tags */
  snippet: string;
  metadataJson: string | null;
  sessionSummary: string | null;
  sessionRepository: string | null;
  sessionBranch: string | null;
  sessionUpdatedAt: string | null;
}

/** Paginated search results response from the backend. */
export interface SearchResultsResponse {
  results: SearchResult[];
  totalCount: number;
  hasMore: boolean;
  query: string;
  latencyMs: number;
}

/** Filters for deep content search. */
export interface SearchFilters {
  contentTypes?: string[];
  excludeContentTypes?: string[];
  repositories?: string[];
  toolNames?: string[];
  sessionId?: string;
  dateFromUnix?: number;
  dateToUnix?: number;
  limit?: number;
  offset?: number;
  sortBy?: "relevance" | "newest" | "oldest";
}

/** Facet counts returned from search. Tuples are [name, count]. */
export interface SearchFacetsResponse {
  byContentType: [string, number][];
  byRepository: [string, number][];
  byToolName: [string, number][];
  totalMatches: number;
  sessionCount: number;
}

/** Statistics about the search index. */
export interface SearchStatsResponse {
  totalRows: number;
  indexedSessions: number;
  totalSessions: number;
  contentTypeCounts: [string, number][];
}

/** Progress payload for search indexing events. */
export interface SearchIndexingProgress {
  current: number;
  total: number;
}

/** FTS health information. */
export interface FtsHealthInfo {
  totalContentRows: number;
  ftsIndexRows: number;
  indexedSessions: number;
  totalSessions: number;
  pendingSessions: number;
  inSync: boolean;
  contentTypes: [string, number][];
  dbSizeBytes: number;
}

/** Adjacent context snippet around a search result. */
export interface ContextSnippet {
  contentType: string;
  turnNumber: number | null;
  toolName: string | null;
  preview: string;
}

// ─── Indexing Progress ────────────────────────────────────────────

/** Enriched indexing progress payload emitted per session during reindexing. */
export interface IndexingProgressPayload {
  current: number;
  total: number;
  /** Per-session info (null/undefined if skipped or failed). */
  sessionRepo: string | null;
  sessionBranch: string | null;
  sessionModel: string | null;
  sessionTokens: number;
  sessionEvents: number;
  sessionTurns: number;
  /** Running totals across all indexed sessions so far. */
  totalTokens: number;
  totalEvents: number;
  totalRepos: number;
}
