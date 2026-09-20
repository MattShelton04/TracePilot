//! Skill lifecycle manager — CRUD operations for skills.

use crate::skills::discovery::{
    builtin_dist_roots, builtin_packages_dir, global_skills_dir, load_skill, registered_skill_roots,
};
use crate::skills::error::SkillsError;
use crate::skills::parser::parse_skill_md;
use crate::skills::types::{Skill, SkillFrontmatter, SkillScope};
use crate::skills::writer::{patch_frontmatter_scalar, patch_skill_md, write_skill_md};
use std::path::{Path, PathBuf};
use tracepilot_core::ids::SkillName;

/// Validate that a skill_dir path is contained within a known skills root
/// (a personal root, the installed CLI's own directories, or a repo skills root).
///
/// This prevents IPC callers from passing arbitrary paths that could lead to
/// reads/writes/deletes of unrelated directories.
pub fn validate_skill_dir(skill_dir: &Path) -> Result<(), SkillsError> {
    // Validate the installation path as well as its target. A skill explicitly
    // linked into a supported root is installed there, even if shared elsewhere.
    if skill_dir
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(SkillsError::PathTraversal(skill_dir.display().to_string()));
    }
    let canonical = skill_dir
        .canonicalize()
        .unwrap_or_else(|_| skill_dir.to_path_buf());

    // Check registered global and packaged built-in roots.
    if let Ok(roots) = registered_skill_roots() {
        for root in roots {
            if let Ok(root_canon) = root.canonicalize()
                && canonical.starts_with(&root_canon)
            {
                return Ok(());
            }
            // Also check non-canonical in case dir doesn't exist yet.
            if canonical.starts_with(&root) || skill_dir.starts_with(&root) {
                return Ok(());
            }
        }
    }

    // Check if it's under a repo-scoped skills directory.
    if crate::skills::discovery::skill_repository(skill_dir).is_some()
        || crate::skills::discovery::skill_repository(&canonical).is_some()
    {
        return Ok(());
    }

    Err(SkillsError::PathTraversal(format!(
        "Path '{}' is not within a known skills directory",
        skill_dir.display()
    )))
}

/// Validate that a skill path is registered and may be mutated.
pub fn validate_mutable_skill_dir(skill_dir: &Path) -> Result<(), SkillsError> {
    validate_skill_dir(skill_dir)?;
    if is_builtin_skill_dir(skill_dir) {
        return Err(SkillsError::ReadOnly(skill_dir.display().to_string()));
    }

    Ok(())
}

/// Built-in content is read-only wherever the CLI was installed: the extracted
/// packages under `<COPILOT_HOME>/pkg`, and the distribution roots an npm,
/// Homebrew or WinGet install leaves elsewhere on disk.
fn builtin_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = builtin_packages_dir().into_iter().collect();
    if let Some(paths) = tracepilot_core::paths::CopilotPaths::try_default() {
        roots.extend(
            builtin_dist_roots(paths.home())
                .into_iter()
                .map(|root| root.path),
        );
    }
    roots
}

fn is_builtin_skill_dir(skill_dir: &Path) -> bool {
    // Both folder links and individual SKILL.md links retain packaged content's
    // read-only policy, even when installed under a writable project root.
    let candidates: Vec<PathBuf> = [
        Some(skill_dir.to_path_buf()),
        skill_dir.canonicalize().ok(),
        skill_dir.join("SKILL.md").canonicalize().ok(),
    ]
    .into_iter()
    .flatten()
    .collect();

    builtin_roots().into_iter().any(|root| {
        let canonical = root.canonicalize().unwrap_or_else(|_| root.clone());
        candidates
            .iter()
            .any(|path| path.starts_with(&root) || path.starts_with(&canonical))
    })
}

/// Create a new skill in the global skills directory.
///
/// Takes a validated [`SkillName`] so the invariant "this name has been
/// format-checked" rides along in the type. The internal
/// [`validate_skill_name`] call remains as defence-in-depth against
/// callers that construct a [`SkillName`] via `from_validated` from an
/// untrusted source.
pub fn create_skill(
    name: &SkillName,
    description: &str,
    body: &str,
) -> Result<PathBuf, SkillsError> {
    let name = name.as_str();
    validate_skill_name(name)?;
    let dir = global_skills_dir().map_err(|e| match e {
        crate::error::OrchestratorError::Io(io_err) => SkillsError::IoSource(io_err),
        other => SkillsError::io_ctx(
            "Failed to resolve global skills dir",
            std::io::Error::other(other.to_string()),
        ),
    })?;
    let skill_dir = dir.join(name);

    if skill_dir.exists() {
        return Err(SkillsError::DuplicateSkill(name.to_string()));
    }

    std::fs::create_dir_all(&skill_dir)?;

    let fm = SkillFrontmatter {
        name: name.to_string(),
        description: description.to_string(),
        argument_hint: None,
        allowed_tools: None,
        user_invocable: None,
        disable_model_invocation: None,
        resource_globs: vec![],
        auto_attach: false,
    };

    let content = write_skill_md(&fm, body);
    let skill_path = skill_dir.join("SKILL.md");
    std::fs::write(&skill_path, content)?;

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

    let existing = tracepilot_core::TracePilotError::read_to_string(&skill_path)?;
    let content = patch_skill_md(&existing, frontmatter, body);
    std::fs::write(&skill_path, content)?;
    Ok(())
}

