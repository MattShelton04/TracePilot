//! SKILL.md writer — generates well-formed SKILL.md content.

use crate::skills::types::{SkillAllowedTools, SkillFrontmatter};

/// Generate a complete SKILL.md file from frontmatter and body.
pub fn write_skill_md(frontmatter: &SkillFrontmatter, body: &str) -> String {
    let yaml = generate_frontmatter_yaml(frontmatter);
    if body.trim().is_empty() {
        format!("---\n{yaml}\n---\n")
    } else {
        format!("---\n{yaml}\n---\n\n{body}\n")
    }
}

/// Escape a YAML scalar value — quote if it contains special characters or YAML keywords.
fn yaml_escape(s: &str) -> String {
    if s.is_empty() {
        return "\"\"".to_string();
    }
    let lower = s.to_lowercase();
    let is_yaml_keyword = matches!(
        lower.as_str(),
        "true" | "false" | "yes" | "no" | "on" | "off" | "null" | "~"
    );
    let needs_quoting = is_yaml_keyword
        || s.contains(':')
        || s.contains('#')
        || s.contains('\n')
        || s.contains('"')
        || s.contains('\'')
        || s.starts_with('[')
        || s.starts_with('{')
        || s.starts_with('>')
        || s.starts_with('|')
        || s.starts_with('&')
        || s.starts_with('*')
        || s.starts_with('!')
        || s.starts_with('%')
        || s.starts_with('@')
        || s.starts_with('`')
        || s.contains("---");
    if needs_quoting {
        format!(
            "\"{}\"",
            s.replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n")
        )
    } else {
        s.to_string()
    }
}

/// Patch one top-level scalar while retaining unrelated YAML, comments, and line endings.
pub(crate) fn patch_frontmatter_scalar(content: &str, key: &str, value: &str) -> String {
    patch_frontmatter_field(
        content,
        key,
        Some(vec![format!("{key}: {}", yaml_escape(value))]),
    )
}

fn patch_frontmatter_field(content: &str, key: &str, replacement: Option<Vec<String>>) -> String {
    let newline = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let had_final_newline = content.ends_with('\n');
    let mut lines: Vec<String> = content.lines().map(ToString::to_string).collect();
    let Some(open) = lines
        .iter()
        .position(|line| line.trim().trim_start_matches('\u{feff}') == "---")
    else {
        return content.to_string();
    };
    let Some(close) = lines
        .iter()
        .enumerate()
        .skip(open + 1)
        .find_map(|(index, line)| (line.trim() == "---").then_some(index))
    else {
        return content.to_string();
    };
    let key_prefix = format!("{key}:");
    if let Some(start) = (open + 1..close).find(|index| lines[*index].starts_with(&key_prefix)) {
        let scalar = lines[start]
            .split_once(':')
            .map(|(_, value)| value.trim())
            .unwrap_or_default();
        let mut end = start + 1;
        if scalar.is_empty() || matches!(scalar, ">" | ">-" | ">+" | "|" | "|-" | "|+") {
            while end < close
                && (lines[end].chars().next().is_some_and(char::is_whitespace)
                    || lines[end].is_empty())
            {
                end += 1;
            }
        }
        lines.splice(start..end, replacement.unwrap_or_default());
    } else if let Some(replacement) = replacement {
        lines.splice(close..close, replacement);
    }
    let mut result = lines.join(newline);
    if had_final_newline {
        result.push_str(newline);
    }
    result
}

