//! Git worktree management operations.

use crate::error::{OrchestratorError, Result};
use crate::types::{CreateWorktreeRequest, PruneResult, WorktreeDetails, WorktreeInfo, WorktreeStatus};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;
use tracepilot_core::utils::cache::TtlCache;

// ---------------------------------------------------------------------------
// Disk-usage TTL cache (P0 perf fix)
// ---------------------------------------------------------------------------

static DISK_USAGE_CACHE: LazyLock<TtlCache<String, u64>> =
    LazyLock::new(|| TtlCache::new(DISK_USAGE_TTL));

const DISK_USAGE_TTL: Duration = Duration::from_secs(60);

fn disk_usage_cache_key(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_lowercase()
}

/// Invalidate the disk-usage cache entry for a specific path.
pub fn invalidate_disk_usage_cache(path: &Path) {
    DISK_USAGE_CACHE.remove(&disk_usage_cache_key(path));
}

/// Run a git command in the given directory, returning stdout on success.
/// Uses a 30-second timeout to prevent hanging on network operations or slow repositories.
fn git(repo_path: &Path, args: &[&str]) -> Result<String> {
    let output = crate::process::run_hidden("git", args, Some(repo_path), Some(30))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(OrchestratorError::Git(stderr))
    }
}

/// Resolve the canonical git repository root for a path.
pub fn get_repo_root(path: &Path) -> Result<String> {
    git(path, &["rev-parse", "--show-toplevel"])
}

/// Check if a path is a valid git repository.
pub fn is_git_repo(path: &Path) -> bool {
    path.is_dir()
        && crate::process::run_hidden("git", &["rev-parse", "--git-dir"], Some(path), Some(5))
            .map(|o| o.status.success())
            .unwrap_or(false)
}

/// Get the default branch of a repository (usually "main" or "master").
/// Checks `init.defaultBranch` config, then falls back to HEAD of origin, then "main".
pub fn get_default_branch(repo_path: &Path) -> Result<String> {
    // Try symbolic-ref of origin/HEAD first (most reliable for cloned repos)
    if let Ok(ref_str) = git(repo_path, &["symbolic-ref", "refs/remotes/origin/HEAD"])
        && let Some(branch) = ref_str.strip_prefix("refs/remotes/origin/") {
            return Ok(branch.to_string());
        }
    // Fall back to the branch that HEAD points to in the main worktree
    if let Ok(head_ref) = git(repo_path, &["symbolic-ref", "--short", "HEAD"])
        && !head_ref.is_empty() {
            return Ok(head_ref);
        }
    // Last resort
    Ok("main".to_string())
}

/// Fetch the latest changes from the remote for a given branch.
pub fn fetch_remote(repo_path: &Path, branch: Option<&str>) -> Result<String> {
    let mut args = vec!["fetch", "origin"];
    if let Some(b) = branch {
        validate_branch_name(b)?;
        args.push(b);
    }
    args.push("--prune");
    git(repo_path, &args)
}

/// List all worktrees for the repo at `repo_path`.
pub fn list_worktrees(repo_path: &Path) -> Result<Vec<WorktreeInfo>> {
    let repo_root = get_repo_root(repo_path)?;
    let output = git(repo_path, &["worktree", "list", "--porcelain"])?;
    parse_porcelain_output(&output, &repo_root)
}

/// Create a new worktree for `branch` at the specified (or auto-generated) path.
pub fn create_worktree(request: &CreateWorktreeRequest) -> Result<WorktreeInfo> {
    let repo = Path::new(&request.repo_path);

    // Validate branch name via git
    validate_branch_name(&request.branch)?;

    // Determine target directory for the worktree
    let target = match &request.target_dir {
        Some(dir) => PathBuf::from(dir),
        None => {
            let parent = repo
                .parent()
                .ok_or_else(|| OrchestratorError::Worktree("Cannot find parent directory".into()))?;
            parent.join(format!(
                "{}-{}",
                repo.file_name()
                    .unwrap_or_default()
                    .to_string_lossy(),
                sanitize_branch_name(&request.branch)
            ))
        }
    };

    // Build git worktree add command
    let mut args = vec!["worktree", "add"];
    let target_str = target.to_string_lossy().to_string();
    args.push(&target_str);

    // Check if the branch already exists locally
    let branch_exists = git(repo, &["rev-parse", "--verify", &format!("refs/heads/{}", &request.branch)]).is_ok();

    let base_branch_owned: String;
    if !branch_exists {
        if let Some(base) = &request.base_branch {
            // Validate base branch to prevent git argument injection
            validate_branch_name(base)?;
            // Create new branch from base
            args.push("-b");
            args.push(&request.branch);
            base_branch_owned = base.clone();
            args.push(&base_branch_owned);
        } else {
            // Let git create the branch (will create from HEAD)
            args.push("-b");
            args.push(&request.branch);
        }
    } else {
        // Branch already exists — just check it out in the new worktree
        args.push(&request.branch);
    }

    git(repo, &args)?;

    // Invalidate disk-usage cache for the newly created worktree.
    invalidate_disk_usage_cache(&target);

    // Re-list worktrees to get authoritative info instead of constructing manually
    let all = list_worktrees(repo)?;
    let canonical_target = std::fs::canonicalize(&target)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| target_str.clone());

    all.into_iter()
        .find(|wt| {
            let wt_canonical = std::fs::canonicalize(&wt.path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| wt.path.clone());
            paths_equal(&wt_canonical, &canonical_target)
        })
        .map(|mut wt| {
            wt.created_at = Some(chrono::Utc::now().to_rfc3339());
            wt
        })
        .ok_or_else(|| {
            OrchestratorError::Worktree(
                "Worktree was created but could not be found in the worktree list".into(),
            )
        })
}

