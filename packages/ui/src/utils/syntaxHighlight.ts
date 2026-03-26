/**
 * Lightweight regex-based syntax highlighting for common languages.
 *
 * Produces HTML spans with `.syn-*` classes. No external dependencies.
 * NOT a full parser — just good-enough tokenization for visual polish.
 *
 * Security: Tokenization runs on RAW text; each segment is HTML-escaped
 * individually before wrapping in spans, so v-html output is safe.
 */

/** Escape HTML entities to prevent XSS when using v-html. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrap(cls: string, text: string): string {
  return `<span class="syn-${cls}">${text}</span>`;
}

interface TokenRule {
  pattern: RegExp;
  className: string;
}

// ── Language-specific keyword sets ──

const TS_KEYWORDS = [
  'import',
  'export',
  'from',
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'class',
  'extends',
  'implements',
  'interface',
  'type',
  'enum',
  'namespace',
  'new',
  'this',
  'super',
  'typeof',
  'instanceof',
  'in',
  'of',
  'as',
  'async',
  'await',
  'yield',
  'try',
  'catch',
  'finally',
  'throw',
  'default',
  'true',
  'false',
  'null',
  'undefined',
  'void',
  'delete',
  'readonly',
  'abstract',
  'static',
  'private',
  'protected',
  'public',
  'declare',
  'module',
  'require',
  'keyof',
  'infer',
  'satisfies',
];

const RUST_KEYWORDS = [
  'fn',
  'let',
  'mut',
  'const',
  'static',
  'struct',
  'enum',
  'impl',
  'trait',
  'pub',
  'use',
  'mod',
  'crate',
  'self',
  'super',
  'where',
  'for',
  'in',
  'if',
  'else',
  'match',
  'loop',
  'while',
  'break',
  'continue',
  'return',
  'async',
  'await',
  'move',
  'ref',
  'as',
  'type',
  'dyn',
  'unsafe',
  'true',
  'false',
  'Some',
  'None',
  'Ok',
  'Err',
  'Self',
];

const PYTHON_KEYWORDS = [
  'def',
  'class',
  'import',
  'from',
  'return',
  'if',
  'elif',
  'else',
  'for',
  'while',
  'in',
  'is',
  'not',
  'and',
  'or',
  'try',
  'except',
  'finally',
  'raise',
  'with',
  'as',
  'pass',
  'break',
  'continue',
  'yield',
  'lambda',
  'None',
  'True',
  'False',
  'self',
  'async',
  'await',
  'global',
  'nonlocal',
  'del',
  'assert',
];

const CSS_KEYWORDS = [
  'display',
  'position',
  'flex',
  'grid',
  'block',
  'inline',
  'none',
  'relative',
  'absolute',
  'fixed',
  'sticky',
  'auto',
  'inherit',
  'important',
  'solid',
  'dashed',
  'dotted',
  'hidden',
  'visible',
  'transparent',
  'currentColor',
];

const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'CREATE',
  'TABLE',
  'ALTER',
  'DROP',
  'INDEX',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'OUTER',
  'ON',
  'AND',
  'OR',
  'NOT',
  'IN',
  'IS',
  'NULL',
  'AS',
  'ORDER',
  'BY',
  'GROUP',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'UNION',
  'ALL',
  'DISTINCT',
  'EXISTS',
  'BETWEEN',
  'LIKE',
  'PRIMARY',
  'KEY',
  'FOREIGN',
  'REFERENCES',
  'DEFAULT',
  'CASCADE',
  'CONSTRAINT',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'TEXT',
  'INTEGER',
  'BOOLEAN',
  'VARCHAR',
  'TIMESTAMP',
  'SERIAL',
  'DESC',
  'ASC',
];

const SHELL_KEYWORDS = [
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'do',
  'done',
  'case',
  'esac',
  'function',
  'return',
  'exit',
  'echo',
  'export',
  'source',
  'alias',
  'unalias',
  'cd',
  'pwd',
  'ls',
  'cat',
  'grep',
  'sed',
  'awk',
  'find',
  'xargs',
  'pipe',
  'sudo',
  'chmod',
  'chown',
  'mkdir',
  'rm',
  'cp',
  'mv',
  'git',
  'npm',
  'pnpm',
  'yarn',
  'cargo',
  'docker',
  'kubectl',
];

const GO_KEYWORDS = [
  'func',
  'package',
  'import',
  'var',
  'const',
  'type',
  'struct',
  'interface',
  'map',
  'chan',
  'go',
  'select',
  'defer',
  'return',
  'if',
  'else',
  'for',
  'range',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'fallthrough',
  'nil',
  'true',
  'false',
  'error',
  'string',
  'int',
  'bool',
  'byte',
  'float64',
  'append',
  'make',
  'len',
  'cap',
  'new',
  'delete',
  'close',
  'panic',
  'recover',
];

const SCALA_KEYWORDS = [
  'def',
  'val',
  'var',
  'object',
  'class',
  'trait',
  'extends',
  'with',
  'import',
  'package',
  'sealed',
  'abstract',
  'override',
  'final',
  'case',
  'match',
  'if',
  'else',
  'for',
  'while',
  'do',
  'yield',
  'return',
  'throw',
  'try',
  'catch',
  'finally',
  'new',
  'this',
  'super',
  'type',
  'lazy',
  'implicit',
  'given',
  'using',
  'enum',
  'then',
  'true',
  'false',
  'null',
  'private',
  'protected',
  'public',
];

function makeKeywordPattern(keywords: string[], caseInsensitive = false): RegExp {
  const flags = caseInsensitive ? 'gi' : 'g';
  return new RegExp(`\\b(${keywords.join('|')})\\b`, flags);
}

/**
 * Generic tokenization approach: process text left-to-right, matching
 * patterns in priority order. First match wins for each position.
 */
