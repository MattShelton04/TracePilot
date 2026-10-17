### Fixed

- **Worktree clean-up** — Stale worktrees now read as missing folders instead of "0 B reclaimable", and Clean Up asks first, stays within the selected repository, skips locked worktrees and reports what failed.
  Failed prune, discovery, lock and repository actions now show an error, and folder actions are disabled on stale worktrees.
