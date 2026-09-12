//! Skill asset management — list, add, remove files in skill directories.

use crate::skills::error::SkillsError;
use crate::skills::types::SkillAsset;
use std::io::Write;
use std::path::Path;

/// List all assets (non-SKILL.md files) in a skill directory.
pub fn list_assets(skill_dir: &Path) -> Result<Vec<SkillAsset>, SkillsError> {
    if !skill_dir.exists() {
        return Err(SkillsError::NotFound(
            skill_dir.to_string_lossy().to_string(),
        ));
    }

    let mut assets = Vec::new();
    collect_assets(skill_dir, skill_dir, &mut assets)?;
    assets.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(assets)
}

/// Recursively collect assets from a directory.
fn collect_assets(
    root: &Path,
    dir: &Path,
    assets: &mut Vec<SkillAsset>,
) -> Result<(), SkillsError> {
    for entry in std::fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files and SKILL.md
        if name.starts_with('.') || (name == "SKILL.md" && dir == root) {
            continue;
        }

        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        if path.is_dir() {
            assets.push(SkillAsset {
                path: relative.clone(),
                name: name.clone(),
                size_bytes: 0,
                is_directory: true,
            });
            collect_assets(root, &path, assets)?;
        } else {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            assets.push(SkillAsset {
                path: relative,
                name,
                size_bytes: size,
                is_directory: false,
            });
        }
    }

    Ok(())
}

/// Validate an asset name against path traversal and absolute paths.
///
/// Asset names may contain path separators (`/`, `\`) for nested files
/// (e.g. `subdir/helper.py`), but must not contain `..`, start with a
/// separator, or be absolute.
pub fn validate_asset_name(asset_name: &str) -> Result<(), SkillsError> {
    // Check empty
    if asset_name.is_empty() {
        return Err(SkillsError::Asset("Asset name cannot be empty".into()));
    }

    // Special case: SKILL.md cannot be operated on via asset API
    if asset_name == "SKILL.md" {
        return Err(SkillsError::Asset(
            "Cannot operate on SKILL.md via asset API".into(),
        ));
    }

    // Path traversal check
    if asset_name.contains("..") {
        return Err(SkillsError::Asset(
            "Asset name cannot contain '..' (path traversal)".into(),
        ));
    }

    // Absolute path checks
    if asset_name.starts_with('/') || asset_name.starts_with('\\') {
        return Err(SkillsError::Asset(
            "Asset name cannot start with path separator".into(),
        ));
    }

    if Path::new(asset_name).is_absolute() {
        return Err(SkillsError::Asset(
            "Asset name cannot be an absolute path".into(),
        ));
    }

    Ok(())
}

/// Resolve and verify an asset path stays within the skill directory.
fn safe_asset_path(skill_dir: &Path, asset_name: &str) -> Result<std::path::PathBuf, SkillsError> {
    validate_asset_name(asset_name)?;
    let asset_path = skill_dir.join(asset_name);
    // Canonicalize if path exists, otherwise verify parent is within skill_dir
    if asset_path.exists() {
        let canonical = asset_path
            .canonicalize()
            .map_err(|e| SkillsError::Asset(format!("Cannot resolve asset path: {e}")))?;
        let canonical_dir = skill_dir
            .canonicalize()
            .map_err(|e| SkillsError::Asset(format!("Cannot resolve skill dir: {e}")))?;
        if !canonical.starts_with(&canonical_dir) {
            return Err(SkillsError::Asset("Invalid asset name".into()));
        }
    }
    Ok(asset_path)
}

/// Resolve a new asset's destination, checking parents before creating directories.
fn new_asset_path(skill_dir: &Path, asset_name: &str) -> Result<std::path::PathBuf, SkillsError> {
    if !skill_dir.exists() {
        return Err(SkillsError::NotFound(
            skill_dir.to_string_lossy().to_string(),
        ));
    }

    validate_asset_name(asset_name)?;
    let asset_path = skill_dir.join(asset_name);
    let canonical_dir = skill_dir.canonicalize()?;
    let parent = asset_path
        .parent()
        .ok_or_else(|| SkillsError::Asset("Invalid asset path".into()))?;
    let existing_parent = parent
        .ancestors()
        .find(|ancestor| ancestor.exists())
        .ok_or_else(|| SkillsError::Asset("Cannot resolve asset parent".into()))?;
    if !existing_parent.canonicalize()?.starts_with(&canonical_dir) {
        return Err(SkillsError::Asset(
            "Asset path escapes skill directory".into(),
        ));
    }

    tracepilot_core::utils::fs::ensure_parent_dir(&asset_path)?;
    let canonical_parent = parent.canonicalize()?;
    if !canonical_parent.starts_with(&canonical_dir) {
        return Err(SkillsError::Asset(
            "Asset path escapes skill directory".into(),
        ));
    }
    let name = asset_path
        .file_name()
        .ok_or_else(|| SkillsError::Asset("Invalid asset path".into()))?;
    Ok(canonical_parent.join(name))
}

