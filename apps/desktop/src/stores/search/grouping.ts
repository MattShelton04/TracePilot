import type { SearchResult, SessionSource } from "@tracepilot/types";

export interface SessionGroup {
  sessionId: string;
  sessionSummary: string | null;
  sessionRepository: string | null;
  sessionBranch: string | null;
  sessionSource: SessionSource;
  results: SearchResult[];
}

/** Group flat results by session, keeping the order each session first appears. */
export function groupResultsBySession(results: readonly SearchResult[]): SessionGroup[] {
  const map = new Map<string, SessionGroup>();
  for (const r of results) {
    let group = map.get(r.sessionId);
    if (!group) {
      group = {
        sessionId: r.sessionId,
        sessionSummary: r.sessionSummary ?? null,
        sessionRepository: r.sessionRepository ?? null,
        sessionBranch: r.sessionBranch ?? null,
        sessionSource: r.source,
        results: [],
      };
      map.set(r.sessionId, group);
    }
    group.results.push(r);
  }
  return Array.from(map.values());
}