interface Token {
  start: number;
  end: number;
  className: string;
}

function tokenize(raw: string, rules: TokenRule[]): Token[] {
  const tokens: Token[] = [];
  const used = new Uint8Array(raw.length); // track covered positions

  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(raw)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      // Check if any part of this match is already taken
      let overlap = false;
      for (let p = start; p < end; p++) {
        if (used[p]) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;
      // Mark positions as used
      for (let p = start; p < end; p++) used[p] = 1;
      tokens.push({ start, end, className: rule.className });
    }
  }

  tokens.sort((a, b) => a.start - b.start);
  return tokens;
}

/** Build output by escaping each segment individually (gaps and tokens). */
function applyTokensWithEscape(raw: string, tokens: Token[]): string {
  if (tokens.length === 0) return escapeHtml(raw);

  let result = '';
  let pos = 0;

  for (const tok of tokens) {
    if (tok.start > pos) {
      result += escapeHtml(raw.slice(pos, tok.start));
    }
    result += wrap(tok.className, escapeHtml(raw.slice(tok.start, tok.end)));
    pos = tok.end;
  }
  if (pos < raw.length) {
    result += escapeHtml(raw.slice(pos));
  }
  return result;
}

// ── Rule sets per language ──

function tsRules(): TokenRule[] {
  return [
    { pattern: /\/\/.*$/gm, className: 'comment' },
    { pattern: /\/\*[\s\S]*?\*\//g, className: 'comment' },
    { pattern: /`(?:\\[\s\S]|[^`])*`/g, className: 'string' },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: 'string' },
    { pattern: /'(?:\\.|[^'\\])*'/g, className: 'string' },
    { pattern: /\/(?:\\.|[^/\\])+\/[gimsuy]*/g, className: 'regex' },
    { pattern: /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, className: 'number' },
    { pattern: makeKeywordPattern(TS_KEYWORDS), className: 'keyword' },
    { pattern: /\b[A-Z][a-zA-Z0-9]*(?=\s*[<({])/g, className: 'type' },
    { pattern: /\b[a-zA-Z_]\w*(?=\s*\()/g, className: 'func' },
    { pattern: /(?<=\.)[a-zA-Z_]\w*/g, className: 'prop' },
    { pattern: /[+\-*/%=!<>&|^~?:]+/g, className: 'operator' },
    { pattern: /[{}[\]();,]/g, className: 'punct' },
  ];
}

function rustRules(): TokenRule[] {
  return [
    { pattern: /\/\/.*$/gm, className: 'comment' },
    { pattern: /\/\*[\s\S]*?\*\//g, className: 'comment' },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: 'string' },
    { pattern: /r#*"[\s\S]*?"#*/g, className: 'string' },
    { pattern: /'[^'\\]'/g, className: 'string' },
    {
      pattern: /\b\d+(?:\.\d+)?(?:_\d+)*(?:u8|u16|u32|u64|i8|i16|i32|i64|f32|f64|usize|isize)?\b/g,
      className: 'number',
    },
    { pattern: makeKeywordPattern(RUST_KEYWORDS), className: 'keyword' },
    { pattern: /\b[A-Z][a-zA-Z0-9]*\b/g, className: 'type' },
    { pattern: /\b[a-z_]\w*(?=\s*[(<])/g, className: 'func' },
    { pattern: /(?:&mut\s|&)/g, className: 'keyword' },
    { pattern: /[+\-*/%=!<>&|^~?:]+/g, className: 'operator' },
    { pattern: /[{}[\]();,]/g, className: 'punct' },
  ];
}

function pythonRules(): TokenRule[] {
  return [
    { pattern: /#.*$/gm, className: 'comment' },
    { pattern: /"""[\s\S]*?"""/g, className: 'string' },
    { pattern: /'''[\s\S]*?'''/g, className: 'string' },
    { pattern: /f"(?:\\.|[^"\\])*"/g, className: 'string' },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: 'string' },
    { pattern: /'(?:\\.|[^'\\])*'/g, className: 'string' },
    { pattern: /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?j?\b/gi, className: 'number' },
    { pattern: makeKeywordPattern(PYTHON_KEYWORDS), className: 'keyword' },
    { pattern: /\b[A-Z][a-zA-Z0-9]*\b/g, className: 'type' },
    { pattern: /\b[a-z_]\w*(?=\s*\()/g, className: 'func' },
    { pattern: /@\w+/g, className: 'keyword' },
    { pattern: /[+\-*/%=!<>&|^~:]+/g, className: 'operator' },
    { pattern: /[{}[\]();,]/g, className: 'punct' },
  ];
}

function cssRules(): TokenRule[] {
  return [
    { pattern: /\/\*[\s\S]*?\*\//g, className: 'comment' },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: 'string' },
    { pattern: /'(?:\\.|[^'\\])*'/g, className: 'string' },
    { pattern: /\b\d+(?:\.\d+)?(?:px|em|rem|vh|vw|%|s|ms|deg|fr)?\b/g, className: 'number' },
    { pattern: /#[0-9a-fA-F]{3,8}\b/g, className: 'number' },
    { pattern: /\.[a-zA-Z_][\w-]*/g, className: 'func' },
    { pattern: /#[a-zA-Z_][\w-]*/g, className: 'const' },
    { pattern: /[a-zA-Z-]+(?=\s*:)/g, className: 'prop' },
    { pattern: makeKeywordPattern(CSS_KEYWORDS), className: 'keyword' },
    { pattern: /[{}();:,]/g, className: 'punct' },
  ];
}

function jsonRules(): TokenRule[] {
  return [
    { pattern: /"(?:\\.|[^"\\])*"(?=\s*:)/g, className: 'prop' },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: 'string' },
    { pattern: /\b(?:true|false|null)\b/g, className: 'keyword' },
    { pattern: /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/g, className: 'number' },
    { pattern: /[{}[\]:,]/g, className: 'punct' },
  ];
}

function sqlRules(): TokenRule[] {
  return [
    { pattern: /--.*$/gm, className: 'comment' },
    { pattern: /\/\*[\s\S]*?\*\//g, className: 'comment' },
    { pattern: /'(?:''|[^'])*'/g, className: 'string' },
    { pattern: /\b\d+(?:\.\d+)?\b/g, className: 'number' },
    { pattern: makeKeywordPattern(SQL_KEYWORDS, true), className: 'keyword' },
    { pattern: /\b[a-zA-Z_]\w*(?=\s*\()/g, className: 'func' },
    { pattern: /[+\-*/%=!<>&|]+/g, className: 'operator' },
    { pattern: /[();,]/g, className: 'punct' },
  ];
}

function shellRules(): TokenRule[] {
  return [
    { pattern: /#.*$/gm, className: 'comment' },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: 'string' },
    { pattern: /'[^']*'/g, className: 'string' },
    { pattern: /\$\{?\w+\}?/g, className: 'const' },
    { pattern: /\b\d+\b/g, className: 'number' },
    { pattern: makeKeywordPattern(SHELL_KEYWORDS), className: 'keyword' },
    { pattern: /--?[\w-]+/g, className: 'param' },
    { pattern: /[|&;><]+/g, className: 'operator' },
  ];
}

function goRules(): TokenRule[] {
  return [
    { pattern: /\/\/.*$/gm, className: 'comment' },
    { pattern: /\/\*[\s\S]*?\*\//g, className: 'comment' },
    { pattern: /`[^`]*`/g, className: 'string' },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: 'string' },
    { pattern: /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, className: 'number' },
    { pattern: makeKeywordPattern(GO_KEYWORDS), className: 'keyword' },
    { pattern: /\b[A-Z][a-zA-Z0-9]*\b/g, className: 'type' },
    { pattern: /\b[a-z_]\w*(?=\s*\()/g, className: 'func' },
    { pattern: /[+\-*/%=!<>&|^~?:]+/g, className: 'operator' },
    { pattern: /[{}[\]();,]/g, className: 'punct' },
  ];
}

