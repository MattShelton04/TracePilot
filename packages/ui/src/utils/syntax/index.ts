/**
 * Lightweight regex-based syntax highlighting for common languages.
 *
 * Produces HTML spans with `.syn-*` classes. No external dependencies.
 * NOT a full parser — just good-enough tokenization for visual polish.
 *
 * Public API:
 *   - `highlightLine(line, language)` — primary per-line highlighter
 *   - `highlightSql(sql)` — convenience for `SqlResultRenderer`
 *
 * Architecture: each language has a `TokenRule[]` (regex + CSS class +
 * optional validator/expander). `tokenize` runs the rules left-to-right
 * over the line, first match wins per position. Output is escaped per
 * segment so it's safe for `v-html`.
 *
 * See `docs/syntax-highlighting-bespoke-analysis.md` for the design doc
 * and the list of known limitations (multi-line tokens, language aliases).
 */

import { applyTokensWithEscape, escapeHtml, memoise, type TokenRule, tokenize } from "./core";
import {
  CSS_RULES,
  GO_RULES,
  HCL_RULES,
  HTML_RULES,
  JSON_RULES,
  MARKDOWN_RULES,
  PYTHON_RULES,
  RUST_RULES,
  SCALA_RULES,
  SHELL_RULES,
  SQL_RULES,
  TOML_RULES,
  YAML_RULES,
} from "./langRules";
import { TS_RULES, TSX_RULES } from "./tsRules";

const LANG_RULES: Record<string, TokenRule[]> = {
  typescript: TS_RULES,
  javascript: TS_RULES,
  // TSX-aware variants share a small "TS + JSX" rule list. `vue` and
  // `svelte` snippets often contain JSX-shaped template expressions, so
  // they get the JSX rules too.
  tsx: TSX_RULES,
  jsx: TSX_RULES,
  vue: TSX_RULES,
  svelte: TSX_RULES,
  rust: RUST_RULES,
  python: PYTHON_RULES,
  css: CSS_RULES,
  scss: CSS_RULES,
  less: CSS_RULES,
  json: JSON_RULES,
  sql: SQL_RULES,
  bash: SHELL_RULES,
  powershell: SHELL_RULES,
  bat: SHELL_RULES,
  go: GO_RULES,
  html: HTML_RULES,
  xml: HTML_RULES,
  markdown: MARKDOWN_RULES,
  yaml: YAML_RULES,
  toml: TOML_RULES,
  hcl: HCL_RULES,
  csharp: TS_RULES,
  java: TS_RULES,
  kotlin: TS_RULES,
  swift: TS_RULES,
  php: TS_RULES,
  ruby: PYTHON_RULES,
  perl: PYTHON_RULES,
  lua: PYTHON_RULES,
  elixir: PYTHON_RULES,
  erlang: PYTHON_RULES,
  scala: SCALA_RULES,
};

/**
 * Highlight a single line of code.
 *
 * Output is HTML-escaped per segment, wrapped in `<span class="syn-*">`,
 * and safe for `v-html`. Results are cached in a small bounded LRU
 * (256 entries; lines longer than 1 kB bypass the cache).
 *
 * @param line The raw (unescaped) line of code.
 * @param language The language identifier (see `LANG_RULES` above).
 */
export function highlightLine(line: string, language: string): string {
  const rules = LANG_RULES[language];
  if (!rules) return escapeHtml(line);
  return memoise(language, line, () => {
    const tokens = tokenize(line, rules);
    return applyTokensWithEscape(line, tokens);
  });
}

/** Highlight a SQL query string (convenience helper for `SqlResultRenderer`). */
export function highlightSql(sql: string): string {
  return highlightLine(sql, "sql");
}

// Test-only escape hatches — not part of the public API surface.
export { _cacheSize, _clearCache } from "./core";
