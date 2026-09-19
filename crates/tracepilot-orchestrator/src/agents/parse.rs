//! Lenient parsing of built-in YAML and custom Markdown agent definitions.
//!
//! Keys observed in Copilot CLI 1.0.79–1.0.86 (frontmatter spelling first):
//! `name`, `description`, `tools`, `model` (a string, or a fallback list
//! since 1.0.83), `model-policy`, `reasoning-effort`, `context-tier`,
//! `include-custom-instructions`, `deferred-tool-loading`,
//! `disable-model-invocation`, `user-invocable`, `infer` and `mcp-servers`.
//! Built-in YAML uses camelCase (`displayName`, `reasoningEffort`) and keeps
//! the prompt in `prompt`. Anything else is preserved and shown read-only.

use serde_norway::Value;

use super::types::{AgentDiagnostic, AgentFields, AgentFormat, AgentOtherField};
use crate::frontmatter::split_frontmatter;

/// An editable field and its key in each format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Field {
    Name,
    DisplayName,
    Description,
    Model,
    ModelPolicy,
    ReasoningEffort,
    ContextTier,
    Tools,
    IncludeCustomInstructions,
    DeferredToolLoading,
    DisableModelInvocation,
    UserInvocable,
    Infer,
}

impl Field {
    pub(crate) const ALL: [Field; 13] = [
        Field::Name,
        Field::DisplayName,
        Field::Description,
        Field::Model,
        Field::ModelPolicy,
        Field::ReasoningEffort,
        Field::ContextTier,
        Field::Tools,
        Field::IncludeCustomInstructions,
        Field::DeferredToolLoading,
        Field::DisableModelInvocation,
        Field::UserInvocable,
        Field::Infer,
    ];

    /// The key for this field, or `None` when the format has no such key.
    pub(crate) fn key(self, format: AgentFormat) -> Option<&'static str> {
        use AgentFormat::{Markdown, Yaml};
        Some(match (self, format) {
            (Field::Name, _) => "name",
            (Field::DisplayName, Yaml) => "displayName",
            (Field::DisplayName, Markdown) => return None,
            (Field::Description, _) => "description",
            (Field::Model, _) => "model",
            (Field::ModelPolicy, Markdown) => "model-policy",
            (Field::ModelPolicy, Yaml) => "modelPolicy",
            (Field::ReasoningEffort, Markdown) => "reasoning-effort",
            (Field::ReasoningEffort, Yaml) => "reasoningEffort",
            (Field::ContextTier, Markdown) => "context-tier",
            (Field::ContextTier, Yaml) => "contextTier",
            (Field::Tools, _) => "tools",
            (Field::IncludeCustomInstructions, Markdown) => "include-custom-instructions",
            (Field::DeferredToolLoading, Markdown) => "deferred-tool-loading",
            (Field::DeferredToolLoading, Yaml) => "deferredToolLoading",
            (Field::DisableModelInvocation, Markdown) => "disable-model-invocation",
            (Field::UserInvocable, Markdown) => "user-invocable",
            (Field::Infer, Markdown) => "infer",
            (
                Field::IncludeCustomInstructions
                | Field::DisableModelInvocation
                | Field::UserInvocable
                | Field::Infer,
                Yaml,
            ) => return None,
        })
    }
}

pub(crate) fn mcp_key(format: AgentFormat) -> &'static str {
    match format {
        AgentFormat::Markdown => "mcp-servers",
        AgentFormat::Yaml => "mcpServers",
    }
}

/// YAML key holding a built-in agent's prompt.
pub(crate) const PROMPT_KEY: &str = "prompt";

/// Parsed content of one definition file.
#[derive(Debug, Clone, Default)]
pub(crate) struct ParsedDefinition {
    pub fields: AgentFields,
    pub body: String,
    pub other_fields: Vec<AgentOtherField>,
    pub mcp_servers: Option<serde_json::Value>,
    pub diagnostics: Vec<AgentDiagnostic>,
    /// The frontmatter/YAML could not be read; fields are empty.
    pub malformed: bool,
}

