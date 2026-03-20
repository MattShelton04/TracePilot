# TracePilot Orchestration — Implementation Roadmap

> **Generated**: 2026-03-19 | **Updated**: 2026-03-19 | **Based on**: `copilot-cli-integration-report.md`, `copilot-sdk-deep-dive.md`
>
> This document is the concrete, actionable plan for implementing all orchestration features.
> It maps every feature to its **routing** (where code lives), **technology** (Rust/Vue/SDK/CLI),
> and **implementation details**.

## Phase 1 Status: ✅ COMPLETE

Phase 1 foundation has been implemented with the following deliverables:

### New Rust Crate: `tracepilot-orchestrator`
- **worktrees.rs** — Git worktree management (list, create, remove, prune, disk usage)
- **launcher.rs** — Copilot CLI session launching, model listing, system dependency checks
- **config_injector.rs** — Agent definition CRUD, global config, backups, diffs, atomic writes
- **version_manager.rs** — Version discovery, active version detection, migration diffs
- **templates.rs** — Session templates (default + user-saved), CRUD operations
- **21 unit tests** all passing

### New Tauri Commands (22 commands)
All registered in `generate_handler![]` and `build.rs`:
- System: `check_system_deps`
- Worktrees: `list_worktrees`, `create_worktree`, `remove_worktree`, `prune_worktrees`, `list_branches`, `get_worktree_disk_usage`
- Launcher: `launch_session`, `get_available_models`
- Config: `get_agent_definitions`, `save_agent_definition`, `get_copilot_config`, `save_copilot_config`, `create_config_backup`, `list_config_backups`, `restore_config_backup`, `diff_config_files`
- Versions: `discover_copilot_versions`, `get_active_copilot_version`, `get_migration_diffs`, `migrate_agent_definition`
- Templates: `list_session_templates`, `save_session_template`, `delete_session_template`

### Frontend
- **Types**: `packages/types/src/orchestration.ts` — 15 interfaces
- **Client**: `packages/client/src/orchestration.ts` — 22 functions + full mock data
- **Stores**: 4 new Pinia stores (worktrees, launcher, configInjector, orchestrationHome)
- **Views**: 4 new Vue views matching prototype designs:
  - `OrchestrationHomeView.vue` — Command center dashboard
  - `WorktreeManagerView.vue` — File-manager-style worktree management
  - `SessionLauncherView.vue` — Split-panel launcher with live preview
  - `ConfigInjectorView.vue` — Tabbed config editor with migration support
- **Router**: 4 new routes under `/orchestration/*`
- **Sidebar**: New "Orchestration" nav section with 4 items

---

## Feature Routing Overview

Every feature is routed through one of these technology paths:

| Route | Description | When to use |
|-------|-------------|-------------|
| **🦀 Rust (Tauri command)** | Backend logic in Rust crates, exposed via `#[tauri::command]` | File I/O, process spawning, git CLI, config parsing, heavy computation |
| **🖼️ Vue (Frontend only)** | UI logic in Vue components/views, no new backend needed | Display, filtering, templates stored in localStorage |
| **📦 Node.js Sidecar** | New Node.js process using `@github/copilot-sdk` | SDK-dependent features: live sessions, tool injection, hooks, steering |
| **🔧 CLI Spawn** | Rust spawns `copilot` / `git` as child process | Simple commands where SDK is overkill |
| **📁 File-based** | Direct file read/write (YAML, JSON, JSONL) | Config injection, agent definition editing |

---

## Feature Routing Matrix

### Phase 1: Foundation (No SDK Dependency)

