//! Skill discovery — scans filesystem for SKILL.md files.
//!
//! Discovers skills in:
//! - Personal skills under the Copilot home, `~/.agents/skills` and
//!   `COPILOT_SKILLS_DIRS`
//! - Built-in skills bundled with the installed CLI, wherever it was installed
//!   to (see [`tracepilot_core::paths::cli_install`])
//! - Repository skills under supported repo-scoped skill roots
//!
//! Every root is scanned independently. A root that is missing, unreadable or
//! not a directory becomes a diagnostic, never an error, so one broken
//! location — most often a half-extracted CLI package — cannot hide the skills
//! the user does have.

use crate::skills::error::SkillsError;
use crate::skills::parser::parse_skill_md;
use crate::skills::types::{
    Skill, SkillDiagnostic, SkillDiscoveryResult, SkillScope, SkillSummary,
};
use semver::Version;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tracepilot_core::paths::cli_install::{self, DistRoot};
use tracepilot_core::paths::path_is_allowed_by_isolation;

/// Shown when no CLI installation can be found anywhere on disk.
pub const MISSING_CLI_NOTE: &str = "No Copilot CLI installation was found, so its built-in skills are not listed. Set COPILOT_CLI_DIST_DIR to the CLI bundle directory if it is installed somewhere else.";

fn copilot_paths() -> crate::error::Result<tracepilot_core::paths::CopilotPaths> {
    tracepilot_core::paths::CopilotPaths::try_default()
        .ok_or_else(|| crate::error::OrchestratorError::Config("Home directory not found".into()))
}

/// Get the global skills directory (`~/.copilot/skills/`).
pub fn global_skills_dir() -> crate::error::Result<PathBuf> {
    Ok(copilot_paths()?.global_skills_dir())
}

/// Get the root containing Copilot CLI's downloaded packages (`~/.copilot/pkg/`).
pub fn builtin_packages_dir() -> crate::error::Result<PathBuf> {
    Ok(copilot_paths()?.pkg_dir())
}

/// Personal skill roots the CLI reads: `<COPILOT_HOME>/skills`, the
/// `~/.agents/skills` alternative, and anything in `COPILOT_SKILLS_DIRS`.
///
/// `.agents` is taken as a sibling of the Copilot home rather than from the
/// real user home, so a configured or isolated home keeps both roots together.
pub fn personal_skill_dirs(copilot_home: &Path) -> Vec<PathBuf> {
    let mut dirs =
        vec![tracepilot_core::paths::CopilotPaths::from_home(copilot_home).global_skills_dir()];
    if let Some(home) = copilot_home.parent() {
        dirs.push(cli_install::agents_home_skills_dir(home));
    }
    dirs.extend(cli_install::extra_skill_dirs());
    dirs.retain(|dir| path_is_allowed_by_isolation(dir));
    dirs.sort();
    dirs.dedup();
    dirs
}

/// The installed CLI's distribution roots, or an empty list when no
/// installation can be found.
pub fn builtin_dist_roots(copilot_home: &Path) -> Vec<DistRoot> {
    cli_install::dist_roots(copilot_home)
}

/// Centralized fixed roots from which skill content may be read.
///
/// Covers every personal root plus the installed CLI's own directories, so a
/// built-in skill stays readable however the CLI was installed. Repository
/// roots are validated structurally because they are supplied at runtime.
pub fn registered_skill_roots() -> crate::error::Result<Vec<PathBuf>> {
    let paths = copilot_paths()?;
    let mut roots = personal_skill_dirs(paths.home());
    roots.push(paths.pkg_dir());
    roots.extend(paths.dist_roots().into_iter().map(|root| root.path));
    Ok(roots)
}

/// Get the primary repository skills directory (`.github/skills/` under repo root).
pub fn repo_skills_dir(repo_root: &Path) -> PathBuf {
    tracepilot_core::paths::RepoPaths::from_root(repo_root).github_skills_dir()
}

fn repo_skill_dirs(repo_root: &Path) -> [PathBuf; 4] {
    let paths = tracepilot_core::paths::RepoPaths::from_root(repo_root);
    [
        paths.github_skills_dir(),
        repo_root.join(".agents").join("skills"),
        repo_root.join(".claude").join("skills"),
        paths.copilot_skills_dir(),
    ]
}

/// Discover project skills without rescanning personal or packaged definitions.
pub fn discover_repository(root: &Path) -> Result<SkillDiscoveryResult, SkillsError> {
    let mut result = SkillDiscoveryResult {
        skills: Vec::new(),
        diagnostics: Vec::new(),
    };
    for directory in repo_skill_dirs(root) {
        collect_root(&mut result, &directory, SkillScope::Repository);
    }
    Ok(result)
}