struct Diagnostics<'a> {
    path: &'a str,
    items: Vec<AgentDiagnostic>,
}

impl Diagnostics<'_> {
    fn push(&mut self, severity: &str, message: impl Into<String>) {
        self.items.push(AgentDiagnostic {
            path: self.path.to_string(),
            message: message.into(),
            severity: severity.to_string(),
        });
    }
}

/// Parse a definition. Never fails: problems become diagnostics.
pub(crate) fn parse_definition(content: &str, format: AgentFormat, path: &str) -> ParsedDefinition {
    let mut diagnostics = Diagnostics {
        path,
        items: Vec::new(),
    };
    let (yaml, body) = match format {
        AgentFormat::Yaml => (content.to_string(), None),
        AgentFormat::Markdown => match split_frontmatter(content) {
            Some((yaml, body)) => (yaml, Some(body)),
            None if content
                .trim_start_matches('\u{feff}')
                .trim_start()
                .starts_with("---") =>
            {
                diagnostics.push("error", "The frontmatter has no closing '---' line.");
                return ParsedDefinition {
                    body: content.to_string(),
                    diagnostics: diagnostics.items,
                    malformed: true,
                    ..Default::default()
                };
            }
            None => {
                diagnostics.push(
                    "warning",
                    "No YAML frontmatter: add a description so Copilot knows when to use this agent.",
                );
                return ParsedDefinition {
                    body: content.trim().to_string(),
                    diagnostics: diagnostics.items,
                    ..Default::default()
                };
            }
        },
    };

    let value: Value = if yaml.trim().is_empty() {
        Value::Mapping(Default::default())
    } else {
        match serde_norway::from_str(&yaml) {
            Ok(value) => value,
            Err(error) => {
                diagnostics.push("error", format!("Invalid YAML: {error}"));
                return ParsedDefinition {
                    body: body.unwrap_or_default(),
                    diagnostics: diagnostics.items,
                    malformed: true,
                    ..Default::default()
                };
            }
        }
    };
    let Some(map) = value.as_mapping() else {
        diagnostics.push(
            "error",
            "The definition must be a YAML mapping of keys to values.",
        );
        return ParsedDefinition {
            body: body.unwrap_or_default(),
            diagnostics: diagnostics.items,
            malformed: true,
            ..Default::default()
        };
    };

    let get = |field: Field| field.key(format).and_then(|key| map.get(key));
    let mut fields = AgentFields::default();
    for field in Field::ALL {
        let Some(value) = get(field) else {
            continue;
        };
        let key = field.key(format).unwrap_or_default();
        let ok = match field {
            Field::Model => read_string_list(value).map(|models| fields.models = models),
            Field::Tools => read_tools(value).map(|tools| fields.tools = Some(tools)),
            Field::IncludeCustomInstructions
            | Field::DeferredToolLoading
            | Field::DisableModelInvocation
            | Field::UserInvocable
            | Field::Infer => {
                read_bool(value).map(|flag| *bool_slot(&mut fields, field) = Some(flag))
            }
            _ => read_string(value).map(|text| *string_slot(&mut fields, field) = Some(text)),
        };
        if ok.is_none() && !value.is_null() {
            let expected = match field {
                Field::Model => "a string or a list of strings",
                Field::Tools => "a list of tool names",
                Field::IncludeCustomInstructions
                | Field::DeferredToolLoading
                | Field::DisableModelInvocation
                | Field::UserInvocable
                | Field::Infer => "true or false",
                _ => "a string",
            };
            diagnostics.push("warning", format!("`{key}` should be {expected}."));
        }
    }

    let known: Vec<&str> = Field::ALL
        .iter()
        .filter_map(|field| field.key(format))
        .chain([mcp_key(format), PROMPT_KEY])
        .collect();
    let other_fields = map
        .iter()
        .filter_map(|(key, value)| {
            let key = key.as_str()?;
            (!known.contains(&key)).then(|| AgentOtherField {
                key: key.to_string(),
                value: display_value(value),
            })
        })
        .collect();

    let body = match format {
        AgentFormat::Markdown => body.unwrap_or_default(),
        AgentFormat::Yaml => map
            .get(PROMPT_KEY)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim_end()
            .to_string(),
    };

    if format == AgentFormat::Markdown
        && fields
            .description
            .as_deref()
            .is_none_or(|d| d.trim().is_empty())
    {
        diagnostics.push(
            "warning",
            "Add a description so Copilot knows when to delegate to this agent.",
        );
    }
    if fields.model_policy.as_deref() == Some("required") && fields.models.is_empty() {
        diagnostics.push(
            "warning",
            "`model-policy: required` has no effect without a model.",
        );
    }

    ParsedDefinition {
        fields,
        body,
        other_fields,
        mcp_servers: map
            .get(mcp_key(format))
            .and_then(|value| serde_json::to_value(value).ok()),
        diagnostics: diagnostics.items,
        malformed: false,
    }
}

