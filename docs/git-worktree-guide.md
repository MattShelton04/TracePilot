# Git Worktree Guide for TracePilot

## What Are Git Worktrees?

Git worktrees let you check out multiple branches of a repository **simultaneously**, each in its own directory. Instead of stashing changes and switching branches, you can have `main`, `feature-auth`, and `bugfix-123` all open at once — each in its own folder, sharing the same git history.

```
C:\projects\my-app\              ← main worktree (main branch)
C:\projects\my-app-feature-auth\ ← linked worktree (feature-auth branch)
C:\projects\my-app-bugfix-123\   ← linked worktree (bugfix-123 branch)
```

All three share the same `.git` metadata, so commits, branches, and history are synchronized. This is especially useful when running multiple Copilot CLI sessions in parallel — each session can work on its own branch in its own worktree.

---

## Why Worktrees in TracePilot?

TracePilot's orchestration layer uses worktrees for:

1. **Parallel Copilot sessions** — Launch multiple sessions, each on its own branch in isolated worktrees
2. **A/B testing** — Run two sessions on different approaches simultaneously and compare results
3. **Branch isolation** — Keep work-in-progress changes isolated without stashing
4. **Disk efficiency** — Worktrees share git objects, using far less disk than full clones

---

## Getting Started

### 1. Register a Repository

Open **Orchestration → Worktree Manager** in TracePilot.

In the left panel, you'll see your registered repositories. To add one:

- Click **Add Repository** → browse to your git repository folder
- Or click **Discover from Sessions** to auto-detect repos from your indexed Copilot sessions

TracePilot remembers your registered repos across sessions.

### 2. View Worktrees

Click any repository in the left panel to load its worktrees. The main panel shows:

| Column | Description |
|--------|-------------|
| **Branch** | The checked-out branch name and file path |
| **Session** | Linked Copilot session (if any) — click to navigate |
| **Disk** | Disk usage relative to the largest worktree |
| **Status** | `active` (on disk) or `stale` (git entry, path missing) |
| **Created** | When the worktree was created (TracePilot-created only) |

Click column headers to sort. Click a worktree row to open the detail panel.

### 3. Create a Worktree

Click **Create Worktree** in the toolbar. You'll need:

