//! Skill discovery — scans filesystem for SKILL.md files.
//!
//! Discovers skills in:
//! - Global Copilot skills under the Copilot home
//! - Built-in skills bundled under versioned Copilot packages
//! - Repository skills under supported repo-scoped skill roots

use crate::skills::error::SkillsError;
use crate::skills::parser::parse_skill_md;
use crate::skills::types::{
    Skill, SkillDiagnostic, SkillDiscoveryResult, SkillScope, SkillSummary,
};
use semver::Version;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

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

/// Centralized fixed roots from which skill content may be read.
///
/// Repository-scoped roots are validated structurally because their locations
/// are supplied at runtime.
pub fn registered_skill_roots() -> crate::error::Result<Vec<PathBuf>> {
    let paths = copilot_paths()?;
    Ok(vec![paths.global_skills_dir(), paths.pkg_dir()])
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

/// Discover all skills (global + optional repository).
pub fn discover_all(repo_root: Option<&Path>) -> Result<Vec<SkillSummary>, SkillsError> {
    Ok(discover_all_detailed(repo_root)?.skills)
}

/// Discover skills and retain actionable diagnostics for invalid entries.
pub fn discover_all_detailed(
    repo_root: Option<&Path>,
) -> Result<SkillDiscoveryResult, SkillsError> {
    let mut summaries = Vec::new();
    let mut diagnostics = Vec::new();

    // Global skills
    if let Ok(global_dir) = global_skills_dir()
        && global_dir.exists()
    {
        let result = discover_in_directory_detailed(&global_dir, SkillScope::Global)?;
        summaries.extend(result.skills);
        diagnostics.extend(result.diagnostics);
    }

    // Built-in skills bundled with installed Copilot CLI versions.
    if let Ok(packages_dir) = builtin_packages_dir()
        && packages_dir.exists()
    {
        summaries.extend(discover_builtin_skills(&packages_dir)?);
    }

    // Repository skills
    if let Some(root) = repo_root {
        for repo_dir in repo_skill_dirs(root) {
            if repo_dir.exists() {
                let result = discover_in_directory_detailed(&repo_dir, SkillScope::Repository)?;
                summaries.extend(result.skills);
                diagnostics.extend(result.diagnostics);
            }
        }
    }

    summaries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(SkillDiscoveryResult {
        skills: summaries,
        diagnostics,
    })
}

/// Discover packaged built-in skills, retaining the newest semantic-versioned
/// copy of each case-insensitive skill name across package targets.
fn discover_builtin_skills(packages_dir: &Path) -> Result<Vec<SkillSummary>, SkillsError> {
    let package_targets = std::fs::read_dir(packages_dir).map_err(|e| {
        SkillsError::io_ctx(
            format!(
                "Failed to read Copilot packages directory {}",
                packages_dir.display()
            ),
            e,
        )
    })?;
    let mut discovered = BTreeMap::<String, (Version, SkillSummary)>::new();

    for target in package_targets.flatten() {
        let target_path = target.path();
        if !target_path.is_dir()
            || target
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case("tmp")
        {
            continue;
        }

        let Ok(versions) = std::fs::read_dir(&target_path) else {
            continue;
        };
        for version_entry in versions.flatten() {
            let version_path = version_entry.path();
            if !version_path.is_dir() {
                continue;
            }
            let Ok(version) = Version::parse(&version_entry.file_name().to_string_lossy()) else {
                continue;
            };
            let builtin_dir = version_path.join("builtin");
            if !builtin_dir.is_dir() {
                continue;
            }

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
                            version.cmp(current_version).is_gt()
                                || (version.eq(current_version)
                                    && summary.directory < current_summary.directory)
                        });
                if should_replace {
                    discovered.insert(key, (version.clone(), summary));
                }
            }
        }
    }

    Ok(discovered
        .into_values()
        .map(|(_, summary)| summary)
        .collect())
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
        if !skill_md.exists() {
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
    })
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

    let modified_at = std::fs::metadata(skill_md_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .map(chrono::DateTime::from);

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
        modified_at,
    })
}

/// Recursively count non-SKILL.md, non-hidden files in a directory.
fn count_assets(dir: &Path) -> usize {
    count_assets_recursive(dir)
}

fn count_assets_recursive(dir: &Path) -> usize {
    let mut count = 0;
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            count += count_assets_recursive(&path);
        } else if name_str != "SKILL.md" {
            count += 1;
        }
    }
    count
}

#[cfg(test)]
mod tests;
