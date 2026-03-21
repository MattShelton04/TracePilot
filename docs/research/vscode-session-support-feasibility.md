# VSCode Copilot Session Support — Feasibility & Integration Plan

> **Status:** Research Complete — Multi-Model Review Consolidated ✅  
> **Branch:** `Matt/VSCode_Support_Evaluation`  
> **Date:** 2026-03-21  

---

## 1. Executive Summary

TracePilot currently indexes **Copilot CLI agent sessions** stored under `~/.copilot/session-state/`. This report investigates adding support for **VSCode Copilot Chat sessions** — a completely different data format stored in VSCode's `workspaceStorage/` directory.

**Key finding:** VSCode sessions are feasible to integrate, but require a dedicated parser due to fundamental format differences. The good news is TracePilot's turn reconstruction pipeline is already source-agnostic (it operates on `TypedEvent` structs) — so the main work is building a **VSCode → TypedEvent translator** behind a `SessionProvider` trait abstraction, plus a new discovery/indexing path.

**Scope:** 71 VSCode chat sessions found on the user's machine across 18 workspaces (13.4 MB total), compared to 100+ CLI sessions. ~30-40% of VSCode sessions are empty stubs. VSCode data is sparser (no token usage, no shutdown metrics) but richer in some areas (chain-of-thought/thinking, per-request model ID, inline file references).

**⚠️ Key caveat:** This feature depends on undocumented, private file formats. It should ship as **Experimental/Beta** behind a feature flag.

---

## 2. Data Location & Storage Architecture

### 2.1 Copilot CLI Sessions (Current — Fully Supported)

```
~/.copilot/session-state/{UUID}/
├── workspace.yaml          ← Session metadata (id, cwd, repo, branch, summary)
├── events.jsonl            ← Append-only event stream (95% of data)
├── session.db              ← SQLite (todos, task graph)
├── plan.md                 ← Agent planning document
├── checkpoints/            ← Context compaction checkpoints
├── rewind-snapshots/       ← Git-state snapshots per user message
├── files/                  ← Agent-generated artifacts
├── vscode.metadata.json    ← IDE context marker (present in 65% of sessions)
└── inuse.{PID}.lock        ← Active session lock
```

- **Location:** `~/.copilot/session-state/` (hardcoded in `discovery.rs:10-11`)
- **Session naming:** UUID directories (validated via `uuid::Uuid::parse_str`)
- **Event format:** JSONL with envelope `{type, data, id, timestamp, parentId}`
- **35 typed event types** handled by the parser

### 2.2 VSCode Copilot Chat Sessions (New — Target for Integration)

```
%APPDATA%\Code\User\
├── globalStorage\
│   ├── state.vscdb                              ← Global SQLite (settings, model prefs)
│   └── github.copilot-chat\
│       └── copilotCli\copilotcli.session.metadata.json  ← CLI session registry
│
└── workspaceStorage\{md5-hash}\
    ├── workspace.json                           ← {"folder": "file:///c%3A/git/Project"}
    ├── state.vscdb                              ← Per-workspace SQLite
    │   └── ItemTable:
    │       ├── chat.ChatSessionStore.index       ← Session index (id, title, dates)
    │       ├── agentSessions.model.cache         ← CLI session metadata cache
    │       ├── chat.customModes                  ← Agent mode definitions
    │       └── memento/interactive-session        ← Prompt history
    │
    ├── chatSessions\                            ← ✅ THE CHAT HISTORY
    │   ├── {sessionId}.json                      ← Legacy: static JSON snapshot
    │   └── {sessionId}.jsonl                     ← Modern: event-sourced operation log
    │
    ├── chatEditingSessions\{sessionId}\          ← Edit timeline + checkpoints
    │   ├── state.json
    │   └── contents\                             ← File snapshots
    │
    └── GitHub.copilot-chat\chat-session-resources\{sessionId}\
        └── call_{toolCallId}__vscode-{ts}\
            └── content.txt                       ← Raw tool call output
```

**Platform paths:**

