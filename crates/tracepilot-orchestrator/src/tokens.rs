//! Token estimation utilities shared across MCP and Skills features.
//!
//! Uses a ~4 characters per token heuristic (average across GPT/Claude
//! tokenizers for English text). This is intentionally simple — exact
//! tokenization would require a full tokenizer dependency.

/// Estimate the number of LLM tokens consumed by arbitrary text.
///
/// Uses the widely-accepted heuristic of ~4 characters per token for
/// English text. Returns at least 1 for non-empty input.
pub fn estimate_tokens(text: &str) -> u32 {
    if text.is_empty() {
        return 0;
    }
    (text.len() as f64 / 4.0).ceil() as u32
}

/// Estimate tokens for an MCP tool definition (name + description).
pub fn estimate_tool_tokens(name: &str, description: &str) -> u32 {
    let combined = format!("{} {}", name, description);
    estimate_tokens(&combined)
}

/// Estimate tokens for a SKILL.md file (frontmatter + body).
pub fn estimate_skill_tokens(frontmatter_yaml: &str, body: &str) -> u32 {
    estimate_tokens(frontmatter_yaml) + estimate_tokens(body)
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
    fn skill_tokens_sums_both_parts() {
        let fm = "name: test\ndescription: A test skill";
        let body = "# Test Skill\n\nDo things.";
        let total = estimate_skill_tokens(fm, body);
        assert_eq!(total, estimate_tokens(fm) + estimate_tokens(body));
    }
}
