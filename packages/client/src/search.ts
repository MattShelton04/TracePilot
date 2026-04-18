import type {
  SearchFacetsResponse,
  SearchFilters,
  SearchResultsResponse,
  SearchStatsResponse,
} from "@tracepilot/types";

import { invoke } from "./internal/core.js";

// ── Deep Search (FTS) ────────────────────────────────────────

/** Full-text search across all session content. */
export async function searchContent(
  query: string,
  filters?: SearchFilters,
): Promise<SearchResultsResponse> {
  return invoke<SearchResultsResponse>("search_content", {
    query,
    contentTypes: filters?.contentTypes,
    excludeContentTypes: filters?.excludeContentTypes,
    repositories: filters?.repositories,
    toolNames: filters?.toolNames,
    sessionId: filters?.sessionId,
    dateFromUnix: filters?.dateFromUnix,
    dateToUnix: filters?.dateToUnix,
    limit: filters?.limit,
    offset: filters?.offset,
    sortBy: filters?.sortBy,
  });
}

/** Get facet counts — pass query for result-scoped facets, omit for global. */
export async function getSearchFacets(
  query?: string,
  filters?: Pick<
    SearchFilters,
    | "contentTypes"
    | "excludeContentTypes"
    | "repositories"
    | "toolNames"
    | "sessionId"
    | "dateFromUnix"
    | "dateToUnix"
  >,
): Promise<SearchFacetsResponse> {
  return invoke<SearchFacetsResponse>("get_search_facets", {
    query,
    contentTypes: filters?.contentTypes,
    excludeContentTypes: filters?.excludeContentTypes,
    repositories: filters?.repositories,
    toolNames: filters?.toolNames,
    sessionId: filters?.sessionId,
    dateFromUnix: filters?.dateFromUnix,
    dateToUnix: filters?.dateToUnix,
  });
}

/** Get search index statistics. */
export async function getSearchStats(): Promise<SearchStatsResponse> {
  return invoke<SearchStatsResponse>("get_search_stats");
}

/** Get distinct repositories for the search filter dropdown. */
export async function getSearchRepositories(): Promise<string[]> {
  return invoke<string[]>("get_search_repositories");
}

/** Get distinct tool names for the search filter dropdown. */
export async function getSearchToolNames(): Promise<string[]> {
  return invoke<string[]>("get_search_tool_names");
}

/** Run FTS integrity check. Returns a status message. */
export async function ftsIntegrityCheck(): Promise<string> {
  return invoke<string>("fts_integrity_check");
}

/** Optimize the FTS index for better query performance. */
export async function ftsOptimize(): Promise<string> {
  return invoke<string>("fts_optimize");
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

/** Get detailed FTS health information. */
export async function ftsHealth(): Promise<FtsHealthInfo> {
  return invoke<FtsHealthInfo>("fts_health");
}

/** Adjacent context snippet around a search result. */
export interface ContextSnippet {
  contentType: string;
  turnNumber: number | null;
  toolName: string | null;
  preview: string;
}

/** Get surrounding context for a search result (adjacent rows). */
export async function getResultContext(
  resultId: number,
  radius?: number,
): Promise<[ContextSnippet[], ContextSnippet[]]> {
  return invoke<[ContextSnippet[], ContextSnippet[]]>("get_result_context", {
    resultId,
    radius,
  });
}
