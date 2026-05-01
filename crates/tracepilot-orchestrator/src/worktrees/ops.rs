use super::cache::invalidate_disk_usage_cache;
use super::git::{get_default_branch, get_repo_root, git, validate_branch_name};
use super::parser::{parse_porcelain_output, paths_equal, sanitize_branch_name};
use crate::error::{OrchestratorError, Result};
use crate::types::{CreateWorktreeRequest, PruneResult, WorktreeDetails, WorktreeInfo};
use std::path::{Path, PathBuf};

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
            let parent = repo.parent().ok_or_else(|| {
                OrchestratorError::Worktree("Cannot find parent directory".into())
            })?;
            parent.join(format!(
                "{}-{}",
                repo.file_name().unwrap_or_default().to_string_lossy(),
                sanitize_branch_name(&request.branch)
            ))
        }
    };

    // Build git worktree add command
    let mut args = vec!["worktree", "add"];
    let target_str = target.to_string_lossy().to_string();
    args.push(&target_str);

    // Check if the branch already exists locally
    let branch_exists = git(
        repo,
        &[
            "rev-parse",
            "--verify",
            &format!("refs/heads/{}", &request.branch),
        ],
    )
    .is_ok();

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
                &[
                    "rev-list",
                    "--left-right",
                    "--count",
                    &format!("HEAD...{}", remote_ref),
                ],
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
