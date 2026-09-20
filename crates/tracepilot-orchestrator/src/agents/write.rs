//! Create, edit and delete agent definitions safely.
//!
//! Every write validates the target against the known roots, refuses
//! content that no longer parses, backs up the previous file and replaces
//! it atomically. Edits patch only the keys that changed so comments,
//! unknown keys and formatting survive.

use std::path::{Path, PathBuf};

use super::discovery::{AgentRoots, format_of, path_starts_with};
use super::parse::{Field, PROMPT_KEY, ParsedDefinition, parse_definition};
use super::types::{AgentCreateScope, AgentFields, AgentFormat, AgentScope, AgentWriteResult};
use crate::error::{OrchestratorError, Result};
use crate::frontmatter::{
    patch_frontmatter_field, patch_yaml_field, replace_body, split_frontmatter, yaml_block,
    yaml_escape, yaml_list,
};

/// Whether built-in definitions may be written (the Config Injector's
/// advanced mode). Plugin definitions are never writable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuiltinWrites {
    Denied,
    Allowed,
}

/// Validate that `path` is an existing definition TracePilot may modify.
pub fn resolve_mutable(
    roots: &AgentRoots,
    path: &Path,
    builtin: BuiltinWrites,
) -> Result<AgentScope> {
    if format_of(path).is_none() {
        return Err(OrchestratorError::Config(format!(
            "Not an agent definition: {}",
            path.display()
        )));
    }
    let (scope, repo_root) = roots.scope_of(path).ok_or_else(|| {
        OrchestratorError::Config(format!(
            "{} is not inside a known agents directory",
            path.display()
        ))
    })?;
    // A linked custom definition cannot bypass packaged/plugin write policy.
    let target = path.canonicalize()?;
    if path_starts_with(&target, &roots.plugins_dir())
        || (builtin == BuiltinWrites::Denied && path_starts_with(&target, &roots.pkg_dir()))
    {
        return Err(OrchestratorError::Config(
            "The linked definition is read-only.".into(),
        ));
    }
    match scope {
        AgentScope::Plugin => Err(OrchestratorError::Config(
            "Plugin agents are read-only: plugin updates replace local edits.".into(),
        )),
        AgentScope::Builtin if builtin == BuiltinWrites::Denied => Err(OrchestratorError::Config(
            "Built-in agents are read-only. Enable the Config Injector to edit the installed definition."
                .into(),
        )),
        AgentScope::Project => {
            let registered = repo_root.is_some_and(|root| {
                roots
                    .repo_roots
                    .iter()
                    .any(|known| path_starts_with(&root, known) && path_starts_with(known, &root))
            });
            if registered {
                Ok(scope)
            } else {
                Err(OrchestratorError::Config(format!(
                    "{} is not in a registered repository",
                    path.display()
                )))
            }
        }
        _ => Ok(scope),
    }
}

fn read_parsed(path: &Path) -> Result<(String, AgentFormat, ParsedDefinition)> {
    let format = format_of(path).ok_or_else(|| {
        OrchestratorError::Config(format!("Not an agent definition: {}", path.display()))
    })?;
    let content = std::fs::read_to_string(path)?;
    let parsed = parse_definition(&content, format, &path.to_string_lossy());
    Ok((content, format, parsed))
}

/// Render the file content after applying `fields` and `body`, patching
/// only what differs from the current file.
pub fn render_update(path: &Path, fields: &AgentFields, body: &str) -> Result<String> {
    let (content, format, current) = read_parsed(path)?;
    if current.malformed {
        return Err(OrchestratorError::Config(
            "The definition's YAML is invalid; fix it in the raw editor first.".into(),
        ));
    }
    Ok(apply_changes(&content, format, &current, fields, body))
}