- **Branch name** — The branch to check out (creates a new branch if it doesn't exist)
- **Base branch** (optional) — Which branch to base the new branch on (defaults to HEAD)
- **Target directory** (optional) — Custom path for the worktree (auto-generated if omitted)

The branch name is validated against git naming rules. Invalid characters are sanitized automatically.

### 4. Lock / Unlock Worktrees

Locking prevents accidental deletion of a worktree:

- Click the **lock icon** on any worktree row, or use the lock button in the detail panel
- Provide an optional reason (e.g., "Active development — do not remove")
- Locked worktrees show a 🔒 icon and cannot be deleted without force

### 5. Delete & Clean Up

- **Delete**: Click the trash icon on any worktree → confirm in the modal. Check "Force delete" to remove even with uncommitted changes
- **Clean Stale**: Click "Clean Stale" to remove all stale worktrees (entries where the path no longer exists)
- **Prune**: Click "Prune" to clean up git's internal worktree metadata

### 6. Detail Panel

Click any worktree to expand the detail panel showing:

- Repository root path
- Branch name and full path
- Disk usage
- Lock status and reason
- **On-demand details**: Uncommitted changes count, ahead/behind remote counts
- Quick actions: Open Folder, Open Terminal, Lock/Unlock, Launch Session Here, Delete

---

## Launcher Integration

### Launch a Session in a New Worktree

From the **Session Launcher** (Orchestration → Launch Session):

1. Set your repository path and branch
2. Open **Advanced Options**
3. Toggle **Create Worktree** on
4. Optionally set a **Base Branch** (e.g., `main`)
5. Click **Launch Session**

TracePilot will:
1. Create a new worktree for the specified branch
2. Launch the Copilot CLI session inside that worktree
3. Show the worktree path in the success notification

> **Note**: A branch name is required when creating a worktree. The launcher will validate this before allowing launch.

### Launch from Worktree Manager

In the Worktree Manager, click **Launch Session Here** in any worktree's detail panel or row actions. This pre-fills the launcher with the repository path and branch.

---

## Command Center Integration

The **Orchestration Home** (Command Center) shows aggregate worktree statistics:

- Total worktrees across all registered repositories
- Count of stale worktrees
- Total disk usage
- Number of registered repositories

These stats update automatically from your registered repositories — no manual path entry needed.

---

## Repository Registry

The repository registry persists your tracked repositories so you don't have to re-enter paths each time.

### How It Works

- Stored in `~/.copilot/tracepilot/repo-registry.json`
- Uses atomic writes (temp file + rename) to prevent corruption
- Paths are canonicalized and deduplicated (case-insensitive on Windows)
- Each repo tracks: path, name, when it was added, when last used, and how it was added (manual or auto-discovered)

### Auto-Discovery

Click **Discover from Sessions** to scan your indexed Copilot sessions for repository paths. TracePilot:

1. Queries all session working directories from the index database
2. Resolves each to its git root (via `git rev-parse --show-toplevel`)
3. Deduplicates and adds new repositories to the registry
4. Shows how many new repos were found

This means if you've used Copilot in 10 different repos, they'll all appear automatically.

---

## Worktree Status Reference

| Status | Meaning | Action |
|--------|---------|--------|
| `active` | Worktree path exists on disk, valid git checkout | Normal usage |
| `stale` | Git metadata entry exists but path is missing | Prune or Clean Stale |
| 🔒 Locked | Worktree is locked (orthogonal to active/stale) | Unlock before deleting |

---

## Troubleshooting

### "Failed to load worktrees"
- Verify the path is a valid git repository (contains `.git`)
- Ensure `git` is available on your PATH
- Check that you have read permissions to the repository

### "Branch name is invalid"
- Git branch names cannot contain: `~`, `^`, `:`, `?`, `*`, `[`, `\`, spaces, or ASCII control characters
- Names cannot start or end with `.` or `/`
- Names cannot contain `..` or `@{`

### "Cannot delete locked worktree"
- Unlock the worktree first, or use "Force delete" in the delete dialog

### "Stale worktree detected"
- The worktree directory was deleted outside TracePilot
- Use "Prune" or "Clean Stale" to remove the stale entries

### Disk usage shows 0 or —
- Disk usage is calculated asynchronously after the worktree list loads
- For very large worktrees, it may take a few seconds to calculate
- Stale worktrees cannot have their disk usage measured (path doesn't exist)

---

## Git Worktree CLI Reference

For advanced users, here are the underlying git commands TracePilot wraps:

```bash
# List all worktrees
git worktree list --porcelain

# Create a worktree with a new branch
git worktree add ../my-feature -b feature-branch main

# Create a worktree for an existing branch
git worktree add ../my-feature existing-branch

# Remove a worktree
git worktree remove ../my-feature

# Force remove (even with uncommitted changes)
git worktree remove --force ../my-feature

# Lock a worktree
git worktree lock ../my-feature --reason "Active development"

# Unlock a worktree
git worktree unlock ../my-feature

# Prune stale entries
git worktree prune

# Get the repo root
git rev-parse --show-toplevel
```

---

## Architecture Notes

For developers working on TracePilot's worktree integration:

### Backend (Rust)
- **`crates/tracepilot-orchestrator/src/worktrees.rs`** — Core worktree operations (list, create, delete, prune, lock, details)
- **`crates/tracepilot-orchestrator/src/repo_registry.rs`** — Repository registry with JSON persistence
- **`crates/tracepilot-orchestrator/src/launcher.rs`** — Session launcher with worktree creation integration

### Frontend (TypeScript/Vue)
- **`packages/types/src/orchestration.ts`** — Shared type definitions
- **`packages/client/src/orchestration.ts`** — Tauri command wrappers
- **`apps/desktop/src/stores/worktrees.ts`** — Pinia store with full state management
- **`apps/desktop/src/views/orchestration/WorktreeManagerView.vue`** — Main worktree UI

### Tauri Commands
All worktree operations are exposed as Tauri plugin commands under `plugin:tracepilot|*`:

| Command | Description |
|---------|-------------|
| `list_worktrees` | List all worktrees for a repo |
| `create_worktree` | Create a new worktree |
| `remove_worktree` | Delete a worktree |
| `prune_worktrees` | Prune stale entries |
| `list_branches` | List available branches |
| `get_worktree_disk_usage` | Get disk usage for a worktree path |
| `lock_worktree` | Lock a worktree |
| `unlock_worktree` | Unlock a worktree |
| `get_worktree_details` | Get on-demand details (uncommitted, ahead/behind) |
| `is_git_repo` | Check if a path is a git repository |
| `list_registered_repos` | List all registered repositories |
| `add_registered_repo` | Register a new repository |
| `remove_registered_repo` | Unregister a repository |
| `discover_repos_from_sessions` | Auto-discover repos from session history |