/// Scan one root into `result`. A missing root is silent; an unreadable one is
/// reported so the user can see why it is empty. Neither stops the scan.
fn collect_root(result: &mut SkillDiscoveryResult, directory: &Path, scope: SkillScope) {
    if !path_is_allowed_by_isolation(directory) || !directory.exists() {
        return;
    }
    match discover_in_directory_detailed(directory, scope) {
        Ok(found) => {
            result.skills.extend(found.skills);
            result.diagnostics.extend(found.diagnostics);
        }
        Err(error) => {
            tracing::warn!("Skipping skills directory {}: {error}", directory.display());
            result.diagnostics.push(SkillDiagnostic {
                path: directory.to_string_lossy().to_string(),
                message: error.to_string(),
                severity: "error".into(),
            });
        }
    }
}

/// Owning repository for a skill under any supported project root.
pub fn skill_repository(skill_dir: &Path) -> Option<&Path> {
    skill_dir.ancestors().find_map(|ancestor| {
        if ancestor.file_name()? != "skills" {
            return None;
        }
        let parent = ancestor.parent()?;
        let marker = parent.file_name()?.to_str()?;
        matches!(marker, ".github" | ".copilot" | ".agents" | ".claude")
            .then(|| parent.parent())
            .flatten()
    })
}

/// Discover all skills (global + optional repository).
pub fn discover_all(repo_root: Option<&Path>) -> Result<Vec<SkillSummary>, SkillsError> {
    Ok(discover_all_detailed(repo_root)?.skills)
}

/// Discover skills and retain actionable diagnostics for invalid entries.
pub fn discover_all_detailed(
    repo_root: Option<&Path>,
) -> Result<SkillDiscoveryResult, SkillsError> {
    let mut result = match copilot_paths() {
        Ok(paths) => discover_user_skills(paths.home())?,
        Err(_) => SkillDiscoveryResult {
            skills: Vec::new(),
            diagnostics: Vec::new(),
        },
    };
    if let Some(root) = repo_root {
        let project = discover_repository(root)?;
        result.skills.extend(project.skills);
        result.diagnostics.extend(project.diagnostics);
    }
    result.skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

/// Discover personal and bundled skills from the configured Copilot home.
///
/// Returns `Ok` even when every root fails: the failures travel as diagnostics
/// so the manager still lists whatever was readable.
pub fn discover_user_skills(copilot_home: &Path) -> Result<SkillDiscoveryResult, SkillsError> {
    let mut result = SkillDiscoveryResult {
        skills: Vec::new(),
        diagnostics: Vec::new(),
    };
    for directory in personal_skill_dirs(copilot_home) {
        collect_root(&mut result, &directory, SkillScope::Global);
    }
    let dist_roots = builtin_dist_roots(copilot_home);
    if dist_roots.is_empty() {
        // Said once, as a warning rather than an error: the user's own skills
        // above are unaffected, and this explains the missing built-ins.
        result.diagnostics.push(SkillDiagnostic {
            path: tracepilot_core::paths::CopilotPaths::from_home(copilot_home)
                .pkg_dir()
                .to_string_lossy()
                .to_string(),
            message: MISSING_CLI_NOTE.into(),
            severity: "warning".into(),
        });
    }
    result.skills.extend(discover_builtin_skills(&dist_roots));
    Ok(result)
}

/// Discover the built-in skills the installed CLI ships, keeping the
/// newest-versioned copy of each case-insensitive name.
///
/// Roots without a built-in directory (an old CLI, or a package still being
/// extracted) are skipped, and an unreadable one is logged rather than
/// returned, because built-ins are a bonus next to the user's own skills.
fn discover_builtin_skills(dist_roots: &[DistRoot]) -> Vec<SkillSummary> {
    let mut discovered = BTreeMap::<String, (Option<Version>, SkillSummary)>::new();

    for root in cli_install::effective_dist_roots(dist_roots) {
        let Some(builtin_dir) = root.builtin_skills_dir() else {
            continue;
        };
        let version = root
            .version
            .as_deref()
            .and_then(|raw| Version::parse(raw).ok());
        let summaries = match discover_in_directory(&builtin_dir, SkillScope::Builtin) {
            Ok(summaries) => summaries,
            Err(error) => {
                tracing::warn!(
                    "Skipping built-in skills at {}: {error}",
                    builtin_dir.display()
                );
                continue;
            }
        };
        for summary in summaries {
            let key = summary.name.trim().to_lowercase();
            let should_replace =
                discovered
                    .get(&key)
                    .is_none_or(|(current_version, current_summary)| {
                        version > *current_version
                            || (version == *current_version
                                && summary.directory < current_summary.directory)
                    });
            if should_replace {
                discovered.insert(key, (version.clone(), summary));
            }
        }
    }

    discovered
        .into_values()
        .map(|(_, summary)| summary)
        .collect()
}

/// Discover skills in a specific directory.
///
/// Expects the directory to contain subdirectories, each with a SKILL.md file.
pub fn discover_in_directory(
    dir: &Path,
    scope: SkillScope,
) -> Result<Vec<SkillSummary>, SkillsError> {
    Ok(discover_in_directory_detailed(dir, scope)?.skills)
}

fn discover_in_directory_detailed(
    dir: &Path,
    scope: SkillScope,
) -> Result<SkillDiscoveryResult, SkillsError> {
    let mut summaries = Vec::new();
    let mut diagnostics = Vec::new();

    if !path_is_allowed_by_isolation(dir) {
        return Err(SkillsError::PathTraversal(dir.display().to_string()));
    }

    let entries = std::fs::read_dir(dir).map_err(|e| {
        SkillsError::io_ctx(
            format!("Failed to read skills directory {}", dir.display()),
            e,
        )
    })?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let skill_md = path.join("SKILL.md");
        if !path_is_allowed_by_isolation(&skill_md) || !skill_md.exists() {
            continue;
        }

        match load_skill_summary(&skill_md, &scope) {
            Ok(summary) => summaries.push(summary),
            Err(e) => {
                tracing::warn!("Skipping skill at {}: {e}", path.display());
                diagnostics.push(SkillDiagnostic {
                    path: skill_md.to_string_lossy().to_string(),
                    message: e.to_string(),
                    severity: "error".into(),
                });
            }
        }
    }

    Ok(SkillDiscoveryResult {
        skills: summaries,
        diagnostics,
    })
}

