import type {
  SearchContentType,
  SearchFacetsResponse,
  SearchResult,
  SearchResultsResponse,
  SearchStatsResponse,
  SearchToolName,
} from "@tracepilot/types";
import { NOW_MS, ONE_HOUR } from "./common.js";
import { MOCK_SESSIONS } from "./sessions.js";

type Row = [
  sessionId: string,
  type: SearchContentType,
  tool: string | null,
  text: string,
  /** The source-native tool name (Claude Code rows). */
  native?: string,
];

/** Synthetic indexed content across the mock sessions, including the Claude Code one. */
const ROWS: Row[] = [
  ["sess-auth-refactor", "user_message", null, "Refactor the auth plugin to retry token refresh."],
  ["sess-auth-refactor", "tool_call", "powershell", "pnpm test --filter auth"],
  [
    "sess-auth-refactor",
    "error",
    null,
    "Rate limit exceeded (429) while refreshing the auth token.",
  ],
  ["sess-search-polish", "user_message", null, "Tidy the search browse presets."],
  [
    "sess-search-polish",
    "assistant_message",
    null,
    "Moved the presets into one list and fixed the retry hint.",
  ],
  ["sess-export-markdown", "tool_result", "view", "export/markdown.ts renders each section."],
  [
    "sess-claude-code-review",
    "user_message",
    null,
    "Review the indexing retries for the auth path.",
  ],
  [
    "sess-claude-code-review",
    "tool_call",
    "shell",
    "cargo test -p tracepilot-indexer retry",
    "Bash",
  ],
  [
    "sess-claude-code-review",
    "assistant_message",
    null,
    "The retry loop backs off but never caps attempts.",
  ],
];

const RESULTS: SearchResult[] = ROWS.map(
  ([sessionId, contentType, toolName, snippet, native], i) => {
    const session = MOCK_SESSIONS.find((s) => s.id === sessionId);
    return {
      id: i + 1,
      sessionId,
      contentType,
      turnNumber: 0,
      eventIndex: i,
      timestampUnix: Math.floor((NOW_MS - ONE_HOUR * (i + 1)) / 1000),
      toolName,
      snippet,
      metadataJson: native ? JSON.stringify({ nativeToolName: native }) : null,
      sessionSummary: session?.summary ?? null,
      sessionRepository: session?.repository ?? null,
      sessionBranch: session?.branch ?? null,
      sessionUpdatedAt: session?.updatedAt ?? null,
      source: session?.source ?? "copilot",
    };
  },
);

/** Canonical tool names with their native names and sources, like the backend. */
function toolNames(): SearchToolName[] {
  const byName = new Map<string, SearchToolName>();
  ROWS.forEach(([, , tool, , native], i) => {
    if (!tool) return;
    const entry = byName.get(tool) ?? { name: tool, nativeNames: [], sources: [] };
    byName.set(tool, entry);
    const source = RESULTS[i].source;
    if (!entry.sources.includes(source)) entry.sources.push(source);
    if (native && !entry.nativeNames.includes(native)) entry.nativeNames.push(native);
  });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Rows matching the command's query and filters, mirroring `SearchFilters`. */
function matching(args: Record<string, unknown>): SearchResult[] {
  const words = String(args.query ?? "")
    .toLowerCase()
    .replace(/["*]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const types = list(args.contentTypes);
  const excluded = list(args.excludeContentTypes);
  const repos = list(args.repositories);
  const tools = list(args.toolNames);
  return RESULTS.filter(
    (r) =>
      words.every((w) => r.snippet.toLowerCase().includes(w)) &&
      (types.length === 0 || types.includes(r.contentType)) &&
      !excluded.includes(r.contentType) &&
      (repos.length === 0 || repos.includes(r.sessionRepository ?? "")) &&
      (tools.length === 0 || tools.includes(r.toolName ?? "")) &&
      (!args.sessionId || r.sessionId === args.sessionId) &&
      (!args.source || r.source === args.source),
  );
}

function counts(values: (string | null)[]): [string, number][] {
  const map = new Map<string, number>();
  for (const v of values) if (v != null) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function searchResults(args: Record<string, unknown>): SearchResultsResponse {
  const rows = matching(args);
  const limit = typeof args.limit === "number" ? args.limit : 50;
  const offset = typeof args.offset === "number" ? args.offset : 0;
  const sorted = args.sortBy === "oldest" ? [...rows].reverse() : rows;
  return {
    results: sorted.slice(offset, offset + limit),
    totalCount: rows.length,
    hasMore: offset + limit < rows.length,
    query: String(args.query ?? ""),
    latencyMs: 1,
  };
}

function searchFacets(args: Record<string, unknown>): SearchFacetsResponse {
  // Each dimension ignores its own filter, as the backend does.
  const without = (key: string) => matching({ ...args, [key]: undefined });
  const rows = matching(args);
  return {
    byContentType: counts(without("contentTypes").map((r) => r.contentType)),
    byRepository: counts(without("repositories").map((r) => r.sessionRepository)),
    byToolName: counts(without("toolNames").map((r) => r.toolName)),
    totalMatches: rows.length,
    sessionCount: new Set(rows.map((r) => r.sessionId)).size,
  };
}

const STATS: SearchStatsResponse = {
  totalRows: RESULTS.length,
  indexedSessions: MOCK_SESSIONS.length,
  totalSessions: MOCK_SESSIONS.length,
  contentTypeCounts: counts(RESULTS.map((r) => r.contentType)),
};

/**
 * Search queries for `pnpm app:ui`, filtered like the backend (including by
 * source). `null` for any other command.
 */
export function searchMockRoute(
  cmd: string,
  args: Record<string, unknown> = {},
): { value: unknown } | null {
  switch (cmd) {
    case "search_content":
      return { value: searchResults(args) };
    case "get_search_facets":
      return { value: searchFacets(args) };
    case "get_search_stats":
      return { value: STATS };
    case "get_search_repositories":
      return { value: [...new Set(RESULTS.map((r) => r.sessionRepository ?? ""))].filter(Boolean) };
    case "get_search_tool_names":
      return { value: toolNames() };
    default:
      return null;
  }
}
