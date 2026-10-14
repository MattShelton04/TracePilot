//! Sanitization helpers for FTS queries and result snippets, plus row mapping.

use super::SearchResult;
use crate::index_db::row_helpers::session_source_from_row;

/// Map a rusqlite row to a `SearchResult`.
pub(super) fn map_search_result(row: &rusqlite::Row<'_>) -> rusqlite::Result<SearchResult> {
    let raw_snippet: String = row.get(7)?;
    Ok(SearchResult {
        id: row.get(0)?,
        session_id: row.get(1)?,
        content_type: row.get(2)?,
        turn_number: row.get(3)?,
        event_index: row.get(4)?,
        timestamp_unix: row.get(5)?,
        tool_name: row.get(6)?,
        snippet: sanitize_snippet(&raw_snippet),
        metadata_json: row.get(8)?,
        session_summary: row.get(9)?,
        session_repository: row.get(10)?,
        session_branch: row.get(11)?,
        session_updated_at: row.get(12)?,
        source: session_source_from_row(row)?,
    })
}

/// FTS5 boolean operators. FTS5 only treats these exact uppercase spellings
/// as operators, so the lowercase words stay ordinary search terms.
const OPERATORS: [&str; 3] = ["AND", "OR", "NOT"];

/// Sanitize a user query for safe FTS5 MATCH usage.
///
/// FTS5 has a specific query syntax. Raw user input can cause parse errors.
/// This function handles:
/// - Balanced quotes (phrase search), including mixed phrases + terms
/// - Prefix queries (word*)
/// - Boolean operators: like FTS5, only the uppercase spellings `AND`, `OR`
///   and `NOT` are operators; `and`, `or` and `not` are ordinary words
/// - Stripping problematic characters (parentheses, colons, carets) and the
///   `NEAR` keyword (words such as "nearby" are kept)
/// - A NOT with no term before it: FTS5 can't search for "everything except
///   X", so the NOT and the term it negates are both dropped rather than
///   searching for X instead (`a AND NOT b` becomes `a NOT b`)
/// - Adjacent operator prevention
///
/// Returns an empty string when nothing searchable is left.
pub fn sanitize_fts_query(query: &str) -> String {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    // Strip characters that are problematic for FTS5 — only keep alphanumeric,
    // whitespace, quotes (for phrases), * (for prefix), and basic separators.
    // The unicode61 tokenizer treats most punctuation as separators anyway.
    let cleaned: String = trimmed
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '"' || c == '*' || c == '_' || c.is_whitespace() {
                c
            } else {
                ' '
            }
        })
        .collect();

    // Parse into tokens, preserving quoted phrases
    let mut tokens: Vec<String> = Vec::new();
    let mut chars = cleaned.chars().peekable();
    let mut current = String::new();

    while let Some(c) = chars.next() {
        if c == '"' {
            // Start of a quoted phrase — collect until closing quote or end
            if !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
            let mut phrase = String::from('"');
            let mut closed = false;
            for inner in chars.by_ref() {
                if inner == '"' {
                    phrase.push('"');
                    closed = true;
                    break;
                }
                phrase.push(inner);
            }
            if !closed {
                // Unclosed quote — treat as plain tokens (strip the leading quote)
                let plain = phrase[1..].to_string();
                for word in plain.split_whitespace() {
                    if !word.is_empty() {
                        tokens.push(word.to_string());
                    }
                }
            } else {
                // Valid quoted phrase, kept when it has something to match
                let inner = &phrase[1..phrase.len() - 1];
                if inner.chars().any(char::is_alphanumeric) {
                    tokens.push(phrase);
                }
            }
        } else if c.is_whitespace() {
            if !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
        } else {
            current.push(c);
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }

    if tokens.is_empty() {
        return String::new();
    }

    let mut result_tokens: Vec<String> = Vec::new();
    let mut last_was_operator = true; // the start counts as an operator: no leading operators
    // Set by a NOT with no term before it; the next term is the one it negates.
    let mut skip_negated = false;

    for token in &tokens {
        if OPERATORS.contains(&token.as_str()) {
            skip_negated = false;
            if token == "NOT" && last_was_operator {
                if result_tokens.last().is_some_and(|t| t == "AND") {
                    // `a AND NOT b` is written `a NOT b` in FTS5.
                    result_tokens.pop();
                    result_tokens.push(token.clone());
                } else {
                    skip_negated = true;
                }
                continue;
            }
            // Skip if leading or adjacent to another operator.
            if !last_was_operator {
                result_tokens.push(token.clone());
                last_was_operator = true;
            }
            continue;
        }

        // Strip the NEAR keyword — NEAR groups are too complex for user input.
        if token == "NEAR" {
            continue;
        }

        let term = if token.starts_with('"') && token.ends_with('"') {
            // Quoted phrases pass through directly.
            token.clone()
        } else {
            // A term needs a letter or digit; a single trailing * makes it a prefix.
            let base: String = token.chars().filter(|c| *c != '*' && *c != '"').collect();
            if !base.chars().any(char::is_alphanumeric) {
                continue;
            }
            if token.contains('*') {
                format!("{base}*")
            } else {
                base
            }
        };
        if skip_negated {
            skip_negated = false;
            continue;
        }
        result_tokens.push(term);
        last_was_operator = false;
    }

    // Ensure we don't end with an operator
    while result_tokens
        .last()
        .is_some_and(|t| OPERATORS.contains(&t.as_str()))
    {
        result_tokens.pop();
    }

    result_tokens.join(" ")
}

