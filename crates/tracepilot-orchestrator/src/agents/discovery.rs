//! Enumerate agent definitions from every source the CLI reads.
//!
//! - Built-in: `definitions/*.yaml` of the active CLI package version.
//! - Personal: `<COPILOT_HOME>/agents/**`.
//! - Project: `<repo>/.github/agents/**` and `<repo>/.claude/agents/**`
//!   for every registered repository (plus an explicit one).
//! - Plugins: `<COPILOT_HOME>/installed-plugins/**/agents/**`.
//!
//! Agents that exist only inside the CLI binary (e.g. `general-purpose`)
//! have no file and are represented from session evidence by the UI.

use std::path::{Path, PathBuf};

use tracepilot_core::paths::{
    AGENTS_DIR_NAME, COPILOT_DEFINITIONS_DIR, CopilotPaths, GITHUB_DIR_NAME, RepoPaths,
};

use super::parse::{ParsedDefinition, file_stem, parse_definition};
use super::types::{
    AgentCatalog, AgentDefinitionDetail, AgentDefinitionSummary, AgentDiagnostic, AgentFormat,
    AgentScope,
};
use crate::error::{OrchestratorError, Result};

/// Definitions larger than this are skipped rather than loaded.
const MAX_DEFINITION_BYTES: u64 = 1024 * 1024;
const MAX_DEPTH: usize = 6;

/// The roots agent definitions are read from.
#[derive(Debug, Clone)]
pub struct AgentRoots {
    pub copilot_home: PathBuf,
    pub repo_roots: Vec<PathBuf>,
}

impl AgentRoots {
    pub fn personal_dir(&self) -> PathBuf {
        CopilotPaths::from_home(&self.copilot_home).global_agents_dir()
    }

    pub fn plugins_dir(&self) -> PathBuf {
        CopilotPaths::from_home(&self.copilot_home).installed_plugins_dir()
    }

    pub fn pkg_dir(&self) -> PathBuf {
        CopilotPaths::from_home(&self.copilot_home).pkg_dir()
    }

    /// Classify a definition path, or `None` when it is outside every root.
    pub(crate) fn scope_of(&self, path: &Path) -> Option<(AgentScope, Option<PathBuf>)> {
        let within = |root: PathBuf| path_starts_with(path, &root);
        if within(self.personal_dir()) {
            return Some((AgentScope::Personal, None));
        }
        if within(self.plugins_dir()) {
            return Some((AgentScope::Plugin, None));
        }
        if within(self.pkg_dir()) {
            let in_definitions = path
                .parent()
                .is_some_and(|dir| dir.ends_with(COPILOT_DEFINITIONS_DIR));
            return in_definitions.then_some((AgentScope::Builtin, None));
        }
        // `<repo>/.github/agents/...` or `<repo>/.claude/agents/...`.
        path.ancestors().find_map(|ancestor| {
            let parent = ancestor.parent()?;
            let is_agents_root = ancestor.ends_with(AGENTS_DIR_NAME)
                && (parent.ends_with(GITHUB_DIR_NAME) || parent.ends_with(".claude"));
            is_agents_root.then(|| (AgentScope::Project, parent.parent().map(Path::to_path_buf)))
        })
    }
}

/// Compare paths after canonicalisation where possible (Windows casing,
/// `\\?\` prefixes and symlinked homes).
pub(crate) fn path_starts_with(path: &Path, root: &Path) -> bool {
    let canonical = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    let (path_c, root_c) = (canonical(path), canonical(root));
    path_c.starts_with(&root_c) || path.starts_with(root)
}

pub(crate) fn format_of(path: &Path) -> Option<AgentFormat> {
    let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
    if name.ends_with(".md") {
        (name != "readme.md").then_some(AgentFormat::Markdown)
    } else if name.ends_with(".yaml") || name.ends_with(".yml") {
        Some(AgentFormat::Yaml)
    } else {
        None
    }
}

/// Discover every definition. Unreadable files become diagnostics.
pub fn discover(roots: &AgentRoots) -> AgentCatalog {
    let mut catalog = AgentCatalog {
        personal_dir: roots.personal_dir().to_string_lossy().to_string(),
        repo_roots: roots
            .repo_roots
            .iter()
            .map(|root| root.to_string_lossy().to_string())
            .collect(),
        ..Default::default()
    };
    let add = |catalog: &mut AgentCatalog, path: PathBuf| match load_definition(roots, &path) {
        Ok(detail) => {
            catalog.diagnostics.extend(
                detail
                    .diagnostics
                    .iter()
                    .filter(|d| d.severity == "error")
                    .cloned(),
            );
            catalog.definitions.push(detail.summary);
        }
        Err(error) => catalog.diagnostics.push(AgentDiagnostic {
            path: path.to_string_lossy().to_string(),
            message: error.to_string(),
            severity: "error".into(),
        }),
    };

    match crate::version_manager::active_version(&roots.copilot_home) {
        Ok(active) => {
            catalog.cli_version = Some(active.version.clone());
            for path in builtin_definition_paths(Path::new(&active.path)) {
                add(&mut catalog, path);
            }
        }
        Err(error) => tracing::debug!("No active Copilot CLI package for built-in agents: {error}"),
    }
    for path in markdown_files(&roots.personal_dir(), false) {
        add(&mut catalog, path);
    }
    for root in &roots.repo_roots {
        let repo = RepoPaths::from_root(root);
        for dir in [repo.github_agents_dir(), repo.claude_agents_dir()] {
            for path in markdown_files(&dir, false) {
                add(&mut catalog, path);
            }
        }
    }
    for path in markdown_files(&roots.plugins_dir(), true) {
        add(&mut catalog, path);
    }

    catalog.definitions.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });
    catalog.definitions.dedup_by(|a, b| a.path == b.path);
    catalog
}

