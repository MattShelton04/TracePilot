//! SKILL.md writer — generates well-formed SKILL.md content.

use crate::skills::types::SkillFrontmatter;

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
        format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n"))
    } else {
        s.to_string()
    }
}

/// Generate the YAML frontmatter string (without delimiters).
fn generate_frontmatter_yaml(fm: &SkillFrontmatter) -> String {
    let mut lines = Vec::new();

    lines.push(format!("name: {}", yaml_escape(&fm.name)));
    lines.push(format!("description: {}", yaml_escape(&fm.description)));

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
pub fn create_template(name: &str, description: &str) -> String {
    let fm = SkillFrontmatter {
        name: name.to_string(),
        description: description.to_string(),
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
        for keyword in &["true", "false", "yes", "no", "on", "off", "null", "True", "False", "YES", "NO", "Null"] {
            let escaped = yaml_escape(keyword);
            assert!(escaped.starts_with('"'), "'{keyword}' should be quoted but got: {escaped}");
        }
    }

    #[test]
    fn round_trip_yaml_boolean_description() {
        let fm = SkillFrontmatter {
            name: "test-bool".to_string(),
            description: "Yes".to_string(),
            resource_globs: vec![],
            auto_attach: false,
        };
        let content = write_skill_md(&fm, "body");
        let (parsed_fm, body) = crate::skills::parser::parse_skill_md(&content).unwrap();
        assert_eq!(parsed_fm.description, "Yes");
        assert_eq!(body, "body");
    }
}