/// Update supported fields and body while retaining unknown YAML fields and comments.
pub(crate) fn patch_skill_md(content: &str, frontmatter: &SkillFrontmatter, body: &str) -> String {
    let mut updated = patch_frontmatter_scalar(content, "name", &frontmatter.name);
    updated = patch_frontmatter_scalar(&updated, "description", &frontmatter.description);
    updated = patch_frontmatter_field(
        &updated,
        "argument-hint",
        frontmatter
            .argument_hint
            .as_ref()
            .map(|value| vec![format!("argument-hint: {}", yaml_escape(value))]),
    );
    updated = patch_frontmatter_field(
        &updated,
        "allowed-tools",
        frontmatter.allowed_tools.as_ref().map(|value| match value {
            SkillAllowedTools::Text(value) => {
                vec![format!("allowed-tools: {}", yaml_escape(value))]
            }
            SkillAllowedTools::List(values) => {
                let mut lines = vec!["allowed-tools:".to_string()];
                lines.extend(
                    values
                        .iter()
                        .map(|value| format!("  - {}", yaml_escape(value))),
                );
                lines
            }
        }),
    );
    updated = patch_frontmatter_field(
        &updated,
        "user-invocable",
        frontmatter
            .user_invocable
            .map(|value| vec![format!("user-invocable: {value}")]),
    );
    updated = patch_frontmatter_field(
        &updated,
        "disable-model-invocation",
        frontmatter
            .disable_model_invocation
            .map(|value| vec![format!("disable-model-invocation: {value}")]),
    );
    updated = patch_frontmatter_field(
        &updated,
        "resource_globs",
        (!frontmatter.resource_globs.is_empty()).then(|| {
            let mut lines = vec!["resource_globs:".to_string()];
            lines.extend(
                frontmatter
                    .resource_globs
                    .iter()
                    .map(|glob| format!("  - {}", yaml_escape(glob))),
            );
            lines
        }),
    );
    updated = patch_frontmatter_field(
        &updated,
        "auto_attach",
        frontmatter
            .auto_attach
            .then(|| vec!["auto_attach: true".to_string()]),
    );

    let newline = if updated.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let lines: Vec<&str> = updated.lines().collect();
    let Some(open) = lines
        .iter()
        .position(|line| line.trim().trim_start_matches('\u{feff}') == "---")
    else {
        return updated;
    };
    let Some(close) = lines
        .iter()
        .enumerate()
        .skip(open + 1)
        .find_map(|(index, line)| (line.trim() == "---").then_some(index))
    else {
        return updated;
    };
    let header = lines[..=close].join(newline);
    if body.trim().is_empty() {
        format!("{header}{newline}")
    } else {
        format!("{header}{newline}{newline}{}{newline}", body.trim_end())
    }
}

/// Generate the YAML frontmatter string (without delimiters).
fn generate_frontmatter_yaml(fm: &SkillFrontmatter) -> String {
    let mut lines = Vec::new();

    lines.push(format!("name: {}", yaml_escape(&fm.name)));
    lines.push(format!("description: {}", yaml_escape(&fm.description)));

    if let Some(value) = &fm.argument_hint {
        lines.push(format!("argument-hint: {}", yaml_escape(value)));
    }
    if let Some(value) = &fm.allowed_tools {
        match value {
            SkillAllowedTools::Text(value) => {
                lines.push(format!("allowed-tools: {}", yaml_escape(value)));
            }
            SkillAllowedTools::List(values) => {
                lines.push("allowed-tools:".to_string());
                lines.extend(
                    values
                        .iter()
                        .map(|value| format!("  - {}", yaml_escape(value))),
                );
            }
        }
    }
    if fm.user_invocable == Some(false) {
        lines.push("user-invocable: false".to_string());
    }
    if fm.disable_model_invocation == Some(true) {
        lines.push("disable-model-invocation: true".to_string());
    }

    if !fm.resource_globs.is_empty() {
        lines.push("resource_globs:".to_string());
        for glob in &fm.resource_globs {
            lines.push(format!("  - {}", yaml_escape(glob)));
        }
    }

    if fm.auto_attach {
        lines.push("auto_attach: true".to_string());
    }

    lines.join("\n")
}

