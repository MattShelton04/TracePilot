//! Unit tests for the FTS query sanitizer and snippet markers.

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
    // Punctuation is stripped to prevent FTS5 errors. Words it joined stay
    // a phrase, because the tokenizer indexed them side by side.
    // (These were separate terms before, e.g. "path to file".)
    assert_eq!(sanitize_fts_query("error(code)"), "\"error code\"");
    assert_eq!(sanitize_fts_query("field:value"), "\"field value\"");
    assert_eq!(sanitize_fts_query("a{b}c"), "\"a b c\"");
    assert_eq!(sanitize_fts_query("^test$"), "test");
    assert_eq!(sanitize_fts_query("path/to/file"), "\"path to file\"");
    assert_eq!(sanitize_fts_query("a+b-c"), "\"a b c\"");
    assert_eq!(sanitize_fts_query("(error) code."), "error code");
}

#[test]
fn test_sanitize_punctuation_joined_words_are_a_phrase() {
    assert_eq!(sanitize_fts_query("index.ts"), "\"index ts\"");
    assert_eq!(sanitize_fts_query("build-std"), "\"build std\"");
    assert_eq!(
        sanitize_fts_query("open src/index.ts now"),
        "open \"src index ts\" now"
    );
    assert_eq!(sanitize_fts_query("--no-verify"), "\"no verify\"");
    assert_eq!(sanitize_fts_query("snake_case"), "snake_case");
    // Operators around a joined word still apply to the whole phrase.
    assert_eq!(
        sanitize_fts_query("lib.rs OR index.ts"),
        "\"lib rs\" OR \"index ts\""
    );
    assert_eq!(sanitize_fts_query("NOT index.ts store"), "store");
    assert_eq!(
        sanitize_fts_query("\"unclosed index.ts"),
        "unclosed \"index ts\""
    );
}

#[test]
fn test_sanitize_prefix_on_joined_words() {
    assert_eq!(sanitize_fts_query("index.t*"), "\"index t\"*");
    // A * on punctuation alone isn't a prefix of the word beside it.
    assert_eq!(sanitize_fts_query("build-*"), "build");
    assert_eq!(sanitize_fts_query("*.ts"), "ts");
    assert_eq!(sanitize_fts_query("index.*"), "index");
}

#[test]
fn test_sanitize_operators_wrapped_in_punctuation() {
    // Parentheses and other punctuation around an operator leave it an
    // operator, as before words joined by punctuation became phrases.
    for (query, expected) in [
        ("cache AND (NOT found)", "cache NOT found"),
        ("(cache OR found) AND (NOT jwt)", "cache OR found NOT jwt"),
        ("error OR (NOT timeout)", "error"),
        ("(OR jwt)", "jwt"),
        ("(AND) cache", "cache"),
        ("[OR] cache", "cache"),
        ("-NOT cache", ""),
        (".NOT cache", ""),
        ("(NEAR) cache", "cache"),
    ] {
        assert_eq!(sanitize_fts_query(query), expected, "{query:?}");
    }
    // Inside a joined word an operator is just a word of the phrase.
    assert_eq!(sanitize_fts_query("cache.AND"), "\"cache AND\"");
}

#[test]
fn test_sanitize_prefix_preserved() {
    assert_eq!(sanitize_fts_query("auth*"), "auth*");
    assert_eq!(sanitize_fts_query("config*"), "config*");
}

#[test]
fn test_sanitize_operator_word_prefix_is_a_quoted_term() {
    // FTS5 reads a bare `OR*` as the operator and fails with a syntax error.
    for (query, expected) in [
        ("OR*", "\"OR\"*"),
        ("AND*", "\"AND\"*"),
        ("NOT* foo", "\"NOT\"* foo"),
        ("foo bar AND*", "foo bar \"AND\"*"),
        ("*OR", "\"OR\"*"),
        ("(OR*)", "\"OR\"*"),
        ("NEAR*", "\"NEAR\"*"),
        ("foo OR OR*", "foo OR \"OR\"*"),
        // Lowercase words were never operators and stay bare.
        ("or*", "or*"),
    ] {
        assert_eq!(sanitize_fts_query(query), expected, "{query:?}");
    }
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
    // "/" joins "NEAR" and "5"; NEAR is stripped, 5 is kept as a term
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
