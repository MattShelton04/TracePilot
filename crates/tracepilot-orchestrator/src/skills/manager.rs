//! Skill lifecycle manager — CRUD operations for skills.

use crate::json_io::atomic_write_str;
use crate::skills::discovery::{global_skills_dir, load_skill};
use crate::skills::error::SkillsError;
use crate::skills::parser::parse_skill_md;
use crate::skills::types::{Skill, SkillFrontmatter, SkillScope};
use crate::skills::writer::write_skill_md;
use std::path::{Path, PathBuf};

/// Validate that a skill_dir path is contained within a known skills root
/// (global `~/.copilot/skills/` or repo `.copilot/skills/`).
///
/// This prevents IPC callers from passing arbitrary paths that could lead to
/// reads/writes/deletes of unrelated directories.
pub fn validate_skill_dir(skill_dir: &Path) -> Result<(), SkillsError> {
    let canonical = skill_dir
        .canonicalize()
        .unwrap_or_else(|_| skill_dir.to_path_buf());

    // Check global skills root
    if let Ok(global) = global_skills_dir() {
        if let Ok(global_canon) = global.canonicalize() {
            if canonical.starts_with(&global_canon) {
                return Ok(());
            }
        }
        // Also check non-canonical in case dir doesn't exist yet
        if canonical.starts_with(&global) {
            return Ok(());
        }
    }

    // Check if it's under a repo .copilot/skills/ directory
    // Walk up to find a .copilot/skills pattern
    for ancestor in canonical.ancestors() {
        if ancestor.ends_with("skills") {
            if let Some(parent) = ancestor.parent() {
                if parent.ends_with(".copilot") || parent.ends_with(".github") {
                    return Ok(());
                }
            }
        }
    }

    Err(SkillsError::PathTraversal(format!(
        "Path '{}' is not within a known skills directory",
        skill_dir.display()
    )))
}

/// Create a new skill in the global skills directory.
pub fn create_skill(name: &str, description: &str, body: &str) -> Result<PathBuf, SkillsError> {
    validate_skill_name(name)?;
    let dir = global_skills_dir().map_err(|e| match e {
        crate::error::OrchestratorError::Io(io_err) => SkillsError::IoSource(io_err),
        other => SkillsError::Io(other.to_string()),
    })?;
    let skill_dir = dir.join(name);

    if skill_dir.exists() {
        return Err(SkillsError::DuplicateSkill(name.to_string()));
    }

    std::fs::create_dir_all(&skill_dir)?;

    let fm = SkillFrontmatter {
        name: name.to_string(),
        description: description.to_string(),
        resource_globs: vec![],
        auto_attach: false,
    };

    let content = write_skill_md(&fm, body);
    let skill_path = skill_dir.join("SKILL.md");
    atomic_write_str(&skill_path, &content)?;

    Ok(skill_dir)
}

/// Update an existing skill's SKILL.md file.
pub fn update_skill(
    skill_dir: &Path,
    frontmatter: &SkillFrontmatter,
    body: &str,
) -> Result<(), SkillsError> {
    let skill_path = skill_dir.join("SKILL.md");
    if !skill_path.exists() {
        return Err(SkillsError::NotFound(
            skill_dir.to_string_lossy().to_string(),
        ));
    }

    let content = write_skill_md(frontmatter, body);
    atomic_write_str(&skill_path, &content)?;
    Ok(())
}

/// Update a skill from raw SKILL.md content (validates before writing).
pub fn update_skill_raw(skill_dir: &Path, raw_content: &str) -> Result<(), SkillsError> {
    // Validate by parsing
    let _ = parse_skill_md(raw_content)?;
    let skill_path = skill_dir.join("SKILL.md");
    atomic_write_str(&skill_path, raw_content)?;
    Ok(())
}

/// Delete a skill directory entirely.
pub fn delete_skill(skill_dir: &Path) -> Result<(), SkillsError> {
    if !skill_dir.exists() {
        return Err(SkillsError::NotFound(
            skill_dir.to_string_lossy().to_string(),
        ));
    }
    std::fs::remove_dir_all(skill_dir)?;
    Ok(())
}