/// Create a default SKILL.md template for a new skill.
#[allow(dead_code)]
pub fn create_template(name: &str, description: &str) -> String {
    let fm = SkillFrontmatter {
        name: name.to_string(),
        description: description.to_string(),
        argument_hint: None,
        allowed_tools: None,
        user_invocable: None,
        disable_model_invocation: None,
        resource_globs: vec![],
        auto_attach: false,
    };
    let body = format!(
        "This skill guides creation of {description}.\n\n\
        ## Instructions\n\n\
        Add your skill instructions here.\n"
    );
    write_skill_md(&fm, &body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills::parser::parse_skill_md;

    #[test]
    fn round_trip_simple() {
        let fm = SkillFrontmatter {
            name: "test".into(),
            description: "A test".into(),
            argument_hint: None,
            allowed_tools: None,
            user_invocable: None,
            disable_model_invocation: None,
            resource_globs: vec![],
            auto_attach: false,
        };
        let body = "# Test\n\nHello world.";
        let content = write_skill_md(&fm, body);
        let (parsed_fm, parsed_body) = parse_skill_md(&content).unwrap();
        assert_eq!(parsed_fm.name, "test");
        assert!(parsed_body.contains("Hello world"));
    }

    #[test]
    fn round_trip_with_globs() {
        let fm = SkillFrontmatter {
            name: "rust-helper".into(),
            description: "Rust help".into(),
            argument_hint: None,
            allowed_tools: None,
            user_invocable: None,
            disable_model_invocation: None,
            resource_globs: vec!["src/**/*.rs".into(), "Cargo.toml".into()],
            auto_attach: true,
        };
        let content = write_skill_md(&fm, "Body");
        let (parsed_fm, _) = parse_skill_md(&content).unwrap();
        assert_eq!(parsed_fm.resource_globs.len(), 2);
        assert!(parsed_fm.auto_attach);
    }

    #[test]
    fn empty_body_produces_valid_output() {
        let fm = SkillFrontmatter {
            name: "empty".into(),
            description: "Empty body".into(),
            argument_hint: None,
            allowed_tools: None,
            user_invocable: None,
            disable_model_invocation: None,
            resource_globs: vec![],
            auto_attach: false,
        };
        let content = write_skill_md(&fm, "");
        assert!(content.starts_with("---\n"));
        assert!(content.ends_with("---\n"));
    }

    #[test]
    fn template_is_parseable() {
        let content = create_template("my-skill", "helpful things");
        let (fm, body) = parse_skill_md(&content).unwrap();
        assert_eq!(fm.name, "my-skill");
        assert!(body.contains("Instructions"));
    }

    #[test]
    fn auto_attach_false_not_in_yaml() {
        let fm = SkillFrontmatter {
            name: "test".into(),
            description: "desc".into(),
            argument_hint: None,
            allowed_tools: None,
            user_invocable: None,
            disable_model_invocation: None,
            resource_globs: vec![],
            auto_attach: false,
        };
        let yaml = generate_frontmatter_yaml(&fm);
        assert!(!yaml.contains("auto_attach"));
    }

    #[test]
    fn round_trip_special_chars_in_description() {
        let fm = SkillFrontmatter {
            name: "special".into(),
            description: "Handles HTTP: GET and POST requests".into(),
            argument_hint: None,
            allowed_tools: None,
            user_invocable: None,
            disable_model_invocation: None,
            resource_globs: vec![],
            auto_attach: false,
        };
        let content = write_skill_md(&fm, "Body");
        let (parsed_fm, _) = parse_skill_md(&content).unwrap();
        assert_eq!(parsed_fm.description, "Handles HTTP: GET and POST requests");
    }

    #[test]
    fn round_trip_newline_in_description() {
        let fm = SkillFrontmatter {
            name: "multiline".into(),
            description: "Line one\nLine two".into(),
            argument_hint: None,
            allowed_tools: None,
            user_invocable: None,
            disable_model_invocation: None,
            resource_globs: vec![],
            auto_attach: false,
        };
        let content = write_skill_md(&fm, "Body");
        let (parsed_fm, _) = parse_skill_md(&content).unwrap();
        assert_eq!(parsed_fm.description, "Line one\nLine two");
    }

    #[test]
    fn yaml_escape_quotes_special_values() {
        assert_eq!(yaml_escape("simple"), "simple");
        assert_eq!(yaml_escape("has: colon"), "\"has: colon\"");
        assert_eq!(yaml_escape(""), "\"\"");
        assert!(yaml_escape("has\nnewline").starts_with('"'));
    }

    #[test]
    fn yaml_escape_quotes_boolean_keywords() {
        for keyword in &[
            "true", "false", "yes", "no", "on", "off", "null", "True", "False", "YES", "NO", "Null",
        ] {
            let escaped = yaml_escape(keyword);
            assert!(
                escaped.starts_with('"'),
                "'{keyword}' should be quoted but got: {escaped}"
            );
        }
    }

    #[test]
    fn round_trip_yaml_boolean_description() {
        let fm = SkillFrontmatter {
            name: "test-bool".to_string(),
            description: "Yes".to_string(),
            argument_hint: None,
            allowed_tools: None,
            user_invocable: None,
            disable_model_invocation: None,
            resource_globs: vec![],
            auto_attach: false,
        };
        let content = write_skill_md(&fm, "body");
        let (parsed_fm, body) = crate::skills::parser::parse_skill_md(&content).unwrap();
        assert_eq!(parsed_fm.description, "Yes");
        assert_eq!(body, "body");
    }

    #[test]
    fn scalar_patch_preserves_unknown_fields_comments_and_crlf() {
        let input = "\u{feff}---\r\n# keep\r\nname: old\r\nx-vendor: yes\r\n---\r\nBody\r\n";
        let output = patch_frontmatter_scalar(input, "name", "new");
        assert_eq!(
            output,
            "\u{feff}---\r\n# keep\r\nname: new\r\nx-vendor: yes\r\n---\r\nBody\r\n"
        );
    }
}