/// Update a skill from raw SKILL.md content (validates before writing).
pub fn update_skill_raw(skill_dir: &Path, raw_content: &str) -> Result<(), SkillsError> {
    // Validate by parsing
    let _ = parse_skill_md(raw_content)?;
    let skill_path = skill_dir.join("SKILL.md");
    std::fs::write(&skill_path, raw_content)?;
    Ok(())
}

/// Delete a skill directory entirely.
pub fn delete_skill(skill_dir: &Path) -> Result<(), SkillsError> {
    let metadata = std::fs::symlink_metadata(skill_dir)?;
    if metadata.file_type().is_symlink() {
        #[cfg(windows)]
        std::fs::remove_dir(skill_dir)?;
        #[cfg(not(windows))]
        std::fs::remove_file(skill_dir)?;
    } else {
        // Rust's remove_dir_all does not follow directory junctions either.
        std::fs::remove_dir_all(skill_dir)?;
    }
    Ok(())
}

/// Validate a skill name for safe filesystem use.
fn validate_skill_name(name: &str) -> Result<(), SkillsError> {
    crate::validation::validate_identifier(name, crate::validation::SKILL_NAME_RULES, "Skill name")
        .map_err(SkillsError::FrontmatterValidation)
}

/// Rename a skill (updates both directory name and frontmatter name).
pub fn rename_skill(skill_dir: &Path, new_name: &SkillName) -> Result<PathBuf, SkillsError> {
    let new_name = new_name.as_str();
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
    let content = tracepilot_core::TracePilotError::read_to_string(&skill_path)?;
    parse_skill_md(&content)?;
    let new_content = patch_frontmatter_scalar(&content, "name", new_name);

    // Write updated SKILL.md to the OLD directory first (safe — can retry)
    std::fs::write(&skill_path, &new_content)?;

    // Now rename the directory — if this fails, the old dir still has valid content
    if let Err(e) = std::fs::rename(skill_dir, &new_dir) {
        // Rollback: restore original SKILL.md content. If this fails, the on-disk
        // SKILL.md will have the new name but the directory retains the old name —
        // surface the rollback failure via tracing so an operator can fix it.
        if let Err(rb_err) = std::fs::write(&skill_path, &content) {
            tracing::error!(
                path = %skill_path.display(),
                rollback_error = %rb_err,
                original_error = %e,
                "Failed to roll back SKILL.md after rename failure — manual cleanup may be required"
            );
        }
        return Err(e.into());
    }

    Ok(new_dir)
}

/// Duplicate a skill with a new name.
pub fn duplicate_skill(skill_dir: &Path, new_name: &SkillName) -> Result<PathBuf, SkillsError> {
    let new_name = new_name.as_str();
    validate_skill_name(new_name)?;

    let skill_path = skill_dir.join("SKILL.md");
    let content = tracepilot_core::TracePilotError::read_to_string(&skill_path)?;
    parse_skill_md(&content)?;

    let new_content = patch_frontmatter_scalar(&content, "name", new_name);
    let parent = skill_dir.parent().unwrap_or(Path::new("."));
    let (new_dir, _) = crate::skills::import::atomic_dir_install(parent, new_name, |staging| {
        crate::skills::import::copy_dir_contents(skill_dir, staging)?;
        std::fs::write(staging.join("SKILL.md"), new_content)?;
        Ok(())
    })?;

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

/// Determine if a skill directory is built-in, global, or repository-scoped.
fn determine_scope(skill_dir: &Path) -> SkillScope {
    if is_builtin_skill_dir(skill_dir) {
        return SkillScope::Builtin;
    }
    // The logical global path wins before the structurally identical
    // <repo>/.copilot/skills path. Project links keep their installing scope.
    if global_skills_dir().is_ok_and(|root| skill_dir.starts_with(root)) {
        return SkillScope::Global;
    }
    SkillScope::Repository
}

#[cfg(test)]
mod tests;
