//! Line-based YAML patching shared by skill and agent definitions.
//!
//! Definitions are hand-edited files. Re-serialising them through a YAML
//! library would drop comments, reorder keys and rewrite quoting, so edits
//! patch one top-level key at a time and leave every other line, the line
//! endings and any BOM untouched.

/// Quote a YAML scalar when it contains special characters or keywords.
pub(crate) fn yaml_escape(s: &str) -> String {
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
        || s.starts_with('-')
        || s.starts_with(' ')
        || s.ends_with(' ')
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

/// `key: value` lines for a string list, or `key: []` when empty.
pub(crate) fn yaml_list(key: &str, values: &[String]) -> Vec<String> {
    if values.is_empty() {
        return vec![format!("{key}: []")];
    }
    let mut lines = vec![format!("{key}:")];
    lines.extend(
        values
            .iter()
            .map(|value| format!("  - {}", yaml_escape(value))),
    );
    lines
}

/// Literal block scalar (`key: |`) preserving the text's own lines.
pub(crate) fn yaml_block(key: &str, text: &str) -> Vec<String> {
    let mut lines = vec![format!("{key}: |")];
    lines.extend(text.trim_end().lines().map(|line| {
        if line.trim().is_empty() {
            String::new()
        } else {
            format!("  {line}")
        }
    }));
    lines
}

fn newline_of(content: &str) -> &'static str {
    if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

/// Indices of the opening and closing `---` delimiters.
fn frontmatter_bounds(lines: &[String]) -> Option<(usize, usize)> {
    let open = lines
        .iter()
        .position(|line| line.trim().trim_start_matches('\u{feff}') == "---")?;
    let close = lines
        .iter()
        .enumerate()
        .skip(open + 1)
        .find_map(|(index, line)| (line.trim() == "---").then_some(index))?;
    Some((open, close))
}

/// Replace, insert (`Some`) or remove (`None`) one top-level key within
/// `lines[first..end]`. A block value (list, mapping, block scalar) extends
/// over the indented or `- ` lines that follow the key.
fn patch_lines(
    lines: &mut Vec<String>,
    first: usize,
    end: usize,
    key: &str,
    replacement: Option<Vec<String>>,
) {
    let key_prefix = format!("{key}:");
    if let Some(start) = (first..end).find(|index| lines[*index].starts_with(&key_prefix)) {
        let scalar = lines[start]
            .split_once(':')
            .map(|(_, value)| value.trim())
            .unwrap_or_default();
        let mut stop = start + 1;
        if scalar.is_empty() || matches!(scalar, ">" | ">-" | ">+" | "|" | "|-" | "|+") {
            while stop < end
                && (lines[stop].chars().next().is_some_and(char::is_whitespace)
                    || lines[stop].is_empty()
                    || (scalar.is_empty() && lines[stop].starts_with("- ")))
            {
                stop += 1;
            }
            // Blank lines separating the next key stay with the file.
            while stop > start + 1 && lines[stop - 1].trim().is_empty() {
                stop -= 1;
            }
        }
        lines.splice(start..stop, replacement.unwrap_or_default());
    } else if let Some(replacement) = replacement {
        // Insert before trailing blank lines of the block.
        let mut at = end;
        while at > first && lines[at - 1].trim().is_empty() {
            at -= 1;
        }
        lines.splice(at..at, replacement);
    }
}

fn join(lines: &[String], newline: &str, had_final_newline: bool) -> String {
    let mut result = lines.join(newline);
    if had_final_newline {
        result.push_str(newline);
    }
    result
}

/// Patch one top-level key of the `---` delimited frontmatter.
/// Content without frontmatter is returned unchanged.
pub(crate) fn patch_frontmatter_field(
    content: &str,
    key: &str,
    replacement: Option<Vec<String>>,
) -> String {
    let mut lines: Vec<String> = content.lines().map(ToString::to_string).collect();
    let Some((open, close)) = frontmatter_bounds(&lines) else {
        return content.to_string();
    };
    patch_lines(&mut lines, open + 1, close, key, replacement);
    join(&lines, newline_of(content), content.ends_with('\n'))
}

/// Patch one top-level key of a plain YAML document.
pub(crate) fn patch_yaml_field(
    content: &str,
    key: &str,
    replacement: Option<Vec<String>>,
) -> String {
    let mut lines: Vec<String> = content.lines().map(ToString::to_string).collect();
    let end = lines.len();
    patch_lines(&mut lines, 0, end, key, replacement);
    join(&lines, newline_of(content), content.ends_with('\n'))
}

/// Replace the Markdown body that follows the frontmatter.
pub(crate) fn replace_body(content: &str, body: &str) -> String {
    let newline = newline_of(content);
    let lines: Vec<String> = content.lines().map(ToString::to_string).collect();
    let Some((_, close)) = frontmatter_bounds(&lines) else {
        return content.to_string();
    };
    let header = lines[..=close].join(newline);
    if body.trim().is_empty() {
        format!("{header}{newline}")
    } else {
        format!("{header}{newline}{newline}{}{newline}", body.trim_end())
    }
}

/// Split `---` frontmatter from the body. `None` when there is no complete
/// frontmatter block.
pub(crate) fn split_frontmatter(content: &str) -> Option<(String, String)> {
    let trimmed = content.trim_start_matches('\u{feff}').trim_start();
    let after_first = trimmed.strip_prefix("---")?;
    let closing = after_first.find("\n---")?;
    let yaml = after_first[..closing].trim().to_string();
    let rest = &after_first[closing + 4..];
    // Skip the remainder of the delimiter line.
    let body = rest.split_once('\n').map(|(_, body)| body).unwrap_or("");
    Some((yaml, body.trim().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patches_preserve_comments_crlf_and_unknown_keys() {
        let input = "\u{feff}---\r\n# keep\r\nname: old\r\nx-vendor: yes\r\n---\r\nBody\r\n";
        let output = patch_frontmatter_field(input, "name", Some(vec!["name: new".into()]));
        assert_eq!(
            output,
            "\u{feff}---\r\n# keep\r\nname: new\r\nx-vendor: yes\r\n---\r\nBody\r\n"
        );
    }

    #[test]
    fn list_values_are_replaced_including_unindented_items() {
        let input = "---\nname: a\ntools:\n- view\n- grep\nmodel: x\n---\nBody\n";
        let output =
            patch_frontmatter_field(input, "tools", Some(yaml_list("tools", &["bash".into()])));
        assert_eq!(
            output,
            "---\nname: a\ntools:\n  - bash\nmodel: x\n---\nBody\n"
        );
    }

    #[test]
    fn missing_keys_are_inserted_and_none_removes() {
        let input = "---\nname: a\n---\nBody\n";
        let inserted = patch_frontmatter_field(input, "model", Some(vec!["model: gpt".into()]));
        assert_eq!(inserted, "---\nname: a\nmodel: gpt\n---\nBody\n");
        assert_eq!(patch_frontmatter_field(&inserted, "model", None), input);
    }

    #[test]
    fn plain_yaml_documents_patch_block_scalars() {
        let input = "name: explore\nmodel: haiku\nprompt: |\n  line one\n\n  line two\n\ntools:\n  - view\n";
        let output = patch_yaml_field(input, "prompt", Some(yaml_block("prompt", "new\n\nbody")));
        assert_eq!(
            output,
            "name: explore\nmodel: haiku\nprompt: |\n  new\n\n  body\n\ntools:\n  - view\n"
        );
    }

    #[test]
    fn body_replacement_keeps_the_header() {
        let input = "---\nname: a\n---\n\nOld body\n";
        assert_eq!(replace_body(input, "New"), "---\nname: a\n---\n\nNew\n");
        assert_eq!(replace_body(input, "  "), "---\nname: a\n---\n");
    }

    #[test]
    fn split_returns_none_without_frontmatter() {
        assert!(split_frontmatter("# Just markdown").is_none());
        let (yaml, body) = split_frontmatter("---\nname: a\n---\n\nHello").unwrap();
        assert_eq!(yaml, "name: a");
        assert_eq!(body, "Hello");
    }
}