fn duplicate_asset(asset_name: &str) -> SkillsError {
    SkillsError::Asset(format!(
        "Asset '{asset_name}' already exists. Choose a different name."
    ))
}

/// Publish a complete asset without overwriting an existing destination.
fn write_asset_file(
    skill_dir: &Path,
    asset_name: &str,
    permissions: Option<&std::fs::Permissions>,
    write_contents: impl FnOnce(&mut std::fs::File) -> std::io::Result<()>,
) -> Result<(), SkillsError> {
    let destination = new_asset_path(skill_dir, asset_name)?;
    if destination.symlink_metadata().is_ok() {
        return Err(duplicate_asset(asset_name));
    }
    let mut staged = tempfile::Builder::new()
        .prefix(".tracepilot-asset-")
        .tempfile_in(destination.parent().expect("validated asset parent"))?;
    write_contents(staged.as_file_mut())?;
    staged.as_file_mut().flush()?;
    if let Some(permissions) = permissions {
        staged.as_file().set_permissions(permissions.clone())?;
    }
    // The exclusive publish also handles another request winning after the
    // preflight check. On any failure, the owned temporary file is removed.
    let _persisted = staged.persist_noclobber(&destination).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            duplicate_asset(asset_name)
        } else {
            SkillsError::io_ctx(format!("Cannot create asset '{asset_name}'"), error.error)
        }
    })?;
    // tempfile clears Windows file attributes while publishing; restore the
    // copied source's read-only flag using the still-owned file handle.
    #[cfg(windows)]
    if let Some(permissions) = permissions {
        _persisted.set_permissions(permissions.clone())?;
    }
    Ok(())
}

/// Add a new file asset without replacing an existing asset.
pub fn add_asset(skill_dir: &Path, asset_name: &str, content: &[u8]) -> Result<(), SkillsError> {
    write_asset_file(skill_dir, asset_name, None, |destination| {
        destination.write_all(content)
    })
}

/// Copy a file into a new asset without replacing an existing destination.
pub fn copy_asset_from(
    skill_dir: &Path,
    asset_name: &str,
    source_path: &Path,
) -> Result<(), SkillsError> {
    if !skill_dir.exists() {
        return Err(SkillsError::NotFound(
            skill_dir.to_string_lossy().to_string(),
        ));
    }
    if !source_path.exists() {
        return Err(SkillsError::Asset(format!(
            "Source file '{}' not found",
            source_path.display()
        )));
    }

    let mut source = std::fs::File::open(source_path)?;
    let metadata = source.metadata()?;
    if !metadata.is_file() {
        return Err(SkillsError::Asset("Source path must be a file".into()));
    }
    write_asset_file(
        skill_dir,
        asset_name,
        Some(&metadata.permissions()),
        |destination| std::io::copy(&mut source, destination).map(|_| ()),
    )
}

/// Remove an asset from a skill directory.
pub fn remove_asset(skill_dir: &Path, asset_name: &str) -> Result<(), SkillsError> {
    let asset_path = safe_asset_path(skill_dir, asset_name)?;

    if !asset_path.exists() {
        return Err(SkillsError::Asset(format!(
            "Asset '{asset_name}' not found"
        )));
    }

    if asset_path.is_dir() {
        std::fs::remove_dir_all(&asset_path)?;
    } else {
        std::fs::remove_file(&asset_path)?;
    }

    Ok(())
}

/// Read the contents of a text asset.
pub fn read_asset(skill_dir: &Path, asset_name: &str) -> Result<String, SkillsError> {
    let asset_path = safe_asset_path(skill_dir, asset_name)?;

    if !asset_path.exists() {
        return Err(SkillsError::Asset(format!(
            "Asset '{asset_name}' not found"
        )));
    }
    Ok(std::fs::read_to_string(&asset_path)?)
}

#[cfg(test)]
mod tests;