| # | Feature | Route | New Tauri Commands | New Vue Pages | New Components |
|---|---------|-------|--------------------|---------------|----------------|
| 1.1 | **Git Worktree Manager** | 🦀 Rust + 🔧 CLI (`git worktree` commands) | `list_worktrees()`, `create_worktree(repo, branch, path)`, `remove_worktree(path)`, `prune_worktrees(repo)`, `get_worktree_disk_usage(path)` | `WorktreeManagerView.vue` | `WorktreeCard.vue`, `CreateWorktreeDialog.vue` |
| 1.2 | **Session Launcher** | 🦀 Rust + 🔧 CLI (`copilot` spawn) | `launch_session(config)`, `list_available_models()`, `get_trusted_folders()`, `get_git_branches(repo)` | `SessionLauncherView.vue` | `ModelSelector.vue`, `LaunchConfigForm.vue`, `PromptEditor.vue` |
| 1.3 | **Config Injector** | 🦀 Rust + 📁 File I/O | `get_agent_definitions()`, `update_agent_definition(name, changes)`, `get_copilot_config()`, `update_copilot_config(changes)`, `backup_config()`, `restore_config(backup_id)`, `list_config_backups()` | `ConfigInjectorView.vue` | `AgentEditor.vue`, `ConfigDiffPreview.vue`, `BackupManager.vue` |
| 1.4 | **Active Session Discovery** | 🦀 Rust (lock file scanning) | `discover_active_sessions()` (extends existing `is_session_running`) | — (enhances `SessionListView`) | `ActiveSessionBadge.vue` |
| 1.5 | **Session Templates** | 🖼️ Vue (localStorage) + 🦀 Rust (file I/O for export) | `save_template(template)`, `list_templates()`, `delete_template(id)` | `SessionTemplatesView.vue` | `TemplateCard.vue`, `TemplateEditor.vue` |
| 1.6 | **Orchestration Home** | 🖼️ Vue (aggregates existing data) | — (reuses existing commands) | `OrchestrationHomeView.vue` | `QuickActionGrid.vue`, `SystemHealthPanel.vue` |

**What changes in the existing app for Phase 1:**

| Layer | Changes |
|-------|---------|
| **Rust crates** | New crate: `tracepilot-orchestrator` for worktree + launcher + config injection logic |
| **Tauri bindings** | ~15 new `#[tauri::command]` functions in `tracepilot-tauri-bindings` |
| **`build.rs`** | Register new commands in `generate_handler![]` and `.commands(&[])` |
| **Router** | 4–5 new routes under `/orchestration/*` prefix |
| **Sidebar** | New "Orchestration" section in `AppSidebar.vue` with sub-items |
| **Stores** | New `orchestration.ts` Pinia store (worktrees, launcher state, templates) |
| **Types** | New types in `packages/types/` for worktree, template, launch config |
| **Client** | New invoke wrappers in `packages/client/` |

---

### Phase 2: SDK Sidecar

| # | Feature | Route | New Infrastructure | New Vue Pages | New Components |
|---|---------|-------|--------------------|---------------|----------------|
| 2.1 | **Node.js Sidecar Bootstrap** | 📦 Sidecar infra | Tauri sidecar config, `sidecar/` directory with SDK client, IPC bridge (JSON-RPC over stdio) | — | `SidecarStatus.vue` |
| 2.2 | **Live Session Dashboard** | 📦 Sidecar → SDK events | Sidecar streams `session.on(*)` events to Tauri via IPC | `MissionControlView.vue` | `LiveSessionCard.vue`, `SessionSparkline.vue`, `StatusTimeline.vue` |
| 2.3 | **Quota Monitor** | 📦 Sidecar → SDK `assistant.usage` | Sidecar captures `quotaSnapshots` from usage events, forwards to frontend | — (widget in Mission Control + Cost Tracker) | `QuotaGauge.vue`, `BurnRateChart.vue` |
| 2.4 | **SDK Session Launch** | 📦 Sidecar → `client.createSession()` | Sidecar replaces CLI spawn for session creation | — (enhances Session Launcher) | — |
| 2.5 | **Cost & Budget Tracker** | 🦀 Rust (historical from index) + 📦 Sidecar (live quota) | Hybrid: existing analytics for history, sidecar for real-time quota | `CostTrackerView.vue` | `BudgetProgressRing.vue`, `CostBreakdownChart.vue` |

