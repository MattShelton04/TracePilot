# AI Agent Task System — Implementation Plan

> Derived from `docs/ai-agent-task-system.md`. This is the code-level implementation plan
> for building Phase 1 of the task system. Each section maps to a work stream with concrete
> file paths, types, and acceptance criteria.

---

## Table of Contents

- [Overview](#overview)
- [Work Stream 1: Task Database](#work-stream-1-task-database)
- [Work Stream 2: Task Preset System](#work-stream-2-task-preset-system)
- [Work Stream 3: Context Assembly Pipeline](#work-stream-3-context-assembly-pipeline)
- [Work Stream 4: Orchestrator Launch & Lifecycle](#work-stream-4-orchestrator-launch--lifecycle)
- [Work Stream 5: File-Based IPC Protocol](#work-stream-5-file-based-ipc-protocol)
- [Work Stream 6: Subagent Attribution & Monitoring](#work-stream-6-subagent-attribution--monitoring)
- [Work Stream 7: Orchestrator Recovery](#work-stream-7-orchestrator-recovery)
- [Work Stream 8: Tauri IPC Commands](#work-stream-8-tauri-ipc-commands)
- [Work Stream 9: Frontend — Stores & Composables](#work-stream-9-frontend--stores--composables)
- [Work Stream 10: Frontend — Views & Components](#work-stream-10-frontend--views--components)
- [Work Stream 11: Built-in Presets](#work-stream-11-built-in-presets)
- [Work Stream 12: CLI Read-Only Commands](#work-stream-12-cli-read-only-commands)
- [Work Stream 13: Config & Settings](#work-stream-13-config--settings)
- [Work Stream 14: Integration Testing](#work-stream-14-integration-testing)
- [Dependency Graph](#dependency-graph)
- [Implementation Order](#implementation-order)

---

## Overview

### Principles

1. **Vertical slices** — each work stream is independently testable
2. **Backend-first** — Rust infrastructure before frontend views
3. **Existing patterns** — follow index.db for DB, templates for presets, launcher for sessions
4. **No new dependencies** unless strictly needed (e.g., `notify` crate)

### Architecture Summary

```
TracePilot App (Rust)
  ├── tasks.db (SQLite — single writer)
  ├── task-presets/ (JSON files)
  ├── jobs/ (file-based IPC with orchestrator)
  │   ├── manifest.json
  │   ├── heartbeat.json
  │   └── {task_id}/
  │       ├── context.md
  │       ├── result.json
  │       └── status.json
  └── Orchestrator (Copilot CLI session in visible terminal)
      └── Subagents (fresh context per task, write results to files)
```

---

## Work Stream 1: Task Database

### 1.1 Create `tasks.db` module

**New files:**
- `crates/tracepilot-orchestrator/src/task_db/mod.rs` — DB open/create, PRAGMAs, migrations
- `crates/tracepilot-orchestrator/src/task_db/schema.rs` — SQL DDL constants
- `crates/tracepilot-orchestrator/src/task_db/operations.rs` — CRUD functions
- `crates/tracepilot-orchestrator/src/task_db/types.rs` — Rust types matching DB rows

**Pattern to follow:** `crates/tracepilot-indexer/src/index_db/mod.rs` (lines 37-54) for
connection setup with PRAGMAs.

**Types to define (`task_db/types.rs`):**
```rust
pub enum TaskStatus {
    Pending, Claimed, InProgress, Done, Failed, Cancelled, Expired, DeadLetter,
}

pub enum JobStatus {
    Pending, Running, Completed, Failed, Cancelled,
}

pub struct Task {
    pub id: String,
    pub job_id: Option<String>,
    pub task_type: String,
    pub preset_id: String,
    pub status: TaskStatus,
    pub priority: String,
    pub input_params: serde_json::Value,
    pub context_hash: Option<String>,
    pub attempt_count: i32,
    pub max_retries: i32,
    pub orchestrator_session_id: Option<String>,
    pub result_content: Option<String>,
    pub result_parsed: Option<serde_json::Value>,
    pub schema_valid: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

pub struct Job {
    pub id: String,
    pub name: String,
    pub preset_id: Option<String>,
    pub status: JobStatus,
    pub task_count: i32,
    pub tasks_completed: i32,
    pub tasks_failed: i32,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub orchestrator_session_id: Option<String>,
}

pub struct TaskFilter {
    pub status: Option<TaskStatus>,
    pub task_type: Option<String>,
    pub job_id: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}
```

**DB operations to implement (`task_db/operations.rs`):**
```rust
pub fn create_task(conn: &Connection, task: &NewTask) -> Result<Task>
pub fn create_task_batch(conn: &Connection, tasks: &[NewTask], job_name: &str) -> Result<Job>
pub fn get_task(conn: &Connection, id: &str) -> Result<Task>
pub fn list_tasks(conn: &Connection, filter: &TaskFilter) -> Result<Vec<Task>>
pub fn update_task_status(conn: &Connection, id: &str, status: TaskStatus) -> Result<()>
pub fn store_task_result(conn: &Connection, id: &str, result: &TaskResult) -> Result<()>
pub fn cancel_task(conn: &Connection, id: &str) -> Result<()>
pub fn cancel_job(conn: &Connection, job_id: &str) -> Result<()>
pub fn retry_task(conn: &Connection, id: &str) -> Result<()>
pub fn delete_task(conn: &Connection, id: &str) -> Result<()>
pub fn get_task_stats(conn: &Connection) -> Result<TaskStats>
pub fn release_stale_tasks(conn: &Connection) -> Result<u64>
pub fn expire_old_tasks(conn: &Connection) -> Result<u64>
pub fn cleanup_old_completed(conn: &Connection, retention_days: i64) -> Result<u64>
pub fn get_pending_tasks_for_manifest(conn: &Connection) -> Result<Vec<Task>>
```

**Schema SQL** (from architecture doc Part 5):
- `task_meta`, `tasks`, `jobs`, `task_deps` tables
- Indexes: `idx_tasks_dedup` (partial unique), `idx_tasks_status`, `idx_tasks_job_id`
- PRAGMAs: WAL, synchronous=NORMAL, foreign_keys=ON, busy_timeout=5000

**Acceptance criteria:**
- [ ] DB created at `~/.copilot/tracepilot/tasks.db` on first access
- [ ] All CRUD operations work with proper error handling
- [ ] Schema version tracked and migrateable
- [ ] Stale task release works correctly (expired leases → pending)
- [ ] Unit tests for all operations

### 1.2 Wire into Tauri app state

**Modified files:**
- `crates/tracepilot-tauri-bindings/src/lib.rs` — add `TaskDb` to managed state
- `apps/desktop/src-tauri/src/main.rs` — initialise TaskDb on startup

**Pattern to follow:** How `IndexDb` is wired into state (if applicable), or use
`tauri::Manager::manage()` directly.

**Acceptance criteria:**
- [ ] `TaskDb` (connection pool or `Mutex<Connection>`) available in all command handlers
- [ ] DB initialised on app startup with PRAGMAs applied
- [ ] Cleanup runs on startup (stale tasks, orphan files)

---

## Work Stream 2: Task Preset System

### 2.1 Preset types and CRUD

**New files:**
- `crates/tracepilot-orchestrator/src/presets/mod.rs` — module root
- `crates/tracepilot-orchestrator/src/presets/types.rs` — `TaskPreset`, `PromptVariable`, `ContextSource`
- `crates/tracepilot-orchestrator/src/presets/io.rs` — load/save/list/delete from JSON files

**Pattern to follow:** `crates/tracepilot-orchestrator/src/templates.rs` for file-based
config CRUD (read, write, list from a directory).

**Storage directory:** `~/.copilot/tracepilot/task-presets/{id}.json`

**Rust types (`presets/types.rs`):**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskPreset {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: u32,
    pub prompt: PresetPrompt,
    pub context: PresetContext,
    pub output: PresetOutput,
    pub execution: PresetExecution,
    pub tags: Vec<String>,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetPrompt {
    pub system: String,
    pub user: String,
    pub variables: Vec<PromptVariable>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptVariable {
    pub name: String,
    #[serde(rename = "type")]
    pub var_type: VariableType,
    pub required: bool,
    pub description: String,
    pub default: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VariableType {
    #[serde(rename = "string")]
    String,
    #[serde(rename = "number")]
    Number,
    #[serde(rename = "boolean")]
    Boolean,
    #[serde(rename = "session_ref")]
    SessionRef,
    #[serde(rename = "session_list")]
    SessionList,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetContext {
    pub sources: Vec<ContextSource>,
    pub max_chars: usize,
    pub format: ContextFormat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextSource {
    #[serde(rename = "type")]
    pub source_type: ContextSourceType,
    pub config: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ContextSourceType {
    #[serde(rename = "session_export")]
    SessionExport,
    #[serde(rename = "session_analytics")]
    SessionAnalytics,
    #[serde(rename = "session_health")]
    SessionHealth,
    #[serde(rename = "session_todos")]
    SessionTodos,
    #[serde(rename = "recent_sessions")]
    RecentSessions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetOutput {
    pub schema: serde_json::Value,
    pub format: OutputFormat,
    pub validation: ValidationMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetExecution {
    pub model_override: Option<String>,
    pub timeout_seconds: u64,
    pub max_retries: u32,
    pub priority: String,
}
```

**IO functions (`presets/io.rs`):**
```rust
pub fn list_presets(data_dir: &Path) -> Result<Vec<TaskPreset>>
pub fn get_preset(data_dir: &Path, id: &str) -> Result<TaskPreset>
pub fn save_preset(data_dir: &Path, preset: &TaskPreset) -> Result<()>
pub fn delete_preset(data_dir: &Path, id: &str) -> Result<()>
pub fn preset_exists(data_dir: &Path, id: &str) -> bool
```

**Acceptance criteria:**
- [ ] Preset CRUD works (create, read, update, delete, list)
- [ ] JSON files stored atomically (`.tmp` → rename)
- [ ] Preset validation (required fields, valid variable types, valid source types)
- [ ] Built-in presets embedded in binary (not just shipped as files)

### 2.2 TypeScript types

**New files:**
- `packages/types/src/tasks.ts` — TypeScript equivalents of all task/preset types

**Modified files:**
- `packages/types/src/index.ts` — re-export tasks types

**Acceptance criteria:**
- [ ] Types match Rust types exactly (serde + TS naming conventions)
- [ ] Exported from `@tracepilot/types`

---

## Work Stream 3: Context Assembly Pipeline

### 3.1 Context assembler

**New files:**
- `crates/tracepilot-orchestrator/src/task_context/mod.rs` — module root
- `crates/tracepilot-orchestrator/src/task_context/assembler.rs` — orchestrates assembly
- `crates/tracepilot-orchestrator/src/task_context/sources.rs` — per-source-type logic
- `crates/tracepilot-orchestrator/src/task_context/budget.rs` — token budget management

**Pattern to follow:** `tracepilot-export` crate for session data extraction.

**Core function:**
```rust
/// Assemble all context for a task based on its preset and input parameters.
/// Returns the rendered context file content and metadata.
pub fn assemble_task_context(
    preset: &TaskPreset,
    input_params: &serde_json::Value,
    index_db: &IndexDb,
    data_dir: &Path,
) -> Result<AssembledContext>

pub struct AssembledContext {
    pub content: String,           // Full context.md content
    pub format: ContextFormat,
    pub sources_included: Vec<String>,
    pub truncated: bool,
    pub char_count: usize,
    pub context_hash: String,      // SHA-256 for dedup
}
```

**Per-source assembly (`sources.rs`):**
```rust
fn assemble_session_export(session_id: &str, data_dir: &Path, config: &Value) -> Result<String>
fn assemble_session_analytics(session_id: &str, index_db: &IndexDb, config: &Value) -> Result<String>
fn assemble_session_health(session_id: &str, index_db: &IndexDb, config: &Value) -> Result<String>
fn assemble_session_todos(session_id: &str, data_dir: &Path, config: &Value) -> Result<String>
fn assemble_recent_sessions(index_db: &IndexDb, config: &Value) -> Result<String>
```

**Budget management (`budget.rs`):**
```rust
/// Truncate assembled context to fit within the character budget.
/// Priority: required > primary (export, analytics) > supplementary (recent, health).
/// Truncation happens at line boundaries.
pub fn apply_budget(sources: &mut Vec<(String, String, Priority)>, max_chars: usize) -> BudgetResult
```

**Context file format** (written as markdown):
````markdown
# Task: {preset_name}

## System Prompt
{rendered_system_prompt}

## Instructions
{rendered_user_prompt}

## Context Data
{assembled_context_from_sources}

## Output Schema
```json
{output_schema}
```

## Output Format
Return your result as valid JSON matching the schema above.
Write the JSON to the result file at: {result_file_path}
Use atomic write (write to `.tmp` then rename).
````

**Acceptance criteria:**
- [ ] Each context source assembles correctly for a real session
- [ ] Variable interpolation works in prompt templates (`{{session_id}}` → actual ID)
- [ ] Budget truncation respects priority ordering
- [ ] Context hash is stable (same inputs → same hash)
- [ ] Context file is human-readable markdown

---

## Work Stream 4: Orchestrator Launch & Lifecycle

### 4.1 Orchestrator launcher

**New files:**
- `crates/tracepilot-orchestrator/src/task_orchestrator/mod.rs` — module root
- `crates/tracepilot-orchestrator/src/task_orchestrator/launcher.rs` — launch logic
- `crates/tracepilot-orchestrator/src/task_orchestrator/prompt.rs` — prompt template
- `crates/tracepilot-orchestrator/src/task_orchestrator/manifest.rs` — manifest generation

**Pattern to follow:** `crates/tracepilot-orchestrator/src/launcher.rs` for the session
launch logic. The task orchestrator reuses `LaunchConfig` and `spawn_detached_terminal`.

**Prompt template (`prompt.rs`):**
```rust
/// The orchestrator prompt template with placeholders for template variables.
const ORCHESTRATOR_PROMPT_TEMPLATE: &str = include_str!("orchestrator_prompt.md");

pub fn render_orchestrator_prompt(config: &OrchestratorConfig) -> String {
    ORCHESTRATOR_PROMPT_TEMPLATE
        .replace("{{manifest_path}}", &config.manifest_path)
        .replace("{{poll_interval}}", &config.poll_interval.to_string())
        .replace("{{max_parallel}}", &config.max_parallel.to_string())
        .replace("{{max_empty_polls}}", &config.max_empty_polls.to_string())
        .replace("{{max_cycles}}", &config.max_cycles.to_string())
}
```

**New file:** `crates/tracepilot-orchestrator/src/task_orchestrator/orchestrator_prompt.md`
— The full prompt template from Appendix A of the architecture doc.

**Manifest generation (`manifest.rs`):**
```rust
#[derive(Serialize)]
pub struct TaskManifest {
    pub version: u32,
    pub poll_interval_seconds: u64,
    pub max_parallel: u32,
    pub shutdown: bool,
    pub tasks: Vec<ManifestTask>,
}

#[derive(Serialize)]
pub struct ManifestTask {
    pub id: String,
    #[serde(rename = "type")]
    pub task_type: String,
    pub title: String,
    pub context_file: String,
    pub result_file: String,
    pub status_file: String,
    pub model: String,
    pub priority: u32,
}

pub fn generate_manifest(
    pending_tasks: &[Task],
    jobs_dir: &Path,
    config: &OrchestratorConfig,
) -> Result<TaskManifest>

pub fn write_manifest(manifest: &TaskManifest, path: &Path) -> Result<()>

pub fn update_manifest_shutdown(path: &Path) -> Result<()>
```

**Launch function (`launcher.rs`):**
```rust
pub struct OrchestratorConfig {
    pub manifest_path: String,
    pub poll_interval: u64,
    pub max_parallel: u32,
    pub max_empty_polls: u32,
    pub max_cycles: u32,
    pub orchestrator_model: String,
    pub cli_command: String,
}

pub struct OrchestratorHandle {
    pub pid: u32,
    pub session_uuid: Option<String>,
    pub manifest_path: PathBuf,
    pub jobs_dir: PathBuf,
    pub launched_at: String,
}

/// Full orchestrator launch sequence:
/// 1. Get pending tasks from tasks.db
/// 2. Assemble context files for each task
/// 3. Generate and write manifest.json
/// 4. Render orchestrator prompt
/// 5. Launch Copilot CLI session via spawn_detached_terminal
/// 6. Return handle for monitoring
pub fn launch_orchestrator(
    task_db: &Connection,
    index_db: &IndexDb,
    data_dir: &Path,
    config: &OrchestratorConfig,
    app_config: &TracePilotConfig,
) -> Result<OrchestratorHandle>
```

**Acceptance criteria:**
- [ ] Orchestrator launches in a visible terminal with the correct prompt
- [ ] Manifest includes all pending tasks with correct file paths
- [ ] Context files are written for each task before manifest is written
- [ ] Prompt template interpolation produces valid output
- [ ] Handle returned with PID and metadata

### 4.2 Orchestrator state management

**New files:**
- `crates/tracepilot-tauri-bindings/src/commands/tasks.rs` — task IPC commands (see WS8)

**Modified files:**
- `apps/desktop/src-tauri/src/main.rs` — add `OrchestratorState` to managed state

**Tauri managed state:**
```rust
pub struct OrchestratorState {
    pub handle: Mutex<Option<OrchestratorHandle>>,
    pub restart_count: AtomicU32,
}
```

**Acceptance criteria:**
- [ ] Only one orchestrator can run at a time (concurrent guard)
- [ ] State is cleared when orchestrator exits
- [ ] Restart count tracked for circuit breaker

---

## Work Stream 5: File-Based IPC Protocol

### 5.1 Result watcher

**New files:**
- `crates/tracepilot-orchestrator/src/task_orchestrator/watcher.rs` — file watching logic

**Core function:**
```rust
/// Poll the jobs directory for new status.json files.
/// For each detected status file:
/// 1. Read status.json
/// 2. Read corresponding result.json (if status == completed)
/// 3. Validate result against preset's output schema
/// 4. Return processed results for DB update
pub fn poll_job_directory(jobs_dir: &Path) -> Result<Vec<TaskCompletion>>

pub struct TaskCompletion {
    pub task_id: String,
    pub status: CompletionStatus,
    pub result_content: Option<String>,
    pub result_parsed: Option<serde_json::Value>,
    pub schema_valid: bool,
    pub validation_errors: Vec<String>,
    pub summary: Option<String>,
}

pub enum CompletionStatus {
    Completed,
    Failed { error: String },
}
```

### 5.2 Heartbeat monitor

**New file (in same module):**
```rust
/// Check orchestrator health via heartbeat file.
pub fn check_heartbeat(jobs_dir: &Path, max_stale_seconds: u64) -> HeartbeatStatus

pub enum HeartbeatStatus {
    Healthy { cycle_count: u32, last_poll: String },
    Stale { last_poll: String, stale_for_seconds: u64 },
    Missing,
}
```

### 5.3 Manifest updater

When app detects completed tasks or new tasks are created:
```rust
/// Rewrite the manifest with only currently-pending tasks.
/// Called after processing completions or when new tasks are added.
pub fn refresh_manifest(
    task_db: &Connection,
    jobs_dir: &Path,
    config: &OrchestratorConfig,
) -> Result<()>

/// Signal the orchestrator to shut down by setting "shutdown": true.
pub fn signal_shutdown(jobs_dir: &Path) -> Result<()>
```

### 5.4 Background polling loop (Tauri side)

**Modified file:** `apps/desktop/src-tauri/src/main.rs` (or new setup module)

Set up a Tauri background task (using `tauri::async_runtime`) that polls every 3 seconds:
```rust
// Pseudocode for the polling loop
loop {
    // 1. Poll for status files
    let completions = poll_job_directory(&jobs_dir)?;
    for completion in completions {
        store_task_result(&task_db, &completion)?;
        app.emit("task-completed", &completion)?;
        // Clean up files
        remove_task_files(&jobs_dir, &completion.task_id)?;
    }

    // 2. Refresh manifest (remove completed, add new)
    refresh_manifest(&task_db, &jobs_dir, &config)?;

    // 3. Check heartbeat
    match check_heartbeat(&jobs_dir, max_stale) {
        HeartbeatStatus::Stale { .. } => handle_orchestrator_crash(),
        _ => {}
    }

    tokio::time::sleep(Duration::from_secs(3)).await;
}
```

**Acceptance criteria:**
- [ ] Status files detected within 3 seconds of being written
- [ ] Result files parsed and validated against output schema
- [ ] Completed task files cleaned up after processing
- [ ] Manifest dynamically updated as tasks complete
- [ ] Heartbeat stale detection triggers recovery
- [ ] Tauri events emitted for each task status change

---

## Work Stream 6: Subagent Attribution & Monitoring

### 6.1 Events.jsonl parser for orchestrator sessions

**New files:**
- `crates/tracepilot-orchestrator/src/task_orchestrator/attribution.rs`

**Core function:**
```rust
/// Parse the orchestrator's events.jsonl for subagent lifecycle events.
/// Returns task attribution: which subagent is working on which task.
pub fn parse_orchestrator_events(
    session_dir: &Path,
    last_offset: u64,  // Resume from last read position
) -> Result<(Vec<SubagentAttribution>, u64)>  // (events, new_offset)

pub struct SubagentAttribution {
    pub task_id: String,           // Extracted from "tp-{task_id}" naming
    pub tool_call_id: String,
    pub agent_name: String,
    pub status: SubagentStatus,
    pub timestamp: String,
}

pub enum SubagentStatus {
    Spawning,     // tool.execution_start
    Running,      // subagent.started
    Completed,    // subagent.completed
    Failed,       // subagent.failed
}
```

**Logic:**
1. Tail `events.jsonl` from `last_offset`
2. Parse each line as JSON
3. Match `tool.execution_start` where `toolName == "task"` and `arguments.name` starts with `"tp-"`
4. Extract task ID: `"tp-task-001"` → `"task-001"`
5. Match `subagent.started/completed/failed` by `toolCallId`
6. Return attribution events

**Pattern to follow:** `crates/tracepilot-core/src/parsing/events.rs` for event parsing.
Reuse `SubagentStartedData`, `ToolExecStartData` types from `tracepilot-core`.

### 6.2 Integration with polling loop

Add attribution parsing to the WS5 polling loop. On each cycle:
1. Find orchestrator session dir (by stored UUID)
2. Parse new events from `events.jsonl`
3. Emit Tauri events for subagent status changes:
   - `task-subagent-started`: `{ task_id, agent_name }`
   - `task-subagent-completed`: `{ task_id }`
   - `task-subagent-failed`: `{ task_id, error }`

**Acceptance criteria:**
- [ ] Task IDs correctly extracted from `"tp-{id}"` naming convention
- [ ] Subagent lifecycle events mapped to task progress
- [ ] Incremental parsing (only new events, not full re-read)
- [ ] Tauri events emitted for real-time dashboard updates

---

## Work Stream 7: Orchestrator Recovery

### 7.1 Crash detection and recovery

**New file:**
- `crates/tracepilot-orchestrator/src/task_orchestrator/recovery.rs`

```rust
/// Check if orchestrator needs recovery.
/// Called from the polling loop when heartbeat is stale or missing.
pub fn check_recovery_needed(
    task_db: &Connection,
    orchestrator_state: &OrchestratorState,
) -> RecoveryAction

pub enum RecoveryAction {
    None,                          // All tasks done
    Restart,                       // Remaining tasks, retry budget available
    CircuitBreaker { restarts: u32 }, // Too many restarts
}

/// Execute recovery:
/// 1. Reset in-progress tasks without status files → pending
/// 2. Rewrite manifest with remaining tasks
/// 3. Launch fresh orchestrator
pub fn execute_recovery(
    task_db: &Connection,
    index_db: &IndexDb,
    data_dir: &Path,
    config: &OrchestratorConfig,
    orchestrator_state: &OrchestratorState,
) -> Result<Option<OrchestratorHandle>>
```

**Recovery steps:**
1. Check: any tasks still pending/in-progress?
2. Reset in-progress tasks without status files → pending
3. Check restart count < max (default 3)
4. If yes: assemble new context files + manifest, launch fresh orchestrator
5. If no: mark remaining tasks as dead_letter, emit failure event
6. Old orchestrator session preserved for debugging

**Acceptance criteria:**
- [ ] Stale orchestrator detected via heartbeat timeout
- [ ] In-progress tasks without status files reset to pending
- [ ] Fresh orchestrator launched with only remaining tasks
- [ ] Circuit breaker prevents infinite restarts
- [ ] User notified on circuit breaker activation

---

## Work Stream 8: Tauri IPC Commands

### 8.1 Task commands

**New file:** `crates/tracepilot-tauri-bindings/src/commands/tasks.rs`

**Commands to implement:**
```rust
#[tauri::command]
pub async fn create_task(preset_id: String, input_params: Value, state: ...) -> Result<Task>

#[tauri::command]
pub async fn create_task_batch(preset_id: String, input_params_list: Vec<Value>, state: ...) -> Result<Job>

#[tauri::command]
pub async fn list_tasks(filter: TaskFilter, state: ...) -> Result<Vec<Task>>

#[tauri::command]
pub async fn get_task(id: String, state: ...) -> Result<Task>

#[tauri::command]
pub async fn get_task_result(id: String, state: ...) -> Result<TaskResultDetail>

#[tauri::command]
pub async fn cancel_task(id: String, state: ...) -> Result<()>

#[tauri::command]
pub async fn cancel_job(job_id: String, state: ...) -> Result<()>

#[tauri::command]
pub async fn retry_task(id: String, state: ...) -> Result<()>

#[tauri::command]
pub async fn delete_task(id: String, state: ...) -> Result<()>

#[tauri::command]
pub async fn get_task_stats(state: ...) -> Result<TaskStats>

#[tauri::command]
pub async fn launch_orchestrator(state: ...) -> Result<OrchestratorHandle>

#[tauri::command]
pub async fn stop_orchestrator(state: ...) -> Result<()>

#[tauri::command]
pub async fn get_orchestrator_status(state: ...) -> Result<OrchestratorStatus>
```

### 8.2 Preset commands

```rust
#[tauri::command]
pub async fn list_presets(state: ...) -> Result<Vec<TaskPreset>>

#[tauri::command]
pub async fn get_preset(id: String, state: ...) -> Result<TaskPreset>

#[tauri::command]
pub async fn save_preset(preset: TaskPreset, state: ...) -> Result<()>

#[tauri::command]
pub async fn delete_preset(id: String, state: ...) -> Result<()>
```

**Modified files:**
- `crates/tracepilot-tauri-bindings/src/commands/mod.rs` — add `tasks` module
- `crates/tracepilot-tauri-bindings/src/lib.rs` — register new commands

**Pattern to follow:** `crates/tracepilot-tauri-bindings/src/commands/orchestration.rs`
for existing command patterns (error handling, state access, event emission).

**Acceptance criteria:**
- [ ] All commands registered and callable from frontend
- [ ] Proper error types (BindingsError variants)
- [ ] Events emitted on state changes

### 8.3 Client bindings

**Modified file:** `packages/client/src/index.ts`
- Add typed wrappers for all new Tauri commands
- Add mock data entries in `getMockData()` for dev/browser mode

**Acceptance criteria:**
- [ ] All commands have typed TypeScript wrappers
- [ ] Mock data returns realistic test data
- [ ] Types imported from `@tracepilot/types`

---

## Work Stream 9: Frontend — Stores & Composables

### 9.1 Tasks store

**New file:** `apps/desktop/src/stores/tasks.ts`

```typescript
export const useTasksStore = defineStore("tasks", () => {
  const tasks = ref<Task[]>([]);
  const taskStats = ref<TaskStats | null>(null);
  const loading = ref(false);

  async function loadTasks(filter?: TaskFilter) { ... }
  async function loadTaskStats() { ... }
  async function createTask(presetId: string, inputParams: Record<string, unknown>) { ... }
  async function createBatch(presetId: string, paramsList: Record<string, unknown>[]) { ... }
  async function cancelTask(id: string) { ... }
  async function retryTask(id: string) { ... }

  // Listen for Tauri events
  safeListen("task-completed", (event) => { ... });
  safeListen("task-failed", (event) => { ... });

  return { tasks, taskStats, loading, loadTasks, loadTaskStats, createTask, ... };
});
```

**Pattern to follow:** `apps/desktop/src/stores/sessions.ts` for list loading pattern,
`useAsyncGuard` for staleness detection.

### 9.2 Orchestrator store

**New file:** `apps/desktop/src/stores/orchestrator.ts`

```typescript
export const useOrchestratorStore = defineStore("orchestrator", () => {
  const status = ref<OrchestratorStatus | null>(null);
  const isRunning = computed(() => status.value?.state === "running");

  async function launch() { ... }
  async function stop() { ... }
  async function refreshStatus() { ... }

  safeListen("orchestrator-started", ...);
  safeListen("orchestrator-finished", ...);
  safeListen("task-subagent-started", ...);

  return { status, isRunning, launch, stop, refreshStatus };
});
```

### 9.3 Presets store

**New file:** `apps/desktop/src/stores/presets.ts`

```typescript
export const usePresetsStore = defineStore("presets", () => {
  const presets = ref<TaskPreset[]>([]);

  async function loadPresets() { ... }
  async function savePreset(preset: TaskPreset) { ... }
  async function deletePreset(id: string) { ... }

  return { presets, loadPresets, savePreset, deletePreset };
});
```

### 9.4 Composables

**New files:**
- `apps/desktop/src/composables/useTaskPolling.ts` — auto-refresh for task list
- `apps/desktop/src/composables/useOrchestratorHealth.ts` — poll orchestrator status

**Pattern to follow:** `apps/desktop/src/composables/useAutoRefresh.ts` for polling,
`onBeforeUnmount` cleanup.

**Acceptance criteria:**
- [ ] Stores reactive and updated via Tauri events
- [ ] useAsyncGuard pattern for staleness
- [ ] Composables clean up timers on unmount
- [ ] Mock data works in dev mode

---

## Work Stream 10: Frontend — Views & Components

> Note: Detailed prototypes are being designed by a separate agent. This section describes the
> views and components needed, not their exact design.

### 10.1 Task Dashboard View

**New file:** `apps/desktop/src/views/tasks/TaskDashboardView.vue`

**Requirements:**
- Hero stats: total tasks, pending, running, completed, failed
- Task list with filtering (by status, type, preset)
- "Start Orchestrator" / "Stop Orchestrator" button
- Orchestrator health indicator
- Quick-create task buttons (per enabled preset)
- Links to task detail view

### 10.2 Task Detail View

**New file:** `apps/desktop/src/views/tasks/TaskDetailView.vue`

**Requirements:**
- Task metadata (type, preset, status, timestamps)
- Input parameters display
- Result viewer (rendered markdown or formatted JSON)
- Subagent attribution (which model/agent processed this)
- Retry / Cancel actions
- Link to orchestrator session (if identifiable)

### 10.3 Presets Management View

**New file:** `apps/desktop/src/views/tasks/TaskPresetsView.vue`

**Requirements:**
- List of presets (built-in + custom)
- Enable/disable toggle
- Edit / Delete buttons
- "Create New Preset" button
- Import/export (JSON)

### 10.4 Navigation

**Modified files:**
- `apps/desktop/src/router/index.ts` — add task routes
- Navigation sidebar/tabs — add "Tasks" section

**Routes:**
```typescript
{
  path: "/tasks",
  component: TaskDashboardView,
  name: "tasks",
},
{
  path: "/tasks/:id",
  component: TaskDetailView,
  name: "task-detail",
},
{
  path: "/tasks/presets",
  component: TaskPresetsView,
  name: "task-presets",
},
```

### 10.5 Components

**New component files:**
- `apps/desktop/src/components/tasks/TaskCard.vue` — compact task representation
- `apps/desktop/src/components/tasks/TaskStatusBadge.vue` — status pill
- `apps/desktop/src/components/tasks/TaskResultViewer.vue` — render result (md/json)
- `apps/desktop/src/components/tasks/OrchestratorStatusBar.vue` — health bar
- `apps/desktop/src/components/tasks/CreateTaskModal.vue` — modal for creating tasks
- `apps/desktop/src/components/tasks/PresetCard.vue` — compact preset representation

**Acceptance criteria:**
- [ ] Dashboard shows task stats and list
- [ ] Task detail renders results correctly
- [ ] Orchestrator start/stop works from UI
- [ ] Real-time updates via Tauri events
- [ ] Presets manageable from UI

---

## Work Stream 11: Built-in Presets

### 11.1 Ship 5 default presets

**New files in:** `crates/tracepilot-orchestrator/src/presets/builtins/`
- `session_summary.json`
- `code_review_digest.json`
- `session_health_audit.json`
- `cost_analysis.json`
- `weekly_digest.json`

These are embedded at compile time via `include_str!` and written to the presets directory
on first run (if not already present).

**Pattern to follow:** How default templates or config are shipped.

**Acceptance criteria:**
- [ ] Each preset has a tested prompt that produces valid output
- [ ] Output schemas validate correctly
- [ ] Context sources resolve for real session data
- [ ] Presets are copy-on-write (user edits create a custom version, built-in preserved)

---

## Work Stream 12: CLI Read-Only Commands

### 12.1 Task status commands

**Modified file:** `apps/cli/src/index.ts` — add `tasks` command group

**New commands:**
```
tracepilot tasks list [--status pending|done|failed] [--limit N]
tracepilot tasks status <task-id>
tracepilot tasks stats
```

These are **read-only** — the CLI reads tasks.db directly (read-only, same pattern as
sessions listing) but never writes.

**New file:** `apps/cli/src/commands/tasks.ts`

**Acceptance criteria:**
- [ ] Commands work from CLI
- [ ] Read-only access (no writes to tasks.db)
- [ ] Output formatted for terminal

---

## Work Stream 13: Config & Settings

### 13.1 Config schema update

**Modified files:**
- `crates/tracepilot-orchestrator/src/types.rs` — add `OrchestratorTaskConfig` struct
- `crates/tracepilot-tauri-bindings/src/config.rs` — add orchestrator section
- `packages/types/src/orchestration.ts` — TypeScript config types

**New config section in `config.toml`:**
```toml
[orchestrator.tasks]
orchestrator_model = "claude-sonnet-4.6"
subagent_model = "claude-haiku-4.5"
max_parallel_tasks = 3
poll_interval_seconds = 30
max_empty_polls = 10
max_cycles = 100
auto_start = false
```

**Pattern to follow:** Existing config migration system (`version_manager.rs`).
Bump `CURRENT_VERSION` from 3 → 4.

### 13.2 Settings UI

**Modified file:** `apps/desktop/src/views/SettingsView.vue`

Add a "Tasks" section in settings:
- Orchestrator model selector
- Subagent model selector
- Max parallel tasks slider
- Poll interval input
- Auto-start toggle
- Max cycles input
- Max empty polls input

**Pattern to follow:** Existing settings sections (MCP, preferences, etc.)

**Acceptance criteria:**
- [ ] Config persists across app restarts
- [ ] Config version migration works (v3 → v4)
- [ ] Settings changes take effect on next orchestrator launch
- [ ] Validation on numeric fields (reasonable ranges)

---

## Work Stream 14: Integration Testing

### 14.1 Rust integration tests

**New files:**
- `crates/tracepilot-orchestrator/src/task_db/tests.rs` — DB operation tests
- `crates/tracepilot-orchestrator/src/presets/tests.rs` — preset CRUD tests
- `crates/tracepilot-orchestrator/src/task_context/tests.rs` — context assembly tests
- `crates/tracepilot-orchestrator/src/task_orchestrator/tests.rs` — manifest/prompt tests

### 14.2 Frontend tests

**New files:**
- `apps/desktop/src/__tests__/stores/tasks.test.ts`
- `apps/desktop/src/__tests__/stores/orchestrator.test.ts`

### 14.3 End-to-end test

Manual test script that:
1. Creates a task via UI
2. Launches orchestrator
3. Verifies task completes and result is displayed
4. Verifies orchestrator exits cleanly
5. Verifies task stats update

**Acceptance criteria:**
- [ ] All Rust unit tests pass
- [ ] Frontend store tests pass
- [ ] E2E flow verified manually
- [ ] `cargo check --package tracepilot-tauri-bindings` passes
- [ ] `corepack pnpm typecheck` passes in apps/desktop

---

## Dependency Graph

```
WS1 (Task DB)
  │
  ├──→ WS3 (Context Assembly) ←── WS2 (Presets)
  │         │
  │         ▼
  │    WS4 (Orchestrator Launch)
  │         │
  │         ├──→ WS5 (File IPC)
  │         │         │
  │         │         ├──→ WS6 (Attribution)
  │         │         └──→ WS7 (Recovery)
  │         │
  │         └──→ WS8 (Tauri Commands)
  │                   │
  │                   ├──→ WS9 (Stores)
  │                   │         │
  │                   │         └──→ WS10 (Views)
  │                   │
  │                   └──→ WS12 (CLI)
  │
  ├──→ WS11 (Built-in Presets) ←── WS2
  └──→ WS13 (Config)
```

## Implementation Order

### Layer 1: Foundation (no dependencies)
1. **WS1.1** — Task DB schema + operations
2. **WS2.1** — Preset types and CRUD
3. **WS2.2** — TypeScript types
4. **WS13.1** — Config schema update

### Layer 2: Core Backend (depends on Layer 1)
5. **WS3.1** — Context assembly pipeline
6. **WS4.1** — Orchestrator launcher + prompt
7. **WS11.1** — Built-in presets

### Layer 3: IPC & Monitoring (depends on Layer 2)
8. **WS5.1-5.4** — File IPC (watcher, heartbeat, manifest updater, polling loop)
9. **WS6.1-6.2** — Subagent attribution
10. **WS7.1** — Recovery logic

### Layer 4: Integration Layer (depends on Layer 3)
11. **WS8.1-8.3** — Tauri IPC commands + client bindings
12. **WS4.2** — Orchestrator state management

### Layer 5: Frontend (depends on Layer 4)
13. **WS9.1-9.4** — Stores and composables
14. **WS10.1-10.5** — Views and components
15. **WS13.2** — Settings UI

### Layer 6: Polish (depends on Layer 5)
16. **WS12.1** — CLI read-only commands
17. **WS14.1-14.3** — Integration testing

---

## Notes

### Crate Dependency Additions
- `tracepilot-orchestrator` may need: `sha2` (context hashing), `notify` (Phase 2 file watching)
- `tracepilot-tauri-bindings` may need: no new deps (reuses existing patterns)

### File Path Summary
All new modules are in existing crates — no new crate creation needed:
- **Rust:** `crates/tracepilot-orchestrator/src/task_db/`, `presets/`, `task_context/`, `task_orchestrator/`
- **Rust IPC:** `crates/tracepilot-tauri-bindings/src/commands/tasks.rs`
- **TS Types:** `packages/types/src/tasks.ts`
- **Client:** `packages/client/src/index.ts` (extend)
- **Stores:** `apps/desktop/src/stores/tasks.ts`, `orchestrator.ts`, `presets.ts`
- **Views:** `apps/desktop/src/views/tasks/` (new directory)
- **Components:** `apps/desktop/src/components/tasks/` (new directory)
- **CLI:** `apps/cli/src/commands/tasks.ts`

### Risk Mitigations
1. **LLM file-writing reliability**: Validate result files, retry on malformed output
2. **Context assembly errors**: Graceful degradation (skip failed sources, note in context)
3. **Concurrent manifest writes**: App is single writer; atomic write pattern
4. **Large result files**: Set reasonable size limits, truncate for DB storage