/// Remove a worktree at the given path.
pub fn remove_worktree(repo_path: &Path, worktree_path: &Path, force: bool) -> Result<()> {
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    let wt_str = worktree_path.to_string_lossy().to_string();
    args.push(&wt_str);

    git(repo_path, &args)?;
    invalidate_disk_usage_cache(worktree_path);
    Ok(())
}

/// Prune stale worktrees. Compares before/after lists to avoid race conditions.
pub fn prune_worktrees(repo_path: &Path) -> Result<PruneResult> {
    let before = list_worktrees(repo_path)?;

    git(repo_path, &["worktree", "prune"])?;

    let after = list_worktrees(repo_path)?;

    // Determine what was pruned by diffing before/after
    let after_paths: std::collections::HashSet<String> =
        after.iter().map(|w| w.path.clone()).collect();
    let messages: Vec<String> = before
        .iter()
        .filter(|w| !after_paths.contains(&w.path))
        .map(|w| {
            invalidate_disk_usage_cache(Path::new(&w.path));
            format!("Pruned: {} (branch: {})", w.path, w.branch)
        })
        .collect();
    let count = messages.len();

    Ok(PruneResult {
        pruned_count: count,
        messages,
    })
}

/// List branches for a repository (local + remote, deduplicated).
pub fn list_branches(repo_path: &Path) -> Result<Vec<String>> {
    let output = git(
        repo_path,
        &["branch", "-a", "--format=%(refname:short)"],
    )?;

    let mut seen = std::collections::HashSet::new();
    let mut branches = Vec::new();

    for line in output.lines() {
        let name = line.trim();
        if name.is_empty() {
            continue;
        }
        // Filter out symbolic refs like "origin/HEAD"
        if name.ends_with("/HEAD") {
            continue;
        }
        // For remote branches like "origin/main", strip the remote prefix for dedup
        let canonical = if let Some(stripped) = name.strip_prefix("origin/") {
            stripped.to_string()
        } else {
            name.to_string()
        };
        // If we haven't seen this branch name (local or remote), add it
        if seen.insert(canonical.clone()) {
            // Prefer local name (without origin/ prefix)
            branches.push(canonical);
        }
    }

    branches.sort();
    Ok(branches)
}

/// Lock a worktree to prevent it from being pruned.
pub fn lock_worktree(repo_path: &Path, worktree_path: &Path, reason: Option<&str>) -> Result<()> {
    let wt_str = worktree_path.to_string_lossy().to_string();
    let mut args = vec!["worktree", "lock", &wt_str];
    let reason_str;
    if let Some(r) = reason {
        args.push("--reason");
        reason_str = r.to_string();
        args.push(&reason_str);
    }
    git(repo_path, &args)?;
    Ok(())
}

/// Unlock a worktree.
pub fn unlock_worktree(repo_path: &Path, worktree_path: &Path) -> Result<()> {
    let wt_str = worktree_path.to_string_lossy().to_string();
    git(repo_path, &["worktree", "unlock", &wt_str])?;
    Ok(())
}

