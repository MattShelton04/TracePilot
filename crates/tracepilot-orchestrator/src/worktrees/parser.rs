use crate::error::Result;
use crate::types::{WorktreeInfo, WorktreeStatus};
use std::path::Path;

/// Parse `git worktree list --porcelain` output into structured data.
pub(super) fn parse_porcelain_output(raw: &str, repo_root: &str) -> Result<Vec<WorktreeInfo>> {
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

pub(super) fn sanitize_branch_name(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | ' ' | '~' | '^' | ':' | '?' | '*' | '[' | ']' | '\\' | '<' | '>' | '|' | '"' => {
                '-'
            }
            _ => c,
        })
        .collect()
}

/// Case-insensitive path comparison on Windows, case-sensitive elsewhere.
pub(super) fn paths_equal(a: &str, b: &str) -> bool {
    #[cfg(windows)]
    {
        a.eq_ignore_ascii_case(b)
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}
