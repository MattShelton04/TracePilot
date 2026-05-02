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

/// Helper to acquire the registry lock, handling poisoned mutexes.
///
/// Returns the lock guard if successful, or the inner mutex guard
/// if the mutex was poisoned (indicating a previous thread panic).
fn registry_lock() -> std::sync::MutexGuard<'static, ()> {
    REGISTRY_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryFile {
    schema_version: u32,
    repos: Vec<RegisteredRepo>,
}

/// Get the path to the registry JSON file.
fn registry_path() -> Result<PathBuf> {
    let home = tracepilot_core::paths::default_copilot_home_opt()
        .ok_or_else(|| OrchestratorError::Registry("Cannot determine home directory".into()))?;
    Ok(tracepilot_core::paths::CopilotPaths::from_home(home)
        .tracepilot()
        .repo_registry_json())
}

fn registry_path_in(tracepilot_home: &Path) -> PathBuf {
    tracepilot_core::paths::TracePilotPaths::from_root(tracepilot_home).repo_registry_json()
}

/// Read the registry from disk. Returns empty registry if file doesn't exist.
fn read_registry() -> Result<RegistryFile> {
    let path = registry_path()?;
    read_registry_from_path(&path)
}

fn read_registry_from_path(path: &Path) -> Result<RegistryFile> {
    if !path.exists() {
        return Ok(RegistryFile {
            schema_version: SCHEMA_VERSION,
            repos: Vec::new(),
        });
    }
    let data = std::fs::read_to_string(path)?;
    let registry: RegistryFile = serde_json::from_str(&data)?;
    Ok(registry)
}

fn write_registry_to_path(path: &Path, registry: &RegistryFile) -> Result<()> {
    crate::json_io::atomic_json_write(path, registry)
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
    let _guard = registry_lock();
    let registry = read_registry()?;
    Ok(registry.repos)
}

pub fn list_registered_repos_in(tracepilot_home: &Path) -> Result<Vec<RegisteredRepo>> {
    let _guard = registry_lock();
    let registry = read_registry_from_path(&registry_path_in(tracepilot_home))?;
    Ok(registry.repos)
}

/// Add a repo to the registry. Returns the registered entry.
/// Deduplicates by normalized path.
pub fn add_repo(path: &str, source: RepoSource) -> Result<RegisteredRepo> {
    let registry_path = registry_path()?;
    add_repo_at_path(&registry_path, path, source)
}

pub fn add_repo_in(
    tracepilot_home: &Path,
    path: &str,
    source: RepoSource,
) -> Result<RegisteredRepo> {
    add_repo_at_path(&registry_path_in(tracepilot_home), path, source)
}

fn add_repo_at_path(
    registry_path: &Path,
    path: &str,
    source: RepoSource,
) -> Result<RegisteredRepo> {
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

    let _guard = registry_lock();
    let mut registry = read_registry_from_path(registry_path)?;

    // Check for duplicates — single traversal to find and update
    if let Some(repo) = registry
        .repos
        .iter_mut()
        .find(|r| normalize_path(&r.path) == normalized)
    {
        repo.last_used_at = Some(chrono::Utc::now().to_rfc3339());
        let result = repo.clone();
        write_registry_to_path(registry_path, &registry)?;
        return Ok(result);
    }

    let repo = RegisteredRepo {
        path: root.clone(),
        name: repo_name_from_path(&root),
        added_at: chrono::Utc::now().to_rfc3339(),
        last_used_at: None,
        source,
        favourite: false,
    };

    registry.repos.push(repo.clone());
    write_registry_to_path(registry_path, &registry)?;
    Ok(repo)
}

/// Remove a repo from the registry by path.
pub fn remove_repo(path: &str) -> Result<()> {
    let registry_path = registry_path()?;
    remove_repo_at_path(&registry_path, path)
}

pub fn remove_repo_in(tracepilot_home: &Path, path: &str) -> Result<()> {
    remove_repo_at_path(&registry_path_in(tracepilot_home), path)
}

fn remove_repo_at_path(registry_path: &Path, path: &str) -> Result<()> {
    let normalized = normalize_path(path);
    let _guard = registry_lock();
    let mut registry = read_registry_from_path(registry_path)?;
    let before = registry.repos.len();
    registry
        .repos
        .retain(|r| normalize_path(&r.path) != normalized);
    if registry.repos.len() == before {
        return Err(OrchestratorError::NotFound(format!(
            "Repo not found in registry: {path}"
        )));
    }
    write_registry_to_path(registry_path, &registry)?;
    Ok(())
}