**Sidecar Architecture:**

```
┌──────────────────┐     stdio/JSON-RPC      ┌───────────────────────┐
│  Tauri App       │ ◄──────────────────────► │  Node.js Sidecar      │
│  (Rust backend)  │                          │  @github/copilot-sdk  │
│                  │  Events:                 │                       │
│  New commands:   │  ← session.event         │  CopilotClient        │
│  sidecar_start() │  ← quota.update          │  ├─ createSession()   │
│  sidecar_stop()  │  ← session.status        │  ├─ resumeSession()   │
│  sidecar_send()  │                          │  ├─ listSessions()    │
│                  │  Commands:               │  ├─ on('*', ...)      │
│                  │  → create_session         │  └─ tools/hooks       │
│                  │  → resume_session         │                       │
│                  │  → send_message           └───────────────────────┘
│                  │  → register_tool                    │
│                  │  → list_sessions                    │ TCP/stdio
│                  │                                     ▼
│                  │                          ┌───────────────────────┐
│                  │                          │  Copilot CLI Server   │
│                  │                          │  (copilot --headless) │
└──────────────────┘                          └───────────────────────┘
```

**Key implementation decisions:**
- Sidecar communicates with Tauri via **stdio JSON-RPC** (simplest for Tauri sidecar model)
- Sidecar is **lazy-started** — only launched when user accesses orchestration features
- Sidecar manages a **connection pool** to multiple CLI servers (one per active session)
- Tauri Rust side has a thin `SidecarManager` that spawns/kills/communicates with the Node.js process
- Frontend gets events via Tauri's `listen()` event system (Rust → Vue push)

---

### Phase 3: Active Orchestration

| # | Feature | Route | Dependencies | New Components |
|---|---------|-------|--------------|----------------|
| 3.1 | **Hook into CLI TUI Sessions** | 📦 Sidecar → TCP multi-client | Phase 2 sidecar | `TUISessionObserver.vue` |
| 3.2 | **Custom Tool Injection** | 📦 Sidecar → `defineTool()` | Phase 2 sidecar | `ToolRegistrar.vue`, `ToolBuilder.vue` |
| 3.3 | **Hook-Based Guardrails** | 📦 Sidecar → `onPreToolUse` hooks | Phase 2 sidecar | `GuardrailConfig.vue` |
| 3.4 | **Session Steering** | 📦 Sidecar → `session.send({ mode: "immediate" })` | Phase 2 sidecar | `SteeringPanel.vue`, `QuickPromptBar.vue` |
| 3.5 | **Model Switching** | 📦 Sidecar → `session.rpc.model.switchTo()` | Phase 2 sidecar | `ModelSwitcher.vue` |
| 3.6 | **Extension Manager** | 🦀 Rust + 📁 File I/O | Phase 1 foundation | `ExtensionManagerView.vue`, `ExtensionEditor.vue` |
| 3.7 | **MCP Server Manager** | 🦀 Rust + 📁 File I/O (config) + 📦 Sidecar (connectivity test) | Phase 2 sidecar | `MCPManagerView.vue`, `MCPServerCard.vue` |

---

### Phase 4: Advanced

| # | Feature | Route | Dependencies |
|---|---------|-------|--------------|
| 4.1 | **A/B Testing Arena** | 📦 Sidecar (parallel sessions) + 🦀 Rust (worktrees + diff) | Phase 1.1 + Phase 2 |
| 4.2 | **Batch Operations** | 📦 Sidecar (session queue) + 🦀 Rust (worktrees) | Phase 1.1 + Phase 2 |
| 4.3 | **Session Knowledge Base** | 🦀 Rust (index `store_memory` events from SQLite) + 🖼️ Vue | Existing indexer |
| 4.4 | **Custom Agent Studio** | 📁 File-based (YAML generation) + 📦 Sidecar (test) | Phase 1.3 + Phase 2 |
| 4.5 | **Fleet Mode** | 📦 Sidecar → SDK fleet APIs | Phase 2 + Phase 3 |
| 4.6 | **BYOK Management** | 🦀 Rust (secure credential store) + 📦 Sidecar (BYOK session config) | Phase 2 |