/// Validate a skill name for safe filesystem use.
fn validate_skill_name(name: &str) -> Result<(), SkillsError> {
    crate::validation::validate_identifier(name, crate::validation::SKILL_NAME_RULES, "Skill name")
        .map_err(SkillsError::FrontmatterValidation)
}

/// Rename a skill (updates both directory name and frontmatter name).
pub fn rename_skill(skill_dir: &Path, new_name: &str) -> Result<PathBuf, SkillsError> {
    validate_skill_name(new_name)?;

    let skill_path = skill_dir.join("SKILL.md");
    if !skill_path.exists() {
        return Err(SkillsError::NotFound(
            skill_dir.to_string_lossy().to_string(),
        ));
    }

    // Check destination FIRST — before any mutation
    let new_dir = skill_dir.parent().unwrap_or(Path::new(".")).join(new_name);

    if new_dir.exists() {
        return Err(SkillsError::DuplicateSkill(new_name.to_string()));
    }

    // Prepare updated content BEFORE any filesystem mutation
    let content = std::fs::read_to_string(&skill_path)?;
    let (mut fm, body) = parse_skill_md(&content)?;
    fm.name = new_name.to_string();
    let new_content = write_skill_md(&fm, &body);

    // Write updated SKILL.md to the OLD directory first (safe — can retry)
    atomic_write_str(&skill_path, &new_content)?;

    // Now rename the directory — if this fails, the old dir still has valid content
    if let Err(e) = std::fs::rename(skill_dir, &new_dir) {
        // Rollback: restore original SKILL.md content
        let _ = std::fs::write(&skill_path, &content);
        return Err(e.into());
    }

    Ok(new_dir)
}

/// Duplicate a skill with a new name.
pub fn duplicate_skill(skill_dir: &Path, new_name: &str) -> Result<PathBuf, SkillsError> {
    validate_skill_name(new_name)?;

    let skill = load_skill(&skill_dir.join("SKILL.md"), SkillScope::Global)?;

    let new_dir = skill_dir.parent().unwrap_or(Path::new(".")).join(new_name);

    if new_dir.exists() {
        return Err(SkillsError::DuplicateSkill(new_name.to_string()));
    }

    // Copy the entire directory
    copy_dir_recursive(skill_dir, &new_dir)?;

    // Update the frontmatter name in the copy
    let mut fm = skill.frontmatter;
    fm.name = new_name.to_string();
    update_skill(&new_dir, &fm, &skill.body)?;

    Ok(new_dir)
}

/// Get the full skill data from a directory path.
pub fn get_skill(skill_dir: &Path) -> Result<Skill, SkillsError> {
    let skill_path = skill_dir.join("SKILL.md");
    if !skill_path.exists() {
        return Err(SkillsError::NotFound(
            skill_dir.to_string_lossy().to_string(),
        ));
    }
    load_skill(&skill_path, determine_scope(skill_dir))
}

/// Determine if a skill directory is global or repository-scoped.
fn determine_scope(skill_dir: &Path) -> SkillScope {
    let path_str = skill_dir.to_string_lossy();
    if path_str.contains(".copilot") && !path_str.contains("skills") {
        SkillScope::Repository
    } else if let Ok(global) = global_skills_dir() {
        if skill_dir.starts_with(&global) {
            SkillScope::Global
        } else {
            SkillScope::Repository
        }
    } else {
        SkillScope::Repository
    }
}

