//! Tool-specific extractors for converting JSON tool results into searchable text.
//!
//! Contains `extract_tool_result` (tool-specific extractors with fallback),
//! `result_text` (a result's `content`/`detailedContent` text),
//! `flatten_json_value` / `flatten_json_with_keys` (JSON→text flatteners),
//! and `expand_camel_case` (identifier splitting, test-only).

use tracepilot_core::utils::truncate_utf8;

/// Per-extractor internal limits for tool result fields.
const EXTRACT_VIEW_CONTENT: usize = 400;
const EXTRACT_VIEW_PATH_PLUS: usize = 500;
const EXTRACT_SHELL_OUTPUT: usize = 400;
const EXTRACT_SHELL_FALLBACK: usize = 500;
const EXTRACT_SHELL_STDERR: usize = 600;
const EXTRACT_GREP_BYTES: usize = 2000;
const EXTRACT_EDIT_CONTENT: usize = 300;
const EXTRACT_EDIT_FALLBACK: usize = 400;
const EXTRACT_GENERIC_BYTES: usize = 400;

/// Flatten a serde_json::Value into a searchable text string.
/// Objects have their values concatenated, arrays are joined, etc.
pub(super) fn flatten_json_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Null => String::new(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .map(flatten_json_value)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        serde_json::Value::Object(map) => map
            .values()
            .map(flatten_json_value)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

/// The text of a result shaped `{content, detailedContent}`, as both Copilot
/// and the Claude Code provider write it, or a plain string; `None` when it
/// has neither, so the caller flattens whatever else it holds.
///
/// `content` comes first. `detailedContent` is added only when it says more:
/// it repeats or extends `content` for shells, and carries the diff that an
/// edit's `content` ("File updated") lacks. Key names are never included,
/// since search snippets show this text as it is.
fn result_text(result: &serde_json::Value) -> Option<String> {
    if let Some(text) = result.as_str() {
        return Some(text.to_string()).filter(|t| !t.trim().is_empty());
    }
    let field = |key| {
        result
            .get(key)
            .and_then(|v| v.as_str())
            .filter(|t| !t.trim().is_empty())
    };
    match (field("content"), field("detailedContent")) {
        (Some(content), Some(detailed)) => Some(if content.contains(detailed.trim()) {
            content.to_string()
        } else if detailed.starts_with(content) {
            detailed.to_string()
        } else {
            format!("{content}\n{detailed}")
        }),
        (content, detailed) => content.or(detailed).map(str::to_string),
    }
}

/// [`result_text`], or the flattened result when it has no text, cut to
/// `max_bytes`.
fn result_text_or_flattened(result: &serde_json::Value, max_bytes: usize) -> String {
    let text = result_text(result).unwrap_or_else(|| flatten_json_with_keys(result));
    truncate_utf8(&text, max_bytes).to_string()
}

/// Flatten a serde_json::Value preserving keys as "key: value" pairs. Only
/// for results with no text field, where the keys are the only context
/// (`{"ready": true}`).
fn flatten_json_with_keys(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Null => String::new(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .map(flatten_json_with_keys)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        serde_json::Value::Object(map) => map
            .iter()
            .filter_map(|(k, v)| {
                let val = flatten_json_with_keys(v);
                if val.is_empty() {
                    None
                } else {
                    Some(format!("{}: {}", k, val))
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

/// Extract the most searchable content from a tool result, using tool-specific extractors.
pub(super) fn extract_tool_result(tool_name_lower: &str, result: &serde_json::Value) -> String {
    match tool_name_lower {
        "view" | "github-mcp-server-get_file_contents" => {
            // Extract path + abbreviated content
            let mut parts = Vec::new();
            if let Some(path) = result.get("path").and_then(|v| v.as_str()) {
                parts.push(path.to_string());
            }
            // `detailedContent` is the same file with line numbers, so it
            // stands in only for an empty `content`.
            let content = ["content", "detailedContent"].into_iter().find_map(|key| {
                result
                    .get(key)
                    .and_then(|v| v.as_str())
                    .filter(|t| !t.trim().is_empty())
            });
            if let Some(content) = content {
                let t = truncate_utf8(content, EXTRACT_VIEW_CONTENT);
                parts.push(t.to_string());
            }
            let joined = parts.join("\n");
            if joined.is_empty() {
                result_text_or_flattened(result, EXTRACT_VIEW_PATH_PLUS)
            } else {
                joined
            }
        }
        "edit" | "create" => {
            let mut parts = Vec::new();
            if let Some(path) = result.get("path").and_then(|v| v.as_str()) {
                parts.push(path.to_string());
            }
            if let Some(new_str) = result.get("new_str").and_then(|v| v.as_str()) {
                let t = truncate_utf8(new_str, EXTRACT_EDIT_CONTENT);
                parts.push(t.to_string());
            }
            let joined = parts.join("\n");
            if joined.is_empty() {
                // `content` is "File updated"; `detailedContent` is the diff.
                result_text_or_flattened(result, EXTRACT_EDIT_FALLBACK)
            } else {
                joined
            }
        }
        "powershell" | "bash" | "shell" => {
            if let Some(output) = result.get("output").and_then(|v| v.as_str()) {
                let t = truncate_utf8(output, EXTRACT_SHELL_OUTPUT);
                return t.to_string();
            }
            if let Some(text) = result_text(result) {
                return truncate_utf8(&text, EXTRACT_SHELL_FALLBACK).to_string();
            }
            if let Some(stderr) = result.get("stderr").and_then(|v| v.as_str())
                && !stderr.is_empty()
            {
                let t = truncate_utf8(stderr, EXTRACT_SHELL_STDERR);
                return t.to_string();
            }
            let full = flatten_json_with_keys(result);
            truncate_utf8(&full, EXTRACT_SHELL_FALLBACK).to_string()
        }
        "grep" | "glob" | "github-mcp-server-search_code" => {
            result_text_or_flattened(result, EXTRACT_GREP_BYTES)
        }
        _ => result_text_or_flattened(result, EXTRACT_GENERIC_BYTES),
    }
}

/// Expand camelCase and PascalCase identifiers into space-separated words.
/// Returns ONLY the expansion terms (not the original text).
/// Kept for potential future use in search enrichment.
#[cfg(test)]
fn expand_camel_case(text: &str) -> String {
    let mut expansions = Vec::new();

    for word in text.split(|c: char| !c.is_alphanumeric() && c != '_') {
        if word.len() < 4 {
            continue;
        }
        let chars: Vec<char> = word.chars().collect();
        let mut parts = Vec::new();
        let mut start = 0;

        for i in 1..chars.len() {
            let split = chars[i].is_uppercase()
                && (chars[i - 1].is_lowercase()
                    || (i + 1 < chars.len() && chars[i + 1].is_lowercase()));
            if split {
                let part: String = chars[start..i].iter().collect();
                if part.len() >= 2 {
                    parts.push(part.to_lowercase());
                }
                start = i;
            }
        }
        let last: String = chars[start..].iter().collect();
        if last.len() >= 2 {
            parts.push(last.to_lowercase());
        }

        if parts.len() >= 2 {
            expansions.push(parts.join(" "));
        }
    }

    expansions.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── flatten_json_value tests ────────────────────────────────

    #[test]
    fn test_flatten_json_string() {
        let v = serde_json::json!("hello world");
        assert_eq!(flatten_json_value(&v), "hello world");
    }

    #[test]
    fn test_flatten_json_object() {
        let v = serde_json::json!({"path": "/src/main.rs", "content": "fn main() {}"});
        let text = flatten_json_value(&v);
        assert!(text.contains("/src/main.rs"));
        assert!(text.contains("fn main() {}"));
    }

    #[test]
    fn test_flatten_json_nested() {
        let v = serde_json::json!({"args": {"file": "test.rs"}, "extra": null});
        let text = flatten_json_value(&v);
        assert!(text.contains("test.rs"));
        assert!(!text.contains("null"));
    }

    #[test]
    fn test_flatten_json_null() {
        let v = serde_json::Value::Null;
        assert_eq!(flatten_json_value(&v), "");
    }

    // ── expand_camel_case tests ─────────────────────────────────

    #[test]
    fn test_expand_camel_case_simple() {
        assert_eq!(expand_camel_case("parseJSON"), "parse json");
    }

    #[test]
    fn test_expand_camel_case_http_client() {
        assert_eq!(expand_camel_case("getHTTPClient"), "get http client");
    }

    #[test]
    fn test_expand_camel_case_basic() {
        assert_eq!(expand_camel_case("camelCase"), "camel case");
    }

    #[test]
    fn test_expand_camel_case_multi() {
        assert_eq!(
            expand_camel_case("searchContentType"),
            "search content type"
        );
    }

    #[test]
    fn test_expand_camel_case_leading_acronym() {
        assert_eq!(expand_camel_case("XMLParser"), "xml parser");
    }

    #[test]
    fn test_expand_camel_case_short_words_skipped() {
        // Words < 4 chars are skipped entirely
        assert_eq!(expand_camel_case("the"), "");
        assert_eq!(expand_camel_case("is"), "");
    }

    #[test]
    fn test_expand_camel_case_no_splits() {
        // Words that are all lowercase or all uppercase produce < 2 parts → empty
        assert_eq!(expand_camel_case("lowercase"), "");
        assert_eq!(expand_camel_case("ALLCAPS"), "");
    }

    #[test]
    fn test_expand_camel_case_snake_case_passthrough() {
        // Snake case splits on _ but produces single-part words → empty
        assert_eq!(expand_camel_case("already_snake"), "");
    }

    #[test]
    fn test_expand_camel_case_mixed_identifiers() {
        let result = expand_camel_case("parseJSON getHTTPClient");
        assert!(result.contains("parse json"));
        assert!(result.contains("get http client"));
    }

    #[test]
    fn test_expand_camel_case_open_url() {
        assert_eq!(expand_camel_case("openURL"), "open url");
    }

    // ── extract_tool_result tests ───────────────────────────────

    #[test]
    fn test_extract_tool_result_view() {
        let result = serde_json::json!({
            "path": "/src/main.rs",
            "content": "fn main() {\n    println!(\"hello\");\n}"
        });
        let extracted = extract_tool_result("view", &result);
        assert!(extracted.contains("/src/main.rs"));
        assert!(extracted.contains("fn main()"));
    }

    #[test]
    fn test_extract_tool_result_edit() {
        let result = serde_json::json!({
            "path": "/src/lib.rs",
            "old_str": "old code",
            "new_str": "new code"
        });
        let extracted = extract_tool_result("edit", &result);
        assert!(extracted.contains("/src/lib.rs"));
    }

    #[test]
    fn test_extract_tool_result_shell() {
        let result = serde_json::json!({
            "stdout": "test passed\nall good",
            "stderr": "",
            "exit_code": 0
        });
        let extracted = extract_tool_result("powershell", &result);
        assert!(extracted.contains("test passed"));
    }

    #[test]
    fn test_extract_tool_result_grep() {
        let result = serde_json::json!({
            "matches": "src/main.rs:10:fn main() {}\nsrc/lib.rs:5:pub fn init()"
        });
        let extracted = extract_tool_result("grep", &result);
        assert!(!extracted.is_empty());
    }

    #[test]
    fn test_extract_tool_result_generic_fallback() {
        let result = serde_json::json!({"data": "some value", "count": 42});
        let extracted = extract_tool_result("unknown_tool", &result);
        assert!(extracted.contains("some value"));
    }

    // ── flatten_json_with_keys tests ────────────────────────────

    #[test]
    fn test_flatten_json_with_keys_simple() {
        let v = serde_json::json!({"path": "/src/main.rs", "content": "fn main() {}"});
        let text = flatten_json_with_keys(&v);
        assert!(text.contains("path: /src/main.rs"));
        assert!(text.contains("content: fn main() {}"));
    }

    #[test]
    fn test_flatten_json_with_keys_string() {
        let v = serde_json::json!("just a string");
        assert_eq!(flatten_json_with_keys(&v), "just a string");
    }

    #[test]
    fn test_flatten_json_with_keys_null() {
        let v = serde_json::Value::Null;
        assert_eq!(flatten_json_with_keys(&v), "");
    }

    // ── content-shaped results (Copilot and Claude Code) ────────

    #[test]
    fn content_results_are_their_text_without_key_names() {
        use serde_json::json;
        for (tool, result, expected) in [
            // Claude Code writes `{content}`, plus extra fields for shells.
            ("monitor", json!({"content": "Ready."}), "Ready."),
            (
                "ask_user",
                json!({"content": "{\"q1\":\"Ready\"}"}),
                "{\"q1\":\"Ready\"}",
            ),
            (
                "shell",
                json!({"content": "tests ok", "persistedOutputPath": "/tmp/out.txt"}),
                "tests ok",
            ),
            // Copilot writes `{content, detailedContent}`.
            (
                "powershell",
                json!({"content": "PASS", "detailedContent": "PASS"}),
                "PASS",
            ),
            (
                "powershell",
                json!({"content": "PASS", "detailedContent": "PASS\n<exited with exit code 0>"}),
                "PASS\n<exited with exit code 0>",
            ),
            (
                "edit",
                json!({"content": "Edited.", "detailedContent": "@@ -1,1 +1,1 @@\n-old\n+new"}),
                "Edited.\n@@ -1,1 +1,1 @@\n-old\n+new",
            ),
            (
                "grep",
                json!({"content": "src/a.rs:1:ready", "detailedContent": ""}),
                "src/a.rs:1:ready",
            ),
            (
                "web_fetch",
                json!({"content": "", "detailedContent": "page"}),
                "page",
            ),
            // A view's `detailedContent` repeats the file with line numbers.
            (
                "view",
                json!({"content": "fn main() {}", "detailedContent": "1. fn main() {}"}),
                "fn main() {}",
            ),
            (
                "view",
                json!({"content": " ", "detailedContent": "1. fn main() {}"}),
                "1. fn main() {}",
            ),
        ] {
            assert_eq!(
                extract_tool_result(tool, &result),
                expected,
                "{tool}: {result}"
            );
        }
    }

    #[test]
    fn results_without_text_keep_their_key_names() {
        let result = serde_json::json!({"ready": true});
        assert_eq!(extract_tool_result("unknown_tool", &result), "ready: true");
    }

    #[test]
    fn key_names_no_longer_use_up_the_byte_limit() {
        // The generic limit is 400 bytes; "content: " used to take 9 of them.
        let text = format!("{} needle", "x".repeat(EXTRACT_GENERIC_BYTES - 8));
        let result = serde_json::json!({"content": text});
        assert!(extract_tool_result("unknown_tool", &result).ends_with("needle"));
        let shell = serde_json::json!({"content": text, "detailedContent": text});
        assert!(extract_tool_result("bash", &shell).ends_with("needle"));
    }
}