/// Convert FTS5 snippet sentinel markers into safe HTML-escapable markers.
/// Input uses `\x01MARK_OPEN\x01` and `\x01MARK_CLOSE\x01` sentinels.
/// Output uses `<mark>` / `</mark>` after escaping the content.
fn sanitize_snippet(raw: &str) -> String {
    // First, HTML-escape the content (but preserve our sentinels)
    let escaped = raw
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");

    // Then replace sentinels with HTML marks
    escaped
        .replace("\x01MARK_OPEN\x01", "<mark>")
        .replace("\x01MARK_CLOSE\x01", "</mark>")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── sanitize_fts_query tests ────────────────────────────────────

    #[test]
    fn test_sanitize_simple_query() {
        assert_eq!(sanitize_fts_query("hello world"), "hello world");
    }

    #[test]
    fn test_sanitize_phrase_query() {
        assert_eq!(
            sanitize_fts_query("\"file not found\""),
            "\"file not found\""
        );
    }

    #[test]
    fn test_sanitize_mixed_phrase_and_terms() {
        // This was the critical bug: previously destroyed embedded phrases
        assert_eq!(
            sanitize_fts_query("error \"file not found\""),
            "error \"file not found\""
        );
        assert_eq!(
            sanitize_fts_query("\"hello world\" foo bar"),
            "\"hello world\" foo bar"
        );
        assert_eq!(
            sanitize_fts_query("before \"middle phrase\" after"),
            "before \"middle phrase\" after"
        );
    }

    #[test]
    fn test_sanitize_boolean_operators() {
        assert_eq!(sanitize_fts_query("rust AND async"), "rust AND async");
        assert_eq!(sanitize_fts_query("error OR warning"), "error OR warning");
        assert_eq!(sanitize_fts_query("auth NOT jwt"), "auth NOT jwt");
    }

    #[test]
    fn test_sanitize_adjacent_operators() {
        // Adjacent operators should collapse to just the term
        assert_eq!(sanitize_fts_query("foo AND OR bar"), "foo AND bar");
        assert_eq!(sanitize_fts_query("foo OR AND bar"), "foo OR bar");
        assert_eq!(sanitize_fts_query("AND AND foo"), "foo");
    }

    #[test]
    fn test_sanitize_leading_not_drops_the_negated_term() {
        // FTS5 can't express "everything except error"; searching for
        // "error" instead would return exactly what the user excluded.
        assert_eq!(sanitize_fts_query("NOT error"), "");
        assert_eq!(sanitize_fts_query("NOT error timeout"), "timeout");
        assert_eq!(sanitize_fts_query("NOT \"rate limit\" retry"), "retry");
        assert_eq!(sanitize_fts_query("foo OR NOT bar"), "foo");
    }

    #[test]
    fn test_sanitize_and_not_becomes_not() {
        assert_eq!(sanitize_fts_query("auth AND NOT jwt"), "auth NOT jwt");
    }

    #[test]
    fn test_sanitize_leading_operators() {
        assert_eq!(sanitize_fts_query("AND foo"), "foo");
        assert_eq!(sanitize_fts_query("OR foo"), "foo");
        assert_eq!(sanitize_fts_query("NOT AND foo"), "foo");
    }

    #[test]
    fn test_sanitize_trailing_operator() {
        assert_eq!(sanitize_fts_query("hello AND"), "hello");
        assert_eq!(sanitize_fts_query("hello OR"), "hello");
        assert_eq!(sanitize_fts_query("hello NOT"), "hello");
    }

    #[test]
    fn test_sanitize_strips_problematic_chars() {
        assert_eq!(sanitize_fts_query("error(code)"), "error code");
        assert_eq!(sanitize_fts_query("field:value"), "field value");
        assert_eq!(sanitize_fts_query("a{b}c"), "a b c");
        assert_eq!(sanitize_fts_query("^test$"), "test");
        // Slashes and other punctuation are stripped to prevent FTS5 errors
        assert_eq!(sanitize_fts_query("path/to/file"), "path to file");
        assert_eq!(sanitize_fts_query("a+b-c"), "a b c");
    }

    #[test]
    fn test_sanitize_prefix_preserved() {
        assert_eq!(sanitize_fts_query("auth*"), "auth*");
        assert_eq!(sanitize_fts_query("config*"), "config*");
    }

    #[test]
    fn test_sanitize_invalid_wildcards() {
        // Leading wildcard — normalized to trailing
        assert_eq!(sanitize_fts_query("*foo"), "foo*");
        // Double wildcard — collapsed to single trailing
        assert_eq!(sanitize_fts_query("foo**"), "foo*");
        // Bare wildcard — dropped entirely
        assert_eq!(sanitize_fts_query("*"), "");
        // Double bare wildcard — dropped
        assert_eq!(sanitize_fts_query("**"), "");
        // Wildcard with valid context preserved
        assert_eq!(sanitize_fts_query("err* AND warn*"), "err* AND warn*");
    }

    #[test]
    fn test_sanitize_empty_input() {
        assert_eq!(sanitize_fts_query(""), "");
        assert_eq!(sanitize_fts_query("   "), "");
    }

    #[test]
    fn test_sanitize_near_stripped() {
        assert_eq!(sanitize_fts_query("NEAR(a b)"), "a b");
        // / becomes space, so "NEAR/5" → "NEAR 5"; NEAR is stripped, 5 is kept as a term
        assert_eq!(sanitize_fts_query("NEAR/5 foo"), "5 foo");
    }

    #[test]
    fn test_sanitize_keeps_words_starting_with_near() {
        assert_eq!(sanitize_fts_query("nearby"), "nearby");
        assert_eq!(sanitize_fts_query("nearest nearly"), "nearest nearly");
        assert_eq!(sanitize_fts_query("near miss"), "near miss");
        assert_eq!(sanitize_fts_query("NEARBY"), "NEARBY");
    }

    #[test]
    fn test_sanitize_unclosed_quote() {
        // Unclosed quote should be treated as plain words
        let result = sanitize_fts_query("\"unclosed phrase");
        assert_eq!(result, "unclosed phrase");
    }

    #[test]
    fn test_sanitize_empty_phrase() {
        // Empty quoted phrase should be dropped
        let result = sanitize_fts_query("\"\" hello");
        assert_eq!(result, "hello");
    }

    #[test]
    fn test_sanitize_lowercase_operator_words_are_terms() {
        // FTS5 only reads the uppercase spellings as operators, so lowercase
        // ones stay words: "command not found" must not exclude "found".
        // (This replaces an older test that upper-cased them into operators.)
        assert_eq!(sanitize_fts_query("foo and bar"), "foo and bar");
        assert_eq!(sanitize_fts_query("foo or bar"), "foo or bar");
        assert_eq!(sanitize_fts_query("foo not bar"), "foo not bar");
        assert_eq!(sanitize_fts_query("not"), "not");
        assert_eq!(sanitize_fts_query("Not found"), "Not found");
    }

    #[test]
    fn test_sanitize_only_operators() {
        assert_eq!(sanitize_fts_query("AND OR NOT"), "");
        assert_eq!(sanitize_fts_query("NOT"), "");
    }

    #[test]
    fn test_sanitize_nothing_searchable() {
        for query in ["*", "((", "!!!", "_", "\"*\"", "\"!!\"", "NEAR"] {
            assert_eq!(sanitize_fts_query(query), "", "{query:?}");
        }
    }

    #[test]
    fn test_sanitize_multiple_phrases() {
        assert_eq!(
            sanitize_fts_query("\"hello world\" AND \"foo bar\""),
            "\"hello world\" AND \"foo bar\""
        );
    }

    #[test]
    fn test_sanitize_phrase_with_special_chars() {
        // Problematic chars like : are stripped even inside quotes (first pass is global)
        // This is safe — FTS5 matches on the tokenized content anyway
        assert_eq!(
            sanitize_fts_query("\"error: file not found\""),
            "\"error  file not found\""
        );
    }

    // ── sanitize_snippet tests ──────────────────────────────────────

    #[test]
    fn test_snippet_sanitization() {
        let raw = "hello \x01MARK_OPEN\x01world\x01MARK_CLOSE\x01 <script>";
        let result = sanitize_snippet(raw);
        assert_eq!(result, "hello <mark>world</mark> &lt;script&gt;");
    }

    #[test]
    fn test_snippet_no_markers() {
        assert_eq!(sanitize_snippet("plain text"), "plain text");
    }

    #[test]
    fn test_snippet_html_entities() {
        let raw = "a < b & c > d";
        assert_eq!(sanitize_snippet(raw), "a &lt; b &amp; c &gt; d");
    }

    #[test]
    fn test_snippet_multiple_marks() {
        let raw = "\x01MARK_OPEN\x01a\x01MARK_CLOSE\x01 b \x01MARK_OPEN\x01c\x01MARK_CLOSE\x01";
        assert_eq!(sanitize_snippet(raw), "<mark>a</mark> b <mark>c</mark>");
    }
}
