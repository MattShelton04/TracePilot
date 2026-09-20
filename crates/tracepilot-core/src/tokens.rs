//! Token estimation and skill-content fingerprinting.
//!
//! The estimate uses a ~4 characters per token heuristic (roughly the average
//! across GPT and Claude tokenizers for English prose). It is deliberately
//! simple: an exact count would need a full tokenizer dependency, and every
//! figure derived from it is labelled as an estimate in the UI.
//!
//! The frontmatter split is lenient on purpose. The same helpers run over
//! SKILL.md files on disk *and* over the content embedded in `skill.invoked`
//! events, and 18 of 162 invocations in a real local corpus carried content
//! with no frontmatter at all (SDK-provided skills). A missing or malformed
//! delimiter yields "all body", never an error.

use sha2::{Digest, Sha256};

/// Estimate the number of LLM tokens consumed by arbitrary text.
///
/// Returns at least 1 for non-empty input.
pub fn estimate_tokens(text: &str) -> u32 {
    if text.is_empty() {
        return 0;
    }
    u32::try_from(text.len().div_ceil(4)).unwrap_or(u32::MAX)
}

/// Split Markdown content into its YAML frontmatter and body.
///
/// Returns `None` for the frontmatter when the content does not open with a
/// `---` delimiter or never closes it; the whole input is then the body.
pub fn split_frontmatter(content: &str) -> (Option<&str>, &str) {
    let trimmed = content.trim_start();
    let Some(after_open) = trimmed.strip_prefix("---") else {
        return (None, content);
    };
    // The closing delimiter must start its own line.
    let Some(close) = after_open.find("\n---") else {
        return (None, content);
    };
    let yaml = after_open[..close].trim();
    let body = after_open[close + 4..]
        .trim_start_matches(['-', '\r'])
        .trim();
    (Some(yaml), body)
}

/// Estimate the tokens a skill costs while it is only advertised (its
/// frontmatter) and the extra it costs once invoked (its instructions).
///
/// Content with no frontmatter is reported as all instructions.
pub fn estimate_skill_token_usage(content: &str) -> (u32, u32) {
    let (frontmatter, body) = split_frontmatter(content);
    (
        frontmatter.map(estimate_tokens).unwrap_or(0),
        estimate_tokens(body),
    )
}

/// Normalise line endings so the same file hashes identically whether it was
/// read from disk on Windows or round-tripped through a session log.
///
/// In a real local corpus two of 91 comparable invocations differed from the
/// installed file by CRLF alone; without this they would read as drifted.
pub fn normalize_newlines(content: &str) -> String {
    content.replace("\r\n", "\n")
}

/// Lower-case hex SHA-256 of the content, with line endings normalised and
/// trailing whitespace trimmed.
pub fn content_fingerprint(content: &str) -> String {
    let normalized = normalize_newlines(content);
    let mut hasher = Sha256::new();
    hasher.update(normalized.trim_end().as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_string_returns_zero() {
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn four_chars_are_one_token() {
        assert_eq!(estimate_tokens("a"), 1);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
    }

    #[test]
    fn frontmatter_splits_into_yaml_and_body() {
        let (yaml, body) =
            split_frontmatter("---\nname: x\ndescription: y\n---\n\n# Title\n\nUse.");
        assert_eq!(yaml, Some("name: x\ndescription: y"));
        assert_eq!(body, "# Title\n\nUse.");
    }

    #[test]
    fn content_without_frontmatter_is_all_body() {
        let (yaml, body) = split_frontmatter("# Title\n\nUse it.");
        assert_eq!(yaml, None);
        assert_eq!(body, "# Title\n\nUse it.");

        let (frontmatter_tokens, instruction_tokens) =
            estimate_skill_token_usage("# Title\n\nUse it.");
        assert_eq!(frontmatter_tokens, 0);
        assert!(instruction_tokens > 0);
    }

    #[test]
    fn unclosed_frontmatter_is_all_body() {
        let (yaml, body) = split_frontmatter("---\nname: x\nstill going");
        assert_eq!(yaml, None);
        assert_eq!(body, "---\nname: x\nstill going");
    }

    #[test]
    fn instruction_estimate_ignores_frontmatter_size() {
        let short = "---\nname: x\ndescription: same\n---\nShort body.";
        let long = format!(
            "---\nname: x\ndescription: same\n---\n{}",
            "Long. ".repeat(500)
        );
        assert_eq!(
            estimate_skill_token_usage(short).0,
            estimate_skill_token_usage(&long).0
        );
        assert!(estimate_skill_token_usage(&long).1 > estimate_skill_token_usage(short).1);
    }

    #[test]
    fn fingerprint_ignores_line_endings_and_trailing_space() {
        let unix = "---\nname: x\n---\nBody.";
        let windows = "---\r\nname: x\r\n---\r\nBody.\r\n";
        assert_eq!(content_fingerprint(unix), content_fingerprint(windows));
        assert_ne!(content_fingerprint(unix), content_fingerprint("Other."));
    }
}
