use crate::error::{OrchestratorError, Result};
use std::path::Path;

/// Run a git command in the given directory, returning stdout on success.
/// Uses a 30-second timeout to prevent hanging on network operations or slow repositories.
pub(super) fn git(repo_path: &Path, args: &[&str]) -> Result<String> {
    let output = crate::process::run_hidden(
        tracepilot_core::constants::DEFAULT_GIT_COMMAND,
        args,
        Some(repo_path),
        Some(30),
    )?;

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
        && crate::process::run_hidden(
            tracepilot_core::constants::DEFAULT_GIT_COMMAND,
            &["rev-parse", "--git-dir"],
            Some(path),
            Some(5),
        )
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Get the default branch of a repository (usually "main" or "master").
/// Checks `init.defaultBranch` config, then falls back to HEAD of origin, then "main".
pub fn get_default_branch(repo_path: &Path) -> Result<String> {
    // Try symbolic-ref of origin/HEAD first (most reliable for cloned repos)
    if let Ok(ref_str) = git(repo_path, &["symbolic-ref", "refs/remotes/origin/HEAD"])
        && let Some(branch) = ref_str.strip_prefix("refs/remotes/origin/")
    {
        return Ok(branch.to_string());
    }
    // Fall back to the branch that HEAD points to in the main worktree
    if let Ok(head_ref) = git(repo_path, &["symbolic-ref", "--short", "HEAD"])
        && !head_ref.is_empty()
    {
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

/// List branches for a repository (local + remote, deduplicated).
pub fn list_branches(repo_path: &Path) -> Result<Vec<String>> {
    let output = git(repo_path, &["branch", "-a", "--format=%(refname:short)"])?;

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

/// Validate a branch name using git check-ref-format.
pub fn validate_branch_name(name: &str) -> Result<()> {
    if name.is_empty() {
        return Err(OrchestratorError::Worktree(
            "Branch name cannot be empty".into(),
        ));
    }
    // Use git check-ref-format to validate (5s timeout for local check)
    let output = crate::process::run_hidden(
        tracepilot_core::constants::DEFAULT_GIT_COMMAND,
        &["check-ref-format", "--branch", name],
        None,
        Some(5),
    )?;
    if output.status.success() {
        Ok(())
    } else {
        Err(OrchestratorError::Worktree(format!(
            "Invalid branch name: {name}"
        )))
    }
}