pub(crate) fn apply_changes(
    content: &str,
    format: AgentFormat,
    current: &ParsedDefinition,
    fields: &AgentFields,
    body: &str,
) -> String {
    let mut out = if format == AgentFormat::Markdown && split_frontmatter(content).is_none() {
        // Give frontmatter-less files a block to patch into.
        format!("---\n---\n\n{}", content.trim_start())
    } else {
        content.to_string()
    };
    for field in Field::ALL {
        let Some(key) = field.key(format) else {
            continue;
        };
        let (before, after) = (
            field_lines(field, key, &current.fields),
            field_lines(field, key, fields),
        );
        if before == after {
            continue;
        }
        out = match format {
            AgentFormat::Markdown => patch_frontmatter_field(&out, key, after),
            AgentFormat::Yaml => patch_yaml_field(&out, key, after),
        };
    }
    if body.trim_end() != current.body.trim_end() {
        out = match format {
            AgentFormat::Markdown => replace_body(&out, body),
            AgentFormat::Yaml => {
                patch_yaml_field(&out, PROMPT_KEY, Some(yaml_block(PROMPT_KEY, body)))
            }
        };
    }
    out
}

/// The YAML lines for one field, or `None` when the key should be absent.
fn field_lines(field: Field, key: &str, fields: &AgentFields) -> Option<Vec<String>> {
    let text = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(|v| vec![format!("{key}: {}", yaml_escape(v))])
    };
    let flag = |value: Option<bool>| value.map(|v| vec![format!("{key}: {v}")]);
    match field {
        Field::Name => text(&fields.name),
        Field::DisplayName => text(&fields.display_name),
        Field::Description => text(&fields.description),
        Field::ModelPolicy => text(&fields.model_policy),
        Field::ReasoningEffort => text(&fields.reasoning_effort),
        Field::ContextTier => text(&fields.context_tier),
        Field::Model => {
            let models: Vec<String> = fields
                .models
                .iter()
                .map(|m| m.trim().to_string())
                .filter(|m| !m.is_empty())
                .collect();
            match models.as_slice() {
                [] => None,
                [only] => Some(vec![format!("{key}: {}", yaml_escape(only))]),
                _ => Some(yaml_list(key, &models)),
            }
        }
        Field::Tools => fields.tools.as_ref().map(|tools| {
            let tools: Vec<String> = tools
                .iter()
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect();
            yaml_list(key, &tools)
        }),
        Field::IncludeCustomInstructions => flag(fields.include_custom_instructions),
        Field::DeferredToolLoading => flag(fields.deferred_tool_loading),
        Field::DisableModelInvocation => flag(fields.disable_model_invocation),
        Field::UserInvocable => flag(fields.user_invocable),
        Field::Infer => flag(fields.infer),
    }
}

/// Replace `path` with `content` after validating it and backing up the
/// previous version.
fn write_validated(
    path: &Path,
    content: &str,
    backup_dir: &Path,
    label: &str,
) -> Result<AgentWriteResult> {
    let format = format_of(path).unwrap_or(AgentFormat::Markdown);
    let parsed = parse_definition(content, format, &path.to_string_lossy());
    if let Some(error) = parsed.diagnostics.iter().find(|d| d.severity == "error") {
        return Err(OrchestratorError::Config(format!(
            "Not saved: {}",
            error.message
        )));
    }
    let backup = crate::config_injector::create_backup(path, backup_dir, label)?;
    atomic_write_text(path, content)?;
    Ok(AgentWriteResult {
        path: path.to_string_lossy().to_string(),
        backup_path: Some(backup.backup_path),
    })
}

/// Save structured edits.
pub fn save_fields(
    roots: &AgentRoots,
    path: &Path,
    fields: &AgentFields,
    body: &str,
    builtin: BuiltinWrites,
    backup_dir: &Path,
) -> Result<AgentWriteResult> {
    resolve_mutable(roots, path, builtin)?;
    let content = render_update(path, fields, body)?;
    write_validated(path, &content, backup_dir, "pre-edit")
}

