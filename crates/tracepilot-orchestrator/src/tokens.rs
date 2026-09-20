//! Token estimation utilities shared across MCP and Skills features.
//!
//! The heuristic itself lives in [`tracepilot_core::tokens`], because the
//! indexer estimates the same skill content from session logs and the two
//! figures have to agree.

/// Estimate the number of LLM tokens consumed by arbitrary text.
///
/// Uses the widely-accepted heuristic of ~4 characters per token for
/// English text. Returns at least 1 for non-empty input.
pub fn estimate_tokens(text: &str) -> u32 {
    tracepilot_core::tokens::estimate_tokens(text)
}

/// Estimate tokens for an MCP tool definition (name + description).
pub fn estimate_tool_tokens(name: &str, description: &str) -> u32 {
    let combined = format!("{} {}", name, description);
    estimate_tokens(&combined)
}

/// Estimate tokens for the frontmatter that advertises a skill before invocation.
pub fn estimate_skill_tokens(frontmatter_yaml: &str) -> u32 {
    estimate_tokens(frontmatter_yaml)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_string_returns_zero() {
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn single_char_returns_one() {
        assert_eq!(estimate_tokens("a"), 1);
    }

    #[test]
    fn four_chars_returns_one() {
        assert_eq!(estimate_tokens("abcd"), 1);
    }

    #[test]
    fn five_chars_returns_two() {
        assert_eq!(estimate_tokens("abcde"), 2);
    }

    #[test]
    fn typical_tool_description() {
        // ~100 chars → ~25 tokens
        let desc = "Read the contents of a file from the filesystem given an absolute path";
        let tokens = estimate_tokens(desc);
        assert!(tokens > 15 && tokens < 30, "got {tokens}");
    }

    #[test]
    fn tool_tokens_combines_name_and_description() {
        let tokens = estimate_tool_tokens("read_file", "Read file contents from disk");
        assert!(tokens > 5);
    }

    #[test]
    fn skill_tokens_only_include_frontmatter() {
        let fm = "name: test\ndescription: A test skill";
        let total = estimate_skill_tokens(fm);
        assert_eq!(total, estimate_tokens(fm));
    }
}