/// Load a skill summary from a SKILL.md file.
fn load_skill_summary(
    skill_md_path: &Path,
    scope: &SkillScope,
) -> Result<SkillSummary, SkillsError> {
    let content = tracepilot_core::TracePilotError::read_to_string(skill_md_path)?;
    let (fm, _) = parse_skill_md(&content)?;
    let (frontmatter_tokens, instruction_tokens) =
        crate::skills::estimate_skill_token_usage(&content)?;

    let dir = skill_md_path
        .parent()
        .unwrap_or(skill_md_path)
        .to_string_lossy()
        .to_string();

    // Count assets (non-SKILL.md files in the directory)
    let asset_count = count_assets(skill_md_path.parent().unwrap_or(Path::new(".")));

    Ok(SkillSummary {
        name: fm.name,
        description: fm.description,
        scope: scope.clone(),
        directory: dir,
        frontmatter_tokens,
        instruction_tokens,
        enabled: true,
        disabled_reason: None,
        has_assets: asset_count > 0,
        asset_count,
        modified_at: file_modified_at(skill_md_path),
        content_sha256: tracepilot_core::tokens::content_fingerprint(&content),
    })
}

/// `SKILL.md` modification time, or `None` when the filesystem will not say.
fn file_modified_at(path: &Path) -> Option<chrono::DateTime<chrono::Utc>> {
    std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(chrono::DateTime::from)
}

/// Load a full skill from a SKILL.md path.
pub fn load_skill(skill_md_path: &Path, scope: SkillScope) -> Result<Skill, SkillsError> {
    let content = tracepilot_core::TracePilotError::read_to_string(skill_md_path)?;
    let (fm, body) = parse_skill_md(&content)?;
    let (frontmatter_tokens, instruction_tokens) =
        crate::skills::estimate_skill_token_usage(&content)?;

    let dir = skill_md_path
        .parent()
        .unwrap_or(skill_md_path)
        .to_string_lossy()
        .to_string();

    Ok(Skill {
        frontmatter: fm,
        body,
        raw_content: content,
        scope,
        directory: dir,
        frontmatter_tokens,
        instruction_tokens,
        enabled: true,
        disabled_reason: None,
        modified_at: file_modified_at(skill_md_path),
    })
}

/// Recursively count non-SKILL.md, non-hidden files in a directory.
fn count_assets(dir: &Path) -> usize {
    crate::skills::assets::list_assets(dir)
        .unwrap_or_default()
        .iter()
        .filter(|asset| !asset.is_directory)
        .count()
}

#[cfg(test)]
mod tests;