/// Save the full file text from the raw editor.
pub fn save_raw(
    roots: &AgentRoots,
    path: &Path,
    content: &str,
    builtin: BuiltinWrites,
    backup_dir: &Path,
) -> Result<AgentWriteResult> {
    resolve_mutable(roots, path, builtin)?;
    write_validated(path, content, backup_dir, "pre-edit")
}

/// Delete a custom agent, keeping a backup.
pub fn delete(roots: &AgentRoots, path: &Path, backup_dir: &Path) -> Result<AgentWriteResult> {
    let scope = resolve_mutable(roots, path, BuiltinWrites::Denied)?;
    if scope == AgentScope::Builtin {
        return Err(OrchestratorError::Config(
            "Built-in agents cannot be deleted.".into(),
        ));
    }
    let backup = crate::config_injector::create_backup(path, backup_dir, "pre-delete")?;
    std::fs::remove_file(path)?;
    Ok(AgentWriteResult {
        path: path.to_string_lossy().to_string(),
        backup_path: Some(backup.backup_path),
    })
}

/// Create `<name>.agent.md` from a template.
pub fn create(
    roots: &AgentRoots,
    scope: AgentCreateScope,
    repo_root: Option<&Path>,
    name: &str,
    description: &str,
) -> Result<AgentWriteResult> {
    let name = name.trim();
    crate::validation::validate_identifier(
        name,
        crate::validation::TEMPLATE_ID_RULES,
        "Agent name",
    )
    .map_err(OrchestratorError::Config)?;
    let dir: PathBuf = match scope {
        AgentCreateScope::Personal => roots.personal_dir(),
        AgentCreateScope::Project => {
            let root = repo_root.ok_or_else(|| {
                OrchestratorError::Config("Choose a repository for a project agent.".into())
            })?;
            if !roots
                .repo_roots
                .iter()
                .any(|known| path_starts_with(root, known) && path_starts_with(known, root))
            {
                return Err(OrchestratorError::Config(format!(
                    "{} is not a registered repository",
                    root.display()
                )));
            }
            tracepilot_core::paths::RepoPaths::from_root(root).github_agents_dir()
        }
    };
    let path = dir.join(format!("{name}.agent.md"));
    if path.exists() {
        return Err(OrchestratorError::Config(format!(
            "An agent named {name} already exists at {}",
            path.display()
        )));
    }
    std::fs::create_dir_all(&dir)?;
    atomic_write_text(&path, &template(name, description))?;
    Ok(AgentWriteResult {
        path: path.to_string_lossy().to_string(),
        backup_path: None,
    })
}

pub(crate) fn template(name: &str, description: &str) -> String {
    let description = description.trim();
    let description = if description.is_empty() {
        "Describe when Copilot should delegate to this agent."
    } else {
        description
    };
    // Only the keys the CLI requires. Model, tools and the rest are added by
    // the Agents editor, so commented-out hints here would linger as noise
    // above the real keys once those are patched in.
    format!(
        "---\n\
         name: {name}\n\
         description: {description}\n\
         ---\n\n\
         You are a focused agent. Describe its role, the steps it follows and what it returns.\n\n\
         ## Instructions\n\n\
         - Keep answers concise and cite file paths.\n",
        name = yaml_escape(name),
        description = yaml_escape(description),
    )
}

/// Write via a sibling temp file and rename over the target.
fn atomic_write_text(path: &Path, content: &str) -> Result<()> {
    // Replace the target atomically without replacing an installed symlink.
    let target = if path.is_symlink() {
        Some(path.canonicalize()?)
    } else {
        None
    };
    let path = target.as_deref().unwrap_or(path);
    let parent = path
        .parent()
        .ok_or_else(|| OrchestratorError::Config("Definition has no parent directory".into()))?;
    let temp = parent.join(format!(
        ".tmp-{}",
        path.file_name().unwrap_or_default().to_string_lossy()
    ));
    std::fs::write(&temp, content)?;
    if let Err(error) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(&temp);
        return Err(error.into());
    }
    Ok(())
}
