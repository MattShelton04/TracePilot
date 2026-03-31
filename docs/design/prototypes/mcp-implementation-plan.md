# MCP Server Management — Implementation Plan

> TracePilot feature for browsing, configuring, and managing Model Context Protocol servers used by GitHub Copilot CLI.
>
> **Prototype reference:** `docs/design/prototypes/mcp/mcp-hybrid.html`
>
> **Reviewed by:** Claude Opus 4.6, GPT 5.4, GPT 5.3 Codex — feedback consolidated below.

---

## 0. Reviewer Feedback Summary

Three AI reviewers validated this plan against the actual codebase. Key corrections applied:

1. **Architecture**: Modules in `tracepilot-orchestrator`, NOT separate crates (user decision — less workspace overhead)
2. **Store pattern**: Must use `@tracepilot/client` typed wrappers, not raw `invoke()` (all stores do this)
3. **Health check I/O**: `process::run_hidden()` is one-shot — MCP JSON-RPC needs `tokio::process::Command` with piped stdin/stdout for bidirectional communication
4. **serde conventions**: Tauri DTOs use `#[serde(rename_all = "camelCase")]` for frontend compatibility
5. **Route meta**: Must include `sidebarId` property for sidebar active highlighting
6. **Feature flags**: Require 3-file update (Rust `config.rs` + TS `config.ts` type + TS `defaults.ts` value)
7. **Package types/client**: All IPC types need TypeScript definitions in `packages/types/` and typed wrappers in `packages/client/`
8. **StatusIcon incompatible**: Existing variants (`done|in_progress|blocked|pending`) don't match MCP statuses — need new `McpStatusDot` component
9. **`#[cfg(windows)]`**: Use this form, not `#[cfg(target_os = "windows")]`, to match codebase convention
10. **File watching**: Should detect external config changes (Copilot CLI or manual edits)
11. **Static mutex**: Use crate-level static lock for config writes (following `repo_registry.rs` pattern)

---

## 1. Overview

MCP servers extend Copilot CLI's capabilities by providing external tools (filesystem access, databases, browsers, etc.) via a JSON-RPC protocol. TracePilot will provide a GUI for viewing installed servers, adding/removing servers, toggling tools on/off, inspecting health, and estimating context token cost — all operating on the same config files Copilot CLI reads.

### Config Files Managed

| File | Scope | Format |
|------|-------|--------|
| `~/.copilot/mcp-config.json` | Global | `{ "mcpServers": { "<name>": { ... } } }` |
| `<project>/.copilot/mcp-config.json` | Project | Same schema |
| `<project>/.mcp.json` | Project (flat) | `{ "<name>": { ... } }` |

### Server Entry Schema

```json
{
  "type": "stdio" | "http" | "sse",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
  "env": { "API_KEY": "sk-..." },
  "cwd": "/optional/working/dir",
  "url": "https://...",
  "headers": { "Authorization": "Bearer ..." },
  "tools": { "include": ["tool_a"], "exclude": ["tool_b"] },
  "instructions": "Optional natural-language instructions for the model"
}
```

---

## 2. Existing Infrastructure Reuse

### 2.1 Shared UI Components (packages/ui)

These existing components map directly to prototype elements:

| Prototype Element | Existing Component | Notes |
|---|---|---|
| Server enable/disable toggle | `FormSwitch` (`modelValue: boolean, label?: string`) | Direct fit for card toggle |
| Server name / command / URL inputs | `FormInput` (`modelValue, type?, placeholder?, disabled?`) | Add Server modal fields |
| Scope / status / transport dropdowns | `FilterSelect` (`options: string[], placeholder?`) | Filter bar dropdowns |
| Search bar with ⌘K hint | `SearchInput` (`placeholder?, shortcutHint?`) | Filter bar search |
| Transport type selector | `SearchableSelect` or `BtnGroup` (`options: {value,label}[]`) | Segmented control in Add modal |
| Add Server modal | `ModalDialog` (`visible, title?, role?`) | Slots: header, body, footer |
| Delete server confirmation | `ConfirmDialog` + `useConfirmDialog()` | Danger variant with title/message |
| Scope / transport / token badges | `Badge` (`variant: default\|accent\|success\|warning\|danger\|done\|neutral`) | Per-card badges |
| Health stats cards | `StatCard` (`value, label, color?, trend?, gradient?, mini?, tooltip?`) | 4-column health grid |
| Server status indicator | `StatusIcon` (`status, size?`) | Needs custom status mapping |
| Token budget progress bar | `ProgressBar` (`percent, color?, ariaLabel?`) | Token usage summary |
| Token bar visualization | `TokenBar` (`label, value, percentage, color?`) | Per-server token display |
| Env var table | `DataTable` (`columns, rows, emptyMessage?`) | With custom cell slots for masking |
| Config key-value rows | `DefList` (`items: {label, value}[]`) | Simple config display |
| JSON config preview | `renderers/CodeBlock` (`code, language?, lineNumbers?`) | JSON syntax highlighting |
| Empty state (no servers) | `EmptyState` (`message?, icon?, title?, compact?`) | With action slot |
| Error state (load failure) | `ErrorState` (`heading?, message?, retryable?`) | With retry emit |
| Health check error | `ErrorAlert` (`message?, severity?, variant?, dismissible?, retryable?`) | Inline variant |
| Loading states | `LoadingSpinner` / `LoadingOverlay` / `SkeletonLoader` | Card variant for grid |
| Section panels | `SectionPanel` (`title?, padding?`) | Config sections |
| Action buttons | `ActionButton` (`disabled?, size?, variant?`) | Primary/ghost variants |

