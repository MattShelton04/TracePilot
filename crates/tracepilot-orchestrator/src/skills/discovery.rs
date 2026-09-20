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

/// Discover project skills without rescanning global or packaged definitions.
pub fn discover_repository(root: &Path) -> Result<SkillDiscoveryResult, SkillsError> {
    let mut result = SkillDiscoveryResult {
        skills: Vec::new(),
        diagnostics: Vec::new(),
    };
    for directory in repo_skill_dirs(root) {
        if directory.exists() {
            let found = discover_in_directory_detailed(&directory, SkillScope::Repository)?;
            result.skills.extend(found.skills);
            result.diagnostics.extend(found.diagnostics);
        }
    }
    Ok(result)
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
pub fn discover_user_skills(copilot_home: &Path) -> Result<SkillDiscoveryResult, SkillsError> {
    let paths = tracepilot_core::paths::CopilotPaths::from_home(copilot_home);
    let mut result = SkillDiscoveryResult {
        skills: Vec::new(),
        diagnostics: Vec::new(),
    };
    if paths.global_skills_dir().exists() {
        let global =
            discover_in_directory_detailed(&paths.global_skills_dir(), SkillScope::Global)?;
        result.skills.extend(global.skills);
        result.diagnostics.extend(global.diagnostics);
    }
    if paths.pkg_dir().exists() {
        result
            .skills
            .extend(discover_builtin_skills(&paths.pkg_dir())?);
    }
    Ok(result)
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
