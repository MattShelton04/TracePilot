//! Context assembler: builds the complete `context.md` for a task.
//!
//! Takes a preset, runtime parameters, and assembled source data, applies the
//! character budget, and renders the final markdown context file.

use crate::error::{OrchestratorError, Result};
use crate::presets::types::TaskPreset;
use crate::task_context::budget::{self, BudgetSection, Priority};
use crate::task_context::sources;
use sha2::{Digest, Sha256};
use std::path::Path;

/// Result of assembling context for a single task.
#[derive(Debug)]
pub struct AssembledContext {
    /// Full rendered context.md content.
    pub content: String,
    /// Which sources were included in the assembly.
    pub sources_included: Vec<String>,
    /// Whether any sections were truncated to fit the budget.
    pub truncated: bool,
    /// Total character count.
    pub char_count: usize,
    /// SHA-256 hash of the content (for dedup/caching).
    pub context_hash: String,
}

/// Assemble all context for a task based on its preset and input parameters.
///
/// - `preset`: The task preset defining prompts, sources, and output schema.
/// - `input_params`: Runtime values (e.g. `{"session_id": "abc-123"}`).
/// - `data_dir`: The session-state root directory.
/// - `max_chars`: Character budget for the entire context file.
/// - `result_file_path`: Absolute path where the subagent should write results.
pub fn assemble_task_context(
    preset: &TaskPreset,
    input_params: &serde_json::Value,
    data_dir: &Path,
    max_chars: usize,
    result_file_path: &str,
) -> Result<AssembledContext> {
    let mut sections = Vec::new();

    // 1. Render system prompt (Required priority)
    let system_prompt = render_prompt_template(&preset.prompt.system, input_params);
    sections.push(BudgetSection {
        label: "System Prompt".to_string(),
        content: system_prompt,
        priority: Priority::Required,
    });

    // 2. Render user prompt / instructions (Required priority)
    let user_prompt = render_prompt_template(&preset.prompt.user, input_params);
    sections.push(BudgetSection {
        label: "Instructions".to_string(),
        content: user_prompt,
        priority: Priority::Required,
    });

    // 3. Assemble each context source
    let mut sources_included = Vec::new();
    for source in &preset.context.sources {
        match sources::assemble_source(source, input_params, data_dir) {
            Ok(content) => {
                if content.is_empty() {
                    continue;
                }
                let priority = if source.required {
                    Priority::Primary
                } else {
                    Priority::Supplementary
                };
                sources_included.push(source.id.clone());
                sections.push(BudgetSection {
                    label: source.label.clone().unwrap_or_else(|| source.id.clone()),
                    content,
                    priority,
                });
            }
            Err(e) => {
                if source.required {
                    return Err(OrchestratorError::Task(format!(
                        "Required context source '{}' failed: {}",
                        source.id, e
                    )));
                }
                tracing::warn!(
                    source_id = %source.id,
                    error = %e,
                    "Optional context source failed, skipping"
                );
            }
        }
    }

    // 4. Output schema section (Required priority)
    if !preset.output.schema.is_null() {
        let schema_text: String =
            serde_json::to_string_pretty(&preset.output.schema)
                .unwrap_or_else(|_| preset.output.schema.to_string());
        sections.push(BudgetSection {
            label: "Output Schema".to_string(),
            content: schema_text,
            priority: Priority::Required,
        });
    }

    // 5. Apply budget
    let budget_result = budget::apply_budget(sections, max_chars);

    // 6. Render final markdown
    let content = render_context_markdown(
        &budget_result.sections,
        &preset.id,
        result_file_path,
    );

    // 7. Compute hash
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let context_hash = format!("{:x}", hasher.finalize());

    Ok(AssembledContext {
        char_count: content.len(),
        content,
        sources_included,
        truncated: budget_result.truncated,
        context_hash,
    })
}

/// Replace `{{variable}}` placeholders in a prompt template with values from params.
fn render_prompt_template(template: &str, params: &serde_json::Value) -> String {
    let mut result = template.to_string();
    if let Some(obj) = params.as_object() {
        for (key, value) in obj {
            let placeholder = format!("{{{{{}}}}}", key);
            let replacement = match value {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            result = result.replace(&placeholder, &replacement);
        }
    }
    result
}

/// Render the final context.md from assembled sections.
fn render_context_markdown(
    sections: &[BudgetSection],
    preset_id: &str,
    result_file_path: &str,
) -> String {
    let mut parts = Vec::new();
    parts.push(format!("# Task: {}\n", preset_id));

    for section in sections {
        match section.label.as_str() {
            "System Prompt" => {
                parts.push(format!("## System Prompt\n\n{}\n", section.content));
            }
            "Instructions" => {
                parts.push(format!("## Instructions\n\n{}\n", section.content));
            }
            "Output Schema" => {
                parts.push(format!(
                    "## Output Schema\n\n```json\n{}\n```\n",
                    section.content
                ));
            }
            _ => {
                parts.push(format!("## {}\n\n{}\n", section.label, section.content));
            }
        }
    }

    // Output format instructions
    parts.push(format!(
        "## Output Format\n\n\
         Return your result as valid JSON matching the Output Schema above.\n\
         Write the JSON to the result file at: `{}`\n\
         Use atomic write: write to `.tmp` then rename.\n",
        result_file_path
    ));

    parts.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::presets::types::*;

    fn make_simple_preset() -> TaskPreset {
        TaskPreset {
            id: "test-preset".to_string(),
            name: "Test Preset".to_string(),
            description: "A test preset".to_string(),
            version: 1,
            prompt: PresetPrompt {
                system: "You are a test assistant for session {{session_id}}.".to_string(),
                user: "Summarise session {{session_id}}.".to_string(),
                variables: vec![],
            },
            context: PresetContext {
                sources: vec![],
                max_chars: 100_000,
                format: ContextFormat::Markdown,
            },
            output: PresetOutput {
                schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "summary": { "type": "string" }
                    }
                }),
                format: OutputFormat::Json,
                validation: ValidationMode::Warn,
            },
            execution: PresetExecution::default(),
            tags: vec![],
            enabled: true,
            builtin: false,
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: "2025-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn renders_simple_context() {
        let preset = make_simple_preset();
        let params = serde_json::json!({ "session_id": "abc-123" });
        let result = assemble_task_context(
            &preset,
            &params,
            Path::new("/tmp"),
            100_000,
            "/tmp/result.json",
        )
        .unwrap();

        assert!(result.content.contains("# Task: test-preset"));
        assert!(result.content.contains("session abc-123"));
        assert!(result.content.contains("Summarise session abc-123"));
        assert!(result.content.contains("Output Schema"));
        assert!(result.content.contains("Output Format"));
        assert!(!result.context_hash.is_empty());
    }

    #[test]
    fn variable_interpolation_works() {
        let template = "Hello {{name}}, session {{session_id}} is ready.";
        let params = serde_json::json!({ "name": "TracePilot", "session_id": "xyz" });
        let rendered = render_prompt_template(template, &params);
        assert_eq!(rendered, "Hello TracePilot, session xyz is ready.");
    }
}
