//! Import and discover skills from local directories.

use super::atomic::atomic_dir_install;
use crate::skills::error::SkillsError;
use crate::skills::parser::parse_skill_md;
use crate::skills::types::{LocalSkillPreview, RepoSkillsResult, SkillImportResult};
use std::path::Path;

/// Import a skill from a local directory.
///
/// Copies the entire directory contents to the global skills folder.
/// Uses atomic staging to prevent partial state on failure.
pub fn import_from_local(
    source_dir: &Path,
    dest_parent: &Path,
) -> Result<SkillImportResult, SkillsError> {
    let skill_md = source_dir.join("SKILL.md");
    if !skill_md.exists() {
        return Err(SkillsError::Import(format!(
            "No SKILL.md found in {}. This directory doesn't appear to be a Copilot skill. Skills must contain a SKILL.md file.",
            source_dir.display()
        )));
    }

    // Parse to get the skill name
    let content = std::fs::read_to_string(&skill_md)?;
    let (fm, _) = parse_skill_md(&content)?;

    let (final_dir, files_copied) = atomic_dir_install(dest_parent, &fm.name, |staging| {
        copy_dir_contents(source_dir, staging)
    })?;

    Ok(SkillImportResult {
        skill_name: fm.name,
        destination: final_dir.to_string_lossy().to_string(),
        warnings: vec![],
        files_copied,
    })
}

/// Copy all files from a source directory to a destination.
pub(super) fn copy_dir_contents(src: &Path, dst: &Path) -> Result<usize, SkillsError> {
    std::fs::create_dir_all(dst)?;
    let mut count = 0;

    for entry in std::fs::read_dir(src)?.flatten() {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            count += copy_dir_contents(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
            count += 1;
        }
    }

    Ok(count)
}

/// Discover skills within a local repository or directory.
///
/// Searches well-known skill locations and returns previews. The search order is:
/// 1. Direct SKILL.md (the directory itself is a skill)
/// 2. `.github/skills/*/SKILL.md`
/// 3. `.copilot/skills/*/SKILL.md`
/// 4. `skills/*/SKILL.md`
/// 5. `.github/copilot-skills/*/SKILL.md`
pub fn discover_local_skills(base_dir: &Path) -> Result<Vec<LocalSkillPreview>, SkillsError> {
    if !base_dir.is_dir() {
        return Err(SkillsError::Import(format!(
            "'{}' is not a directory",
            base_dir.display()
        )));
    }

    let mut previews = Vec::new();

    // 1. Check if the directory itself is a skill
    let root_skill_md = base_dir.join("SKILL.md");
    if root_skill_md.exists() {
        if let Ok(preview) = skill_preview_from_dir(base_dir) {
            previews.push(preview);
            return Ok(previews);
        }
    }

    // 2–5. Search well-known sub-directory patterns
    let search_parents = [
        ".github/skills",
        ".copilot/skills",
        "skills",
        ".github/copilot-skills",
    ];

    for parent_rel in &search_parents {
        let parent_dir = base_dir.join(parent_rel);
        if !parent_dir.is_dir() {
            continue;
        }
        let entries = std::fs::read_dir(&parent_dir)?;
        for entry in entries.flatten() {
            let skill_dir = entry.path();
            if !skill_dir.is_dir() {
                continue;
            }
            if skill_dir.join("SKILL.md").exists() {
                if let Ok(preview) = skill_preview_from_dir(&skill_dir) {
                    previews.push(preview);
                }
            }
        }
    }

    Ok(previews)
}

/// Build a `LocalSkillPreview` from a directory that contains SKILL.md.
pub(super) fn skill_preview_from_dir(skill_dir: &Path) -> Result<LocalSkillPreview, SkillsError> {
    let skill_md = skill_dir.join("SKILL.md");
    let content = std::fs::read_to_string(&skill_md)?;
    let (fm, _) = parse_skill_md(&content)?;

    let file_count = count_files_recursive(skill_dir);

    Ok(LocalSkillPreview {
        path: skill_dir.to_string_lossy().to_string(),
        name: fm.name,
        description: fm.description,
        file_count,
    })
}

/// Recursively count all files (including SKILL.md) in a directory tree.
pub(super) fn count_files_recursive(dir: &Path) -> usize {
    let mut count = 0;
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            count += count_files_recursive(&path);
        } else {
            count += 1;
        }
    }
    count
}

/// Scans multiple repository paths for skills and returns results grouped by repo.
///
/// Each entry in `repos` is a `(path, name)` pair. The function calls
/// [`discover_local_skills`] on each path, collecting results even if some repos
/// have no skills (they get an empty `skills` vec) or fail (silently skipped).
pub fn discover_repo_skills(repos: &[(&str, &str)]) -> Vec<RepoSkillsResult> {
    repos
        .iter()
        .filter_map(|(path, name)| {
            let dir = Path::new(path);
            if !dir.is_dir() {
                return None;
            }
            let skills = discover_local_skills(dir).unwrap_or_default();
            Some(RepoSkillsResult {
                repo_path: path.to_string(),
                repo_name: name.to_string(),
                skills,
            })
        })
        .collect()
}