/// Get detailed status for a specific worktree (on-demand, not called during list).
pub fn get_worktree_details(worktree_path: &Path) -> Result<WorktreeDetails> {
    let path_str = worktree_path.to_string_lossy().to_string();

    // Uncommitted changes count
    let status_output = git(worktree_path, &["status", "--porcelain"]).unwrap_or_default();
    let uncommitted_count = status_output.lines().filter(|l| !l.is_empty()).count();

    // Ahead/behind tracking: try upstream first, then fall back to origin default branch
    let (ahead, behind) = {
        let parse_count = |output: &str| -> (usize, usize) {
            let parts: Vec<&str> = output.split_whitespace().collect();
            if parts.len() == 2 {
                (parts[0].parse().unwrap_or(0), parts[1].parse().unwrap_or(0))
            } else {
                (0, 0)
            }
        };

        if let Ok(output) = git(
            worktree_path,
            &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        ) {
            parse_count(&output)
        } else if let Ok(default_branch) = get_default_branch(worktree_path) {
            // No upstream — compare against origin/default_branch
            let remote_ref = format!("origin/{}", default_branch);
            if let Ok(output) = git(
                worktree_path,
                &["rev-list", "--left-right", "--count", &format!("HEAD...{}", remote_ref)],
            ) {
                parse_count(&output)
            } else {
                (0, 0)
            }
        } else {
            (0, 0)
        }
    };

    Ok(WorktreeDetails {
        path: path_str,
        uncommitted_count,
        ahead,
        behind,
    })
}

/// Get disk usage of a path (fully recursive), with a 30-second TTL cache.
pub fn disk_usage_bytes(path: &Path) -> Result<u64> {
    let key = disk_usage_cache_key(path);

    if let Some(bytes) = DISK_USAGE_CACHE.get(&key) {
        return Ok(bytes);
    }

    let mut total: u64 = 0;
    if path.is_dir() {
        for entry in walkdir::WalkDir::new(path)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() {
                total += entry.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }

    DISK_USAGE_CACHE.insert(key, total);
    Ok(total)
}

/// Validate a branch name using git check-ref-format.
pub fn validate_branch_name(name: &str) -> Result<()> {
    if name.is_empty() {
        return Err(OrchestratorError::Worktree("Branch name cannot be empty".into()));
    }
    // Use git check-ref-format to validate (5s timeout for local check)
    let output = crate::process::run_hidden("git", &["check-ref-format", "--branch", name], None, Some(5))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(OrchestratorError::Worktree(format!(
            "Invalid branch name: {name}"
        )))
    }
}

// ─── Internal helpers ─────────────────────────────────────────────

/// Parse `git worktree list --porcelain` output into structured data.
fn parse_porcelain_output(raw: &str, repo_root: &str) -> Result<Vec<WorktreeInfo>> {
    let mut worktrees = Vec::new();
    let mut current_path = String::new();
    let mut current_branch = String::new();
    let mut current_head = String::new();
    let mut is_bare = false;
    let mut is_locked = false;
    let mut locked_reason: Option<String> = None;
    let mut in_entry = false;

    for line in raw.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            if in_entry && !current_path.is_empty() {
                worktrees.push(build_worktree_info(
                    &current_path,
                    &current_branch,
                    &current_head,
                    is_bare,
                    worktrees.is_empty(),
                    is_locked,
                    locked_reason.take(),
                    repo_root,
                ));
            }
            current_path = path.to_string();
            current_branch = String::new();
            current_head = String::new();
            is_bare = false;
            is_locked = false;
            locked_reason = None;
            in_entry = true;
        } else if let Some(head) = line.strip_prefix("HEAD ") {
            current_head = head[..head.len().min(7)].to_string();
        } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            current_branch = branch.to_string();
        } else if line == "bare" {
            is_bare = true;
        } else if line == "detached" {
            current_branch = "(detached)".to_string();
        } else if line == "locked" {
            is_locked = true;
        } else if let Some(reason) = line.strip_prefix("locked ") {
            is_locked = true;
            locked_reason = Some(reason.to_string());
        }
    }

    // Flush last entry
    if in_entry && !current_path.is_empty() {
        worktrees.push(build_worktree_info(
            &current_path,
            &current_branch,
            &current_head,
            is_bare,
            worktrees.is_empty(),
            is_locked,
            locked_reason,
            repo_root,
        ));
    }

    Ok(worktrees)
}

#[allow(clippy::too_many_arguments)]
fn build_worktree_info(
    path: &str,
    branch: &str,
    head: &str,
    is_bare: bool,
    is_first: bool,
    is_locked: bool,
    locked_reason: Option<String>,
    repo_root: &str,
) -> WorktreeInfo {
    // Determine status: path must exist on disk to be "Active"
    let status = if Path::new(path).exists() {
        WorktreeStatus::Active
    } else {
        WorktreeStatus::Stale
    };

    WorktreeInfo {
        path: path.to_string(),
        branch: branch.to_string(),
        head_commit: head.to_string(),
        is_main_worktree: is_first,
        is_bare,
        disk_usage_bytes: None,
        status,
        is_locked,
        locked_reason,
        linked_session_id: None,
        created_at: None,
        repo_root: repo_root.to_string(),
    }
}