/// Top-level YAML files of a CLI version's `definitions` directory.
pub fn builtin_definition_paths(version_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(version_dir.join(COPILOT_DEFINITIONS_DIR)) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && format_of(path) == Some(AgentFormat::Yaml))
        .collect();
    paths.sort();
    paths
}

/// Markdown definitions under `dir`. With `inside_agents_dir`, only files
/// below a directory named `agents` count (plugin layouts vary).
fn markdown_files(dir: &Path, inside_agents_dir: bool) -> Vec<PathBuf> {
    if !dir.is_dir() {
        return Vec::new();
    }
    let mut paths: Vec<PathBuf> = walkdir::WalkDir::new(dir)
        .follow_links(true)
        .max_depth(MAX_DEPTH)
        .into_iter()
        .filter_entry(|entry| {
            !entry.file_name().to_string_lossy().starts_with('.') || entry.depth() == 0
        })
        .flatten()
        .filter(|entry| entry.file_type().is_file())
        .map(walkdir::DirEntry::into_path)
        .filter(|path| format_of(path) == Some(AgentFormat::Markdown))
        .filter(|path| {
            !inside_agents_dir
                || path
                    .ancestors()
                    .skip(1)
                    .take_while(|ancestor| *ancestor != dir)
                    .any(|ancestor| ancestor.ends_with(AGENTS_DIR_NAME))
        })
        .collect();
    paths.sort();
    paths
}

/// Read and parse one definition at a validated path.
pub fn load_definition(roots: &AgentRoots, path: &Path) -> Result<AgentDefinitionDetail> {
    let format = format_of(path).ok_or_else(|| {
        OrchestratorError::Config(format!("Not an agent definition: {}", path.display()))
    })?;
    let (scope, repo_root) = roots.scope_of(path).ok_or_else(|| {
        OrchestratorError::Config(format!(
            "{} is not inside a known agents directory",
            path.display()
        ))
    })?;
    let metadata = std::fs::metadata(path)?;
    if metadata.len() > MAX_DEFINITION_BYTES {
        return Err(OrchestratorError::Config(format!(
            "{} is larger than 1 MB and was skipped",
            path.display()
        )));
    }
    let raw_content = std::fs::read_to_string(path)?;
    let path_str = path.to_string_lossy().to_string();
    let parsed = parse_definition(&raw_content, format, &path_str);
    let summary = summarize(roots, path, scope, repo_root, format, &parsed, &metadata);
    Ok(AgentDefinitionDetail {
        summary,
        raw_content,
        body: parsed.body,
        other_fields: parsed.other_fields,
        mcp_servers: parsed.mcp_servers,
        diagnostics: parsed.diagnostics,
    })
}

fn summarize(
    roots: &AgentRoots,
    path: &Path,
    scope: AgentScope,
    repo_root: Option<PathBuf>,
    format: AgentFormat,
    parsed: &ParsedDefinition,
    metadata: &std::fs::Metadata,
) -> AgentDefinitionSummary {
    let stem = file_stem(path);
    let fields = parsed.fields.clone();
    let version = || {
        path.parent()
            .and_then(Path::parent)
            .and_then(Path::file_name)
            .map(|v| v.to_string_lossy().to_string())
            .unwrap_or_default()
    };
    let source_label = match scope {
        AgentScope::Builtin => format!("Copilot CLI {}", version()),
        AgentScope::Personal => "Personal".to_string(),
        AgentScope::Project => repo_root
            .as_deref()
            .and_then(Path::file_name)
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "Project".to_string()),
        AgentScope::Plugin => path
            .strip_prefix(roots.plugins_dir())
            .ok()
            .and_then(|rest| rest.components().next())
            .map(|first| first.as_os_str().to_string_lossy().to_string())
            .unwrap_or_else(|| "Plugin".to_string()),
    };
    let read_only_reason = match scope {
        // The version itself is in `source_label`, which the editor shows
        // once; repeating it here read as noise.
        AgentScope::Builtin => Some(
            "Installed with the Copilot CLI. A CLI update replaces this file, so override it for your sessions instead."
                .to_string(),
        ),
        AgentScope::Plugin => {
            Some("Managed by its plugin. Plugin updates replace local edits.".to_string())
        }
        _ => None,
    };
    AgentDefinitionSummary {
        id: path.to_string_lossy().to_string(),
        name: fields
            .name
            .clone()
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| stem.clone()),
        file_stem: stem,
        display_name: fields.display_name.clone(),
        description: fields.description.clone().unwrap_or_default(),
        scope,
        format,
        path: path.to_string_lossy().to_string(),
        source_label,
        repo_root: repo_root.map(|root| root.to_string_lossy().to_string()),
        has_mcp_servers: parsed.mcp_servers.is_some(),
        fields,
        read_only_reason,
        modified_at: metadata
            .modified()
            .ok()
            .map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339()),
    }
}