| Platform | Base Path |
|----------|-----------|
| Windows  | `%APPDATA%\Code\User\` |
| macOS    | `~/Library/Application Support/Code/User/` |
| Linux    | `~/.config/Code/User/` |

**Variants:** `Code - Insiders`, `VSCodium`, `Cursor` use identical structure.

### 2.3 Visual Studio (Full IDE) — Addendum

Visual Studio 2022 Copilot Chat stores **only ephemeral log files** in:
```
%LOCALAPPDATA%\Temp\VSGitHubCopilotLogs\
```
These are raw `.log` / `.etl` trace files with no structured session data. The format is completely undocumented, the files are temporary, and no community tools exist to parse them. **Visual Studio Copilot sessions are not viable for integration at this time.**

---

## 3. VSCode Session Data Format — Deep Analysis

### 3.1 Two File Formats

VSCode stores sessions in **two formats** (both observed on disk):

| Format | Count | Description | Example Size |
|--------|-------|-------------|-------------|
| **Static JSON** (`.json`) | 23 files | Full session snapshot, single JSON object | 267 B – 10 MB |
| **JSONL Operation Log** (`.jsonl`) | 48 files | Event-sourced write-ahead log, must be replayed | 1.2 KB – 2.3 MB |

The JSONL format is newer (all recent sessions) and requires **replay logic** to reconstruct the session state.

### 3.2 Static JSON Format

```json
{
  "version": 3,
  "sessionId": "896759f5-46c5-4cf2-b0a0-0ef8b7d85bd3",
  "creationDate": 1757580781889,            // epoch ms
  "lastMessageDate": 1757580966963,
  "customTitle": "Fixing async/await in Client Components",
  "requesterUsername": "MattShelton04",
  "responderUsername": "GitHub Copilot",
  "initialLocation": "panel",               // "panel" | "editor" | "terminal"
  "isImported": false,
  "requests": [
    {
      "requestId": "request_7e11f23b-...",
      "timestamp": 1757580789936,
      "modelId": "copilot/gpt-4.1",
      "isCanceled": false,
      "agent": {
        "id": "github.copilot.editsAgent",
        "extensionId": {...},
        "name": "agent"
      },
      "message": {
        "text": "hey i get the following error...",
        "parts": [{"range": {...}, "text": "...", "kind": "text"}]
      },
      "variableData": {"variables": [...]},
      "response": [
        {"kind": "text", "value": "The error occurs because..."},
        {"kind": "toolInvocationSerialized", "toolId": "copilot_readFile", "toolCallId": "...", "isComplete": true, "invocationMessage": {...}},
        {"kind": "thinking", "value": "**Exploring options**\n\nI need to..."},
        {"kind": "textEditGroup", "uri": "file:///path/to/file.py"},
        {"kind": "inlineReference", "inlineReference": {"fsPath": "...", "scheme": "file"}},
        {"kind": "undoStop", "id": "..."},
        {"kind": "codeblockUri", ...}
      ],
      "result": {
        "timings": {"firstProgress": 2690, "totalElapsed": 4572},
        "metadata": {"codeBlocks": [], "renderedUserMessage": [...]},
        "details": {...}
      },
      "contentReferences": [],
      "codeCitations": [],
      "followups": []
    }
  ]
}
```

### 3.3 JSONL Operation Log Format

Each line is a JSON object with a `kind` field:

| Kind | Operation | Description |
|------|-----------|-------------|
| `0`  | **Initial snapshot** | `{"kind":0, "v": {full session state}}` — always first line |
| `1`  | **Set** | `{"kind":1, "k":["path","to","field"], "v": newValue}` |
| `2`  | **Splice** | `{"kind":2, "k":["requests"], "i":0, "d":0, "v":[items]}` |
| `3`  | **Delete** | `{"kind":3, "k":["path","to","field"]}` |

**The JSONL must be replayed sequentially** to reconstruct the final session state. After replay, the structure is identical to the static JSON format above.

Example from a real 52-line session:
```
Line 0:  kind=0  → Initial empty session state
Line 1:  kind=1  → Set customTitle = "Locating VS Code Copilot Agent Session Files"
Line 2:  kind=2  → Splice request[0] into requests array (with message + full response)
Line 3:  kind=1  → Set requests[0].modelState = {value: 0}
Line 4:  kind=2  → Splice response items into requests[0].response array
...
```

### 3.4 Response Item Types (Observed in Real Data)

| Response `kind` | Count | Description | CLI Equivalent |
|-----------------|-------|-------------|----------------|
| `toolInvocationSerialized` | 163 | Tool call with ID, toolId, result | `tool.execution_start` + `tool.execution_complete` |
| `text` / `markdownContent` | 162 | Assistant text response | `assistant.message.content` |
| `thinking` | 117 | Chain-of-thought reasoning | `assistant.reasoning` (partial — CLI stores as `reasoningText` field) |
| `inlineReference` | 70 | File/URI references in response | No direct equivalent |
| `textEditGroup` | 20 | Code edits applied to files | Closest: file changes in `session.shutdown` |
| `prepareToolInvocation` | 14 | Tool invocation preparation | No equivalent |
| `codeblockUri` | 13 | Code block with file association | No equivalent |
| `undoStop` | 12 | Undo boundary markers | No equivalent |
| `progressMessage` | 9 | Progress status text | `system.notification` |
| `mcpServersStarting` | 4 | MCP server initialization | No equivalent |
| `progressTaskSerialized` | 3 | Task progress tracking | No equivalent |

### 3.5 Tool IDs Observed

| VSCode Tool ID | Count | CLI Tool Equivalent |
|----------------|-------|---------------------|
| `copilot_readFile` | 45 | `view` |
| `copilot_listDirectory` | 40 | `view` (directory mode) |
| `run_in_terminal` | 34 | `powershell` / `bash` |
| `copilot_findTextInFiles` | 17 | `grep` |
| `copilot_applyPatch` | 12 | `edit` |
| `manage_todo_list` | 6 | `sql` (todos table) |
| `copilot_findFiles` | 4 | `glob` |
| `runSubagent` | 2 | `task` |
| `copilot_getChangedFiles` | 2 | No equivalent |
| `copilot_memory` | 1 | `store_memory` |

### 3.6 Models Observed

| Model ID | Request Count |
|----------|---------------|
| `copilot/gpt-4.1` | 27 |
| `copilot/gpt-5.4` | 4 |
| `copilot/gpt-5-mini` | 1 |

### 3.7 Agent Types Observed

| Agent ID | Count | Description |
|----------|-------|-------------|
| `github.copilot.editsAgent` | 16 | Agent mode (can edit files) |
| `github.copilot.editor` | 9 | Editor inline mode |
| `github.copilot.default` | 7 | Default Q&A chat |
| `github.copilot.workspace` | 1 | Workspace-scoped agent |

---

## 4. Feature Comparison: CLI vs VSCode Sessions

### 4.1 Data Available for Extraction

| Feature | CLI Session | VSCode Session | Integration Strategy |
|---------|-------------|----------------|---------------------|
| **Session ID** | ✅ UUID from directory name | ✅ UUID from filename | Direct map |
| **Session Title/Summary** | ✅ `workspace.yaml → summary` | ✅ `customTitle` field | Direct map |
| **Creation Date** | ✅ `workspace.yaml → created_at` | ✅ `creationDate` (epoch ms) | Convert epoch → ISO |
| **Last Updated** | ✅ `workspace.yaml → updated_at` | ✅ `lastMessageDate` (epoch ms) | Convert epoch → ISO |
| **Repository** | ✅ `workspace.yaml → repository` | ⚠️ Derive from `workspace.json → folder` URI | Parse URI, run `git remote` or use path |
| **Branch** | ✅ `workspace.yaml → branch` | ❌ Not stored | Show as "N/A (VSCode)" |
| **Working Directory** | ✅ `workspace.yaml → cwd` | ✅ `workspace.json → folder` | Parse file URI |
| **Git Root** | ✅ `workspace.yaml → git_root` | ❌ Not stored | Derive from cwd if needed |
| **Host Type** | ✅ `"cli"` or `"vscode"` | Hardcode `"vscode"` | Set automatically |
| **User Messages** | ✅ `user.message` events | ✅ `request.message.text` | Map to `TypedEventData::UserMessage` |
| **Assistant Messages** | ✅ `assistant.message` events | ✅ `response[kind=text]` items | Map to `TypedEventData::AssistantMessage` |
| **Tool Calls (start)** | ✅ `tool.execution_start` | ✅ `response[kind=toolInvocationSerialized]` | Map, translate tool IDs |
| **Tool Call Results** | ✅ `tool.execution_complete` | ⚠️ Separate files in `chat-session-resources/` | Requires joining across directories |
| **Tool Call Duration** | ✅ Computed from start→complete timestamps | ❌ Not available | Show as N/A |
| **Model Used** | ✅ `session.start → selectedModel` | ✅ `request.modelId` | Direct map, per-request granularity |
| **Turn Count** | ✅ Computed from events | ✅ `requests.length` | Direct map |
| **Event Count** | ✅ Lines in events.jsonl | ✅ Response items count | Approximate via response items |
| **Thinking/Reasoning** | ⚠️ `reasoningText` in assistant.message (often opaque) | ✅ `response[kind=thinking]` full visible text | VSCode is richer here |
| **Token Usage** | ⚠️ Only in `session.shutdown → modelMetrics` (aggregated) | ❌ **Not stored on disk at all** | Show as N/A for VSCode |
| **Total Cost** | ✅ Computed from modelMetrics + pricing | ❌ Cannot compute (no token data) | Show as N/A for VSCode |
| **Premium Requests** | ✅ `session.shutdown → totalPremiumRequests` | ❌ Not available | Show as N/A |
| **API Duration** | ✅ `session.shutdown → totalApiDurationMs` | ❌ Not available | Show as N/A |
| **Code Changes** | ✅ `session.shutdown → codeChanges` (lines +/-) | ⚠️ `chatEditingSessions` timeline (file-level only) | Parse edit sessions for file list |
| **Files Modified** | ✅ From shutdown metrics | ⚠️ From `textEditGroup` response items + edit sessions | Collect URIs from responses |
| **Session Duration** | ✅ Computed from first→last event | ✅ Computed from `creationDate` → `lastMessageDate` | Direct computation |
| **Health Score** | ✅ Computed from errors/warnings | ❌ No error tracking data | Show as N/A or always "healthy" |
| **Error/Warning Count** | ✅ From `session.error`/`session.warning` events | ❌ Not tracked | Show as 0 / N/A |
| **Rate Limit Count** | ✅ From events | ❌ Not tracked | Show as N/A |
| **Compaction Count** | ✅ From `session.compaction_*` events | ❌ Not applicable | N/A |
| **Is Running** | ✅ `inuse.*.lock` file detection | ❌ No lock file mechanism | Show as "unknown" |
| **Checkpoints** | ✅ `checkpoints/` directory | ✅ `chatEditingSessions` checkpoints | Different format, map to similar concept |
| **Session DB (Todos)** | ✅ `session.db` SQLite | ❌ Not stored per-session | Show as N/A |
| **Plan.md** | ✅ In session directory | ❌ Not stored | Show as N/A |
| **FTS Content** | ✅ User + assistant message text | ✅ User message text + response text | Both searchable |
| **Inline References** | ❌ Not captured | ✅ File/URI references in responses | New VSCode-only feature |
| **File Attachments** | ❌ Not in events | ✅ `request.message.parts` with file ranges | New VSCode-only feature |
| **Response Timing** | ⚠️ Via event timestamps | ✅ `result.timings` (firstProgress, totalElapsed) | VSCode has richer per-request timing |
| **Subagent Tracking** | ✅ `subagent.started/completed/failed` events | ⚠️ `runSubagent` tool invocations only | Less granular |

### 4.2 Summary Scorecard

| Category | CLI | VSCode | Notes |
|----------|-----|--------|-------|
| **Conversation data** | ✅ Full | ✅ Full | Both have complete message history |
| **Tool call tracking** | ✅ Full | ✅ Good | VSCode lacks duration, result is in separate files |
| **Cost/Token analytics** | ✅ Good | ❌ None | VSCode stores zero token/cost data on disk |
| **Session lifecycle** | ✅ Full | ⚠️ Partial | No start/shutdown/error/compaction events |
| **Code change tracking** | ✅ Good | ⚠️ Basic | File-level from edit sessions, no line counts |
| **Reasoning/Thinking** | ⚠️ Often opaque | ✅ Full visible text | VSCode stores rich chain-of-thought |
| **Per-request model ID** | ❌ Session-level only | ✅ Per-request | VSCode is richer |
| **Git context** | ✅ Full | ❌ Minimal | No branch, commit, or remote info |
| **Timing granularity** | ⚠️ Event-level | ✅ Per-request `firstProgress`/`totalElapsed` | VSCode provides response timing |

---

## 5. TracePilot Architecture — Integration Points

### 5.1 Current Architecture Layers

```
┌─────────────────────────────────────────────┐
│  Frontend (Vue 3 + Pinia + Tauri)           │
│  ├── stores/sessions.ts                     │
│  ├── stores/preferences.ts                  │
│  └── views/SessionListView.vue              │
└─────────────────┬───────────────────────────┘
                  │ Tauri IPC