### 2.2 Composables

| Use Case | Composable | Usage |
|---|---|---|
| Copy JSON config to clipboard | `useClipboard()` | Export button |
| Delete server dialog | `useConfirmDialog()` | Danger confirmation |
| Dismiss "getting started" banner | `useDismissable(key)` | First-run tips |
| Toast notifications | `useToast()` via `useToastStore()` | Success/error feedback |
| Tool multi-select | `useToggleSet<string>()` | Tool enable/disable checkboxes |

### 2.3 Utility Functions

| Function | Use |
|---|---|
| `formatTokens()` | Token count display (already exists in `packages/ui/src/utils/formatters.ts`) |
| `formatNumber()` | Tool counts, stats |
| `formatRelativeTime()` | "Last health check: 5 min ago" |
| `toErrorMessage()` | Error handling |

### 2.4 Layout Components

| Component | Use |
|---|---|
| `AppSidebar` | Add "MCP Servers" nav item. Uses `NavItem` interface with `featureFlag?` support |
| `BreadcrumbNav` | `items: BreadcrumbItem[]` with `{label, to?}`. "Settings / MCP Servers" |

### 2.5 Rust Backend Patterns

| Existing Module | Reuse For | Pattern |
|---|---|---|
| `repo_registry.rs` | MCP server registry | Atomic JSON read-modify-write with mutex + tmp+rename. Windows `remove_file` before rename. Path normalization. Best model for `mcp-metadata.json` |
| `config_injector.rs` | Config writes, backups, diffs | `write_copilot_config()` for atomic JSON. `create_backup()` / `restore_backup()` / `diff_files()` for config change safety. `preview_backup_restore()` for diff preview |
| `process.rs` | Health checks, CLI invocation | `run_hidden(program, args, cwd)` for stdio server spawn. `run_hidden_stdout()` for quick command output. 5-second timeout pattern |
| `launcher.rs` | Path resolution, dependency checks | `copilot_home()` for `~/.copilot` path. `check_dependencies()` pattern for verifying server commands exist |
| `templates.rs` | Enable/disable pattern | "Dismiss instead of delete" pattern maps to disable/enable without modifying `mcp-config.json` |
| `state.rs` → `check_for_updates` | HTTP request pattern | `reqwest` with GitHub headers for HTTP MCP servers |

### 2.6 Preferences Store Integration

Add feature flag for MCP feature gating:
```typescript
// Existing pattern in preferences.ts featureFlags default
featureFlags: {
  exportView: true,
  healthScoring: false,
  sessionReplay: false,
  renderMarkdown: true,
  mcpServers: true,      // NEW
}
```

Sidebar visibility already checks `isFeatureEnabled()` — new nav item just needs `featureFlag: 'mcpServers'`.

---

## 3. New Shared Infrastructure

### 3.1 Token Estimation Module (Rust — reused by Skills too)

Create `crates/tracepilot-orchestrator/src/tokens.rs` as a shared utility:

```rust
/// Estimate tokens consumed by text in the LLM context window.
/// Uses ~4 characters per token heuristic (average across GPT/Claude tokenizers for English).
pub fn estimate_tokens(text: &str) -> u32 {
    (text.len() as f64 / 4.0).ceil() as u32
}

/// Estimate tokens for an MCP tool definition (name + description).
pub fn estimate_tool_tokens(name: &str, description: &str) -> u32 {
    estimate_tokens(&format!("{} {}", name, description))
}
```

This lives in `tracepilot-orchestrator` so both `mcp` and `skills` modules can use it.

### 3.2 Atomic JSON Helpers (extract from repo_registry.rs)

Extract the atomic write pattern into a shared utility in `tracepilot-orchestrator/src/lib.rs` or a new `json_io.rs`:

