//! Tool-specific extractors for converting JSON tool results into searchable text.
//!
//! Contains `extract_tool_result` (tool-specific extractors with fallback),
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

/// Flatten a serde_json::Value preserving keys as "key: value" pairs.
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
            if let Some(content) = result.get("content").and_then(|v| v.as_str()) {
                let t = truncate_utf8(content, EXTRACT_VIEW_CONTENT);
                parts.push(t.to_string());
            }
            let joined = parts.join("\n");
            if joined.is_empty() {
                let full = flatten_json_with_keys(result);
                truncate_utf8(&full, EXTRACT_VIEW_PATH_PLUS).to_string()
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
                let full = flatten_json_with_keys(result);
                truncate_utf8(&full, EXTRACT_EDIT_FALLBACK).to_string()
            } else {
                joined
            }
        }
        "powershell" | "bash" | "shell" => {
            if let Some(output) = result.get("output").and_then(|v| v.as_str()) {
                let t = truncate_utf8(output, EXTRACT_SHELL_OUTPUT);
                return t.to_string();
            }
            if let Some(stderr) = result.get("stderr").and_then(|v| v.as_str())
                && !stderr.is_empty() {
                    let t = truncate_utf8(stderr, EXTRACT_SHELL_STDERR);
                    return t.to_string();
                }
            let full = flatten_json_with_keys(result);
            truncate_utf8(&full, EXTRACT_SHELL_FALLBACK).to_string()
        }
        "grep" | "glob" | "github-mcp-server-search_code" => {
            let full = flatten_json_with_keys(result);
            truncate_utf8(&full, EXTRACT_GREP_BYTES).to_string()
        }
        _ => {
            let full = flatten_json_with_keys(result);
            truncate_utf8(&full, EXTRACT_GENERIC_BYTES).to_string()
        }
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
        assert_eq!(expand_camel_case("searchContentType"), "search content type");
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
}
