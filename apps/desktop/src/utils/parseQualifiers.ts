import type { SearchContentType } from "@tracepilot/types";

/**
 * Qualifier syntax: extract `type:`, `repo:`, `tool:`, `session:`, `sort:`,
 * `pr:`, `issue:` and `commit:` from query.
 */
export interface ParsedQualifiers {
  cleanQuery: string;
  types: SearchContentType[];
  repo: string | null;
  tool: string | null;
  session: string | null;
  sort: "relevance" | "newest" | "oldest" | null;
  /** Pull-request number a session must mention. */
  pr: string | null;
  /** Issue number a session must mention. */
  issue: string | null;
  /** Git ref a session must mention — a commit SHA only some of the time. */
  commit: string | null;
}

const QUALIFIER_RE = /\b(type|repo|tool|session|sort|pr|issue|commit):(?:"([^"]+)"|(\S+))/gi;

/**
 * Parse inline qualifier syntax from a search query string.
 *
 * Recognised qualifiers: `type:`, `repo:`, `tool:`, `session:`, `sort:`,
 * `pr:`, `issue:`, `commit:`.
 * Quoted values are supported (e.g. `repo:"my org/repo"`).
 * Returns the cleaned query (qualifiers stripped) alongside extracted values.
 */
export function parseQualifiers(raw: string): ParsedQualifiers {
  const result: ParsedQualifiers = {
    cleanQuery: raw,
    types: [],
    repo: null,
    tool: null,
    session: null,
    sort: null,
    pr: null,
    issue: null,
    commit: null,
  };

  const consumed: [number, number][] = [];

  for (const match of raw.matchAll(QUALIFIER_RE)) {
    if (match.index == null) continue;
    const key = match[1].toLowerCase();
    const val = match[2] ?? match[3]; // quoted value or unquoted
    consumed.push([match.index, match.index + match[0].length]);
    switch (key) {
      case "type":
        result.types.push(val as SearchContentType);
        break;
      case "repo":
        result.repo = val;
        break;
      case "tool":
        result.tool = val;
        break;
      case "session":
        result.session = val;
        break;
      case "sort":
        if (["relevance", "newest", "oldest"].includes(val)) {
          result.sort = val as "relevance" | "newest" | "oldest";
        }
        break;
      case "pr":
        result.pr = val;
        break;
      case "issue":
        result.issue = val;
        break;
      case "commit":
        result.commit = val;
        break;
    }
  }

  // Strip consumed qualifiers from query
  if (consumed.length > 0) {
    let clean = "";
    let pos = 0;
    for (const [start, end] of consumed) {
      clean += raw.slice(pos, start);
      pos = end;
    }
    clean += raw.slice(pos);
    result.cleanQuery = clean.replace(/\s+/g, " ").trim();
  }

  return result;
}