fn sanitize_branch_name(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | ' ' | '~' | '^' | ':' | '?' | '*' | '[' | ']' | '\\' | '<' | '>' | '|'
            | '"' => '-',
            _ => c,
        })
        .collect()
}

/// Case-insensitive path comparison on Windows, case-sensitive elsewhere.
fn paths_equal(a: &str, b: &str) -> bool {
    #[cfg(windows)]
    {
        a.eq_ignore_ascii_case(b)
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_sanitize_branch_name() {
        assert_eq!(sanitize_branch_name("feature/my-feature"), "feature-my-feature");
        assert_eq!(sanitize_branch_name("my branch"), "my-branch");
        assert_eq!(sanitize_branch_name("test~1"), "test-1");
        assert_eq!(sanitize_branch_name("foo^bar"), "foo-bar");
        assert_eq!(sanitize_branch_name("a:b?c*d"), "a-b-c-d");
        assert_eq!(sanitize_branch_name("a[b]c"), "a-b-c");
        assert_eq!(sanitize_branch_name("a\\b"), "a-b");
        assert_eq!(sanitize_branch_name("a<b>c"), "a-b-c");
        assert_eq!(sanitize_branch_name("a|b"), "a-b");
        assert_eq!(sanitize_branch_name("clean-name"), "clean-name");
    }

    #[test]
    fn test_parse_porcelain_empty() {
        let result = parse_porcelain_output("", "/repo").unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_parse_porcelain_single() {
        let input = "worktree /home/user/repo\nHEAD abc1234def\nbranch refs/heads/main\n";
        let result = parse_porcelain_output(input, "/home/user/repo").unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].branch, "main");
        assert_eq!(result[0].head_commit, "abc1234");
        assert!(result[0].is_main_worktree);
        assert!(!result[0].is_locked);
        assert_eq!(result[0].repo_root, "/home/user/repo");
    }

    #[test]
    fn test_parse_porcelain_multiple() {
        let input = "\
worktree /home/user/repo
HEAD abc1234def
branch refs/heads/main

worktree /home/user/repo-feature
HEAD def5678abc
branch refs/heads/feature/thing
";
        let result = parse_porcelain_output(input, "/home/user/repo").unwrap();
        assert_eq!(result.len(), 2);
        assert!(result[0].is_main_worktree);
        assert!(!result[1].is_main_worktree);
        assert_eq!(result[1].branch, "feature/thing");
    }

    #[test]
    fn test_parse_porcelain_bare() {
        let input = "worktree /home/user/repo.git\nHEAD 0000000\nbare\n";
        let result = parse_porcelain_output(input, "/home/user/repo.git").unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].is_bare);
    }

    #[test]
    fn test_parse_porcelain_detached() {
        let input = "worktree /home/user/repo\nHEAD abc1234def\ndetached\n";
        let result = parse_porcelain_output(input, "/home/user/repo").unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].branch, "(detached)");
    }

    #[test]
    fn test_parse_porcelain_locked() {
        let input = "\
worktree /home/user/repo
HEAD abc1234def
branch refs/heads/main

worktree /home/user/repo-wt
HEAD def5678abc
branch refs/heads/feature
locked

worktree /home/user/repo-wt2
HEAD ghi9012bcd
branch refs/heads/fix
locked in use by CI
";
        let result = parse_porcelain_output(input, "/home/user/repo").unwrap();
        assert_eq!(result.len(), 3);
        assert!(!result[0].is_locked);
        assert!(result[1].is_locked);
        assert_eq!(result[1].locked_reason, None);
        assert!(result[2].is_locked);
        assert_eq!(result[2].locked_reason, Some("in use by CI".to_string()));
    }

    #[test]
    fn test_paths_equal() {
        #[cfg(windows)]
        {
            assert!(paths_equal("C:\\Git\\Repo", "c:\\git\\repo"));
            assert!(!paths_equal("C:\\Git\\Repo", "C:\\Git\\Other"));
        }
        #[cfg(not(windows))]
        {
            assert!(paths_equal("/home/user/repo", "/home/user/repo"));
            assert!(!paths_equal("/home/user/Repo", "/home/user/repo"));
        }
    }

    #[test]
    fn test_disk_usage_cache_requires_invalidation_to_refresh() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        let file = path.join("trace.log");

        fs::write(&file, vec![0_u8; 4]).unwrap();
        invalidate_disk_usage_cache(path);

        let first = disk_usage_bytes(path).unwrap();
        assert_eq!(first, 4);

        fs::write(&file, vec![0_u8; 9]).unwrap();

        let cached = disk_usage_bytes(path).unwrap();
        assert_eq!(cached, 4);

        invalidate_disk_usage_cache(path);
        let refreshed = disk_usage_bytes(path).unwrap();
        assert_eq!(refreshed, 9);
    }
}