---

## Detailed Implementation: Phase 1

### 1.1 Git Worktree Manager ✅ IMPLEMENTED

**Technology**: Pure Rust + `git` CLI commands (no SDK needed)

**Rust modules**:
- `crates/tracepilot-orchestrator/src/worktrees.rs` — Core worktree operations
- `crates/tracepilot-orchestrator/src/repo_registry.rs` — Repository registry with JSON persistence

```
Implemented functions:
├── list_worktrees(repo_path) → Vec<WorktreeInfo>
│   └── Parses `git worktree list --porcelain` with locked status detection
├── create_worktree(request) → Result<WorktreeInfo>
│   └── Creates worktree, validates branch name, verifies creation via re-list
├── remove_worktree(repo_path, worktree_path, force) → Result<()>
│   └── Supports force deletion for uncommitted changes
├── prune_worktrees(repo_path) → Result<PruneResult>
│   └── Before/after comparison for reliable prune counting
├── get_disk_usage(path) → u64
│   └── Fully recursive via walkdir crate
├── lock_worktree(repo_path, worktree_path, reason) → Result<()>
├── unlock_worktree(repo_path, worktree_path) → Result<()>
├── get_worktree_details(repo_path, worktree_path) → WorktreeDetails
│   └── On-demand: uncommitted count, ahead/behind remote
├── get_repo_root(path) → String
│   └── Resolves any path to canonical git root
├── is_git_repo(path) → bool
├── validate_branch_name(name) → bool
├── list_branches(repo_path) → Vec<String>
│   └── Local + remote branches, deduplicated and sorted
├── list_registered_repos() → Vec<RegisteredRepo>
├── add_repo(path) → RegisteredRepo
├── remove_repo(path) → ()
└── discover_repos_from_sessions(cwds) → Vec<RegisteredRepo>
    └── Resolves session CWDs to git roots, deduplicates, registers new repos
```

**Tauri commands** (14 total in `tracepilot-tauri-bindings`):
- `list_worktrees`, `create_worktree`, `remove_worktree`, `prune_worktrees`
- `list_branches`, `get_worktree_disk_usage`
- `lock_worktree`, `unlock_worktree`, `get_worktree_details`, `is_git_repo`
- `list_registered_repos`, `add_registered_repo`, `remove_registered_repo`, `discover_repos_from_sessions`

**Vue page**: `apps/desktop/src/views/orchestration/WorktreeManagerView.vue`
- Repository registry sidebar with add/remove/discover
- Sortable worktree table with lock status indicators
- On-demand detail panel (uncommitted changes, ahead/behind)
- Create/delete modals with force-delete and branch validation
- Session navigation and "Launch Session Here" integration
- Disk usage monitoring and stale worktree cleanup

**Pinia store**: `apps/desktop/src/stores/worktrees.ts`
- Full CRUD + registry + lock/unlock + sort + multi-repo support

**Router**: `/orchestration/worktrees`

---

### 1.2 Session Launcher (✅ Worktree integration complete)

**Technology**: Rust process spawning (`std::process::Command`) + git CLI for branch listing

**Rust module**: `crates/tracepilot-orchestrator/src/launcher.rs`
- When `create_worktree = true` and `branch` is set, creates a worktree first then launches inside it
- `base_branch` field allows specifying which branch to base the new worktree on
- Returns `worktree_path` in `LaunchedSession` on success

```
Functions needed:
├── launch_session(config: LaunchConfig) → Result<LaunchedSession>
│   ├── Optionally creates worktree first
│   ├── Spawns: copilot --headless --model <model> (or -p "prompt")
│   └── Returns PID + session ID (parsed from CLI output)
├── get_available_models() → Vec<ModelInfo>
│   └── Reads from agent definitions or hardcoded known list
├── get_trusted_folders() → Vec<String>
│   └── Reads ~/.copilot/config.json → trusted_repos.folders
├── get_git_branches(repo_path) → Vec<String>
│   └── Runs `git branch -a --format='%(refname:short)'`
└── kill_session(pid: u32) → Result<()>
    └── Process termination
```

