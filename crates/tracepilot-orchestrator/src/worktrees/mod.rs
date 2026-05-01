//! Git worktree management operations.

mod cache;
mod git;
mod ops;
mod parser;

#[cfg(test)]
mod tests;

pub use cache::{disk_usage_bytes, invalidate_disk_usage_cache};
pub use git::{
    fetch_remote, get_default_branch, get_repo_root, is_git_repo, list_branches,
    validate_branch_name,
};
pub use ops::{
    create_worktree, get_worktree_details, list_worktrees, lock_worktree, prune_worktrees,
    remove_worktree, unlock_worktree,
};