```rust
/// Atomic JSON write: serialize → write temp → rename.
pub fn atomic_json_write<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let json = serde_json::to_string_pretty(value)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json)?;
    #[cfg(windows)]
    let _ = std::fs::remove_file(path);
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Atomic JSON read with typed deserialization.
pub fn atomic_json_read<T: DeserializeOwned>(path: &Path) -> Result<T> {
    let content = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content)?)
}
```

### 3.3 `gh` CLI Wrapper (Rust — reused by Skills import + future GitHub features)

Create `crates/tracepilot-orchestrator/src/github.rs`:

```rust
use crate::process::run_hidden_stdout;

/// Check if `gh` CLI is installed and authenticated.
pub fn gh_auth_status() -> Result<GhAuthInfo> {
    let output = run_hidden_stdout("gh", &["auth", "status"], None)?;
    // Parse: "✓ Logged in to github.com account MattShelton04"
    ...
}

/// Fetch file contents from a GitHub repo (works for private repos if gh is authenticated).
pub fn gh_get_file(owner: &str, repo: &str, path: &str, ref_: &str) -> Result<String> {
    run_hidden_stdout("gh", &[
        "api", &format!("/repos/{owner}/{repo}/contents/{path}?ref={ref_}"),
        "--jq", ".content",
    ], None)
    // Base64 decode the content
}

/// List directory tree of a GitHub repo.
pub fn gh_list_tree(owner: &str, repo: &str, ref_: &str) -> Result<Vec<TreeEntry>> {
    let json = run_hidden_stdout("gh", &[
        "api", &format!("/repos/{owner}/{repo}/git/trees/{ref_}?recursive=1"),
    ], None)?;
    ...
}

pub struct GhAuthInfo {
    pub authenticated: bool,
    pub username: Option<String>,
    pub scopes: Vec<String>,
}

pub struct TreeEntry {
    pub path: String,
    pub type_: String, // "blob" or "tree"
    pub size: Option<u64>,
}
```

Uses existing `process::run_hidden_stdout()` — no new dependencies needed.

---

## 4. Backend — New Modules in `tracepilot-orchestrator`

MCP logic lives as modules inside the existing `tracepilot-orchestrator` crate, following the pattern of `repo_registry`, `templates`, `config_injector`.

```
crates/tracepilot-orchestrator/src/
├─ ... (existing modules)
├─ mcp/
│  ├─ mod.rs              # Public API re-exports
│  ├─ error.rs            # McpError enum
│  ├─ types.rs            # McpServerEntry, McpConfig, Transport, ToolFilter, health types
│  ├─ config.rs           # Read/write/merge config files (global + project + .mcp.json)
│  ├─ health.rs           # Health check via tokio::process::Command + JSON-RPC (piped stdin/stdout)
│  ├─ import.rs           # VS Code mcp.json translation (servers → mcpServers, ${env:VAR} → $VAR)
│  └─ diff.rs             # Generate before/after JSON diff
├─ tokens.rs              # Shared: token estimation (~4 chars/token)
├─ github.rs              # Shared: gh CLI wrapper for GitHub API operations
└─ json_io.rs             # Shared: atomic JSON read/write helpers
```

### 4.1 Additional Dependencies in `tracepilot-orchestrator`

```toml
# Add to existing Cargo.toml [dependencies]
reqwest = { workspace = true }  # For HTTP MCP health checks
tokio = { workspace = true, features = ["process", "time", "io-util"] }  # Async process + timeout
```

Note: `serde`, `serde_json`, `thiserror` are already workspace dependencies in this crate.

