//! Skill asset management — list, add, remove files in skill directories.

use crate::json_io::atomic_write;
use crate::skills::error::SkillsError;
use crate::skills::types::SkillAsset;
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

/// Add a file asset to a skill directory.
pub fn add_asset(skill_dir: &Path, asset_name: &str, content: &[u8]) -> Result<(), SkillsError> {
    if !skill_dir.exists() {
        return Err(SkillsError::NotFound(
            skill_dir.to_string_lossy().to_string(),
        ));
    }

    validate_asset_name(asset_name)?;

    let asset_path = skill_dir.join(asset_name);
    if let Some(parent) = asset_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Verify canonical path stays within skill_dir (prevents symlink escape)
    let canonical_dir = skill_dir.canonicalize()?;
    let canonical_asset = asset_path.canonicalize().or_else(|_| {
        // File doesn't exist yet — check the parent is contained
        if let Some(parent) = asset_path.parent() {
            let canonical_parent = parent.canonicalize()?;
            if !canonical_parent.starts_with(&canonical_dir) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "Asset path escapes skill directory",
                ));
            }
            Ok(asset_path.clone())
        } else {
            Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Invalid asset path",
            ))
        }
    })?;

    if canonical_asset != asset_path {
        // File already exists — verify canonical containment
        if !canonical_asset.starts_with(&canonical_dir) {
            return Err(SkillsError::Asset(
                "Asset path escapes skill directory".into(),
            ));
        }
    }

    atomic_write(&asset_path, content)?;

    Ok(())
}

/// Copy a file from a source path into a skill directory as an asset.
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

    validate_asset_name(asset_name)?;

    let asset_path = skill_dir.join(asset_name);
    if let Some(parent) = asset_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Verify canonical path stays within skill_dir
    let canonical_dir = skill_dir.canonicalize()?;
    if let Some(parent) = asset_path.parent() {
        let canonical_parent = parent.canonicalize()?;
        if !canonical_parent.starts_with(&canonical_dir) {
            return Err(SkillsError::Asset(
                "Asset path escapes skill directory".into(),
            ));
        }
    }

    std::fs::copy(source_path, &asset_path)?;
    Ok(())
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
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_skill_with_assets(dir: &TempDir) -> std::path::PathBuf {
        let skill_dir = dir.path().join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: my-skill\ndescription: test\n---\n",
        )
        .unwrap();
        std::fs::write(skill_dir.join("helper.py"), "# python helper").unwrap();
        std::fs::write(skill_dir.join("config.json"), "{}").unwrap();
        skill_dir
    }

    #[test]
    fn list_assets_excludes_skill_md() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill_with_assets(&dir);

        let assets = list_assets(&skill_dir).unwrap();
        assert_eq!(assets.len(), 2);
        let names: Vec<_> = assets.iter().map(|a| a.name.as_str()).collect();
        assert!(names.contains(&"helper.py"));
        assert!(names.contains(&"config.json"));
        assert!(!names.contains(&"SKILL.md"));
    }

    #[test]
    fn list_assets_nonexistent_dir_errors() {
        let result = list_assets(Path::new("/nonexistent/path"));
        assert!(result.is_err());
    }

    #[test]
    fn add_asset_creates_file() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill_with_assets(&dir);

        add_asset(&skill_dir, "new-file.txt", b"hello").unwrap();
        assert!(skill_dir.join("new-file.txt").exists());
    }

    #[test]
    fn add_asset_rejects_skill_md_overwrite() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill_with_assets(&dir);

        let result = add_asset(&skill_dir, "SKILL.md", b"overwrite");
        assert!(result.is_err());
    }

    #[test]
    fn add_asset_rejects_path_traversal() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill_with_assets(&dir);

        assert!(add_asset(&skill_dir, "../escape.txt", b"evil").is_err());
        assert!(add_asset(&skill_dir, "/absolute.txt", b"evil").is_err());
    }

    #[test]
    fn remove_asset_deletes_file() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill_with_assets(&dir);

        remove_asset(&skill_dir, "helper.py").unwrap();
        assert!(!skill_dir.join("helper.py").exists());
    }

    #[test]
    fn remove_asset_rejects_skill_md() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill_with_assets(&dir);

        let result = remove_asset(&skill_dir, "SKILL.md");
        assert!(result.is_err());
    }

    #[test]
    fn remove_nonexistent_asset_errors() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill_with_assets(&dir);

        let result = remove_asset(&skill_dir, "ghost.txt");
        assert!(result.is_err());
    }

    #[test]
    fn read_asset_returns_content() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill_with_assets(&dir);

        let content = read_asset(&skill_dir, "helper.py").unwrap();
        assert_eq!(content, "# python helper");
    }

    #[test]
    fn read_nonexistent_asset_errors() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill_with_assets(&dir);

        let result = read_asset(&skill_dir, "missing.txt");
        assert!(result.is_err());
    }

    #[test]
    fn remove_asset_rejects_path_traversal() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill_with_assets(&dir);

        assert!(remove_asset(&skill_dir, "../escape.txt").is_err());
        assert!(remove_asset(&skill_dir, "/absolute.txt").is_err());
        assert!(remove_asset(&skill_dir, "..\\escape.txt").is_err());
    }

    #[test]
    fn read_asset_rejects_path_traversal() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill_with_assets(&dir);

        assert!(read_asset(&skill_dir, "../escape.txt").is_err());
        assert!(read_asset(&skill_dir, "/absolute.txt").is_err());
        assert!(read_asset(&skill_dir, "..\\escape.txt").is_err());
    }

    #[test]
    fn validate_asset_name_rejects_empty() {
        assert!(validate_asset_name("").is_err());
    }

    #[test]
    fn validate_asset_name_rejects_skill_md() {
        assert!(validate_asset_name("SKILL.md").is_err());
    }

    #[test]
    fn read_asset_nested_path_works() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill_with_assets(&dir);
        let sub_dir = skill_dir.join("scripts");
        std::fs::create_dir_all(&sub_dir).unwrap();
        std::fs::write(sub_dir.join("run.ps1"), "echo hello").unwrap();

        let content = read_asset(&skill_dir, "scripts/run.ps1").unwrap();
        assert_eq!(content, "echo hello");
    }

    #[test]
    fn validate_asset_name_allows_nested_paths() {
        assert!(validate_asset_name("subdir/file.txt").is_ok());
        assert!(validate_asset_name("deep/nested/file.md").is_ok());
    }

    #[test]
    fn list_assets_includes_subdirectories() {
        let dir = TempDir::new().unwrap();
        let skill_dir = setup_skill_with_assets(&dir);
        let sub_dir = skill_dir.join("sub");
        std::fs::create_dir_all(&sub_dir).unwrap();
        std::fs::write(sub_dir.join("nested.txt"), "nested").unwrap();

        let assets = list_assets(&skill_dir).unwrap();
        let dirs: Vec<_> = assets.iter().filter(|a| a.is_directory).collect();
        assert_eq!(dirs.len(), 1);
        assert_eq!(dirs[0].name, "sub");
    }
}