/// Update the last_used_at timestamp for a repo.
pub fn update_last_used(path: &str) -> Result<()> {
    let registry_path = registry_path()?;
    update_last_used_at_path(&registry_path, path)
}

pub fn update_last_used_in(tracepilot_home: &Path, path: &str) -> Result<()> {
    update_last_used_at_path(&registry_path_in(tracepilot_home), path)
}

fn update_last_used_at_path(registry_path: &Path, path: &str) -> Result<()> {
    let normalized = normalize_path(path);
    let _guard = registry_lock();
    let mut registry = read_registry_from_path(registry_path)?;
    if let Some(repo) = registry
        .repos
        .iter_mut()
        .find(|r| normalize_path(&r.path) == normalized)
    {
        repo.last_used_at = Some(chrono::Utc::now().to_rfc3339());
        write_registry_to_path(registry_path, &registry)?;
    }
    Ok(())
}

/// Toggle the favourite status of a registered repo.
pub fn toggle_repo_favourite(path: &str) -> Result<bool> {
    let registry_path = registry_path()?;
    toggle_repo_favourite_at_path(&registry_path, path)
}

pub fn toggle_repo_favourite_in(tracepilot_home: &Path, path: &str) -> Result<bool> {
    toggle_repo_favourite_at_path(&registry_path_in(tracepilot_home), path)
}

fn toggle_repo_favourite_at_path(registry_path: &Path, path: &str) -> Result<bool> {
    let normalized = normalize_path(path);
    let _guard = REGISTRY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut registry = read_registry_from_path(registry_path)?;
    if let Some(repo) = registry
        .repos
        .iter_mut()
        .find(|r| normalize_path(&r.path) == normalized)
    {
        repo.favourite = !repo.favourite;
        let new_state = repo.favourite;
        write_registry_to_path(registry_path, &registry)?;
        Ok(new_state)
    } else {
        Err(OrchestratorError::NotFound(format!(
            "Repo not found in registry: {path}"
        )))
    }
}

/// Discover repos from a list of session CWD paths.
/// Resolves each CWD to its git root, deduplicates, and registers new repos.
/// Returns only the newly added repos.
pub fn discover_repos_from_sessions(session_cwds: &[String]) -> Result<Vec<RegisteredRepo>> {
    let registry_path = registry_path()?;
    discover_repos_from_sessions_at_path(&registry_path, session_cwds)
}

pub fn discover_repos_from_sessions_in(
    tracepilot_home: &Path,
    session_cwds: &[String],
) -> Result<Vec<RegisteredRepo>> {
    discover_repos_from_sessions_at_path(&registry_path_in(tracepilot_home), session_cwds)
}

fn discover_repos_from_sessions_at_path(
    registry_path: &Path,
    session_cwds: &[String],
) -> Result<Vec<RegisteredRepo>> {
    // Read existing registry (under lock) to get the dedup set
    let existing: std::collections::HashSet<String> = {
        let _guard = REGISTRY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let registry = read_registry_from_path(registry_path)?;
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
                // add_repo_at_path acquires its own lock internally
                match add_repo_at_path(registry_path, &root, RepoSource::SessionDiscovery) {
                    Ok(repo) => new_repos.push(repo),
                    Err(_) => continue,
                }
            }
        }
    }

    Ok(new_repos)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_path() {
        #[cfg(windows)]
        {
            assert_eq!(normalize_path("C:\\Git\\MyRepo\\"), "c:/git/myrepo");
            assert_eq!(normalize_path("C:\\Git\\MyRepo"), "c:/git/myrepo");
        }
        #[cfg(not(windows))]
        {
            assert_eq!(normalize_path("/home/user/repo/"), "/home/user/repo");
            assert_eq!(normalize_path("/home/user/repo"), "/home/user/repo");
        }
    }

    #[test]
    fn test_repo_name_from_path() {
        #[cfg(windows)]
        {
            assert_eq!(repo_name_from_path("C:\\git\\MyProject"), "MyProject");
            assert_eq!(repo_name_from_path("C:\\git\\MyProject\\"), "MyProject");
        }
        #[cfg(not(windows))]
        {
            assert_eq!(repo_name_from_path("/home/user/my-repo"), "my-repo");
            assert_eq!(repo_name_from_path("/home/user/my-repo/"), "my-repo");
        }
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
                favourite: false,
            }],
        };
        let json = serde_json::to_string_pretty(&registry).unwrap();
        let parsed: RegistryFile = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.schema_version, SCHEMA_VERSION);
        assert_eq!(parsed.repos.len(), 1);
        assert_eq!(parsed.repos[0].source, RepoSource::Manual);
    }
}
