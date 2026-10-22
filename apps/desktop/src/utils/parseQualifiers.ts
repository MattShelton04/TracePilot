import type { SearchContentType, SessionSource } from "@tracepilot/types";

/** Qualifier syntax: extract `type:`, `repo:`, `tool:`, `session:`, `source:`, `sort:` from query. */
export interface ParsedQualifiers {
  cleanQuery: string;
  types: SearchContentType[];
  /** `type:` values, as typed, that name no content type; not applied as filters. */
  unknownTypes: string[];
  repo: string | null;
  tool: string | null;
  session: string | null;
  source: SessionSource | null;
  sort: "relevance" | "newest" | "oldest" | null;
}

/** A qualifier starts the query or follows whitespace, so `config.session:abc` stays text. */
const QUALIFIER_RE = /(?<!\S)(type|repo|tool|session|source|sort):(?:"([^"]+)"|(\S+))/gi;

/** `source:` values, lower-cased, with the spellings people type for Claude Code. */
const SOURCE_ALIASES = new Map<string, SessionSource>([
  ["copilot", "copilot"],
  ["claude", "claudeCode"],
  ["claudecode", "claudeCode"],
  ["claude-code", "claudeCode"],
]);

type SortValue = NonNullable<ParsedQualifiers["sort"]>;

/** Every content type; a `Record` so a new variant can't be missed here. */
const CONTENT_TYPES: Record<SearchContentType, true> = {
  user_message: true,
  assistant_message: true,
  reasoning: true,
  tool_call: true,
  tool_result: true,
  tool_error: true,
  error: true,
  compaction_summary: true,
  system_message: true,
  subagent: true,
  checkpoint: true,
};
const SORT_VALUES: readonly SortValue[] = ["relevance", "newest", "oldest"];

/** `type:` and `sort:` values match in any case, with `-` or `_` between words. */
function normaliseValue(val: string): string {
  return val.toLowerCase().replace(/-/g, "_");
}

function contentTypeFor(val: string): SearchContentType | null {
  const key = normaliseValue(val);
  return Object.hasOwn(CONTENT_TYPES, key) ? (key as SearchContentType) : null;
}

/**
 * Parse inline qualifier syntax from a search query string.
 *
 * Recognised qualifiers: `type:`, `repo:`, `tool:`, `session:`, `source:`
 * (`copilot`, `claude` or `claudecode`), `sort:`. `type:` and `sort:` ignore case
 * and `-`/`_` (`type:Tool-Call` is `tool_call`). Unknown `source:` and `sort:` values are
 * stripped and ignored; unknown `type:` values are stripped, not applied, and listed in
 * `unknownTypes` so the search can say so.
 * Quoted values are supported (e.g. `repo:"my org/repo"`).
 * Returns the cleaned query (qualifiers stripped) alongside extracted values.
 */
export function parseQualifiers(raw: string): ParsedQualifiers {
  const result: ParsedQualifiers = {
    cleanQuery: raw,
    types: [],
    unknownTypes: [],
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
      case "type": {
        const type = contentTypeFor(val);
        if (type) result.types.push(type);
        else if (!result.unknownTypes.includes(val)) result.unknownTypes.push(val);
        break;
      }
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
      case "sort": {
        const sort = normaliseValue(val);
        if ((SORT_VALUES as readonly string[]).includes(sort)) result.sort = sort as SortValue;
        break;
      }
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
 * With `value`, only the `key:` qualifiers whose value it accepts are removed.
 * Returns `raw` unchanged when it has none.
 */
export function stripQualifier(raw: string, key: string, value?: (val: string) => boolean): string {
  let stripped = false;
  const clean = raw.replace(
    QUALIFIER_RE,
    (match, name: string, quoted: string | undefined, bare: string | undefined) => {
      if (name.toLowerCase() !== key) return match;
      if (value && !value(quoted ?? bare ?? "")) return match;
      stripped = true;
      return "";
    },
  );
  return stripped ? clean.replace(/\s+/g, " ").trim() : raw;
}

/** `raw` without the `type:` qualifiers that name `type` (in any spelling `type:` accepts). */
export function stripTypeQualifier(raw: string, type: SearchContentType): string {
  return stripQualifier(raw, "type", (val) => contentTypeFor(val) === type);
}
