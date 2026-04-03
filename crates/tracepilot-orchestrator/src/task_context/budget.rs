//! Token/char budget management for context assembly.

/// Priority tier used to order and truncate context sections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    /// Must-have: prompts, output schema (never truncated).
    Required = 0,
    /// Core data: session export, analytics (truncated last).
    Primary = 1,
    /// Supplementary: health, recent sessions (truncated first).
    Supplementary = 2,
}

/// A context section with its content and priority.
#[derive(Debug)]
pub struct BudgetSection {
    pub label: String,
    pub content: String,
    pub priority: Priority,
}

/// Result of applying the budget.
#[derive(Debug)]
#[allow(dead_code)] // Fields used by future context assembly wiring
pub struct BudgetResult {
    pub sections: Vec<BudgetSection>,
    pub truncated: bool,
    pub original_chars: usize,
    pub final_chars: usize,
}

/// Truncate assembled context sections to fit within `max_chars`.
///
/// Truncation strategy:
/// 1. All `Required` sections are kept in full (never truncated).
/// 2. If still over budget, `Supplementary` sections are dropped first.
/// 3. Then `Primary` sections are truncated at line boundaries.
pub fn apply_budget(mut sections: Vec<BudgetSection>, max_chars: usize) -> BudgetResult {
    let original_chars: usize = sections.iter().map(|s| s.content.len()).sum();

    if original_chars <= max_chars {
        return BudgetResult {
            sections,
            truncated: false,
            original_chars,
            final_chars: original_chars,
        };
    }

    // Sort by priority so required comes first.
    sections.sort_by_key(|s| s.priority);

    let required_chars: usize = sections
        .iter()
        .filter(|s| s.priority == Priority::Required)
        .map(|s| s.content.len())
        .sum();

    // If required sections alone exceed budget, keep them all anyway.
    if required_chars >= max_chars {
        sections.retain(|s| s.priority == Priority::Required);
        let final_chars = sections.iter().map(|s| s.content.len()).sum();
        return BudgetResult {
            sections,
            truncated: true,
            original_chars,
            final_chars,
        };
    }

    let mut budget_remaining = max_chars - required_chars;
    let mut result = Vec::new();
    let mut truncated = false;

    for mut section in sections {
        if section.priority == Priority::Required {
            result.push(section);
            continue;
        }

        if budget_remaining == 0 {
            truncated = true;
            continue; // drop section entirely
        }

        if section.content.len() <= budget_remaining {
            budget_remaining -= section.content.len();
            result.push(section);
        } else {
            // Truncate at a line boundary
            let truncated_content = truncate_at_line_boundary(&section.content, budget_remaining);
            budget_remaining = budget_remaining.saturating_sub(truncated_content.len());
            section.content = format!("{}\n\n[... truncated ...]", truncated_content);
            truncated = true;
            result.push(section);
        }
    }

    let final_chars = result.iter().map(|s| s.content.len()).sum();
    BudgetResult {
        sections: result,
        truncated,
        original_chars,
        final_chars,
    }
}

/// Truncate content to at most `max_chars`, cutting at the last newline boundary.
fn truncate_at_line_boundary(content: &str, max_chars: usize) -> String {
    if content.len() <= max_chars {
        return content.to_string();
    }
    let slice = &content[..max_chars];
    match slice.rfind('\n') {
        Some(pos) => slice[..pos].to_string(),
        None => slice.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn section(label: &str, content: &str, priority: Priority) -> BudgetSection {
        BudgetSection {
            label: label.to_string(),
            content: content.to_string(),
            priority,
        }
    }

    #[test]
    fn under_budget_passes_through() {
        let sections = vec![
            section("prompt", "Hello world", Priority::Required),
            section("data", "Some data here", Priority::Primary),
        ];
        let result = apply_budget(sections, 1000);
        assert!(!result.truncated);
        assert_eq!(result.sections.len(), 2);
    }

    #[test]
    fn supplementary_dropped_first() {
        let sections = vec![
            section("prompt", "Required prompt", Priority::Required),
            section("data", "Primary data", Priority::Primary),
            section("extra", "Supplementary info that is quite long and should be dropped", Priority::Supplementary),
        ];
        // Budget fits required + primary but not supplementary
        let result = apply_budget(sections, 50);
        assert!(result.truncated);
        // Supplementary should be dropped or truncated
        let labels: Vec<&str> = result.sections.iter().map(|s| s.label.as_str()).collect();
        assert!(labels.contains(&"prompt"));
        assert!(labels.contains(&"data"));
    }

    #[test]
    fn required_never_dropped() {
        let sections = vec![
            section("prompt", "This required content is 40 chars long!", Priority::Required),
        ];
        let result = apply_budget(sections, 10);
        assert!(result.truncated);
        assert_eq!(result.sections.len(), 1);
        assert_eq!(result.sections[0].label, "prompt");
    }
}
