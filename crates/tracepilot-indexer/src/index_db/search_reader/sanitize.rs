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

/// Stands in for punctuation inside a word (`index.ts`, `build-std`) until
/// the word is turned into a term. It is neither alphanumeric nor whitespace.
const JOIN: char = '\u{1F}';

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
/// - Words joined by punctuation (`index.ts`, `build-std`, `path/to/file`)
///   become a quoted phrase, so their parts must be adjacent as they are in
///   the text; words separated by spaces still match anywhere
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
    // Other punctuation becomes JOIN, which keeps the words it joined together.
    let cleaned: String = trimmed
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '"' || c == '*' || c == '_' || c.is_whitespace() {
                c
            } else {
                JOIN
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
                // Valid quoted phrase, kept when it has something to match.
                // The tokenizer splits on punctuation inside it anyway.
                let inner = &phrase[1..phrase.len() - 1];
                if inner.chars().any(char::is_alphanumeric) {
                    tokens.push(phrase.replace(JOIN, " "));
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
        // Punctuation at a word's edges joins nothing: `(NOT` is the operator
        // NOT, and `(error)` the word error.
        let token = token.trim_matches(JOIN);
        if token.is_empty() {
            continue;
        }
        if OPERATORS.contains(&token) {
            skip_negated = false;
            if token == "NOT" && last_was_operator {
                if result_tokens.last().is_some_and(|t| t == "AND") {
                    // `a AND NOT b` is written `a NOT b` in FTS5.
                    result_tokens.pop();
                    result_tokens.push(token.to_string());
                } else {
                    skip_negated = true;
                }
                continue;
            }
            // Skip if leading or adjacent to another operator.
            if !last_was_operator {
                result_tokens.push(token.to_string());
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
            token.to_string()
        } else {
            match bare_term(token) {
                Some(term) => term,
                None => continue,
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

/// Turn an unquoted token into an FTS5 term, or `None` when it has nothing
/// to match. A term needs a letter or digit, and a `*` in a word makes it a
/// prefix (a `*` on punctuation alone, as in `*.ts`, doesn't).
/// Words joined by punctuation become a phrase (`index.ts` is `"index ts"`)
/// so they match only side by side; a `NEAR` among them is dropped.
fn bare_term(token: &str) -> Option<String> {
    let mut prefix = false;
    let mut parts: Vec<String> = Vec::new();
    for part in token.split(JOIN).filter(|part| *part != "NEAR") {
        let word: String = part.chars().filter(|c| *c != '*' && *c != '"').collect();
        if word.chars().any(char::is_alphanumeric) {
            prefix |= part.contains('*');
            parts.push(word);
        }
    }
    let term = match parts.as_slice() {
        [] => return None,
        [word] => word.clone(),
        words => format!("\"{}\"", words.join(" ")),
    };
    // FTS5 reads `"index t"*` as a phrase whose last word is a prefix.
    Some(if prefix { format!("{term}*") } else { term })
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
#[path = "sanitize_tests.rs"]
mod tests;
