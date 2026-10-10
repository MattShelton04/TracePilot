import type { SearchContentType, SessionSource } from "@tracepilot/types";

/** Qualifier syntax: extract `type:`, `repo:`, `tool:`, `session:`, `source:`, `sort:` from query. */
export interface ParsedQualifiers {
  cleanQuery: string;
  types: SearchContentType[];
  repo: string | null;
  tool: string | null;
  session: string | null;
  source: SessionSource | null;
  sort: "relevance" | "newest" | "oldest" | null;
}

const QUALIFIER_RE = /\b(type|repo|tool|session|source|sort):(?:"([^"]+)"|(\S+))/gi;

/** `source:` values, lower-cased, with the spellings people type for Claude Code. */
const SOURCE_ALIASES = new Map<string, SessionSource>([
  ["copilot", "copilot"],
  ["claude", "claudeCode"],
  ["claudecode", "claudeCode"],
  ["claude-code", "claudeCode"],
]);

/**
 * Parse inline qualifier syntax from a search query string.
 *
 * Recognised qualifiers: `type:`, `repo:`, `tool:`, `session:`, `source:`
 * (`copilot`, `claude` or `claudecode`), `sort:`. Unknown `source:` and
 * `sort:` values are stripped and ignored.
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
    source: null,
    sort: null,
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
      case "source":
        result.source = SOURCE_ALIASES.get(val.toLowerCase()) ?? result.source;
        break;
      case "sort":
        if (["relevance", "newest", "oldest"].includes(val)) {
          result.sort = val as "relevance" | "newest" | "oldest";
        }
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

/**
 * `raw` without its `key:` qualifiers (`key` lower-case), so a UI filter that replaces one
 * (picking a source in the switch) is not overridden by the typed text.
 * Returns `raw` unchanged when it has none.
 */
export function stripQualifier(raw: string, key: string): string {
  let stripped = false;
  const clean = raw.replace(QUALIFIER_RE, (match, name: string) => {
    if (name.toLowerCase() !== key) return match;
    stripped = true;
    return "";
  });
  return stripped ? clean.replace(/\s+/g, " ").trim() : raw;
}