function scalaRules(): TokenRule[] {
  return [
    { pattern: /\/\/.*$/gm, className: 'comment' },
    { pattern: /\/\*[\s\S]*?\*\//g, className: 'comment' },
    { pattern: /"""[\s\S]*?"""/g, className: 'string' },
    { pattern: /s"(?:\\.|[^"\\])*"/g, className: 'string' },
    { pattern: /f"(?:\\.|[^"\\])*"/g, className: 'string' },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: 'string' },
    { pattern: /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?[LlFfDd]?\b/gi, className: 'number' },
    { pattern: makeKeywordPattern(SCALA_KEYWORDS), className: 'keyword' },
    { pattern: /\b[A-Z][a-zA-Z0-9]*\b/g, className: 'type' },
    { pattern: /\b[a-z_]\w*(?=\s*[([])/g, className: 'func' },
    { pattern: /@\w+/g, className: 'keyword' },
    { pattern: /[+\-*/%=!<>&|^~?:]+|=>/g, className: 'operator' },
    { pattern: /[{}[\]();,]/g, className: 'punct' },
  ];
}

function htmlRules(): TokenRule[] {
  return [
    { pattern: /<!--[\s\S]*?-->/g, className: 'comment' },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: 'string' },
    { pattern: /'(?:\\.|[^'\\])*'/g, className: 'string' },
    { pattern: /<\/?[a-zA-Z][\w-]*/g, className: 'tag' },
    { pattern: /\/?>/g, className: 'tag' },
    { pattern: /\b[a-zA-Z-]+(?==)/g, className: 'attr' },
  ];
}

