//! Import a skill from a single SKILL.md file.

use super::atomic::atomic_dir_install;
use crate::skills::error::SkillsError;
use crate::skills::parser::parse_skill_md;
use crate::skills::types::SkillImportResult;
use std::path::Path;

/// Import a skill from a SKILL.md file (single file import).
///
/// Creates a new skill directory with just the SKILL.md file.
/// Uses atomic staging to prevent partial state on failure.
pub fn import_from_file(
    file_path: &Path,
    dest_parent: &Path,
) -> Result<SkillImportResult, SkillsError> {
    let content = std::fs::read_to_string(file_path)?;
    let (fm, _) = parse_skill_md(&content)?;

    let (final_dir, _) = atomic_dir_install(dest_parent, &fm.name, |staging| {
        std::fs::write(staging.join("SKILL.md"), &content)?;
        Ok(())
    })?;

    Ok(SkillImportResult {
        skill_name: fm.name,
        destination: final_dir.to_string_lossy().to_string(),
        warnings: vec![],
        files_copied: 1,
    })
}