### 4.2 `types.rs` — Core Types

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConfig {
    #[serde(rename = "mcpServers", default)]
    pub servers: HashMap<String, McpServerEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerEntry {
    #[serde(rename = "type", default = "default_transport")]
    pub transport: Transport,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub env: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<ToolFilter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    Stdio,
    Http,
    Sse,
    #[serde(alias = "local")]
    Local,
}

fn default_transport() -> Transport { Transport::Stdio }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolFilter {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub include: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpHealthResult {
    pub status: McpServerStatus,
    pub response_time_ms: Option<u64>,
    pub tools: Vec<McpToolInfo>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum McpServerStatus { Connected, Error, Timeout, Unknown }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub description: Option<String>,
    pub estimated_tokens: u32,
}

/// TracePilot-only metadata (NOT written to mcp-config.json — stored in mcp-metadata.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerMeta {
    pub disabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_health_check: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached_tools: Option<Vec<McpToolInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpMetadata {
    pub servers: HashMap<String, McpServerMeta>,
}
```

### 4.3 `config.rs` — Config Operations

All file I/O uses `tracepilot_orchestrator::json_io::{atomic_json_read, atomic_json_write}`.

| Function | Description |
|----------|-------------|
| `load_global_config()` | Read `~/.copilot/mcp-config.json` via `launcher::copilot_home()` |
| `load_project_config(project_path)` | Read `.copilot/mcp-config.json` or `.mcp.json` |
| `load_merged_config(project_path?)` | Merge global + project, annotating scope per server |
| `save_global_config(config)` | Atomic write to global. Uses `config_injector::create_backup()` first |
| `save_project_config(project_path, config)` | Atomic write to project |
| `add_server(name, entry, scope, project_path?)` | Add to appropriate file |
| `remove_server(name, scope, project_path?)` | Remove from appropriate file |
| `update_server(name, entry, scope, project_path?)` | Update in-place |
| `load_metadata()` | Read `~/.copilot/tracepilot/mcp-metadata.json` |
| `save_metadata(meta)` | Atomic write metadata |

### 4.4 `health.rs` — Server Health Check

**Critical**: `process::run_hidden()` is one-shot (captures all output then returns). MCP JSON-RPC requires bidirectional stdin/stdout communication. Must use `tokio::process::Command` with piped streams.

```rust
use tokio::process::Command;
use tokio::time::{timeout, Duration};
use tokio::io::{AsyncWriteExt, AsyncReadExt, BufReader, AsyncBufReadExt};

pub async fn check_health(name: &str, entry: &McpServerEntry) -> McpHealthResult {
    match entry.transport {
        Transport::Stdio | Transport::Local => check_stdio_health(name, entry).await,
        Transport::Http => check_http_health(name, entry).await,
        Transport::Sse => McpHealthResult { status: McpServerStatus::Unknown, ..default() },
    }
}

async fn check_stdio_health(name: &str, entry: &McpServerEntry) -> McpHealthResult {
    let result = timeout(Duration::from_secs(5), async {
        // 1. Spawn process with piped stdin/stdout
        let mut child = Command::new(entry.command.as_deref().unwrap_or(""))
            .args(&entry.args)
            .envs(&entry.env)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()?;
        // 2. Write JSON-RPC initialize request to stdin
        // 3. Read response from stdout (line-delimited JSON)
        // 4. Write tools/list request
        // 5. Parse tool descriptions, compute token estimates
        // 6. Kill child process
        child.kill().await.ok();
        Ok(health_result)
    }).await;
    
    match result {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => McpHealthResult { status: McpServerStatus::Error, error_message: Some(e.to_string()), ..default() },
        Err(_) => McpHealthResult { status: McpServerStatus::Timeout, error_message: Some(format!("Timeout after 5s")), ..default() },
    }
}

async fn check_http_health(name: &str, entry: &McpServerEntry) -> McpHealthResult {
    // Uses reqwest (already a workspace dependency) to POST JSON-RPC to entry.url
}
```

Uses static mutex for metadata cache writes (following `repo_registry.rs:17` pattern).

### 4.5 `import.rs` — VS Code Translation

```rust
/// Translate VS Code MCP config to Copilot CLI format.
/// - "servers" key → "mcpServers"
/// - "${env:VAR}" → "$VAR" in command/args/env
pub fn translate_vscode_config(vscode_json: &str) -> Result<McpConfig> { ... }
```

### 4.6 `error.rs`

Added as a variant to the existing `OrchestratorError` enum in `crates/tracepilot-orchestrator/src/error.rs`, OR as a separate `McpError` type within the `mcp/` module. The latter is cleaner:

```rust
#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Server not found: {0}")]
    NotFound(String),
    #[error("Health check timeout for server: {0}")]
    HealthTimeout(String),
    #[error("Health check error for server {0}: {1}")]
    HealthError(String, String),
    #[error("Server already exists: {0}")]
    AlreadyExists(String),
    #[error("Invalid server name: {0}")]
    InvalidName(String),
}
```

Then in `crates/tracepilot-orchestrator/src/error.rs`, add:
```rust
#[error("MCP error: {0}")]
Mcp(#[from] crate::mcp::McpError),
```

And in `crates/tracepilot-tauri-bindings/src/error.rs`, the existing `Orchestrator(#[from] OrchestratorError)` variant will automatically propagate MCP errors through the chain.

---

## 5. Backend — Tauri Bindings

### 5.1 New File: `crates/tracepilot-tauri-bindings/src/commands/mcp.rs`

| IPC Command | Returns | Prototype View |
|-------------|---------|----------------|
| `list_mcp_servers(project_path?)` | `Vec<McpServerSummary>` | Server List cards |
| `get_mcp_server(name, scope)` | `McpServerDetail` | Server Detail panel |
| `add_mcp_server(name, entry, scope, project_path?)` | `()` | Add Server modal |
| `update_mcp_server(name, entry, scope, project_path?)` | `()` | Server Detail save |
| `remove_mcp_server(name, scope, project_path?)` | `()` | Card remove action |
| `toggle_mcp_server(name, enabled)` | `()` | Card toggle |
| `check_mcp_health(name, scope)` | `McpHealthResult` | Detail health stats |
| `get_mcp_token_summary(project_path?)` | `McpTokenSummary` | Token usage bar |
| `preview_mcp_changes(name, entry, scope)` | `String` (diff) | Diff preview section |
| `import_vscode_mcp(path)` | `McpConfig` | Import flow |
| `export_mcp_config(name, scope)` | `String` (JSON) | Export button |

### 5.2 Existing Files to Modify

| File | Change |
|------|--------|
| `crates/tracepilot-orchestrator/src/lib.rs` | Add `pub mod mcp;` + `pub mod tokens;` + `pub mod github;` + `pub mod json_io;` |
| `crates/tracepilot-orchestrator/src/error.rs` | Add `Mcp(#[from] crate::mcp::McpError)` variant |
| `crates/tracepilot-orchestrator/Cargo.toml` | Add `reqwest`, `tokio` features (`process`, `time`, `io-util`) |
| `crates/tracepilot-tauri-bindings/src/commands/mod.rs` | Add `pub mod mcp;` |
| `crates/tracepilot-tauri-bindings/src/lib.rs` | Register 11 commands in `generate_handler![]` |

> **Note**: No new `BindingsError` variant needed — MCP errors propagate via existing `Orchestrator(#[from] OrchestratorError)` which now includes `Mcp`.

---

## 6. Frontend — Vue 3 / Pinia

### 6.1 New Store: `apps/desktop/src/stores/mcp.ts`

Pattern follows `stores/worktrees.ts` (list + detail + async actions). **Must use `@tracepilot/client` typed wrappers** — NOT raw `invoke()`.

```typescript
import { defineStore } from 'pinia'
import {
  listMcpServers, getMcpServer, addMcpServer, updateMcpServer,
  removeMcpServer, toggleMcpServer, checkMcpHealth, getMcpTokenSummary,
} from '@tracepilot/client'
import type { McpServerSummary, McpServerDetail, McpTokenSummary } from '@tracepilot/types'
import { ref, computed } from 'vue'

export const useMcpStore = defineStore('mcp', () => {
  // State
  const servers = ref<McpServerSummary[]>([])
  const selectedServer = ref<McpServerDetail | null>(null)
  const tokenSummary = ref<McpTokenSummary | null>(null)
  const loading = ref(false)
  const healthChecking = ref(false)
  const error = ref<string | null>(null)
  const filters = ref({
    search: '',
    scope: 'all' as 'all' | 'global' | 'project',
    status: 'all' as 'all' | 'active' | 'paused' | 'error',
    transport: 'all' as 'all' | 'stdio' | 'http' | 'sse',
  })

  // Getters
  const filteredServers = computed(() => { /* filter logic */ })
  const activeCount = computed(() => servers.value.filter(s => s.enabled).length)
  const errorCount = computed(() => servers.value.filter(s => s.status === 'error').length)

  // Actions — all use @tracepilot/client wrappers (which prefix with plugin:tracepilot|)
  async function loadServers(projectPath?: string) { ... }
  async function loadServerDetail(name: string, scope: string) { ... }
  async function addServer(name: string, entry: any, scope: string) { ... }
  async function updateServer(...) { ... }
  async function removeServer(...) { ... }
  async function toggleServer(name: string, enabled: boolean) { ... }
  async function checkHealth(name: string, scope: string) { ... }
  async function loadTokenSummary(projectPath?: string) { ... }

  return { servers, selectedServer, tokenSummary, loading, healthChecking,
           error, filters, filteredServers, activeCount, errorCount,
           loadServers, loadServerDetail, addServer, updateServer,
           removeServer, toggleServer, checkHealth, loadTokenSummary }
})
```

### 6.2 New Views

#### `apps/desktop/src/views/mcp/McpManagerView.vue`

Maps to prototype "Server List" view. Composed from:

| Prototype Section | Implementation |
|---|---|
| Page header + "Add Server" button | `<h1>` + `<ActionButton variant="primary">` |
| Stats strip (6 Installed · 4 Active · ...) | Row of `<Badge>` components with colored dots |
| Token usage summary bar | `<TokenBar>` or `<ProgressBar>` + text |
| Filter bar | `<SearchInput>` + 3× `<FilterSelect>` |
| Server card grid | CSS grid with `<McpServerCard>` components |
| Empty state | `<EmptyState>` with action slot for "Add Server" |
| Loading state | `<SkeletonLoader variant="card" :count="6">` |
| Error state | `<ErrorState>` with retry |

#### `apps/desktop/src/views/mcp/McpServerDetailView.vue`

Maps to prototype "Server Detail" view. Route param: `:serverName/:scope`.

| Prototype Section | Implementation |
|---|---|
| Back button + breadcrumb | `<BreadcrumbNav :items="[...]">` |
| Server header + status | `<Badge>` + `<McpStatusDot>` (custom — `StatusIcon` incompatible with MCP statuses) |
| Config rows (transport, command) | `<DefList>` or custom config card |
| Args tag list | New `<TagList>` component (shared — also used by Skills) |
| Env var table with masking | `<DataTable>` with custom `cell-value` slot + eye toggle |
| Test Connection button | `<ActionButton>` with loading/success/error states |
| Tool checkboxes | `useToggleSet()` + custom checkbox list |
| Per-tool token counts | `formatTokens()` from `packages/ui` |
| Health stats grid | 4× `<StatCard mini gradient>` |
| Diff preview | `<CodeBlock language="diff">` with +/- lines |
| Delete button | `<ActionButton variant="ghost">` → `useConfirmDialog()` |

### 6.3 New Components

```
apps/desktop/src/components/mcp/
├─ McpServerCard.vue          # Card with badges, status dot, toggle, actions
├─ McpStatusDot.vue           # Custom status indicator (connected|error|timeout|unknown)
├─ McpAddServerModal.vue      # Uses ModalDialog, FormInput, BtnGroup, CodeBlock
├─ McpToolList.vue            # Tool checkboxes with useToggleSet, token counts
├─ McpConfigEditor.vue        # DefList + DataTable + TagList for config editing
├─ McpHealthStats.vue         # 4× StatCard in CSS grid
├─ McpDiffPreview.vue         # CodeBlock with diff formatting
└─ McpTokenSummary.vue        # TokenBar/ProgressBar with summary text
```

**Component → Shared UI reuse map:**

| New Component | Shared Components Used |
|---|---|
| `McpServerCard` | `Badge`, `FormSwitch`, `ActionButton`, `StatusIcon` |
| `McpAddServerModal` | `ModalDialog`, `FormInput`, `BtnGroup`, `FilterSelect`, `CodeBlock`, `ActionButton` |
| `McpToolList` | `useToggleSet()`, `ActionButton`, `Badge` |
| `McpConfigEditor` | `DefList`, `DataTable`, `FormInput`, `ActionButton` |
| `McpHealthStats` | `StatCard` (×4) |
| `McpDiffPreview` | `CodeBlock` |
| `McpTokenSummary` | `TokenBar` or `ProgressBar`, `Badge` |

### 6.4 New Shared Components (packages/ui — reused by Skills too)

| Component | Props | Used By |
|---|---|---|
| `TagList.vue` | `tags: string[], removable?: boolean` | MCP args display, Skills allowed-tools |
| `EnvVarTable.vue` | `vars: Record<string,string>, editable?: boolean, masked?: boolean` | MCP env vars, potentially Skills env |
| `SegmentedControl.vue` | `options: {value,label}[], modelValue: string` | Transport selector, scope selector |

### 6.5 Router Changes

**File:** `apps/desktop/src/router/index.ts`

All routes must include `sidebarId` in meta for AppSidebar highlighting.

```typescript
{
  path: '/mcp',
  name: 'mcp-manager',
  component: () => import('@/views/mcp/McpManagerView.vue'),
  meta: { title: 'MCP Servers', sidebarId: 'mcp' },
},
{
  path: '/mcp/:scope/:serverName',
  name: 'mcp-detail',
  component: () => import('@/views/mcp/McpServerDetailView.vue'),
  meta: { title: 'Server Detail', sidebarId: 'mcp' },
  props: true,
},
```

### 6.6 Sidebar Update

**File:** `apps/desktop/src/components/layout/AppSidebar.vue`

Add new "Extensions" nav group (shared with Skills):
```typescript
{ id: 'mcp', label: 'MCP Servers', to: '/mcp', icon: 'mcp', featureFlag: 'mcpServers' }
```

### 6.7 Preferences Update

Feature flags require **3-file update**:

1. **Rust:** `crates/tracepilot-tauri-bindings/src/config.rs` — add to `FeaturesConfig`:
```rust
pub mcp_servers: bool,  // default true
```

2. **TypeScript type:** `packages/types/src/config.ts`:
```typescript
mcpServers: boolean
```

3. **TypeScript default:** `packages/types/src/defaults.ts`:
```typescript
mcpServers: true,
```

Also update `apps/desktop/src/stores/preferences.ts` if it has a hardcoded default.

---

## 7. Tauri Capabilities

**File:** `apps/desktop/src-tauri/capabilities/default.json`

No new permissions needed. Health checks use pure Rust `std::process::Command` (via `process::run_hidden`), not Tauri's shell plugin. Config files are in user home directory, accessible via standard fs operations.

---

## 8. Testing Strategy

### Backend Tests

| Test File | Coverage | Pattern Reference |
|---|---|---|
| `tracepilot-orchestrator/src/mcp/config.rs` (unit) | Load/save/merge, missing files, atomic write | `repo_registry.rs` tests |
| `tracepilot-orchestrator/src/mcp/types.rs` (unit) | Serde round-trip, `local` alias, camelCase DTOs | Existing type tests |
| `tracepilot-orchestrator/src/mcp/health.rs` (unit) | Mock responses, timeout, error cases | — |
| `tracepilot-orchestrator/src/mcp/import.rs` (unit) | VS Code → Copilot translation | — |
| `tracepilot-orchestrator/src/mcp/diff.rs` (unit) | JSON diff generation | `config_injector` diff tests |
| `tracepilot-orchestrator/src/tokens.rs` | Token estimation accuracy | — |
| `tracepilot-orchestrator/src/github.rs` | gh auth parsing, tree listing | — |

Run: `cargo test -p tracepilot-orchestrator mcp` and `cargo test -p tracepilot-orchestrator tokens`

### Frontend Tests

| Test File | Coverage |
|---|---|
| `apps/desktop/src/__tests__/stores/mcp.test.ts` | Store actions, getters, filter logic |
| `packages/ui/src/__tests__/TagList.test.ts` | Tag rendering, removal |
| `packages/ui/src/__tests__/EnvVarTable.test.ts` | Masking, reveal toggle |
| `packages/ui/src/__tests__/SegmentedControl.test.ts` | Selection, keyboard nav |

Run: `pnpm --filter @tracepilot/desktop test` and `pnpm --filter @tracepilot/ui test`

---

## 9. Complete File Inventory

### New Files (CREATE)

| # | File | Size Est. | Category |
|---|------|-----------|----------|
| 1 | `crates/tracepilot-orchestrator/src/mcp/mod.rs` | ~0.5KB | Backend |
| 2 | `crates/tracepilot-orchestrator/src/mcp/error.rs` | ~1KB | Backend |
| 3 | `crates/tracepilot-orchestrator/src/mcp/types.rs` | ~3KB | Backend |
| 4 | `crates/tracepilot-orchestrator/src/mcp/config.rs` | ~4KB | Backend |
| 5 | `crates/tracepilot-orchestrator/src/mcp/health.rs` | ~4KB | Backend |
| 6 | `crates/tracepilot-orchestrator/src/mcp/import.rs` | ~2KB | Backend |
| 7 | `crates/tracepilot-orchestrator/src/mcp/diff.rs` | ~1.5KB | Backend |
| 8 | `crates/tracepilot-orchestrator/src/tokens.rs` | ~1KB | Shared infra |
| 9 | `crates/tracepilot-orchestrator/src/github.rs` | ~3KB | Shared infra |
| 10 | `crates/tracepilot-orchestrator/src/json_io.rs` | ~1KB | Shared infra |
| 11 | `crates/tracepilot-tauri-bindings/src/commands/mcp.rs` | ~4KB | IPC layer |
| 12 | `packages/types/src/mcp.ts` | ~2KB | TS types |
| 13 | `packages/client/src/mcp.ts` | ~2KB | Client wrappers |
| 14 | `apps/desktop/src/stores/mcp.ts` | ~3KB | Frontend |
| 15 | `apps/desktop/src/views/mcp/McpManagerView.vue` | ~5KB | Frontend |
| 16 | `apps/desktop/src/views/mcp/McpServerDetailView.vue` | ~6KB | Frontend |
| 17 | `apps/desktop/src/components/mcp/McpServerCard.vue` | ~3KB | Frontend |
| 18 | `apps/desktop/src/components/mcp/McpAddServerModal.vue` | ~4KB | Frontend |
| 19 | `apps/desktop/src/components/mcp/McpToolList.vue` | ~2.5KB | Frontend |
| 20 | `apps/desktop/src/components/mcp/McpConfigEditor.vue` | ~3KB | Frontend |
| 21 | `apps/desktop/src/components/mcp/McpHealthStats.vue` | ~1.5KB | Frontend |
| 22 | `apps/desktop/src/components/mcp/McpDiffPreview.vue` | ~1.5KB | Frontend |
| 23 | `apps/desktop/src/components/mcp/McpTokenSummary.vue` | ~1.5KB | Frontend |
| 24 | `apps/desktop/src/components/mcp/McpStatusDot.vue` | ~1KB | Frontend (StatusIcon incompatible) |
| 25 | `packages/ui/src/components/TagList.vue` | ~1.5KB | Shared UI |
| 26 | `packages/ui/src/components/EnvVarTable.vue` | ~2.5KB | Shared UI |
| 27 | `packages/ui/src/components/SegmentedControl.vue` | ~2KB | Shared UI |

### Modified Files (MODIFY)

| # | File | Change |
|---|------|--------|
| 1 | `crates/tracepilot-orchestrator/src/lib.rs` | Add `pub mod mcp;` + `pub mod tokens;` + `pub mod github;` + `pub mod json_io;` |
| 2 | `crates/tracepilot-orchestrator/src/error.rs` | Add `Mcp(#[from] mcp::McpError)` variant |
| 3 | `crates/tracepilot-orchestrator/Cargo.toml` | Add `reqwest`, tokio features (`process`, `time`, `io-util`) |
| 4 | `crates/tracepilot-tauri-bindings/src/commands/mod.rs` | Add `pub mod mcp;` |
| 5 | `crates/tracepilot-tauri-bindings/src/lib.rs` | Register 11 commands |
| 6 | `crates/tracepilot-tauri-bindings/src/config.rs` | Add `mcp_servers` to FeaturesConfig |
| 7 | `packages/types/src/config.ts` | Add `mcpServers` to FeaturesConfig TS type |
| 8 | `packages/types/src/defaults.ts` | Add `mcpServers: true` to feature flag defaults |
| 9 | `packages/types/src/index.ts` | Export MCP types |
| 10 | `packages/client/src/index.ts` | Export MCP client functions |
| 11 | `apps/desktop/src/router/index.ts` | Add MCP routes (with `sidebarId: 'mcp'` in meta) |
| 12 | `apps/desktop/src/components/layout/AppSidebar.vue` | Add "Extensions" nav group with MCP item |
| 13 | `apps/desktop/src/stores/preferences.ts` | Add feature flag default |
| 14 | `packages/ui/src/index.ts` | Export new shared components |

### Total: 27 new files + 14 modified files

---

## 10. Implementation Phases

### Phase 1: Shared Infrastructure
- `tokens.rs`, `json_io.rs`, `github.rs` in orchestrator
- `TagList`, `EnvVarTable`, `SegmentedControl` in packages/ui
- `packages/types/src/mcp.ts` TypeScript types
- `packages/client/src/mcp.ts` typed IPC wrappers
- New "Extensions" sidebar nav group in AppSidebar
- Unit tests for shared modules

### Phase 2: Backend Core
- Create `mcp/` module directory in orchestrator (types, config, error)
- Wire up IPC commands in tauri-bindings
- Static mutex for config writes (following repo_registry.rs pattern)
- Unit tests for config load/save/merge

### Phase 3: Frontend Core (Read-Only)
- Pinia store (using @tracepilot/client wrappers)
- Router routes with `sidebarId: 'mcp'`
- McpManagerView with server list (cards from store)
- McpServerCard + McpStatusDot components
- Feature flag gating (3 files: Rust + TS type + TS default)

### Phase 4: Server Management (CRUD)
- McpAddServerModal (add flow)
- McpServerDetailView + McpConfigEditor (edit flow)
- Remove flow with ConfirmDialog
- Toggle with metadata persistence

### Phase 5: Health & Tokens
- Health check via `tokio::process::Command` with piped stdin/stdout (NOT run_hidden)
- 5-second timeout with process kill
- Token estimation (per-tool, per-server, total)
- McpHealthStats, McpTokenSummary, McpToolList

### Phase 6: Advanced Features
- VS Code config import translation
- Diff preview for pending changes
- Export config as JSON
- Tool enable/disable via filter persistence
- File watcher / mtime check for external config changes

---

## 11. Risk Considerations

| Risk | Mitigation |
|------|------------|
| Health check hangs on malformed server | `tokio::time::timeout(5s)` + `child.kill()`. NOT `run_hidden` (one-shot, no stdin pipe) |
| Env vars contain secrets | Never log env values; mask in UI by default; never write to TracePilot logs |
| Concurrent config writes (TracePilot + CLI) | Static mutex (intra-process) + atomic tmp+rename (cross-process). File watcher for external edits |
| Large tool counts (50+ tools) | Virtual scroll or pagination; token budget warning at >5% of context |
| Windows path separator issues | Use `PathBuf` throughout; `#[cfg(windows)]` for rename dance (not `target_os = "windows"`) |
| `.mcp.json` vs `.copilot/mcp-config.json` collision | Check both; prefer `.copilot/mcp-config.json`; warn user if both exist |
| gh CLI not installed | Graceful fallback; show install instructions; feature still works for local configs |
| `copilot_home()` fails on fresh machine | Catch error; show "Copilot CLI not installed" empty state with setup link |
| `StatusIcon` incompatible with MCP statuses | Custom `McpStatusDot` component with `connected\|error\|timeout\|unknown` variants |
