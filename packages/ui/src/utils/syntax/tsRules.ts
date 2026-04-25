/**
 * TypeScript / JavaScript / TSX / JSX rule sets.
 *
 * This file is gnarlier than the others because TS has the trickiest
 * regex-vs-division disambiguation, template literal interpolation, and
 * (for TSX) JSX tag awareness. Pulled into its own file so the rest of
 * the highlighter stays readable.
 */

import { applyTokensWithEscape, escapeHtml, type TokenRule, tokenize, wrap } from "./core";
import { makeKeywordPattern, TS_KEYWORDS } from "./keywords";

// ── Regex-vs-division disambiguation ────────────────────────────────
//
// JS regex literals are ambiguous with the division operator. We treat a
// `/` as a regex literal opener only when it appears in an "expression
// start" context: at the start of a line, after any of the operator/punct
// characters where a primary expression must follow, or after a small set
// of keywords that always precede an expression.

const REGEX_LITERAL_PATTERN = /\/(?:\\.|\[(?:\\.|[^\]])*\]|[^/\\\n])+\/[gimsuy]*/g;

const EXPR_START_PUNCT_RE = /[=({,;:?!&|+\-*%<>~^[]/;
const EXPR_START_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "yield",
  "await",
  "new",
  "void",
  "delete",
  "throw",
]);

/** Returns true if the position before `index` is an expression-start context. */
function isRegexContext(raw: string, index: number): boolean {
  // Walk back over whitespace.
  let i = index - 1;
  while (i >= 0 && (raw[i] === " " || raw[i] === "\t")) i--;
  if (i < 0) return true;
  const ch = raw[i];
  if (EXPR_START_PUNCT_RE.test(ch)) {
    // `/` after another `/` means a comment; tokenize() runs the comment
    // rule first and marks those positions, so we'd already short-circuit
    // via overlap. But guard anyway.
    return ch !== "/";
  }
  // Trailing keyword? Walk back over identifier chars.
  if (/[A-Za-z_$]/.test(ch)) {
    let j = i;
    while (j >= 0 && /[A-Za-z0-9_$]/.test(raw[j])) j--;
    const word = raw.slice(j + 1, i + 1);
    return EXPR_START_KEYWORDS.has(word);
  }
  return false;
}

// ── Template literal interpolation ──────────────────────────────────
//
// `` `hello ${user.name}, ${count + 1}` `` — render the literal slices
// as syn-string, the `${` / `}` as syn-punct, and recursively highlight
// the inner expressions with the standard TS rules.

/**
 * Walk a backtick-delimited template literal and produce nested-span HTML.
 * The input includes the opening and closing backticks. The inner
 * expression is highlighted by re-tokenising it as plain TS source.
 */
function renderTemplateLiteral(text: string): string {
  let out = "";
  let i = 0;
  let strStart = 0;
  const flushString = (end: number): void => {
    if (end > strStart) {
      out += wrap("string", escapeHtml(text.slice(strStart, end)));
    }
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) {
      i += 2;
      continue;
    }
    if (c === "$" && text[i + 1] === "{") {
      flushString(i);
      // Find matching close brace.
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        const d = text[j];
        if (d === "\\" && j + 1 < text.length) {
          j += 2;
          continue;
        }
        if (d === "{") depth++;
        else if (d === "}") {
          depth--;
          if (depth === 0) break;
        } else if (d === "`") {
          // Bail out if we hit an unmatched backtick — treat as literal.
          break;
        }
        j++;
      }
      if (depth !== 0 || j >= text.length) {
        // Malformed; emit the rest as string.
        strStart = i;
        i = text.length;
        break;
      }
      out += wrap("punct", "${");
      const inner = text.slice(i + 2, j);
      out += highlightTsExpression(inner);
      out += wrap("punct", "}");
      i = j + 1;
      strStart = i;
      continue;
    }
    i++;
  }
  flushString(text.length);
  return out;
}

/**
 * Highlight a fragment of TS source code using the same rules as
 * `highlightLine`. Used to render template-literal interpolations.
 *
 * Kept private to this module to avoid an import cycle with index.ts.
 * The cache is intentionally bypassed for fragments — they're usually
 * short, and we don't want to pollute the LRU with sub-line entries.
 */
function highlightTsExpression(expr: string): string {
  const tokens = tokenize(expr, TS_RULES);
  return applyTokensWithEscape(expr, tokens);
}

// ── Rule sets ───────────────────────────────────────────────────────

function tsRules(): TokenRule[] {
  return [
    { pattern: /\/\/.*$/gm, className: "comment" },
    { pattern: /\/\*[\s\S]*?\*\//g, className: "comment" },
    {
      // Template literal — outer match is greedy across the whole literal;
      // `renderTemplateLiteral` walks the body and emits nested spans.
      pattern: /`(?:\\[\s\S]|[^`\\])*`/g,
      className: "",
      expand: (text) => renderTemplateLiteral(text),
    },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: "string" },
    { pattern: /'(?:\\.|[^'\\])*'/g, className: "string" },
    {
      pattern: REGEX_LITERAL_PATTERN,
      className: "regex",
      validate: (raw, m) => isRegexContext(raw, m.index),
    },
    { pattern: /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, className: "number" },
    { pattern: makeKeywordPattern(TS_KEYWORDS), className: "keyword" },
    // Decorators: `@Component`, `@injectable` …
    { pattern: /@[A-Za-z_]\w*/g, className: "keyword" },
    { pattern: /\b[A-Z][a-zA-Z0-9]*(?=\s*[<({])/g, className: "type" },
    { pattern: /\b[a-zA-Z_]\w*(?=\s*\()/g, className: "func" },
    { pattern: /(?<=\.)[a-zA-Z_]\w*/g, className: "prop" },
    { pattern: /[+\-*/%=!<>&|^~?:]+/g, className: "operator" },
    { pattern: /[{}[\]();,]/g, className: "punct" },
  ];
}

/**
 * TSX / JSX rules. Adds tag and attribute recognition on top of the
 * standard TS rules. The tag rules run first so they win against the
 * generic operator/punct rules for `<` and `>`.
 */
function tsxRules(): TokenRule[] {
  const base = tsRules();
  return [
    // Comments and strings still come first so JSX inside a string isn't
    // misinterpreted.
    base[0], // line comment
    base[1], // block comment
    base[2], // template literal
    base[3], // double string
    base[4], // single string
    // JSX self-closing/opening/closing tag heads. Be conservative about the
    // identifier shape so we don't gobble `a < b` as a tag.
    { pattern: /<\/?[A-Za-z][\w.]*(?=[\s/>])/g, className: "tag" },
    { pattern: /\/?>/g, className: "tag" },
    // Attribute names: `prop=` either before a string or before `{`.
    { pattern: /\b[a-zA-Z_][\w-]*(?=\s*=\s*(?:["'{]|$))/g, className: "attr" },
    // Then the rest of the TS rules.
    ...base.slice(5),
  ];
}

export const TS_RULES: TokenRule[] = tsRules();
export const TSX_RULES: TokenRule[] = tsxRules();