function markdownRules(): TokenRule[] {
  return [
    { pattern: /^#{1,6}\s.+$/gm, className: 'keyword' },
    { pattern: /\*\*[^*]+\*\*/g, className: 'keyword' },
    { pattern: /`[^`]+`/g, className: 'string' },
    { pattern: /\[([^\]]+)\]\([^)]+\)/g, className: 'func' },
    { pattern: /^[-*+]\s/gm, className: 'operator' },
    { pattern: /^\d+\.\s/gm, className: 'number' },
  ];
}

function yamlRules(): TokenRule[] {
  return [
    { pattern: /#.*$/gm, className: 'comment' },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: 'string' },
    { pattern: /'[^']*'/g, className: 'string' },
    { pattern: /\b(?:true|false|null|yes|no|on|off)\b/gi, className: 'keyword' },
    { pattern: /\b\d+(?:\.\d+)?\b/g, className: 'number' },
    { pattern: /^[\w.-]+(?=\s*:)/gm, className: 'prop' },
    { pattern: /[:\-|>]/g, className: 'operator' },
  ];
}

function tomlRules(): TokenRule[] {
  return [
    { pattern: /#.*$/gm, className: 'comment' },
    { pattern: /"""[\s\S]*?"""/g, className: 'string' },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: 'string' },
    { pattern: /'[^']*'/g, className: 'string' },
    { pattern: /\b(?:true|false)\b/g, className: 'keyword' },
    { pattern: /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/g, className: 'number' },
    { pattern: /\[[^\]]+\]/g, className: 'type' },
    { pattern: /[\w.-]+(?=\s*=)/g, className: 'prop' },
    { pattern: /[=]/g, className: 'operator' },
  ];
}

// ── Language → Rules mapping ──

const LANG_RULES: Record<string, () => TokenRule[]> = {
  typescript: tsRules,
  tsx: tsRules,
  javascript: tsRules,
  jsx: tsRules,
  vue: tsRules,
  svelte: tsRules,
  rust: rustRules,
  python: pythonRules,
  css: cssRules,
  scss: cssRules,
  less: cssRules,
  json: jsonRules,
  sql: sqlRules,
  bash: shellRules,
  powershell: shellRules,
  bat: shellRules,
  go: goRules,
  html: htmlRules,
  xml: htmlRules,
  markdown: markdownRules,
  yaml: yamlRules,
  toml: tomlRules,
  csharp: tsRules,
  java: tsRules,
  kotlin: tsRules,
  swift: tsRules,
  php: tsRules,
  ruby: pythonRules,
  perl: pythonRules,
  lua: pythonRules,
  elixir: pythonRules,
  erlang: pythonRules,
  hcl: tomlRules,
  scala: scalaRules,
};

/**
 * Highlight a single line of code.
 *
 * @param line The raw (unescaped) line of code
 * @param language The language identifier
 * @returns HTML string with `.syn-*` spans. Safe for v-html (each segment is escaped).
 */
export function highlightLine(line: string, language: string): string {
  const rulesFn = LANG_RULES[language];
  if (!rulesFn) return escapeHtml(line);

  const rules = rulesFn();
  const tokens = tokenize(line, rules);
  return applyTokensWithEscape(line, tokens);
}

/**
 * Highlight a SQL query string (convenience helper for SqlResultRenderer).
 */
export function highlightSql(sql: string): string {
  return highlightLine(sql, 'sql');
}