/// Recursively copy a directory and all its contents.
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), SkillsError> {
    std::fs::create_dir_all(dst)?;

    for entry in std::fs::read_dir(src)?.flatten() {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_skill(dir: &Path, name: &str) -> PathBuf {
        let skill_dir = dir.join(name);
        std::fs::create_dir_all(&skill_dir).unwrap();
        let content = format!("---\nname: {name}\ndescription: Test skill\n---\n\nBody text.\n");
        std::fs::write(skill_dir.join("SKILL.md"), content).unwrap();
        skill_dir
    }

    #[test]
    fn update_skill_writes_valid_content() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill(dir.path(), "test-skill");

        let fm = SkillFrontmatter {
            name: "test-skill".into(),
            description: "Updated description".into(),
            resource_globs: vec!["*.rs".into()],
            auto_attach: true,
        };
        update_skill(&skill_dir, &fm, "New body").unwrap();

        let content = std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
        assert!(content.contains("Updated description"));
        assert!(content.contains("New body"));
    }

    #[test]
    fn update_nonexistent_skill_errors() {
        let dir = TempDir::new().unwrap();
        let fm = SkillFrontmatter {
            name: "ghost".into(),
            description: "desc".into(),
            resource_globs: vec![],
            auto_attach: false,
        };
        let result = update_skill(&dir.path().join("ghost"), &fm, "body");
        assert!(result.is_err());
    }

    #[test]
    fn delete_skill_removes_directory() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill(dir.path(), "to-delete");
        assert!(skill_dir.exists());
        delete_skill(&skill_dir).unwrap();
        assert!(!skill_dir.exists());
    }

    #[test]
    fn delete_nonexistent_errors() {
        let dir = TempDir::new().unwrap();
        let result = delete_skill(&dir.path().join("nonexistent"));
        assert!(result.is_err());
    }

    #[test]
    fn rename_skill_updates_dir_and_content() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill(dir.path(), "old-name");

        let new_dir = rename_skill(&skill_dir, "new-name").unwrap();
        assert!(!skill_dir.exists());
        assert!(new_dir.exists());

        let content = std::fs::read_to_string(new_dir.join("SKILL.md")).unwrap();
        assert!(content.contains("name: new-name"));
    }

    #[test]
    fn rename_to_existing_errors() {
        let dir = TempDir::new().unwrap();
        setup_skill(dir.path(), "skill-a");
        let skill_b = setup_skill(dir.path(), "skill-b");

        let result = rename_skill(&skill_b, "skill-a");
        assert!(result.is_err());

        // Verify original was NOT corrupted
        let content = std::fs::read_to_string(skill_b.join("SKILL.md")).unwrap();
        assert!(
            content.contains("name: skill-b"),
            "original skill-b should be intact"
        );
    }

    #[test]
    fn rename_rejects_path_traversal() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill(dir.path(), "safe-skill");
        assert!(rename_skill(&skill_dir, "../escape").is_err());
        assert!(rename_skill(&skill_dir, "foo/bar").is_err());
        assert!(rename_skill(&skill_dir, "").is_err());
    }

    #[test]
    fn duplicate_rejects_path_traversal() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill(dir.path(), "original-safe");
        assert!(duplicate_skill(&skill_dir, "../escape").is_err());
        assert!(duplicate_skill(&skill_dir, "foo\\bar").is_err());
    }

    #[test]
    fn duplicate_skill_creates_independent_copy() {
        let dir = TempDir::new().unwrap();
        let original = setup_skill(dir.path(), "original");
        std::fs::write(original.join("helper.py"), "# helper script").unwrap();

        let copy = duplicate_skill(&original, "copy").unwrap();
        assert!(copy.exists());
        assert!(copy.join("SKILL.md").exists());
        assert!(copy.join("helper.py").exists());

        // Verify the copy has updated name
        let content = std::fs::read_to_string(copy.join("SKILL.md")).unwrap();
        assert!(content.contains("name: copy"));
    }

    #[test]
    fn update_raw_validates_content() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill(dir.path(), "raw-test");

        // Valid content
        let valid = "---\nname: raw-test\ndescription: Updated\n---\n\nNew body.\n";
        update_skill_raw(&skill_dir, valid).unwrap();

        // Invalid content (missing frontmatter)
        let invalid = "no frontmatter here";
        assert!(update_skill_raw(&skill_dir, invalid).is_err());
    }

    #[test]
    fn get_skill_returns_full_data() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill(dir.path(), "full-data");
        let skill = get_skill(&skill_dir).unwrap();
        assert_eq!(skill.frontmatter.name, "full-data");
        assert!(skill.body.contains("Body text"));
    }

    #[test]
    fn create_skill_rejects_path_traversal() {
        let result = create_skill("../escape", "desc", "body");
        assert!(result.is_err());
        // validate_skill_name catches this — either as path separator or invalid chars
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("invalid") || err.contains("path") || err.contains(".."),
            "Expected validation error, got: {err}"
        );
    }
}
