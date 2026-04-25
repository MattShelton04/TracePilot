/**
 * Rule sets for non-TS-family languages.
 */

import type { TokenRule } from "./core";
import {
  CSS_KEYWORDS,
  GO_KEYWORDS,
  makeKeywordPattern,
  PYTHON_KEYWORDS,
  RUST_KEYWORDS,
  SCALA_KEYWORDS,
  SHELL_KEYWORDS,
  SQL_KEYWORDS,
} from "./keywords";

function rustRules(): TokenRule[] {
  return [
    { pattern: /\/\/.*$/gm, className: "comment" },
    { pattern: /\/\*[\s\S]*?\*\//g, className: "comment" },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: "string" },
    { pattern: /r#*"[\s\S]*?"#*/g, className: "string" },
    // Lifetime — `'a`, `'static`, `'_`. Must come before the char-literal
    // rule so it claims `'a` instead of being half-matched as a string.
    // Negative lookahead `(?!')` distinguishes from char literals like `'x'`.
    { pattern: /'[A-Za-z_][A-Za-z0-9_]*\b(?!')/g, className: "keyword" },
    { pattern: /'(?:\\.|[^'\\])'/g, className: "string" },
    {
      pattern: /\b\d+(?:\.\d+)?(?:_\d+)*(?:u8|u16|u32|u64|i8|i16|i32|i64|f32|f64|usize|isize)?\b/g,
      className: "number",
    },
    { pattern: makeKeywordPattern(RUST_KEYWORDS), className: "keyword" },
    { pattern: /\b[A-Z][a-zA-Z0-9]*\b/g, className: "type" },
    { pattern: /\b[a-z_]\w*(?=\s*[(<])/g, className: "func" },
    { pattern: /(?:&mut\s|&)/g, className: "keyword" },
    { pattern: /[+\-*/%=!<>&|^~?:]+/g, className: "operator" },
    { pattern: /[{}[\]();,]/g, className: "punct" },
  ];
}

function pythonRules(): TokenRule[] {
  return [
    { pattern: /#.*$/gm, className: "comment" },
    { pattern: /"""[\s\S]*?"""/g, className: "string" },
    { pattern: /'''[\s\S]*?'''/g, className: "string" },
    { pattern: /f"(?:\\.|[^"\\])*"/g, className: "string" },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: "string" },
    { pattern: /'(?:\\.|[^'\\])*'/g, className: "string" },
    { pattern: /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?j?\b/gi, className: "number" },
    { pattern: makeKeywordPattern(PYTHON_KEYWORDS), className: "keyword" },
    { pattern: /\b[A-Z][a-zA-Z0-9]*\b/g, className: "type" },
    { pattern: /\b[a-z_]\w*(?=\s*\()/g, className: "func" },
    { pattern: /@\w+/g, className: "keyword" },
    { pattern: /[+\-*/%=!<>&|^~:]+/g, className: "operator" },
    { pattern: /[{}[\]();,]/g, className: "punct" },
  ];
}

function cssRules(): TokenRule[] {
  return [
    { pattern: /\/\*[\s\S]*?\*\//g, className: "comment" },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: "string" },
    { pattern: /'(?:\\.|[^'\\])*'/g, className: "string" },
    { pattern: /\b\d+(?:\.\d+)?(?:px|em|rem|vh|vw|%|s|ms|deg|fr)?\b/g, className: "number" },
    { pattern: /#[0-9a-fA-F]{3,8}\b/g, className: "number" },
    { pattern: /\.[a-zA-Z_][\w-]*/g, className: "func" },
    { pattern: /#[a-zA-Z_][\w-]*/g, className: "const" },
    { pattern: /[a-zA-Z-]{1,80}(?=\s*:)/g, className: "prop" },
    { pattern: makeKeywordPattern(CSS_KEYWORDS), className: "keyword" },
    { pattern: /[{}();:,]/g, className: "punct" },
  ];
}

function jsonRules(): TokenRule[] {
  return [
    { pattern: /"(?:\\.|[^"\\])*"(?=\s*:)/g, className: "prop" },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: "string" },
    { pattern: /\b(?:true|false|null)\b/g, className: "keyword" },
    { pattern: /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/g, className: "number" },
    { pattern: /[{}[\]:,]/g, className: "punct" },
  ];
}

function sqlRules(): TokenRule[] {
  return [
    { pattern: /--.*$/gm, className: "comment" },
    { pattern: /\/\*[\s\S]*?\*\//g, className: "comment" },
    { pattern: /'(?:''|[^'])*'/g, className: "string" },
    { pattern: /\b\d+(?:\.\d+)?\b/g, className: "number" },
    { pattern: makeKeywordPattern(SQL_KEYWORDS, true), className: "keyword" },
    { pattern: /\b[a-zA-Z_]\w*(?=\s*\()/g, className: "func" },
    { pattern: /[+\-*/%=!<>&|]+/g, className: "operator" },
    { pattern: /[();,]/g, className: "punct" },
  ];
}

function shellRules(): TokenRule[] {
  return [
    { pattern: /#.*$/gm, className: "comment" },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: "string" },
    { pattern: /'[^']*'/g, className: "string" },
    { pattern: /\$\{?\w+\}?/g, className: "const" },
    { pattern: /\b\d+\b/g, className: "number" },
    { pattern: makeKeywordPattern(SHELL_KEYWORDS), className: "keyword" },
    { pattern: /--?[\w-]+/g, className: "param" },
    { pattern: /[|&;><]+/g, className: "operator" },
  ];
}

function goRules(): TokenRule[] {
  return [
    { pattern: /\/\/.*$/gm, className: "comment" },
    { pattern: /\/\*[\s\S]*?\*\//g, className: "comment" },
    { pattern: /`[^`]*`/g, className: "string" },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: "string" },
    { pattern: /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, className: "number" },
    { pattern: makeKeywordPattern(GO_KEYWORDS), className: "keyword" },
    { pattern: /\b[A-Z][a-zA-Z0-9]*\b/g, className: "type" },
    { pattern: /\b[a-z_]\w*(?=\s*\()/g, className: "func" },
    { pattern: /[+\-*/%=!<>&|^~?:]+/g, className: "operator" },
    { pattern: /[{}[\]();,]/g, className: "punct" },
  ];
}

function scalaRules(): TokenRule[] {
  return [
    { pattern: /\/\/.*$/gm, className: "comment" },
    { pattern: /\/\*[\s\S]*?\*\//g, className: "comment" },
    { pattern: /"""[\s\S]*?"""/g, className: "string" },
    { pattern: /s"(?:\\.|[^"\\])*"/g, className: "string" },
    { pattern: /f"(?:\\.|[^"\\])*"/g, className: "string" },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: "string" },
    { pattern: /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?[LlFfDd]?\b/gi, className: "number" },
    { pattern: makeKeywordPattern(SCALA_KEYWORDS), className: "keyword" },
    { pattern: /\b[A-Z][a-zA-Z0-9]*\b/g, className: "type" },
    { pattern: /\b[a-z_]\w*(?=\s*[([])/g, className: "func" },
    { pattern: /@\w+/g, className: "keyword" },
    { pattern: /[+\-*/%=!<>&|^~?:]+|=>/g, className: "operator" },
    { pattern: /[{}[\]();,]/g, className: "punct" },
  ];
}

function htmlRules(): TokenRule[] {
  return [
    { pattern: /<!--[\s\S]*?-->/g, className: "comment" },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: "string" },
    { pattern: /'(?:\\.|[^'\\])*'/g, className: "string" },
    { pattern: /<\/?[a-zA-Z][\w-]*/g, className: "tag" },
    { pattern: /\/?>/g, className: "tag" },
    { pattern: /\b[a-zA-Z-]+(?==)/g, className: "attr" },
  ];
}

function markdownRules(): TokenRule[] {
  return [
    { pattern: /^#{1,6}\s.+$/gm, className: "keyword" },
    { pattern: /\*\*[^*]+\*\*/g, className: "keyword" },
    { pattern: /`[^`]+`/g, className: "string" },
    { pattern: /\[([^\]]+)\]\([^)]+\)/g, className: "func" },
    { pattern: /^[-*+]\s/gm, className: "operator" },
    { pattern: /^\d+\.\s/gm, className: "number" },
  ];
}

function yamlRules(): TokenRule[] {
  return [
    { pattern: /#.*$/gm, className: "comment" },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: "string" },
    { pattern: /'[^']*'/g, className: "string" },
    // Tags: `!!str`, `!Custom`, `!<verbatim>`. `syn-type` is the closest
    // existing class; YAML tags assert a type so the colour is appropriate.
    { pattern: /!!?[\w./-]+/g, className: "type" },
    // Anchor definition `&id` and alias reference `*id`. Use `syn-const`
    // (referenced symbol, similar role to a CSS id selector).
    { pattern: /&[A-Za-z_][\w-]*/g, className: "const" },
    { pattern: /\*[A-Za-z_][\w-]*/g, className: "const" },
    { pattern: /\b(?:true|false|null|yes|no|on|off)\b/gi, className: "keyword" },
    { pattern: /\b\d+(?:\.\d+)?\b/g, className: "number" },
    { pattern: /^[\w.-]{1,80}(?=\s*:)/gm, className: "prop" },
    { pattern: /[:\-|>]/g, className: "operator" },
  ];
}

function tomlRules(): TokenRule[] {
  return [
    { pattern: /#.*$/gm, className: "comment" },
    { pattern: /"""[\s\S]*?"""/g, className: "string" },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: "string" },
    { pattern: /'[^']*'/g, className: "string" },
    { pattern: /\b(?:true|false)\b/g, className: "keyword" },
    { pattern: /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/g, className: "number" },
    { pattern: /\[[^\]]+\]/g, className: "type" },
    { pattern: /[\w.-]{1,80}(?=\s*=)/g, className: "prop" },
    { pattern: /[=]/g, className: "operator" },
  ];
}

/**
 * HashiCorp Configuration Language. Looks like TOML but has block syntax
 * (`block "label" { … }`) and `#`/`//` comments. Aliasing it to TOML
 * mis-classifies block headers and labels.
 */
function hclRules(): TokenRule[] {
  return [
    { pattern: /#.*$/gm, className: "comment" },
    { pattern: /\/\/.*$/gm, className: "comment" },
    { pattern: /\/\*[\s\S]*?\*\//g, className: "comment" },
    { pattern: /"(?:\\.|[^"\\])*"/g, className: "string" },
    { pattern: /\b\d+(?:\.\d+)?\b/g, className: "number" },
    { pattern: /\b(?:true|false|null)\b/g, className: "keyword" },
    // Block header: identifier followed by string label or `{`.
    // e.g. `resource "aws_instance" "web" {` — `resource` is the kind.
    // Length-capped to avoid O(n²) backtracking on pathological input.
    { pattern: /^\s*[a-z_][\w-]{0,80}(?=\s+["{])/gm, className: "keyword" },
    // Attribute name: `key = …`.
    { pattern: /[a-z_][\w-]{0,80}(?=\s*=[^=])/gi, className: "prop" },
    { pattern: /\b[A-Z][a-zA-Z0-9]*\b/g, className: "type" },
    { pattern: /[+\-*/%=!<>&|^~?:]+/g, className: "operator" },
    { pattern: /[{}[\]();,]/g, className: "punct" },
  ];
}

export const RUST_RULES: TokenRule[] = rustRules();
export const PYTHON_RULES: TokenRule[] = pythonRules();
export const CSS_RULES: TokenRule[] = cssRules();
export const JSON_RULES: TokenRule[] = jsonRules();
export const SQL_RULES: TokenRule[] = sqlRules();
export const SHELL_RULES: TokenRule[] = shellRules();
export const GO_RULES: TokenRule[] = goRules();
export const HTML_RULES: TokenRule[] = htmlRules();
export const MARKDOWN_RULES: TokenRule[] = markdownRules();
export const YAML_RULES: TokenRule[] = yamlRules();
export const TOML_RULES: TokenRule[] = tomlRules();
export const SCALA_RULES: TokenRule[] = scalaRules();
export const HCL_RULES: TokenRule[] = hclRules();
