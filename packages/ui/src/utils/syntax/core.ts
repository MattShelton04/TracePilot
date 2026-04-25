/**
 * Core tokenisation engine for the bespoke syntax highlighter.
 *
 * Exposes a small, framework-y API used by the per-language rule files:
 *   - `escapeHtml` / `wrap` — string helpers (kept centralised so all
 *     languages emit identical, safe output).
 *   - `Token` / `TokenRule` — types.
 *   - `tokenize` — runs an array of regex rules against a line and produces
 *     a sorted, non-overlapping `Token[]`. First rule to claim a span wins.
 *   - `applyTokensWithEscape` — turns a `Token[]` plus the original raw
 *     line into the final HTML-escaped, span-wrapped output.
 *
 * Tokens may carry a pre-rendered `html` string. This is how the TS rule
 * file injects nested highlighting for template literals (`${expr}`).
 */

/** Escape HTML entities so highlighter output is safe for `v-html`. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function wrap(cls: string, text: string): string {
  return `<span class="syn-${cls}">${text}</span>`;
}

export interface TokenRule {
  pattern: RegExp;
  className: string;
  /**
   * Optional post-match validator. If returns false the match is dropped.
   * Used to disambiguate context-sensitive cases like JS regex-vs-division.
   */
  validate?: (raw: string, match: RegExpExecArray) => boolean;
  /**
   * Optional renderer that produces the inner HTML for a match. The return
   * value is inserted verbatim (NOT html-escaped). Use only when the rule
   * itself emits already-escaped, possibly-nested span markup.
   *
   * If `expand` is set, the final wrap is omitted — the rendered HTML
   * stands alone — unless `className` is also set, in which case the
   * rendered HTML is wrapped in `<span class="syn-${className}">…</span>`.
   */
  expand?: (matchText: string) => string;
}

export interface Token {
  start: number;
  end: number;
  className?: string;
  /** Pre-rendered HTML. If set, replaces the default escape+wrap. */
  html?: string;
}

/**
 * Run rules against `raw`, returning a sorted, non-overlapping span list.
 *
 * `seedUsed` lets a caller (e.g. the TS pre-pass that handles template
 * literals) reserve regions before the generic rule sweep.
 */
export function tokenize(raw: string, rules: TokenRule[], seedUsed?: Uint8Array): Token[] {
  const tokens: Token[] = [];
  const used = seedUsed ?? new Uint8Array(raw.length);

  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
    while ((m = rule.pattern.exec(raw)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      // Empty matches would loop forever; guard.
      if (end === start) {
        rule.pattern.lastIndex = start + 1;
        continue;
      }
      if (rule.validate && !rule.validate(raw, m)) continue;
      let overlap = false;
      for (let p = start; p < end; p++) {
        if (used[p]) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;
      for (let p = start; p < end; p++) used[p] = 1;
      const token: Token = { start, end, className: rule.className };
      if (rule.expand) token.html = rule.expand(m[0]);
      tokens.push(token);
    }
  }

  tokens.sort((a, b) => a.start - b.start);
  return tokens;
}

/** Build output by escaping each segment individually (gaps and tokens). */
export function applyTokensWithEscape(raw: string, tokens: Token[]): string {
  if (tokens.length === 0) return escapeHtml(raw);

  let result = "";
  let pos = 0;

  for (const tok of tokens) {
    if (tok.start > pos) {
      result += escapeHtml(raw.slice(pos, tok.start));
    }
    const inner = tok.html ?? escapeHtml(raw.slice(tok.start, tok.end));
    result += tok.className ? wrap(tok.className, inner) : inner;
    pos = tok.end;
  }
  if (pos < raw.length) {
    result += escapeHtml(raw.slice(pos));
  }
  return result;
}

// ── Bounded LRU cache ───────────────────────────────────────────────
//
// Vue re-renders cause `highlightLine` to be called repeatedly with
// identical (lang, line) pairs. A small LRU keyed by `lang\x00line` is a
// large win at near-zero cost. Lines longer than `MAX_CACHEABLE_LINE`
// are skipped to keep the cache's worst-case memory bounded
// (256 * 1024 chars * 2 bytes ≈ 512 KB ceiling).

const CACHE_MAX = 256;
const MAX_CACHEABLE_LINE = 1024;
const cache = new Map<string, string>();

export function memoise(lang: string, line: string, compute: () => string): string {
  if (line.length > MAX_CACHEABLE_LINE) return compute();
  const key = `${lang}\x00${line}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    // Bump to most-recent.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const html = compute();
  cache.set(key, html);
  if (cache.size > CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  return html;
}

/** Test-only: drop everything in the cache. */
export function _clearCache(): void {
  cache.clear();
}

/** Test-only: read the LRU size. */
export function _cacheSize(): number {
  return cache.size;
}
