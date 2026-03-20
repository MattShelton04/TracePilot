//! Repository registry: persistent list of git repos known to TracePilot.
//!
//! Stores registered repos in a JSON file with atomic writes and
//! path canonicalization for robustness. A process-level mutex
//! serializes all read-modify-write operations to prevent races.

use crate::error::{OrchestratorError, Result};
use crate::types::{RegisteredRepo, RepoSource};
use crate::worktrees;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const SCHEMA_VERSION: u32 = 1;

/// Process-level lock serializing all registry file operations.
static REGISTRY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryFile {
    schema_version: u32,
    repos: Vec<RegisteredRepo>,
}

/// Get the path to the registry JSON file.
fn registry_path() -> Result<PathBuf> {
    let home = home_dir().ok_or_else(|| {
        OrchestratorError::Registry("Cannot determine home directory".into())
    })?;
    let dir = home.join(".copilot").join("tracepilot");
    Ok(dir.join("repo-registry.json"))
}

/// Ensure the parent directory exists.
fn ensure_dir(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}

/// Read the registry from disk. Returns empty registry if file doesn't exist.
fn read_registry() -> Result<RegistryFile> {
    let path = registry_path()?;
    if !path.exists() {
        return Ok(RegistryFile {
            schema_version: SCHEMA_VERSION,
            repos: Vec::new(),
        });
    }
    let data = std::fs::read_to_string(&path)?;
    let registry: RegistryFile = serde_json::from_str(&data)?;
    Ok(registry)
}

/// Write the registry to disk atomically (write to temp, then rename).
/// On Windows, removes the target first since rename doesn't overwrite.
fn write_registry(registry: &RegistryFile) -> Result<()> {
    let path = registry_path()?;
    ensure_dir(&path)?;

    let json = serde_json::to_string_pretty(registry)?;
    let temp_path = path.with_extension("json.tmp");
    std::fs::write(&temp_path, &json)?;

    // On Windows, rename fails if target exists; remove first
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    std::fs::rename(&temp_path, &path)?;
    Ok(())
}

/// Normalize a path for deduplication. On Windows, lowercases for
/// case-insensitive comparison. Uses forward slashes consistently.
fn normalize_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    #[cfg(windows)]
    {
        trimmed.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        trimmed.to_string()
    }
}

/// Extract repo name from path (last path component).
fn repo_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

// ─── Public API ───────────────────────────────────────────────────

/// List all registered repos.
pub fn list_registered_repos() -> Result<Vec<RegisteredRepo>> {
    let _guard = REGISTRY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let registry = read_registry()?;
    Ok(registry.repos)
}

/// Add a repo to the registry. Returns the registered entry.
/// Deduplicates by normalized path.
pub fn add_repo(path: &str, source: RepoSource) -> Result<RegisteredRepo> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(OrchestratorError::Registry(format!(
            "Path does not exist: {path}"
        )));
    }
    if !worktrees::is_git_repo(p) {
        return Err(OrchestratorError::Registry(format!(
            "Path is not a git repository: {path}"
        )));
    }

    // Resolve to canonical repo root
    let root = worktrees::get_repo_root(p)?;
    let normalized = normalize_path(&root);

    let _guard = REGISTRY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut registry = read_registry()?;

    // Check for duplicates
    if registry
        .repos
        .iter()
        .any(|r| normalize_path(&r.path) == normalized)
    {
        // Already registered — update last_used_at and return
        let repo = registry
            .repos
            .iter_mut()
            .find(|r| normalize_path(&r.path) == normalized)
            .unwrap();
        repo.last_used_at = Some(chrono::Utc::now().to_rfc3339());
        let result = repo.clone();
        write_registry(&registry)?;
        return Ok(result);
    }

    let repo = RegisteredRepo {
        path: root.clone(),
        name: repo_name_from_path(&root),
        added_at: chrono::Utc::now().to_rfc3339(),
        last_used_at: None,
        source,
    };

    registry.repos.push(repo.clone());
    write_registry(&registry)?;
    Ok(repo)
}

/// Remove a repo from the registry by path.
pub fn remove_repo(path: &str) -> Result<()> {
    let normalized = normalize_path(path);
    let _guard = REGISTRY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut registry = read_registry()?;
    let before = registry.repos.len();
    registry
        .repos
        .retain(|r| normalize_path(&r.path) != normalized);
    if registry.repos.len() == before {
        return Err(OrchestratorError::NotFound(format!(
            "Repo not found in registry: {path}"
        )));
    }
    write_registry(&registry)?;
    Ok(())
}

/// Update the last_used_at timestamp for a repo.
pub fn update_last_used(path: &str) -> Result<()> {
    let normalized = normalize_path(path);
    let _guard = REGISTRY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut registry = read_registry()?;
    if let Some(repo) = registry
        .repos
        .iter_mut()
        .find(|r| normalize_path(&r.path) == normalized)
    {
        repo.last_used_at = Some(chrono::Utc::now().to_rfc3339());
        write_registry(&registry)?;
    }
    Ok(())
}

/// Discover repos from a list of session CWD paths.
/// Resolves each CWD to its git root, deduplicates, and registers new repos.
/// Returns only the newly added repos.
pub fn discover_repos_from_sessions(session_cwds: &[String]) -> Result<Vec<RegisteredRepo>> {
    // Read existing registry (under lock) to get the dedup set
    let existing: std::collections::HashSet<String> = {
        let _guard = REGISTRY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let registry = read_registry()?;
        registry
            .repos
            .iter()
            .map(|r| normalize_path(&r.path))
            .collect()
    };

    let mut new_repos = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for cwd in session_cwds {
        let p = Path::new(cwd);
        if !p.exists() || !worktrees::is_git_repo(p) {
            continue;
        }

        if let Ok(root) = worktrees::get_repo_root(p) {
            let normalized = normalize_path(&root);
            if !existing.contains(&normalized) && seen.insert(normalized) {
                // add_repo acquires its own lock internally
                match add_repo(&root, RepoSource::SessionDiscovery) {
                    Ok(repo) => new_repos.push(repo),
                    Err(_) => continue,
                }
            }
        }
    }

    Ok(new_repos)
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").map(PathBuf::from).ok()
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME").map(PathBuf::from).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_path() {
        #[cfg(windows)]
        {
            assert_eq!(
                normalize_path("C:\\Git\\MyRepo\\"),
                "c:/git/myrepo"
            );
            assert_eq!(
                normalize_path("C:\\Git\\MyRepo"),
                "c:/git/myrepo"
            );
        }
        #[cfg(not(windows))]
        {
            assert_eq!(normalize_path("/home/user/repo/"), "/home/user/repo");
            assert_eq!(normalize_path("/home/user/repo"), "/home/user/repo");
        }
    }

    #[test]
    fn test_repo_name_from_path() {
        assert_eq!(repo_name_from_path("C:\\git\\MyProject"), "MyProject");
        assert_eq!(repo_name_from_path("/home/user/my-repo"), "my-repo");
    }

    #[test]
    fn test_registry_file_roundtrip() {
        let registry = RegistryFile {
            schema_version: SCHEMA_VERSION,
            repos: vec![RegisteredRepo {
                path: "/test/repo".into(),
                name: "repo".into(),
                added_at: "2025-01-01T00:00:00Z".into(),
                last_used_at: None,
                source: RepoSource::Manual,
            }],
        };
        let json = serde_json::to_string_pretty(&registry).unwrap();
        let parsed: RegistryFile = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.schema_version, SCHEMA_VERSION);
        assert_eq!(parsed.repos.len(), 1);
        assert_eq!(parsed.repos[0].source, RepoSource::Manual);
    }
}
