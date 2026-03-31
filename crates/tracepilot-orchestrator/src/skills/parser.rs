//! SKILL.md frontmatter parser.
//!
//! Parses the YAML frontmatter from SKILL.md files, which uses the
//! standard `---` delimited format.

use crate::skills::error::SkillsError;
use crate::skills::types::SkillFrontmatter;

/// Parse a SKILL.md file into frontmatter and body.
///
/// Expected format:
/// ```text
/// ---
/// name: my-skill
/// description: Does things
/// ---
///
/// # My Skill
///
/// Instructions here...
/// ```
pub fn parse_skill_md(content: &str) -> Result<(SkillFrontmatter, String), SkillsError> {
    let (yaml_str, body) = split_frontmatter(content)?;
    let frontmatter: SkillFrontmatter = serde_yml::from_str(&yaml_str).map_err(|e| {
        SkillsError::FrontmatterParse(format!("Invalid frontmatter YAML: {e}"))
    })?;

    validate_frontmatter(&frontmatter)?;

    Ok((frontmatter, body))
}

/// Split content into frontmatter YAML and body markdown.
fn split_frontmatter(content: &str) -> Result<(String, String), SkillsError> {
    let trimmed = content.trim_start();

    if !trimmed.starts_with("---") {
        return Err(SkillsError::FrontmatterParse(
            "SKILL.md must start with '---' frontmatter delimiter".into(),
        ));
    }

    // Find the closing ---
    let after_first = &trimmed[3..];
    let closing_pos = after_first.find("\n---").ok_or_else(|| {
        SkillsError::FrontmatterParse("Missing closing '---' frontmatter delimiter".into())
    })?;

    let yaml = after_first[..closing_pos].trim().to_string();
    let body_start = closing_pos + 4; // skip "\n---"
    let body = if body_start < after_first.len() {
        after_first[body_start..].trim().to_string()
    } else {
        String::new()
    };

    Ok((yaml, body))
}

