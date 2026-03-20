//! Git worktree management operations.

use crate::error::{OrchestratorError, Result};
use crate::types::{CreateWorktreeRequest, PruneResult, WorktreeInfo, WorktreeStatus};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Run a git command in the given directory, returning stdout on success.
fn git(repo_path: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(OrchestratorError::Git(stderr))
    }
}

/// List all worktrees for the repo at `repo_path`.
pub fn list_worktrees(repo_path: &Path) -> Result<Vec<WorktreeInfo>> {
    let output = git(repo_path, &["worktree", "list", "--porcelain"])?;
    parse_porcelain_output(&output)
}

/// Create a new worktree for `branch` at the specified (or auto-generated) path.
pub fn create_worktree(request: &CreateWorktreeRequest) -> Result<WorktreeInfo> {
    let repo = Path::new(&request.repo_path);

    // Determine target directory for the worktree
    let target = match &request.target_dir {
        Some(dir) => PathBuf::from(dir),
        None => {
            let parent = repo
                .parent()
                .ok_or_else(|| OrchestratorError::Git("Cannot find parent directory".into()))?;
            parent.join(format!(
                "{}-{}",
                repo.file_name()
                    .unwrap_or_default()
                    .to_string_lossy(),
                sanitize_branch_name(&request.branch)
            ))
        }
    };

    // Create the branch from base if specified, otherwise use existing branch or create
    let mut args = vec!["worktree", "add"];
    let target_str = target.to_string_lossy().to_string();
    args.push(&target_str);

    // If base_branch is specified, create a new branch from it
    let new_branch_arg;
    if let Some(base) = &request.base_branch {
        args.push("-b");
        args.push(&request.branch);
        new_branch_arg = base.clone();
        args.push(&new_branch_arg);
    } else {
        args.push(&request.branch);
    }

    git(repo, &args)?;

    // Read info about the newly created worktree
    let head = git(&target, &["rev-parse", "--short", "HEAD"]).unwrap_or_default();

    Ok(WorktreeInfo {
        path: target.to_string_lossy().to_string(),
        branch: request.branch.clone(),
        head_commit: head,
        is_main_worktree: false,
        is_bare: false,
        disk_usage_bytes: None,
        status: WorktreeStatus::Active,
        linked_session_id: None,
        created_at: Some(chrono::Utc::now().to_rfc3339()),
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
    Ok(())
}

/// Prune stale worktrees.
pub fn prune_worktrees(repo_path: &Path) -> Result<PruneResult> {
    // --dry-run first to capture what would be pruned
    let dry_run_output = git(repo_path, &["worktree", "prune", "--dry-run", "--verbose"])?;
    let messages: Vec<String> = dry_run_output
        .lines()
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect();
    let count = messages.len();

    // Actual prune
    git(repo_path, &["worktree", "prune"])?;

    Ok(PruneResult {
        pruned_count: count,
        messages,
    })
}

/// List branches for a repository.
pub fn list_branches(repo_path: &Path) -> Result<Vec<String>> {
    let output = git(repo_path, &["branch", "--format=%(refname:short)"])?;
    Ok(output
        .lines()
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect())
}

/// Get disk usage of a path (non-recursive for speed, estimated).
pub fn disk_usage_bytes(path: &Path) -> Result<u64> {
    let mut total: u64 = 0;
    if path.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let meta = entry.metadata()?;
            if meta.is_file() {
                total += meta.len();
            } else if meta.is_dir() {
                // Only go one level deep for speed
                if let Ok(subdir) = std::fs::read_dir(entry.path()) {
                    for sub_entry in subdir {
                        if let Ok(sub_entry) = sub_entry {
                            if let Ok(sub_meta) = sub_entry.metadata() {
                                total += sub_meta.len();
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(total)
}

// ─── Internal helpers ─────────────────────────────────────────────

/// Parse `git worktree list --porcelain` output into structured data.
fn parse_porcelain_output(raw: &str) -> Result<Vec<WorktreeInfo>> {
    let mut worktrees = Vec::new();
    let mut current_path = String::new();
    let mut current_branch = String::new();
    let mut current_head = String::new();
    let mut is_bare = false;
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
                ));
            }
            current_path = path.to_string();
            current_branch = String::new();
            current_head = String::new();
            is_bare = false;
            in_entry = true;
        } else if let Some(head) = line.strip_prefix("HEAD ") {
            current_head = head[..head.len().min(7)].to_string();
        } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            current_branch = branch.to_string();
        } else if line == "bare" {
            is_bare = true;
        } else if line == "detached" {
            current_branch = "(detached)".to_string();
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
        ));
    }

    Ok(worktrees)
}

fn build_worktree_info(
    path: &str,
    branch: &str,
    head: &str,
    is_bare: bool,
    is_first: bool,
) -> WorktreeInfo {
    WorktreeInfo {
        path: path.to_string(),
        branch: branch.to_string(),
        head_commit: head.to_string(),
        is_main_worktree: is_first,
        is_bare,
        disk_usage_bytes: None,
        status: WorktreeStatus::Active,
        linked_session_id: None,
        created_at: None,
    }
}

fn sanitize_branch_name(name: &str) -> String {
    name.replace('/', "-").replace(' ', "-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_branch_name() {
        assert_eq!(sanitize_branch_name("feature/my-feature"), "feature-my-feature");
        assert_eq!(sanitize_branch_name("my branch"), "my-branch");
    }

    #[test]
    fn test_parse_porcelain_empty() {
        let result = parse_porcelain_output("").unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_parse_porcelain_single() {
        let input = "worktree /home/user/repo\nHEAD abc1234def\nbranch refs/heads/main\n";
        let result = parse_porcelain_output(input).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].branch, "main");
        assert_eq!(result[0].head_commit, "abc1234");
        assert!(result[0].is_main_worktree);
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
        let result = parse_porcelain_output(input).unwrap();
        assert_eq!(result.len(), 2);
        assert!(result[0].is_main_worktree);
        assert!(!result[1].is_main_worktree);
        assert_eq!(result[1].branch, "feature/thing");
    }

    #[test]
    fn test_parse_porcelain_bare() {
        let input = "worktree /home/user/repo.git\nHEAD 0000000\nbare\n";
        let result = parse_porcelain_output(input).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].is_bare);
    }

    #[test]
    fn test_parse_porcelain_detached() {
        let input = "worktree /home/user/repo\nHEAD abc1234def\ndetached\n";
        let result = parse_porcelain_output(input).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].branch, "(detached)");
    }
}