**LaunchConfig struct:**
```rust
struct LaunchConfig {
    repo_path: String,
    branch: Option<String>,       // create worktree if specified
    model: Option<String>,        // --model flag
    prompt: Option<String>,       // -p flag or first message
    headless: bool,               // --headless
    reasoning_effort: Option<String>, // low/medium/high
    custom_instructions: Option<String>,
    env_vars: HashMap<String, String>,
    template_id: Option<String>,
}
```

**Vue page**: `apps/desktop/src/views/SessionLauncherView.vue`
- Repo selector (from trusted folders + manual path)
- Branch picker (fetched from git)
- Model selector with tier badges
- Prompt editor with history
- Advanced options accordion
- "Preview Command" panel showing exact CLI invocation
- "Launch" + "Launch Headless" buttons

**Router**: `/orchestration/launch`

---

### 1.3 Config Injector

**Technology**: Rust file I/O + YAML/JSON parsing

**New Rust module**: `crates/tracepilot-orchestrator/src/config_injector.rs`

```
Functions needed:
├── get_agent_definitions() → Vec<AgentDefinition>
│   └── Reads all *.agent.yaml from pkg/universal/{version}/definitions/
├── update_agent_definition(name, field, value) → Result<()>
│   └── Modifies YAML in-place, creates backup first
├── get_copilot_config() → CopilotConfig
│   └── Reads ~/.copilot/config.json
├── update_copilot_config(field, value) → Result<()>
│   └── Modifies JSON in-place, creates backup first
├── create_backup(target: &str) → BackupEntry
│   └── Copies file to ~/.copilot/tracepilot/backups/{timestamp}_{name}
├── list_backups() → Vec<BackupEntry>
├── restore_backup(backup_id: &str) → Result<()>
└── get_diff(original, modified) → String
    └── Unified diff for preview
```

**Vue page**: `apps/desktop/src/views/ConfigInjectorView.vue`
- Tabs: Agent Definitions | Global Config | Environment | Backups
- Agent cards with inline model dropdown, prompt editor
- Config.json form editor
- Diff preview before applying changes
- Backup history with one-click restore
- Warning banner about COPILOT_AUTO_UPDATE

**Router**: `/orchestration/config`

---

### 1.4 Active Session Discovery

**Technology**: Enhances existing Rust session discovery

**Changes to existing code:**
- `tracepilot-core/src/discovery.rs` — add lock file scanning for active sessions
- `tracepilot-tauri-bindings` — add `discover_active_sessions()` command
- Existing `is_session_running()` already checks lock files; extend to return metadata

**Vue changes**: 
- `SessionListView.vue` — add "Active" filter tab, live status badges
- `AppSidebar.vue` — add active session count badge

---

### 1.5 Session Templates

**Technology**: Vue + localStorage (with JSON export/import via Rust file I/O)

**Storage**: `~/.copilot/tracepilot/templates/*.json`

**Template schema:**
```typescript
interface SessionTemplate {
  id: string;
  name: string;
  description: string;
  category: 'bug-fix' | 'feature' | 'refactor' | 'review' | 'test' | 'docs' | 'custom';
  config: LaunchConfig;  // Same as launcher config
  tags: string[];
  createdAt: string;
  usageCount: number;
}
```

**Vue page**: `apps/desktop/src/views/SessionTemplatesView.vue`
- Card grid with category filter tabs
- Create/edit template modal
- Import/export JSON buttons
- "Quick Launch" button (creates session directly from template)
- Usage stats per template

**Router**: `/orchestration/templates`

---

## Sidebar Navigation Update

Current sidebar has "Primary" and "Advanced" sections. Add third section:

```
📊 Primary
  Sessions
  Analytics
  Health
  Tools
  Code

🔬 Advanced
  Models
  Compare
  Replay
  Export

🚀 Orchestration          ← NEW SECTION
  Home                    → /orchestration
  Launch Session          → /orchestration/launch
  Mission Control         → /orchestration/dashboard    (Phase 2)
  Worktrees              → /orchestration/worktrees
  Config Injector        → /orchestration/config
  Templates              → /orchestration/templates
  Cost Tracker           → /orchestration/costs         (Phase 2)
  Extensions             → /orchestration/extensions    (Phase 3)
  A/B Testing            → /orchestration/ab-test       (Phase 4)
  Batch Ops              → /orchestration/batch         (Phase 4)
  Knowledge Base         → /orchestration/knowledge     (Phase 4)

⚙️ Settings
```

Phase 2+ items show with a "Coming Soon" badge or are hidden until sidecar is available.

---

## New Crate: `tracepilot-orchestrator`

```
crates/tracepilot-orchestrator/
├── Cargo.toml
├── src/
│   ├── lib.rs
│   ├── worktrees.rs       ← Phase 1.1
│   ├── launcher.rs        ← Phase 1.2
│   ├── config_injector.rs ← Phase 1.3
│   ├── templates.rs       ← Phase 1.5
│   ├── discovery.rs       ← Phase 1.4 (or enhance existing)
│   └── types.rs           ← Shared types
```

**Dependencies:** `serde`, `serde_yaml`, `serde_json`, `tokio` (process), `similar` (diff)

---

## New Pinia Store: `orchestration.ts`

```typescript
// apps/desktop/src/stores/orchestration.ts
export const useOrchestrationStore = defineStore('orchestration', () => {
  // Worktrees
  const worktrees = ref<WorktreeInfo[]>([]);
  const loadWorktrees = async (repoPath: string) => { ... };
  const createWorktree = async (repo, branch, path?) => { ... };
  const removeWorktree = async (path) => { ... };

  // Launcher
  const availableModels = ref<ModelInfo[]>([]);
  const trustedFolders = ref<string[]>([]);
  const launchSession = async (config: LaunchConfig) => { ... };

  // Config
  const agentDefinitions = ref<AgentDefinition[]>([]);
  const copilotConfig = ref<CopilotConfig | null>(null);
  const configBackups = ref<BackupEntry[]>([]);

  // Templates
  const templates = ref<SessionTemplate[]>([]);

  // Active sessions (enhanced discovery)
  const activeSessions = ref<ActiveSessionInfo[]>([]);

  // Sidecar status (Phase 2)
  const sidecarStatus = ref<'stopped' | 'starting' | 'running' | 'error'>('stopped');
});
```

---

## New Types Package Additions

```typescript
// packages/types/src/orchestration.ts

export interface WorktreeInfo {
  path: string;
  branch: string;
  headCommit: string;
  isMainWorktree: boolean;
  linkedSessionId?: string;
  diskUsageBytes: number;
  createdAt?: string;
}

export interface LaunchConfig {
  repoPath: string;
  branch?: string;
  model?: string;
  prompt?: string;
  headless: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
  customInstructions?: string;
  envVars: Record<string, string>;
  templateId?: string;
  createWorktree: boolean;
}

export interface LaunchedSession {
  sessionId: string;
  pid: number;
  worktreePath?: string;
  config: LaunchConfig;
  launchedAt: string;
}

export interface AgentDefinition {
  name: string;       // e.g., "copilot-chat"
  filePath: string;
  model: string;
  description: string;
  tools: string[];
  prompt: string;     // system prompt (may be large)
  raw: string;        // raw YAML for editing
}

export interface CopilotConfig {
  model?: string;
  reasoningEffort?: string;
  trustedFolders: string[];
  banner?: string;
  raw: Record<string, unknown>; // full config.json
}

export interface BackupEntry {
  id: string;
  target: string;     // "agent-definitions" | "config-json"
  createdAt: string;
  filePath: string;
}

export interface SessionTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  config: LaunchConfig;
  tags: string[];
  createdAt: string;
  usageCount: number;
}

export interface ActiveSessionInfo {
  sessionId: string;
  pid?: number;
  lockFilePath: string;
  cwd?: string;
  branch?: string;
  startedAt?: string;
}
```