/// Validate that required frontmatter fields are present and valid.
fn validate_frontmatter(fm: &SkillFrontmatter) -> Result<(), SkillsError> {
    if fm.name.trim().is_empty() {
        return Err(SkillsError::FrontmatterValidation(
            "'name' is required and cannot be empty".into(),
        ));
    }
    // Validate name format: lowercase kebab-case with alphanumeric and hyphens
    if !fm.name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(SkillsError::FrontmatterValidation(
            "'name' must contain only alphanumeric characters, hyphens, and underscores".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_skill_md() {
        let content = r#"---
name: test-skill
description: A test skill for testing
---

# Test Skill

This is the body of the skill."#;

        let (fm, body) = parse_skill_md(content).unwrap();
        assert_eq!(fm.name, "test-skill");
        assert_eq!(fm.description, "A test skill for testing");
        assert!(body.contains("# Test Skill"));
        assert!(body.contains("body of the skill"));
    }

    #[test]
    fn parse_with_resource_globs() {
        let content = r#"---
name: rust-helper
description: Helps with Rust
resource_globs:
  - "src/**/*.rs"
  - "Cargo.toml"
auto_attach: true
---

Help with Rust code."#;

        let (fm, _body) = parse_skill_md(content).unwrap();
        assert_eq!(fm.resource_globs, vec!["src/**/*.rs", "Cargo.toml"]);
        assert!(fm.auto_attach);
    }

    #[test]
    fn parse_minimal_frontmatter() {
        let content = "---\nname: minimal\ndescription: Min\n---\n\nBody.";
        let (fm, body) = parse_skill_md(content).unwrap();
        assert_eq!(fm.name, "minimal");
        assert_eq!(body, "Body.");
    }

    #[test]
    fn missing_opening_delimiter() {
        let content = "name: bad\ndescription: No delimiters\n---\nBody.";
        assert!(parse_skill_md(content).is_err());
    }

    #[test]
    fn missing_closing_delimiter() {
        let content = "---\nname: bad\ndescription: No closing";
        assert!(parse_skill_md(content).is_err());
    }

    #[test]
    fn empty_name_fails_validation() {
        let content = "---\nname: \"\"\ndescription: Has desc\n---\nBody.";
        let result = parse_skill_md(content);
        assert!(result.is_err());
    }

    #[test]
    fn empty_description_is_allowed() {
        let content = "---\nname: valid-name\ndescription: \"\"\n---\nBody.";
        let (fm, body) = parse_skill_md(content).unwrap();
        assert_eq!(fm.name, "valid-name");
        assert!(fm.description.is_empty());
        assert_eq!(body, "Body.");
    }

    #[test]
    fn invalid_name_chars_fail() {
        let content = "---\nname: \"invalid name!\"\ndescription: Has spaces\n---\nBody.";
        let result = parse_skill_md(content);
        assert!(result.is_err());
    }

    #[test]
    fn underscore_in_name_ok() {
        let content = "---\nname: my_skill\ndescription: Valid\n---\nBody.";
        let (fm, _) = parse_skill_md(content).unwrap();
        assert_eq!(fm.name, "my_skill");
    }

    #[test]
    fn empty_body_is_ok() {
        let content = "---\nname: no-body\ndescription: No body content\n---";
        let (fm, body) = parse_skill_md(content).unwrap();
        assert_eq!(fm.name, "no-body");
        assert!(body.is_empty());
    }

    #[test]
    fn leading_whitespace_is_trimmed() {
        let content = "\n\n---\nname: trimmed\ndescription: Works\n---\nBody.";
        let (fm, _) = parse_skill_md(content).unwrap();
        assert_eq!(fm.name, "trimmed");
    }

    #[test]
    fn parse_single_quoted_description() {
        let content = "---\nname: test-skill\ndescription: 'This is a single-quoted description with colons: and stuff'\n---\n\nBody.\n";
        let (fm, body) = parse_skill_md(content).unwrap();
        assert_eq!(fm.description, "This is a single-quoted description with colons: and stuff");
        assert_eq!(body, "Body.");
    }

    #[test]
    fn parse_long_description() {
        let content = "---\nname: test-skill\ndescription: 'Add educational comments to the file specified, or prompt asking for file to comment if one is not provided.'\n---\n\nBody.\n";
        let (fm, _) = parse_skill_md(content).unwrap();
        assert!(fm.description.contains("educational comments"));
    }

    #[test]
    fn parse_description_with_special_yaml_chars() {
        let content = "---\nname: test-skill\ndescription: \"Description with: colons and #hashes\"\n---\n\nBody.\n";
        let (fm, _) = parse_skill_md(content).unwrap();
        assert!(fm.description.contains("colons"));
    }

    #[test]
    fn parse_block_scalar_description() {
        let content = "---\nname: test-skill\ndescription: >\n  A multi-line folded\n  description here.\n---\n\nBody.\n";
        let (fm, _) = parse_skill_md(content).unwrap();
        assert!(fm.description.contains("multi-line"));
    }

    #[test]
    fn parse_with_allowed_tools_unknown_field() {
        // Unquoted value exactly as real SKILL.md files use
        let content = "---\nname: playwright-cli\ndescription: Automates browser interactions for web testing, form filling, screenshots, and data extraction. Use when the user needs to navigate websites, interact with web pages, fill forms, take screenshots, test web applications, or extract information from web pages.\nallowed-tools: Bash(playwright-cli:*)\n---\n\nThis skill guides creation.\n";
        let result = parse_skill_md(content);
        assert!(result.is_ok(), "Failed to parse: {:?}", result.err());
        let (fm, body) = result.unwrap();
        assert_eq!(fm.name, "playwright-cli");
        assert!(fm.description.contains("browser interactions"));
        assert!(body.contains("This skill"));
    }
}