fn string_slot(fields: &mut AgentFields, field: Field) -> &mut Option<String> {
    match field {
        Field::Name => &mut fields.name,
        Field::DisplayName => &mut fields.display_name,
        Field::Description => &mut fields.description,
        Field::ModelPolicy => &mut fields.model_policy,
        Field::ReasoningEffort => &mut fields.reasoning_effort,
        _ => &mut fields.context_tier,
    }
}

fn bool_slot(fields: &mut AgentFields, field: Field) -> &mut Option<bool> {
    match field {
        Field::IncludeCustomInstructions => &mut fields.include_custom_instructions,
        Field::DeferredToolLoading => &mut fields.deferred_tool_loading,
        Field::DisableModelInvocation => &mut fields.disable_model_invocation,
        Field::UserInvocable => &mut fields.user_invocable,
        _ => &mut fields.infer,
    }
}

fn read_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.trim().to_string()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

fn read_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(flag) => Some(*flag),
        Value::String(text) => match text.trim().to_ascii_lowercase().as_str() {
            "true" | "yes" => Some(true),
            "false" | "no" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn read_string_list(value: &Value) -> Option<Vec<String>> {
    match value {
        Value::String(text) => Some(
            Some(text.trim().to_string())
                .filter(|t| !t.is_empty())
                .into_iter()
                .collect(),
        ),
        Value::Sequence(items) => items
            .iter()
            .map(|item| item.as_str().map(|s| s.trim().to_string()))
            .collect(),
        _ => None,
    }
}

/// Tools are a list of names (built-ins may use `{name: ...}` entries), or
/// a comma-separated string.
fn read_tools(value: &Value) -> Option<Vec<String>> {
    match value {
        Value::String(text) => Some(
            text.split(',')
                .map(str::trim)
                .filter(|tool| !tool.is_empty())
                .map(String::from)
                .collect(),
        ),
        Value::Sequence(items) => items
            .iter()
            .map(|item| {
                item.as_str()
                    .or_else(|| item.get("name").and_then(Value::as_str))
                    .map(String::from)
            })
            .collect(),
        _ => None,
    }
}

fn display_value(value: &Value) -> String {
    let text = match value {
        Value::String(text) => text.clone(),
        other => serde_json::to_string(other).unwrap_or_default(),
    };
    tracepilot_core::utils::truncate_utf8_with_marker(&text, 200, Some("…"))
}

/// File stem without `.md` / `.yaml` and a trailing `.agent`.
pub(crate) fn file_stem(path: &std::path::Path) -> String {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let lower = name.to_ascii_lowercase();
    let stem_len = [
        ".agent.md",
        ".agent.yaml",
        ".agent.yml",
        ".md",
        ".yaml",
        ".yml",
    ]
    .iter()
    .find(|suffix| lower.ends_with(*suffix))
    .map(|suffix| name.len() - suffix.len())
    .unwrap_or(name.len());
    name[..stem_len].to_string()
}