┌─────────────────▼───────────────────────────┐
│  tracepilot-tauri-bindings                  │
│  ├── config.rs (TracePilotConfig)           │
│  └── lib.rs (25 #[tauri::command] handlers) │
└────────┬────────────────┬───────────────────┘
         │                │
┌────────▼──────┐  ┌──────▼────────────────────┐
│ tracepilot-   │  │ tracepilot-indexer         │
│ core          │  │ ├── reindex_all()          │
│ ├── session/  │  │ ├── reindex_incremental()  │
│ │  discovery  │  │ └── index_db/              │
│ ├── parsing/  │  │    ├── session_writer.rs   │
│ │  events.rs  │  │    ├── session_reader.rs   │
│ │  workspace  │  │    └── migrations.rs       │
│ ├── turns/    │  └───────────────────────────┘
│ │  mod.rs     │
│ ├── summary/  │
│ └── models/   │
└───────────────┘
```

### 5.2 Abstraction Gap Analysis

| Layer | Current State | Gap for VSCode |
|-------|---------------|----------------|
| **Discovery** | Free function, UUID filter, no source tag | Need `discover_vscode_sessions()` + `SessionSource` discriminator (not `host_type`) |
| **Parsing** | Module-per-file, no trait | Need new `vscode_chat.rs` module + shape-based response detection |
| **Turn Reconstruction** | Takes `&[TypedEvent]` — **already source-agnostic** ✅ | **No changes needed** |
| **Summary** | Reads `workspace.yaml` + `events.jsonl` hardcoded | Need VSCode-specific summary builder, use `state.vscdb` as metadata overlay |
| **Indexer** | Calls `discover_sessions()` + CLI parsers | Need `SessionProvider` trait, composite fingerprinting |
| **Config** | Single `session_state_dir` path | Add `vscode_workspace_storage_dir` + enable toggle + multi-variant detection |
| **Session Identity** | `host_type: Option<String>` free string | **New `session_source` column** — `host_type` is NOT a source discriminator (CLI sessions from VSCode terminal already have `host_type: "vscode"`) |
| **Frontend** | Displays `hostType` badge, no filtering | Add filter by `session_source` + graceful N/A for missing fields + Experimental badge |

### 5.3 Key Architectural Decision: Where to Abstract

The critical question is: **at what level do we normalize VSCode data into the CLI pipeline?**

**Recommended approach: `SessionProvider` trait + normalize at the `TypedEvent` level.**

```rust
trait SessionProvider {
    fn discover(&self, base_dir: &Path) -> Result<Vec<DiscoveredSession>>;
    fn load_summary(&self, session: &DiscoveredSession) -> Result<SessionSummary>;
    fn load_typed_events(&self, session: &DiscoveredSession) -> Result<Vec<TypedEvent>>;
    fn fingerprint(&self, session: &DiscoveredSession) -> Result<SessionFingerprint>;
}
```

```
CLI Provider:     events.jsonl → parse_typed_events() → Vec<TypedEvent>
                                                              ↓
VSCode Provider:  chatSessions/*.jsonl → replay → JSON →  vscode_to_typed_events() → Vec<TypedEvent>
                                                              ↓
                                                   ┌──────────▼──────────┐
                                                   │  Shared Pipeline     │
                                                   │  ├── reconstruct_   │
                                                   │  │   turns()        │
                                                   │  ├── extract_       │
                                                   │  │   analytics()    │
                                                   │  └── FTS indexing   │
                                                   └─────────────────────┘
```

**Why this approach:**
1. `reconstruct_turns()` is already generic over `&[TypedEvent]` — zero changes needed
2. The trait encapsulates per-source differences (discovery, fingerprinting, summary) cleanly
3. Avoids spreading `if cli { ... } else { ... }` throughout the indexer
4. FTS indexing extracts text from turns — works regardless of source
5. Frontend `ConversationTurn` display is completely source-agnostic
6. Future sources (JetBrains, Windsurf, etc.) plug in via new trait implementations

**⚠️ Important caveat — `RawEvent` synthesis:**
`TypedEvent` contains `pub raw: RawEvent` with `raw_json: String`. For VSCode data, serialize the original VSCode JSON into `raw_json` so the raw data is still inspectable. Do NOT fabricate fake CLI-shaped raw events.

**⚠️ Important caveat — No synthetic `SessionShutdown`:**
Do NOT synthesize a fake `SessionShutdown` event for VSCode sessions. Current health/analytics logic interprets shutdown events semantically. Instead, let VSCode sessions simply have no shutdown event and handle the absence gracefully in analytics code.

---

## 6. Implementation Plan

### Phase 0: Configuration & Feature Flag

**Files to modify:**
- `crates/tracepilot-tauri-bindings/src/config.rs`
- `apps/desktop/src/stores/preferences.ts`
- `apps/desktop/src/views/SettingsExperimental.vue`

**Changes:**
1. Add to `PathsConfig`:
   ```rust
   pub vscode_workspace_storage_dir: Option<String>,
   ```
2. Add to `FeaturesConfig`:
   ```rust
   pub vscode_session_indexing: bool,  // default: false
   ```
3. Add defaults for all 3 platforms (Windows/macOS/Linux) + auto-detect variants (Code, Code - Insiders, VSCodium, Cursor)
4. Add toggle in Settings → Experimental: "Enable VSCode Session Indexing (Beta)"
5. Add path override in Settings → Paths for custom VSCode data location
6. New config fields must be `Option` / `#[serde(default)]` to avoid breaking existing configs

### Phase 0.5: Data Validation Spike *(NEW — from review feedback)*

**Purpose:** Validate all assumptions against real data before building the full parser.

**Tasks:**
1. Replay all 48 JSONL files programmatically — count successes, failures, edge cases
2. Parse all 23 JSON files — verify schema consistency, identify missing `kind` fields
3. Catalog all unique response `kind` values across the full dataset
4. Verify `kind=2` splice semantics match the spec on all real data
5. Measure replay performance (expected: ~20-150ms per session, ~10-30MB peak RSS)
6. Catalog all `toolId` values and verify the mapping table is complete
7. Identify empty/stub sessions (0 requests) — expected ~30-40%
8. Check for trailing/incomplete JSONL lines

**Exit criteria:** All edge cases documented, parser requirements finalized.

### Phase 1: VSCode Session Discovery

**New file:** `crates/tracepilot-core/src/session/vscode_discovery.rs`

**Logic:**
1. Scan `workspaceStorage/` for directories containing `chatSessions/` subdirectories
2. For each workspace hash directory:
   - Read `workspace.json` → extract folder URI → derive project path (handle `file://`, `vscode-remote://`, `.code-workspace`)
   - Read `state.vscdb` (READONLY + retry/backoff for SQLITE_BUSY) → `chat.ChatSessionStore.index` for metadata overlay (titles, dates, isEmpty, lastResponseState)
   - Filter out empty/stub sessions (`isEmpty == true` or `requests.length == 0`)
   - Enumerate `chatSessions/*.json` and `chatSessions/*.jsonl` files
3. Return `Vec<DiscoveredVscodeSession>` with session ID, workspace path, file path, format type

**Add `SessionSource` enum (NOT `host_type`):**
```rust
pub enum SessionSource { Cli, VscodeChat }

pub struct DiscoveredSession {
    pub id: String,
    pub path: PathBuf,
    pub source: SessionSource,
    // ... existing fields ...
}
```

**DB migration:** Add `session_source TEXT` column to sessions table. Prefix VSCode session IDs with `vscode:` to prevent UUID collisions with CLI sessions.

**Tests:** Discovery tests with real workspace layouts, empty session filtering, remote workspace URIs.

### Phase 2: VSCode Session Parser

**New files:**
- `crates/tracepilot-core/src/parsing/vscode_chat.rs` — Main parser
- `crates/tracepilot-core/src/parsing/vscode_jsonl_replay.rs` — JSONL replay engine

**Dedicated error type:**
```rust
enum VscodeParseError {
    JsonlReplayFailed { line: usize, source: serde_json::Error },
    UnknownOperationKind(u8),
    InvalidSplicePath { path: Vec<String> },
    IncompleteFinalLine,          // tolerated — silently ignored
    UnsupportedVersion(u32),
    StateDatabaseError(rusqlite::Error),
}
```

**Parser responsibilities:**
1. **JSONL Replay Engine:**
   - Process `kind=0` (initial snapshot) → base state
   - Process `kind=1` (set) → update nested field
   - Process `kind=2` (splice) → insert/delete in arrays
   - Process `kind=3` (delete) → remove field
   - **Trailing/incomplete final line** → catch parse error, silently ignore, log debug warning
   - Return final `VscodeSession` struct

2. **JSON Parser:** Deserialize static JSON directly into `VscodeSession`

3. **Response item detection (shape-based — NOT just `kind` matching):**
   - Items with `kind` field → match by kind value
   - Items without `kind` but with `value` + `supportThemeIcons` + `baseUri` → treat as text
   - Unknown shapes → log warning, skip gracefully

4. **TypedEvent Converter (`vscode_to_typed_events`):**

   | VSCode Concept | → TypedEvent Mapping |
   |----------------|---------------------|
   | Session creation | `SessionStart` (synthetic, from metadata) |
   | `request` entry | `UserMessage` + `TurnStart` |
   | `response[kind=text]` | Accumulate into `AssistantMessage.content` |
   | `response[kind=thinking]` | `AssistantReasoning` |
   | `response[kind=toolInvocationSerialized]` | `ToolExecutionStart` + `ToolExecutionComplete` |
   | `response[kind=inlineReference]` | Dropped in v1 (data preserved in `raw_json`) |
   | `response[kind=textEditGroup]` | Dropped in v1 (data preserved in `raw_json`) |
   | End of request | `TurnEnd` |
   | ~~Last request processed~~ | ~~`SessionShutdown`~~ **No synthetic shutdown** — omit entirely |

   **`RawEvent` handling:** Serialize the original VSCode response item JSON into `raw.raw_json`. Do NOT fabricate CLI-shaped raw events.

5. **Tool ID Mapping:**

   | VSCode Tool ID | → CLI Tool Name |
   |----------------|-----------------|
   | `copilot_readFile` | `view` |
   | `copilot_listDirectory` | `view` |
   | `copilot_findTextInFiles` | `grep` |
   | `copilot_findFiles` | `glob` |
   | `copilot_applyPatch` | `edit` |
   | `run_in_terminal` | `powershell` / `bash` |
   | `manage_todo_list` | `sql` |
   | `runSubagent` | `task` |
   | `copilot_getChangedFiles` | (no mapping — keep as-is) |
   | `copilot_memory` | `store_memory` |

**Tests:** Replay engine unit tests (all 4 kinds), shape-based response detection, converter snapshot tests, trailing line handling.

### Phase 3: VSCode Session Summary Builder

**New file:** `crates/tracepilot-core/src/summary/vscode_summary.rs`

Build `SessionSummary` from VSCode data with these mappings:
- `id` ← `vscode:{sessionId}` (prefixed to avoid UUID collision with CLI sessions)
- `summary` ← `customTitle` (fallback to `state.vscdb` index if missing from chat file)
- `repository` ← derived from `workspace.json` folder URI (path-based, not `git remote`)
- `branch` ← `None` (not available — derive from workspace path at index time if possible, but mark as "derived, not historical truth")
- `host_type` ← preserved from original data (may be null)
- `session_source` ← `"vscode_chat"`
- `created_at` ← `creationDate` converted from epoch ms (fallback to `state.vscdb`)
- `updated_at` ← `lastMessageDate` converted from epoch ms (fallback to `state.vscdb`)
- `event_count` ← total response items across all requests
- `turn_count` ← `requests.length`
- `current_model` ← last request's `modelId`
- `has_events` ← `true`
- `shutdown_metrics` ← **None** (no synthetic shutdown)
- `health_signal` ← derived from `result.errorDetails` + `responseIsIncomplete` + canceled request count (basic health, not full CLI parity)
- `has_plan` / `has_checkpoints` / `has_session_db` ← `false`

**Tests:** Summary builder with edge cases — missing fields, empty sessions, missing `state.vscdb`.

### Phase 4: Indexer Integration

**Modify:** `crates/tracepilot-indexer/src/lib.rs`

**Introduce `SessionProvider` trait:**
```rust
trait SessionProvider {
    fn discover(&self, base_dir: &Path) -> Result<Vec<DiscoveredSession>>;
    fn load_summary(&self, session: &DiscoveredSession) -> Result<SessionSummary>;
    fn load_typed_events(&self, session: &DiscoveredSession) -> Result<Vec<TypedEvent>>;
    fn fingerprint(&self, session: &DiscoveredSession) -> Result<SessionFingerprint>;
}
```

Implement `CliSessionProvider` (wrapping existing code) and `VscodeSessionProvider` (new).

**Composite fingerprinting for VSCode sessions:**
- Chat session file mtime + size
- `workspace.json` mtime
- `state.vscdb` entry version (lightweight query)
- Store per-session normalized hash in DB for efficient incremental comparison

**DB migration:** Add `session_source TEXT` column to sessions table. VSCode sessions will have `NULL` values for:
- `total_tokens`, `total_cost`, `total_premium_requests`, `total_api_duration_ms`
- `error_count`, `rate_limit_count`, `compaction_count`, `truncation_count`
- `health_score` (or compute simplified score from `result.errorDetails`)

**FTS extension:** Include `AssistantReasoning` text in FTS content extraction (benefits both CLI and VSCode sessions).

**Tests:** Indexer integration tests — VSCode sessions appear in queries, fingerprint change detection works, FTS indexes reasoning text.

### Phase 5: Frontend Adaptation

**Modify:**
- `apps/desktop/src/stores/sessions.ts` — Add `filterSessionSource` filter (by `session_source`, NOT `host_type`)
- `apps/desktop/src/views/SessionListView.vue` — Add source filter pills (All | CLI | VSCode Chat)
- `apps/desktop/src/views/SessionDetailView.vue` — Graceful N/A for missing fields
- `apps/desktop/src/components/session/OverviewTab.vue` — Conditional display

**Key UI changes:**
1. **Session List:** Add filter tabs: `All | CLI | VSCode Chat`
2. **Session Cards:** Clear visual differentiation — "Beta" badge for VSCode sessions
3. **Detail View:** Show "N/A" or hide sections when data unavailable:
   - Token usage panel → "Token data not available for VSCode sessions"
   - Cost analysis → Hidden or greyed out
   - Health score → Simplified (based on `errorDetails`) or "Not applicable"
   - Error/compaction/truncation counts → Hidden
4. **Info banner:** On VSCode session detail: "Some analytics are not available for VSCode Chat sessions. [Learn more]"
5. **New VSCode-specific sections (v2):**
   - Thinking/reasoning panel (richer than CLI)
   - Per-request timing visualization (firstProgress, totalElapsed)
   - Inline file references

**Tests:** Frontend component tests — N/A handling, filter functionality, mixed session list rendering.

### Phase 6: Testing *(Interleaved — each phase includes its own tests)*

While testing is interleaved with each phase above, this phase covers **cross-cutting integration tests:**

1. **End-to-end:** CLI + VSCode sessions coexist in same index, search works across both
2. **Regression:** Existing CLI session tests still pass with new `SessionProvider` trait
3. **Data integrity:** All 71 real VSCode sessions parse without error
4. **Performance:** Reindex time with VSCode sessions enabled vs disabled
5. **Edge cases:** Empty sessions, remote workspaces, concurrent VSCode writes, missing `state.vscdb`

---

## 7. Key Technical Challenges

### 7.1 JSONL Replay Complexity
The JSONL format requires implementing a stateful replay engine that handles nested path navigation (e.g., `["requests", 0, "response"]`), array splicing with insertions and deletions, and deep property setting. The `wesm/agentsview` (Go) and `thisalihassan/promptrail` (TypeScript) projects have working implementations that can serve as reference.

### 7.2 Tool Call Result Joining
VSCode stores tool call outputs in separate files (`chat-session-resources/{sessionId}/call_{toolCallId}__vscode-{ts}/content.txt`). To populate `ToolExecutionComplete.result`, we need to:
1. Walk the `chat-session-resources/` directory
2. Match `toolCallId` from directory names to response items
3. Read `content.txt` for each match

This is optional for initial implementation — tool invocations can be shown without their full output.

### 7.3 Missing Data Graceful Degradation
The frontend currently assumes all sessions have shutdown metrics, token counts, and health scores. Every display component needs auditing for `null`/`undefined` handling when these are absent for VSCode sessions.

### 7.4 Workspace Resolution
VSCode uses MD5 hashes for workspace directory names. To map sessions to repositories:
1. Read `workspace.json` → get folder URI
2. Parse `file:///c%3A/git/Project` → `C:\git\Project`
3. Optionally run `git remote -v` to get repository name
4. Or just use the folder path as the "repository" identifier

### 7.5 Session Mutability
VSCode sessions are **mutable** — the JSONL operation log can be appended while a session is active in VSCode. TracePilot's incremental reindex (mtime + size check) will handle this correctly, but the JSONL replay must be re-run from scratch each time (no partial replay optimization initially).

### 7.6 Concurrent SQLite Access (state.vscdb)
VSCode's `state.vscdb` may be actively written to while TracePilot reads it. Mitigations:
- Open with `SQLITE_OPEN_READONLY` flag
- Handle `SQLITE_BUSY` with retry/backoff
- Never hold connections longer than needed — cache the query result
- `state.vscdb` must NEVER be mandatory — if it's locked or missing, fall back to parsing chat files directly

### 7.7 Remote Development & Multi-Root Workspaces
VSCode supports SSH, WSL, and container-based remote development. These produce `vscode-remote://` URIs in `workspace.json` that can't be locally resolved. Multi-root workspaces use `.code-workspace` files instead of single folder URIs.

**Handling:** Extract what we can from the URI scheme. Mark unresolvable remotes as "Remote Workspace: {host}". Don't fail — just provide degraded metadata.

### 7.8 Format Stability Risk
VSCode Copilot Chat's file formats are **undocumented private APIs**. They can change without notice across extension updates. Mitigations:
- Store the `version` field from session files
- Warn on unknown versions rather than failing
- Design the parser to be tolerant of unexpected fields (`#[serde(flatten)]` / `deny_unknown_fields = false`)

---

## 8. Effort Estimation (Relative)

| Phase | Scope | Complexity |
|-------|-------|------------|
| Phase 0: Config & Feature Flag | Config + frontend settings + multi-variant detection | Low |
| Phase 0.5: Data Validation Spike | Replay all files, validate assumptions, document edge cases | Low-Medium |
| Phase 1: Discovery | Discovery + `state.vscdb` overlay + empty filtering + `SessionSource` | Medium |
| Phase 2: Parser | JSONL replay + shape-based JSON parser + TypedEvent converter + error types | **High** |
| Phase 3: Summary Builder | Map available fields, handle missing, `errorDetails` health | Medium |
| Phase 4: Indexer Integration | `SessionProvider` trait, composite fingerprinting, FTS for reasoning | Medium-High |
| Phase 5: Frontend Adaptation | Filters, N/A handling, Experimental badge, info banners | Medium |
| Phase 6: Cross-Cutting Tests | E2E, regression, performance, edge cases | Medium |

**Phase 2 (Parser) is the critical path** — everything else depends on it.

---

## 9. Open Questions for User

1. **Scope:** Should we support both `.json` and `.jsonl` formats, or only `.jsonl` (the modern format)?
2. **Tool results:** Should we join tool call outputs from `chat-session-resources/` in v1, or defer?
3. **Cross-IDE:** Should `Code - Insiders` / `Cursor` / `VSCodium` be supported from day one?
4. **Thinking text:** Should reasoning/thinking be surfaced as a new UI section, or folded into existing turn display?
5. **Session index source:** Should we read from `state.vscdb` SQLite for session metadata, or parse files directly?

---

## Addendum A: Visual Studio (Full IDE) Integration

**Verdict: Not feasible at this time.**

- Session data stored only as ephemeral log files in `%LOCALAPPDATA%\Temp\VSGitHubCopilotLogs\`
- Raw `.log` / `.etl` format, not structured JSON
- Files are temporary and may be deleted at any time
- No community tools, documentation, or parsers exist
- The extension is proprietary (not open-sourced unlike VSCode Copilot Chat)
- Would require Sysinternals Process Monitor forensics to reverse-engineer

**Recommendation:** Defer Visual Studio support indefinitely. Monitor for changes if Microsoft open-sources the VS Copilot extension or adds structured export.

---

## Addendum B: Existing Open-Source Parsers (Reference)

| Project | Language | Approach | Useful For |
|---------|----------|----------|------------|
| [wesm/agentsview](https://github.com/wesm/agentsview) | **Go** | Full JSONL replay, tool taxonomy | JSONL replay reference impl |
| [thisalihassan/promptrail](https://github.com/thisalihassan/promptrail) | TypeScript | JSONL replay + chatEditingSessions diffs | Edit session parsing |
| [priyanshu92/agents-dashboard](https://github.com/priyanshu92/agents-dashboard) | TypeScript | JSON + SQLite reading, empty window sessions | Discovery logic |
| [Acidni-LLC/copilot-chat-manager](https://github.com/Acidni-LLC/copilot-chat-manager) | TypeScript | 4KB partial reads, mtime caching | Performance optimization |
| [hurryingauto3/chatsync](https://github.com/hurryingauto3/chatsync) | TypeScript | SQLite `interactive.sessions` + session index | SQLite reading |

---

## Addendum C: Real Data Statistics (From User's Machine)

| Metric | Value |
|--------|-------|
| Total VSCode workspaces with chat data | 18 |
| Total VSCode chat sessions | 71 |
| Total VSCode chat data size | 13.4 MB |
| Sessions in JSON format | 23 (32%) |
| Sessions in JSONL format | 48 (68%) |
| Total tool invocations observed | 163 |
| Unique tool types | 10 |
| Unique models used | 3 |
| Largest single session | 2.3 MB (JSONL) |
| CLI sessions (comparison) | 100+ |
| CLI total session data | 400+ MB |

---

## 10. Multi-Model Review — Consolidated Findings

> Four independent AI model reviews were conducted: **Claude Opus 4.6**, **GPT 5.4**, **Codex 5.3**, and **Gemini 3 Pro**. Below is a consolidated synthesis of their feedback, organized by theme.

### 10.1 Critical Corrections

#### 10.1.1 `host_type` vs `session_source` — Identity Confusion (GPT 5.4, Opus 4.6)
**Problem:** The plan proposes filtering sessions by `host_type` (All | CLI | VSCode). But `host_type` is **not** a source discriminator — it reflects where the CLI agent was launched from (terminal, VSCode terminal, JetBrains, etc.). CLI sessions launched from VSCode's integrated terminal already have `host_type: "vscode"`. Using this for filtering would misclassify them.

**Fix:** Introduce a new **`session_source`** column (or composite key) that is strictly `"cli"` or `"vscode_chat"`. This is the discriminator for filtering and identity. `host_type` remains a display-only metadata field. The DB schema needs a migration to add this column.

#### 10.1.2 `RawEvent` Fabrication Is Non-Trivial (Opus 4.6, Codex 5.3)
**Problem:** `TypedEvent` contains `pub raw: RawEvent` which includes `raw_json: String`, `id: Option<String>`, `parent_id: Option<String>`. The plan glosses over synthesizing these for VSCode data. Every downstream consumer that touches `.raw` will see fabricated data.

**Fix:** Either (a) make `RawEvent` optional (`Option<RawEvent>`) in `TypedEvent`, or (b) serialize the VSCode source data into `raw_json` so it's still inspectable. Option (a) is cleaner but requires auditing all `.raw` accesses. Option (b) is safer for v1.

#### 10.1.3 Text Response Items May Lack `kind` Field (GPT 5.4)
**Problem:** In some static JSON sessions, assistant text items appear as `{ value, supportThemeIcons, baseUri }` with **no `kind` field**. The parser cannot rely solely on `kind == "text"` matching.

**Fix:** Parser must use **shape-based detection** as fallback: if an item has a `value` field and no `kind`, treat it as text. Test against both formats.

#### 10.1.4 Synthetic `SessionShutdown` Can Distort Health Logic (GPT 5.4, Opus 4.6)
**Problem:** The plan proposes synthesizing a fake `SessionShutdown` event. Current health/analytics logic interprets the presence/absence and content of shutdown events semantically. A synthetic shutdown could create false positive health scores or misleading duration calculations.

**Fix:** Either (a) do NOT synthesize `SessionShutdown` — let VSCode sessions simply have no shutdown event and handle the absence gracefully, or (b) tag synthetic events with a `is_synthetic: true` flag so downstream consumers can distinguish them.

### 10.2 Architecture Refinements

#### 10.2.1 Provider Trait Abstraction (GPT 5.4, Codex 5.3)
**Consensus recommendation:** Instead of just normalizing at `TypedEvent` level, introduce a **`SessionProvider` trait**:

```rust
trait SessionProvider {
    fn discover(&self, base_dir: &Path) -> Result<Vec<DiscoveredSession>>;
    fn load_summary(&self, session: &DiscoveredSession) -> Result<SessionSummary>;
    fn load_typed_events(&self, session: &DiscoveredSession) -> Result<Vec<TypedEvent>>;
    fn fingerprint(&self, session: &DiscoveredSession) -> Result<SessionFingerprint>;
}
```

**Why:** This cleanly encapsulates per-source differences (discovery, summary, fingerprinting, event loading) while keeping shared consumers (turn reconstruction, FTS, analytics) source-agnostic. Avoids spreading `if cli { ... } else if vscode { ... }` throughout the indexer.

#### 10.2.2 `state.vscdb` as Metadata Overlay (GPT 5.4, Gemini)
**Problem:** Many chat session files lack `customTitle` and `lastMessageDate`. The `state.vscdb` → `chat.ChatSessionStore.index` is a more reliable source for session metadata (titles, dates, isEmpty, hasPendingEdits, lastResponseState).

**Fix:** Use `state.vscdb` as a **metadata overlay** during discovery. Read the session index first for titles/dates/flags, then parse chat files only for full content. This also enables filtering out empty/stub sessions early (~30-40% of sessions have 0 requests).

#### 10.2.3 Change Detection for VSCode (GPT 5.4, Codex 5.3)
**Problem:** Current incremental reindex fingerprints only `workspace.yaml` + `events.jsonl` mtime/size. VSCode sessions need a composite fingerprint across multiple files.

**Fix:** VSCode session fingerprint should include:
- Chat session file mtime + size
- `workspace.json` mtime (workspace path may change)
- Relevant `state.vscdb` entry version (via a lightweight query)
- Optionally: `chat-session-resources/` directory mtime (for tool outputs)

Store a per-session normalized hash in the DB for efficient comparison.

### 10.3 Data Quality & Edge Cases

#### 10.3.1 Empty Session Filtering (Opus 4.6, GPT 5.4)
**Finding:** ~30-40% of VSCode sessions are empty stubs (0 requests, created when user opens new chat and never types). These should be **filtered out during discovery**, not indexed. Use `state.vscdb` `isEmpty` flag or check `requests.length == 0` after replay.

#### 10.3.2 Trailing/Incomplete JSONL Lines (Codex 5.3, GPT 5.4)
**Finding:** VSCode may be actively writing when TracePilot reads. The last line of a JSONL file may be incomplete/invalid JSON.

**Fix:** Replay engine should catch parse errors on the final line and silently ignore it (the data will be complete on the next reindex). Log a debug-level warning.

#### 10.3.3 Non-UUID `chatEditingSessions` Directories (GPT 5.4)
**Finding:** `chatEditingSessions/` contains ~70 UUID directories but also 2 non-UUID directories. Direct 1:1 path mapping by session ID is unsafe.

**Fix:** Match edit sessions to chat sessions via the session ID inside `state.json`, not the directory name.

#### 10.3.4 `result.metadata` Contains Useful Data (GPT 5.4)
**Finding:** The `result` field contains more than just timings:
- `result.metadata.toolCallRounds` — structured tool round data
- `result.errorDetails` — error information (partial equivalent to CLI errors)
- `result.responseIsIncomplete` — cancellation/failure indicator
- `result.metadata.renderedUserMessage` — processed user prompt

**Fix:** Parse and use `errorDetails` + `responseIsIncomplete` to derive a basic health/error signal for VSCode sessions (not purely N/A as originally proposed).

#### 10.3.5 Remote Development / Multi-Root Workspaces (Gemini, GPT 5.4)
**Finding:** VSCode supports remote development (SSH, WSL, containers) which produce `vscode-remote://` URIs in `workspace.json` that can't be locally resolved. Multi-root workspaces use `.code-workspace` files instead of folder URIs.

**Fix:** Handle gracefully — extract what we can from the URI, mark unresolvable remotes as "Remote Workspace", don't fail on them.

#### 10.3.6 FTS Must Index Thinking/Reasoning (GPT 5.4)
**Finding:** If thinking text is mapped only to `AssistantReasoning` events, current FTS indexing (which only ingests `UserMessage` + `AssistantMessage`) will miss it. This is arguably VSCode's richest data.

**Fix:** Extend FTS content extraction to include `AssistantReasoning` text. This benefits CLI sessions too (where reasoning was previously not searchable).

### 10.4 UX & Product Considerations

#### 10.4.1 Mark as Experimental/Beta (Gemini)
**Recommendation:** VSCode session support depends on **undocumented, private file formats** that could change without notice. The feature should be:
- Behind a feature flag (already planned)
- Labeled "Experimental" or "Beta" in the UI
- Accompanied by a tooltip explaining data limitations
- Versioned — store the chat file `version` field and warn on unknown versions

#### 10.4.2 Manage User Expectations for Data Fidelity Gap (Gemini, GPT 5.4)
**Problem:** CLI sessions have rich analytics (tokens, cost, health, code changes). VSCode sessions have none of these. Mixing high-fidelity CLI sessions with lower-fidelity VSCode sessions in the same list could confuse users.

**Fix:**
- Clear visual differentiation (badge + subtle background color or border)
- Info banner on VSCode session detail: "Some analytics are not available for VSCode sessions"
- Aggregate dashboards should clearly separate or annotate mixed data
- Primary value proposition for VSCode sessions: **Search & Recall** (FTS over message history)

#### 10.4.3 Multi-Variant VSCode Detection (Gemini, GPT 5.4)
**Finding:** Users may have multiple VSCode variants installed: `Code`, `Code - Insiders`, `VSCodium`, `Cursor`. Each stores data in different directories but with identical structure.

**Fix:** Settings should support multiple paths or auto-detect all variants. Discovery should scan all configured paths. Consider a "Detected Installations" UI in settings.

### 10.5 Implementation Process Improvements

#### 10.5.1 Add Phase 0.5: Data Validation Spike (Opus 4.6)
**Before building the full parser, validate assumptions against ALL real data:**
1. Replay all 48 JSONL files — count successes, failures, and edge cases
2. Parse all 23 JSON files — verify schema consistency
3. Identify all unique response `kind` values across the full dataset
4. Verify `kind=2` splice semantics match the spec
5. Measure replay performance (expected: ~20-150ms per session, ~10-30MB peak RSS — Codex estimate)
6. Catalog all `toolId` values and verify mapping table completeness

**This prevents building a parser that fails on 20% of real data.**

#### 10.5.2 Interleave Testing with Implementation (Opus 4.6, Codex 5.3)
**Problem:** The plan defers all testing to Phase 6. This risks discovering fundamental issues late.

**Fix:** Each phase should include its own tests:
- Phase 1: Discovery tests with real workspace layouts
- Phase 2: Replay engine unit tests, converter snapshot tests
- Phase 3: Summary builder tests with edge cases (missing fields, empty sessions)
- Phase 4: Indexer integration tests
- Phase 5: Frontend component tests

#### 10.5.3 Explicit Error Types (Codex 5.3)
**Recommendation:** Add dedicated error variants for VSCode parsing:

```rust
enum VscodeParseError {
    JsonlReplayFailed { line: usize, source: serde_json::Error },
    UnknownOperationKind(u8),
    InvalidSplicePath { path: Vec<String> },
    IncompleteFinalLine,
    UnsupportedVersion(u32),
    StateDatabaseError(rusqlite::Error),
}
```

### 10.6 Future-Looking Considerations

#### 10.6.1 VSCode Extension for Richer Data (Gemini)
**Long-term idea:** Instead of reverse-engineering VSCode's private file formats, consider building a lightweight **VSCode extension** that captures session data in a format TracePilot already understands (or a dedicated richer format). This would:
- Provide token/cost data that's unavailable on disk
- Be immune to upstream format changes
- Enable real-time session tracking
- **However:** Adds significant scope and maintenance burden. Only pursue if the file-parsing approach proves too fragile.

#### 10.6.2 Concurrent Access Safety (Codex 5.3, GPT 5.4)
**For `state.vscdb` access:**
- Open with `SQLITE_OPEN_READONLY` flag
- Handle `SQLITE_BUSY` with retry/backoff
- Never hold connections longer than needed
- Consider caching the index query result rather than re-querying

#### 10.6.3 VSCode-Specific `TypedEventData` Variants (Opus 4.6)
**Problem:** VSCode response types like `inlineReference`, `textEditGroup`, `codeblockUri`, `undoStop` have no CLI equivalent. They'll be silently dropped during `TypedEvent` conversion, losing data.

**Options:**
1. Add new `TypedEventData` variants (e.g., `InlineReference`, `TextEditGroup`) — clean but expands the shared enum
2. Add a `TypedEventData::VscodeSpecific(serde_json::Value)` catch-all — flexible but untyped
3. Drop them and accept data loss — simplest for v1

**Recommendation:** Option 3 for v1, option 1 for v2 if users want to see file references and edit groups.

### 10.7 Revised Phase Summary

| Phase | Original | Revised (Post-Review) |
|-------|----------|----------------------|
| Phase 0 | Config & Feature Flag | Config & Feature Flag + "Experimental" labeling |
| **Phase 0.5** | *(new)* | **Data Validation Spike** — replay all files, validate assumptions |
| Phase 1 | Discovery | Discovery + `SessionSource` enum + `state.vscdb` metadata overlay + empty session filtering |
| Phase 2 | Parser | Parser + shape-based detection + trailing line handling + explicit error types |
| Phase 3 | Summary | Summary + `result.errorDetails` health signal + no synthetic shutdown |
| Phase 4 | Indexer | Indexer + `SessionProvider` trait + composite fingerprinting + `session_source` column |
| Phase 5 | Frontend | Frontend + Experimental badge + data fidelity UX + FTS for reasoning |
| Phase 6 | Testing (deferred) | *(removed — testing interleaved with each phase)* |

### 10.8 Reviewer Agreement Matrix

| Topic | Opus 4.6 | GPT 5.4 | Codex 5.3 | Gemini 3 Pro |
|-------|----------|---------|-----------|--------------|
| Provider trait / abstraction | ✅ Mentioned | ✅ Strong advocate | ✅ Sketched Rust code | — |
| `session_source` not `host_type` | ✅ Collision risk | ✅ Primary correction | — | — |
| `RawEvent` synthesis issue | ✅ Flagged | — | ✅ Flagged | — |
| Empty session filtering | ✅ ~30-40% empty | ✅ Confirmed | — | — |
| `state.vscdb` importance | — | ✅ Critical for metadata | — | ✅ Mentioned |
| Synthetic shutdown danger | ✅ Flag required | ✅ Don't fake it | — | — |
| Test interleaving | ✅ Strong | — | ✅ Strong | — |
| Data validation spike | ✅ Phase 0.5 | — | ✅ Replay all files | — |
| Experimental/Beta labeling | — | — | — | ✅ Strong |
| VSCode extension (future) | — | — | — | ✅ Proposed |
| Trailing JSONL line handling | — | ✅ Flagged | ✅ Flagged | — |
| FTS for reasoning text | — | ✅ Flagged | — | ✅ Search focus |
| Remote/multi-root workspaces | — | ✅ Flagged | — | ✅ Flagged |
| Concurrent SQLite access | — | ✅ Detailed | ✅ Detailed | — |
| Multi-variant detection | — | ✅ Mentioned | — | ✅ Strong |
| Shape-based response parsing | — | ✅ Primary finding | — | — |
| `result.errorDetails` for health | — | ✅ Primary finding | — | — |

---

## Addendum D: Review Model Credits

| Model | Focus Area | Key Contribution |
|-------|-----------|-----------------|
| **Claude Opus 4.6** | Architecture accuracy, data integrity | `RawEvent` fabrication issue, empty session statistics, Phase 0.5 spike |
| **GPT 5.4** | Technical depth, edge cases | `host_type` vs `session_source`, shape-based parsing, provider trait, change detection |
| **Codex 5.3** | Rust implementation, performance | Concrete code sketches, error types, SQLite concurrency, replay performance estimates |
| **Gemini 3 Pro** | UX/product, strategic | Experimental labeling, search-first value prop, VSCode extension idea, multi-variant support |
