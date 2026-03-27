import type { SearchContentType } from '@tracepilot/types';

/** Qualifier syntax: extract `type:`, `repo:`, `tool:`, `session:`, `sort:` from query. */
export interface ParsedQualifiers {
  cleanQuery: string;
  types: SearchContentType[];
  repo: string | null;
  tool: string | null;
  session: string | null;
  sort: 'relevance' | 'newest' | 'oldest' | null;
}

const QUALIFIER_RE = /\b(type|repo|tool|session|sort):(?:"([^"]+)"|(\S+))/gi;

/**
 * Parse inline qualifier syntax from a search query string.
 *
 * Recognised qualifiers: `type:`, `repo:`, `tool:`, `session:`, `sort:`.
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
  };

  const consumed: [number, number][] = [];

  for (const match of raw.matchAll(QUALIFIER_RE)) {
    const key = match[1].toLowerCase();
    const val = match[2] ?? match[3]; // quoted value or unquoted
    consumed.push([match.index, match.index + match[0].length]);
    switch (key) {
      case 'type':
        result.types.push(val as SearchContentType);
        break;
      case 'repo':
        result.repo = val;
        break;
      case 'tool':
        result.tool = val;
        break;
      case 'session':
        result.session = val;
        break;
      case 'sort':
        if (['relevance', 'newest', 'oldest'].includes(val)) {
          result.sort = val as 'relevance' | 'newest' | 'oldest';
        }
        break;
    }
  }

  // Strip consumed qualifiers from query
  if (consumed.length > 0) {
    let clean = '';
    let pos = 0;
    for (const [start, end] of consumed) {
      clean += raw.slice(pos, start);
      pos = end;
    }
    clean += raw.slice(pos);
    result.cleanQuery = clean.replace(/\s+/g, ' ').trim();
  }

  return result;
}