---

## Implementation Order (Concrete Steps)

### Sprint 1: Foundation Infrastructure
1. Create `crates/tracepilot-orchestrator/` crate with `Cargo.toml`
2. Add `tracepilot-orchestrator` as dependency in `tracepilot-tauri-bindings`
3. Add orchestration types to `packages/types/`
4. Add invoke wrappers to `packages/client/`
5. Create `orchestration` Pinia store
6. Update `AppSidebar.vue` with Orchestration section
7. Add routes to router

### Sprint 2: Git Worktree Manager
8. Implement `worktrees.rs` (list, create, remove, prune, disk usage)
9. Register Tauri commands in `lib.rs` + `build.rs`
10. Build `WorktreeManagerView.vue`
11. Build `CreateWorktreeDialog.vue`
12. Test worktree CRUD operations

### Sprint 3: Session Launcher
13. Implement `launcher.rs` (spawn copilot process, branch listing, model list)
14. Register Tauri commands
15. Build `SessionLauncherView.vue` with model selector, prompt editor
16. Wire to worktree creation (optional "create worktree" checkbox)
17. Test session launching

### Sprint 4: Config Injector
18. Implement `config_injector.rs` (agent YAML read/write, config.json, backups)
19. Register Tauri commands
20. Build `ConfigInjectorView.vue` with tabs
21. Build diff preview component
22. Test config modifications + backup/restore

### Sprint 5: Templates + Discovery + Home
23. Implement `templates.rs` (CRUD, file I/O)
24. Build `SessionTemplatesView.vue`
25. Enhance session discovery with active session detection
26. Build `OrchestrationHomeView.vue` (aggregates all orchestration data)
27. End-to-end testing of full Phase 1

### Sprint 6: SDK Sidecar Foundation (Phase 2 start)
28. Create `sidecar/` directory with Node.js project
29. Implement SDK client wrapper with JSON-RPC stdio bridge
30. Add Tauri sidecar configuration
31. Implement `SidecarManager` in Rust
32. Build `MissionControlView.vue` for live dashboard
33. Wire event streaming from sidecar to Vue

---

## Testing Strategy

| Layer | Test approach |
|-------|---------------|
| `tracepilot-orchestrator` Rust crate | Unit tests with mocked git CLI output, temp directories for file I/O |
| Tauri commands | Integration tests via `cargo test -p tracepilot-tauri-bindings` |
| Vue views | Component tests via Vitest (existing test infrastructure) |
| Sidecar (Phase 2) | E2E tests with real SDK against local Copilot CLI |
| Worktree operations | Integration tests with real git repos (temp dirs) |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Copilot CLI auto-update overwrites config injections | Warn user to set `COPILOT_AUTO_UPDATE=false`; detect version changes and re-apply |
| Sidecar crash takes down SDK features | Graceful degradation — app works without sidecar; auto-restart on crash |
| Git worktree conflicts with active sessions | Check for lock files before removing worktrees; show warning |
| SDK API changes across CLI versions | Runtime capability detection at sidecar startup; feature flags |
| Large number of worktrees consuming disk | Disk usage monitoring + cleanup recommendations in UI |

---

## Cross-references

- **Feature proposals**: `docs/copilot-cli-integration-report.md` Part 3
- **SDK API reference**: `docs/copilot-sdk-deep-dive.md` Part 2
- **Cost/interop analysis**: `docs/copilot-sdk-deep-dive.md` Part 0
- **UI prototypes**: `docs/design/prototypes/orchestration/`
- **Page plan**: `docs/design/orchestration-pages-plan.md`
