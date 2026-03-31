//! Skill discovery — scans filesystem for SKILL.md files.
//!
//! Discovers skills in:
//! - Global: `~/.copilot/skills/*/SKILL.md`
//! - Repository: `.copilot/skills/*/SKILL.md` (relative to repo root)

use crate::launcher::copilot_home;
use crate::skills::error::SkillsError;
use crate::skills::parser::parse_skill_md;
use crate::skills::types::{Skill, SkillScope, SkillSummary};
use crate::tokens::estimate_skill_tokens;
use std::path::{Path, PathBuf};

/// Get the global skills directory (`~/.copilot/skills/`).
pub fn global_skills_dir() -> crate::error::Result<PathBuf> {
    Ok(copilot_home()?.join("skills"))
}

/// Get the repository skills directory (`.copilot/skills/` under repo root).
pub fn repo_skills_dir(repo_root: &Path) -> PathBuf {
    repo_root.join(".copilot").join("skills")
}

/// Discover all skills (global + optional repository).
pub fn discover_all(repo_root: Option<&Path>) -> Result<Vec<SkillSummary>, SkillsError> {
    let mut summaries = Vec::new();

    // Global skills
    if let Ok(global_dir) = global_skills_dir() {
        if global_dir.exists() {
            let global = discover_in_directory(&global_dir, SkillScope::Global)?;
            summaries.extend(global);
        }
    }

    // Repository skills
    if let Some(root) = repo_root {
        let repo_dir = repo_skills_dir(root);
        if repo_dir.exists() {
            let repo = discover_in_directory(&repo_dir, SkillScope::Repository)?;
            summaries.extend(repo);
        }
    }

    summaries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(summaries)
}

/// Discover skills in a specific directory.
///
/// Expects the directory to contain subdirectories, each with a SKILL.md file.
pub fn discover_in_directory(
    dir: &Path,
    scope: SkillScope,
) -> Result<Vec<SkillSummary>, SkillsError> {
    let mut summaries = Vec::new();

    let entries = std::fs::read_dir(dir).map_err(|e| {
        SkillsError::Io(format!("Failed to read skills directory {}: {e}", dir.display()))
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
                tracing::warn!(
                    "Skipping skill at {}: {e}",
                    path.display()
                );
            }
        }
    }

    Ok(summaries)
}

/// Load a skill summary from a SKILL.md file.
fn load_skill_summary(
    skill_md_path: &Path,
    scope: &SkillScope,
) -> Result<SkillSummary, SkillsError> {
    let content = std::fs::read_to_string(skill_md_path)?;
    let (fm, body) = parse_skill_md(&content)?;
    let tokens = estimate_skill_tokens(&content, &body);

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
        estimated_tokens: tokens,
        enabled: true,
        has_assets: asset_count > 0,
        asset_count,
    })
}

/// Load a full skill from a SKILL.md path.
pub fn load_skill(skill_md_path: &Path, scope: SkillScope) -> Result<Skill, SkillsError> {
    let content = std::fs::read_to_string(skill_md_path)?;
    let (fm, body) = parse_skill_md(&content)?;
    let tokens = estimate_skill_tokens(&content, &body);

    let dir = skill_md_path
        .parent()
        .unwrap_or(skill_md_path)
        .to_string_lossy()
        .to_string();

    let modified_at = std::fs::metadata(skill_md_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .map(|t| chrono::DateTime::from(t));

    Ok(Skill {
        frontmatter: fm,
        body,
        raw_content: content,
        scope,
        directory: dir,
        estimated_tokens: tokens,
        enabled: true,
        modified_at,
    })
}

/// Count non-SKILL.md files in a directory.
fn count_assets(dir: &Path) -> usize {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| {
                    let name = e.file_name();
                    let name_str = name.to_string_lossy();
                    name_str != "SKILL.md" && !name_str.starts_with('.')
                })
                .count()
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_skill(dir: &Path, name: &str) {
        let skill_dir = dir.join(name);
        std::fs::create_dir_all(&skill_dir).unwrap();
        let content = format!(
            "---\nname: {name}\ndescription: Test skill {name}\n---\n\nBody of {name}.\n"
        );
        std::fs::write(skill_dir.join("SKILL.md"), content).unwrap();
    }

    #[test]
    fn discover_in_empty_directory() {
        let dir = TempDir::new().unwrap();
        let result = discover_in_directory(dir.path(), SkillScope::Global).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn discover_finds_skills() {
        let dir = TempDir::new().unwrap();
        create_test_skill(dir.path(), "skill-a");
        create_test_skill(dir.path(), "skill-b");

        let result = discover_in_directory(dir.path(), SkillScope::Global).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn discover_skips_non_directories() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("not-a-skill.txt"), "hello").unwrap();
        create_test_skill(dir.path(), "real-skill");

        let result = discover_in_directory(dir.path(), SkillScope::Global).unwrap();
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn discover_skips_dirs_without_skill_md() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join("empty-dir")).unwrap();
        create_test_skill(dir.path(), "valid-skill");

        let result = discover_in_directory(dir.path(), SkillScope::Global).unwrap();
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn load_skill_returns_full_data() {
        let dir = TempDir::new().unwrap();
        create_test_skill(dir.path(), "my-skill");
        let path = dir.path().join("my-skill").join("SKILL.md");

        let skill = load_skill(&path, SkillScope::Global).unwrap();
        assert_eq!(skill.frontmatter.name, "my-skill");
        assert!(skill.body.contains("Body of my-skill"));
        assert_eq!(skill.scope, SkillScope::Global);
        assert!(skill.estimated_tokens > 0);
    }

    #[test]
    fn count_assets_excludes_skill_md() {
        let dir = TempDir::new().unwrap();
        let skill_dir = dir.path().join("with-assets");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "---\nname: x\ndescription: y\n---\n").unwrap();
        std::fs::write(skill_dir.join("helper.py"), "# helper").unwrap();
        std::fs::write(skill_dir.join("data.json"), "{}").unwrap();

        assert_eq!(count_assets(&skill_dir), 2);
    }

    #[test]
    fn count_assets_excludes_hidden_files() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join(".hidden"), "").unwrap();
        std::fs::write(dir.path().join("visible"), "").unwrap();
        // SKILL.md not counted
        std::fs::write(dir.path().join("SKILL.md"), "").unwrap();

        assert_eq!(count_assets(dir.path()), 1);
    }
}
