# TracePilot Data Enrichment Report

## Executive Summary

TracePilot currently extracts only a fraction of the data available in Copilot CLI session events. **11 of 24 recognized event types** have typed Rust structs, and even those structs omit fields that exist in the raw data. During turn reconstruction, an additional **9+ fields** are parsed but silently discarded. The most impactful omission is `reasoningText` — the model's visible chain-of-thought — which appears in **every session** (73–134 occurrences per session) but is never surfaced.

This report catalogs all missing data, assesses its value, and provides a concrete implementation guide for incorporating each enrichment.

---

## 1. Missing Fields in Existing Typed Structs

### 1.1 `AssistantMessageData` — The Biggest Gap

**Current struct** (`models/event_types.rs:204-212`):
```rust
pub struct AssistantMessageData {
    pub message_id: Option<String>,
    pub content: Option<String>,
    pub interaction_id: Option<String>,
    pub tool_requests: Option<Vec<serde_json::Value>>,
    pub output_tokens: Option<u64>,
    pub parent_tool_call_id: Option<String>,
}
```

**Fields present in raw events but NOT in the struct:**

| Field | Type | Frequency | Value |
|---|---|---|---|
| **`reasoningText`** | `String` | 73–134 per session | **HIGH** — The model's visible reasoning/chain-of-thought. Shows WHY the model made decisions. Essential for conversation display, debugging, and audit. |
| **`reasoningOpaque`** | `String` | Every assistant.message | **LOW** — Encrypted/opaque reasoning blob. Not human-readable. May be useful for completeness or size analysis. |
| **`encryptedContent`** | `String` | Schema-defined | **LOW** — Encrypted content variant. Rarely observed. |
| **`phase`** | `String` | Schema-defined | **MEDIUM** — Indicates the phase of assistant response (e.g., planning, executing). Not widely observed but potentially useful for chapter detection. |

### 1.2 `ToolExecCompleteData` — Missing `isUserRequested`

**Current struct** has `result` and `tool_telemetry` as raw `Value`, which is fine. But it's missing:

| Field | Type | Frequency | Value |
|---|---|---|---|
| **`isUserRequested`** | `bool` | Schema-defined | **MEDIUM** — Distinguishes user-initiated tool calls (e.g., `tool.user_requested`) from agent-initiated ones. Useful for interaction analysis. |

### 1.3 `ToolRequest` sub-objects in `assistant.message`

Tool requests within `assistant.message.data.toolRequests[]` are stored as raw `serde_json::Value`. Each tool request contains:

| Field | Type | Value |
|---|---|---|
| **`intentionSummary`** | `String` | **HIGH** — Human-readable description of what the tool call intends to do (e.g., "view the file at C:\git\TracePilot\README.md"). Present on 9–448 tool requests per session. Excellent for conversation UX — shows intent without expanding full arguments. |
| `toolCallId` | `String` | Already captured via ToolExecStart |
| `name` | `String` | Already captured |
| `arguments` | `Object` | Already captured |
| `type` | `String` | Always "function" — low value |

### 1.4 `tool.execution_complete.data.result` — Rich Structure

The `result` field is stored as raw `Value` but has a consistent structure:

| Sub-field | Type | Value |
|---|---|---|
| **`content`** | `String` | **HIGH** — The summarized tool output shown to the LLM. Already partially captured but not structured. |
| **`detailedContent`** | `String` | **HIGH** — The full, unsummarized tool output. For `report_intent`, it's the intent text. For `view`, it's the full file content. For `powershell`, it's the complete command output. Present in 7–946 tool completions per session. |

### 1.5 `tool.execution_complete.data.toolTelemetry` — Operational Insights

Currently stored as raw `Value` but has a rich structure:

```json
{
  "properties": {
    "command": "view",
    "viewType": "directory",
    "fileExtension": "[\"directory\"]",
    "resolvedPathAgainstCwd": "false"
  },
  "metrics": {
    "resultLength": 198,
    "resultForLlmLength": 198,
    "responseTokenLimit": 32000
  },
  "restrictedProperties": {}
}
```

| Sub-field | Type | Value |
|---|---|---|
| **`properties.command`** | `String` | **MEDIUM** — The specific command variant (e.g., view, edit, grep). |
| **`properties.agent_type`** | `String` | **MEDIUM** — For task tool calls, identifies the agent type (explore, task, etc.). |
| **`properties.agent_id`** | `String` | **MEDIUM** — Links task tool calls to specific subagent instances. |
| **`metrics.resultLength`** | `u64` | **MEDIUM** — Byte size of tool result. Useful for identifying heavy tool calls. |
| **`metrics.resultForLlmLength`** | `u64` | **MEDIUM** — Byte size sent to LLM (may be truncated vs. full result). |
| **`metrics.responseTokenLimit`** | `u64` | **LOW** — Token limit for the response. |
| **`restrictedProperties.skillName`** | `String` | **MEDIUM** — For skill invocations, the actual skill name. |

---

## 2. Fields Parsed but Dropped During Turn Reconstruction

These fields exist in the typed structs but are never propagated to `ConversationTurn` or `TurnToolCall`:

| Field | Source | Drop Point | Impact |
|---|---|---|---|
| **`output_tokens`** | `AssistantMessageData` | `reconstruct_turns()` | **HIGH** — Per-message token count. Enables per-turn cost estimation and token usage visualization. |
| **`tool_requests`** | `AssistantMessageData` | `reconstruct_turns()` | **HIGH** — Contains `intentionSummary` per tool call. Critical for rich UX. |
| **`message_id`** | `AssistantMessageData` | `reconstruct_turns()` | **LOW** — Internal message ID. Useful for deduplication/linking but not user-facing. |
| **`transformed_content`** | `UserMessageData` | `reconstruct_turns()` | **MEDIUM** — The system-decorated version of user input (includes datetime, reminders, SQL table state). Shows what the LLM actually received vs. what the user typed. |
| **`attachments`** | `UserMessageData` | `reconstruct_turns()` | **MEDIUM** — User message attachments (file selections, code snippets). |
| **`source`** | `UserMessageData` | `reconstruct_turns()` | **LOW** — Source of the message (usually "user"). |
| **`result`** | `ToolExecCompleteData` | `reconstruct_turns()` | **HIGH** — The actual tool output. Currently tools show arguments but never results. This is critical for conversation replay. |
| **`tool_telemetry`** | `ToolExecCompleteData` | `reconstruct_turns()` | **MEDIUM** — Performance and metadata about tool execution. |
| **`parent_tool_call_id`** (assistant msg) | `AssistantMessageData` | `reconstruct_turns()` | **MEDIUM** — Links subagent responses to their parent tool call. |

---

## 3. Event Types With No Typed Struct (13 of 24)

These event types are recognized in the enum but their data falls through to `TypedEventData::Other(Value)`:

### 3.1 High-Value Missing Structs

| Event Type | Data Fields | Value | Use Cases |
|---|---|---|---|
| **`session.compaction_complete`** | `success`, `preCompactionTokens`, `preCompactionMessagesLength`, `summaryContent`, `checkpointNumber`, `checkpointPath`, `compactionTokensUsed{input,output,cachedInput}`, `requestId` | **HIGH** | Context window analysis, compaction timeline markers, token usage visualization |
| **`session.model_change`** | `newModel`, `previousReasoningEffort`, `reasoningEffort` | **HIGH** | Model switch tracking, conversation markers showing when model changed |
| **`session.error`** | `errorType`, `message`, `stack`, `statusCode`, `providerCallId` | **HIGH** | Error visualization, health scoring, debugging failed sessions |
| **`session.resume`** | `resumeTime`, `eventCount`, `selectedModel`, `reasoningEffort`, `context`, `alreadyInUse` | **HIGH** | Session lineage detection, resume markers in timeline |
| **`session.context_changed`** | `cwd`, `gitRoot`, `branch`, `repository`, `hostType`, `headCommit`, `baseCommit` | **MEDIUM** | Tracking when user changed directories or branches mid-session |

### 3.2 Medium-Value Missing Structs

| Event Type | Data Fields | Value | Use Cases |
|---|---|---|---|
| **`system.notification`** | `content`, `kind{type,agentId,agentType,status,description,prompt}` | **MEDIUM** | Subagent completion notifications, system event display |
| **`skill.invoked`** | `name`, `path`, `content`, `allowedTools`, `pluginName`, `pluginVersion` | **MEDIUM** | Skill usage tracking, showing which custom skills were activated |
| **`session.plan_changed`** | `operation` | **MEDIUM** | Plan lifecycle tracking (create/update/delete) |
| **`session.info`** | `infoType`, `message` | **MEDIUM** | Informational messages display |
| **`session.workspace_file_changed`** | `path`, `operation` | **MEDIUM** | File creation/modification tracking within session workspace |

### 3.3 Lower-Value Missing Structs

| Event Type | Data Fields | Value | Use Cases |
|---|---|---|---|
| `session.compaction_start` | *(empty)* | **LOW** | Timing info only (via timestamp) |
| `tool.user_requested` | `toolCallId`, `toolName`, `arguments` | **LOW** | User-initiated tool calls (rare) |
| `abort` | `reason` | **MEDIUM** | Session abort tracking |

---

## 4. Unobserved But Schema-Defined Event Types (38 additional)

From the CLI's JSON Schema (v1.0.5), **38 event types** are defined but never observed in persisted data. Most are ephemeral (streaming deltas, UI interactions) or represent rare features:

### Worth Monitoring For

| Event Type | Why It Matters |
|---|---|
| `assistant.usage` | Per-call token/cost breakdown: `model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cost, duration, initiator, apiCallId`. If this starts appearing in persisted data, it's the richest token analytics source. |
| `session.title_changed` | Session rename events. |
| `session.snapshot_rewind` | Rewind operations: `upToEventId, eventsRemoved`. |
| `session.truncation` | Context truncation: `tokenLimit, preTruncationTokens/Messages, postTruncationTokens/Messages, performedBy`. |
| `hook.start` / `hook.end` | Git hook integrations. |
| `permission.requested` / `permission.completed` | Permission flow tracking. |
| `exit_plan_mode.requested` | Plan mode exit with `summary, planContent, actions, recommendedAction`. |

### Safe to Ignore (Ephemeral/Streaming)

`session.idle`, `assistant.intent`, `assistant.reasoning_delta`, `assistant.streaming_delta`, `assistant.message_delta`, `pending_messages.modified`, `tool.execution_partial_result`, `tool.execution_progress`, `subagent.selected`, `subagent.deselected`

---

## 5. Data Available Outside events.jsonl

### 5.1 Rewind Snapshots — Parsed but Not Exposed

**File:** `rewind-snapshots/index.json`  
**Parser:** `crates/tracepilot-core/src/parsing/rewind_snapshots.rs`

Contains per-user-message snapshots with:
- `snapshotId`, `eventId`, `userMessage`, `timestamp`
- `fileCount`, `gitCommit`, `gitBranch`
- `backupHashes`, `files`, `filePathMap`

**Status:** Parsed into Rust structs but **no Tauri command exposes them**. No frontend component consumes them.

**Value:** **HIGH** — Enables "time travel" view, showing git state at each user interaction. Links user messages to specific commits.

### 5.2 `vscode.metadata.json` — Not Parsed At All

Present in 65% of sessions. Contains VS Code workspace/editor context at session start.

**Value:** **MEDIUM** — Could show which files were open, which editor was used, workspace settings.

### 5.3 Checkpoint Content — ~~Only Index Parsed~~ Already Exposed ✓

> **Correction (from multi-model review):** `parse_checkpoints()` already loads individual `.md` file content into `CheckpointEntry.content`, and `get_session_checkpoints` exposes it via Tauri with 50KB truncation. This was incorrectly flagged as missing in the initial analysis.

---

## 6. Enrichment Priority Matrix

| Priority | Field/Feature | Impact | Effort | Where to Add |
|---|---|---|---|---|
| **P0** | `reasoningText` on assistant messages | Very High | Low | Struct + turn + frontend |
| **P0** | `output_tokens` on turns | Very High | Low | Turn reconstruction + frontend |
| **P0** | `intentionSummary` on tool calls | Very High | Low | Parse from tool_requests + turn |
| **P0** | Tool `result` (content/detailedContent) | Very High | Medium | Turn + frontend (lazy load) |
| **P1** | `transformed_content` on user messages | High | Low | Turn + frontend toggle |
| **P1** | `session.compaction_complete` typed struct | High | Medium | New struct + compaction markers |
| **P1** | `session.model_change` typed struct | High | Low | New struct + model change markers |
| **P1** | `session.error` typed struct | High | Low | New struct + error display |
| **P1** | `session.resume` typed struct | High | Low | New struct + resume markers |
| **P1** | Rewind snapshots exposed via Tauri | High | Medium | New command + frontend |
| **P2** | `attachments` on user messages | Medium | Low | Turn + frontend |
| **P2** | `toolTelemetry` structured parsing | Medium | Medium | New struct + analytics |
| **P2** | `session.context_changed` typed struct | Medium | Low | New struct + context markers |
| **P2** | `system.notification` typed struct | Medium | Low | New struct + notification display |
| **P2** | `skill.invoked` typed struct | Medium | Low | New struct + skill badges |
| **P3** | `reasoningOpaque` (encrypted reasoning) | Low | Low | Struct field only |
| **P3** | `vscode.metadata.json` parsing | Low | Medium | New parser + display |
| **P3** | `session.plan_changed` typed struct | Low | Low | New struct |
| **P3** | `abort` typed struct | Medium | Low | New struct |

---

## 7. Implementation Guide

### 7.1 P0: Add `reasoningText` to Assistant Messages

**Why:** This is the model's visible chain-of-thought reasoning. It shows _why_ decisions were made and is present in every session with extended thinking enabled (73–134 occurrences per session).

#### Step 1: Update `AssistantMessageData` struct

**File:** `crates/tracepilot-core/src/models/event_types.rs`

```rust
pub struct AssistantMessageData {
    pub message_id: Option<String>,
    pub content: Option<String>,
    pub interaction_id: Option<String>,
    pub tool_requests: Option<Vec<serde_json::Value>>,
    pub output_tokens: Option<u64>,
    pub parent_tool_call_id: Option<String>,
    // NEW FIELDS
    pub reasoning_text: Option<String>,       // Visible chain-of-thought reasoning
    pub reasoning_opaque: Option<String>,     // Encrypted reasoning blob
}
```

#### Step 2: Update `ConversationTurn` struct

**File:** `crates/tracepilot-core/src/models/conversation.rs`

```rust
pub struct ConversationTurn {
    // ... existing fields ...
    #[serde(default)]
    pub reasoning_texts: Vec<String>,             // NEW: Per-message reasoning (parallel to assistant_messages)
    pub output_tokens: Option<u64>,               // NEW: Total output tokens for this turn
    pub transformed_user_message: Option<String>, // NEW: System-decorated user input
}
```

> **Note (from review):** Use `Vec<String>` not `Option<String>`. A turn can have multiple `assistant.message` events with distinct reasoning. Using first-wins would discard subsequent reasoning blocks.

#### Step 3: Update turn reconstruction

**File:** `crates/tracepilot-core/src/turns/mod.rs`

In the `AssistantMessage` match arm (~line 45), add:
```rust
if let Some(reasoning) = &data.reasoning_text {
    if !reasoning.trim().is_empty() {
        turn.reasoning_texts.push(reasoning.clone());
    }
}
if let Some(tokens) = data.output_tokens {
    *turn.output_tokens.get_or_insert(0) += tokens;
}
```

In the `UserMessage` match arm (~line 26), add:
```rust
current_turn = Some(ConversationTurn {
    // ... existing ...
    reasoning_texts: Vec::new(),
    output_tokens: None,
    transformed_user_message: data.transformed_content.clone(),
});
```

#### Step 4: Update TypeScript types

**File:** `packages/types/src/index.ts`

```typescript
export interface ConversationTurn {
  // ... existing fields ...
  reasoningTexts?: string[];
  outputTokens?: number;
  transformedUserMessage?: string;
}
```

#### Step 5: Update frontend display

**File:** `apps/desktop/src/views/tabs/ConversationTab.vue` (or relevant component)

Add a collapsible "Reasoning" section to the assistant message display:
```vue
<div v-if="turn.reasoningText" class="reasoning-block">
  <button @click="showReasoning = !showReasoning">
    💭 Reasoning {{ showReasoning ? '▼' : '▶' }}
  </button>
  <pre v-show="showReasoning">{{ turn.reasoningText }}</pre>
</div>
```

#### Step 6: Update `build.rs` if needed

If `ConversationTurn` is exposed via Tauri commands (which it is via `get_session_turns`), no changes needed — serde handles the new fields automatically.

---

### 7.2 P0: Add `intentionSummary` to Tool Calls

**Why:** This is a human-readable description of tool call intent (e.g., "view the file at /path/to/file"). Present on 9–448 tool requests per session. It eliminates the need to parse raw arguments for a quick overview.

#### Step 1: Update `TurnToolCall` struct

**File:** `crates/tracepilot-core/src/models/conversation.rs`

```rust
pub struct TurnToolCall {
    // ... existing fields ...
    pub intention_summary: Option<String>,  // NEW: Human-readable intent
    pub result_content: Option<String>,     // NEW: Tool output preview (truncated ≤1KB)
}
```

> **Note (from review):** Do NOT add `result_detailed` here. Full tool output must be lazy-loaded via a separate Tauri command to avoid memory issues (sessions can have 946 tool completions × 100KB+).

#### Step 2: Extract `intentionSummary` from tool_requests during turn reconstruction

In the `AssistantMessage` match arm, parse `tool_requests` to extract `intentionSummary`:

```rust
if let Some(requests) = &data.tool_requests {
    for req in requests {
        if let (Some(id), Some(summary)) = (
            req.get("toolCallId").and_then(|v| v.as_str()),
            req.get("intentionSummary").and_then(|v| v.as_str()),
        ) {
            // Store for later matching with ToolExecStart
            intention_summaries.insert(id.to_string(), summary.to_string());
        }
    }
}
```

Then in `ToolExecutionStart`, look up the intention:
```rust
intention_summary: data.tool_call_id.as_ref()
    .and_then(|id| intention_summaries.get(id))
    .cloned(),
```

#### Step 3: Extract tool `result` content during completion (with polymorphic handling)

In the `ToolExecutionComplete` match arm:
```rust
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max { s.to_string() }
    else { format!("{}...[truncated]", &s[..max]) }
}

// Handle both forms: result can be a plain string OR an object with content/detailedContent
if let Some(result) = &data.result {
    match result {
        Value::String(s) => {
            tool_call.result_content = Some(truncate(s, 1024));
        }
        Value::Object(obj) => {
            if let Some(content) = obj.get("content").and_then(|v| v.as_str()) {
                tool_call.result_content = Some(truncate(content, 1024));
            }
        }
        _ => {}
    }
}
```

#### Step 3b: Add lazy-load Tauri command for full tool output

**File:** `crates/tracepilot-tauri-bindings/src/lib.rs`

```rust
#[tauri::command]
pub async fn get_tool_result(
    session_id: String,
    tool_call_id: String,
    config: tauri::State<'_, SharedConfig>,
) -> Result<Option<serde_json::Value>, String> {
    let events_path = resolve_session_path_in(&config, &session_id, "events.jsonl");
    let events = parse_typed_events(&events_path).map_err(|e| e.to_string())?;
    // Find the tool.execution_complete event for this tool_call_id
    for event in events.iter().rev() {
        if let TypedEventData::ToolExecutionComplete(data) = &event.typed_data {
            if data.tool_call_id.as_deref() == Some(&tool_call_id) {
                return Ok(data.result.clone());
            }
        }
    }
    Ok(None)
}
```

Register in `generate_handler![]` and `build.rs` `.commands()` list.

#### Step 4: Update TypeScript types and frontend

```typescript
export interface TurnToolCall {
  // ... existing ...
  intentionSummary?: string;
  resultContent?: string;  // Truncated preview (≤1KB)
}
```

**Full tool output** is fetched on-demand via a separate Tauri command:
```typescript
// packages/client/src/index.ts
export async function getToolResult(sessionId: string, toolCallId: string): Promise<unknown> {
  return invoke('get_tool_result', { sessionId, toolCallId });
}
```

**Frontend pattern:** Show `resultContent` as preview, "Show Full Output" button triggers `getToolResult()`:
```vue
<div v-if="tc.resultContent" class="tool-result-preview">
  <pre>{{ tc.resultContent }}</pre>
  <button @click="loadFullResult(tc.toolCallId)">Show Full Output</button>
</div>
```

---

### 7.3 P1: Add Typed Structs for Missing Event Types

#### `session.compaction_complete`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionCompleteData {
    pub success: Option<bool>,
    pub error: Option<String>,
    pub pre_compaction_tokens: Option<u64>,
    pub pre_compaction_messages_length: Option<u64>,
    pub summary_content: Option<String>,
    pub checkpoint_number: Option<u64>,
    pub checkpoint_path: Option<String>,
    pub compaction_tokens_used: Option<CompactionTokenUsage>,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionTokenUsage {
    pub input: Option<u64>,
    pub output: Option<u64>,
    pub cached_input: Option<u64>,
}
```

#### `session.model_change`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelChangeData {
    pub previous_model: Option<String>,
    pub new_model: Option<String>,
    pub previous_reasoning_effort: Option<String>,
    pub reasoning_effort: Option<String>,
}
```

#### `session.error`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionErrorData {
    pub error_type: Option<String>,
    pub message: Option<String>,
    pub stack: Option<String>,
    pub status_code: Option<u16>,
    pub provider_call_id: Option<String>,
}
```

#### `session.resume`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResumeData {
    pub resume_time: Option<String>,
    pub event_count: Option<u64>,
    pub selected_model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub context: Option<SessionContext>,
    pub already_in_use: Option<bool>,
}
```

#### `system.notification`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemNotificationData {
    pub content: Option<String>,
    pub kind: Option<serde_json::Value>, // Complex/varying structure
}
```

#### `skill.invoked`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInvokedData {
    pub name: Option<String>,
    pub path: Option<String>,
    pub content: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub plugin_name: Option<String>,
    pub plugin_version: Option<String>,
}
```

#### `abort`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbortData {
    pub reason: Option<String>,
}
```

#### `session.context_changed`

Reuse existing `SessionContext` struct:

```rust
// No new struct needed — use SessionContext
```

#### `session.plan_changed`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanChangedData {
    pub operation: Option<String>, // "create", "update", "delete"
}
```

#### `session.info`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfoData {
    pub info_type: Option<String>,
    pub message: Option<String>,
}
```

For each new struct:
1. Add the struct to `event_types.rs`
2. Add a variant to `TypedEventData` enum in `parsing/events.rs`
3. Add the match arm in `typed_data_from_raw()` in `parsing/events.rs`

---

### 7.4 P1: Expose Rewind Snapshots via Tauri

#### Step 1: Add Tauri command

```rust
#[tauri::command]
pub async fn get_rewind_snapshots(session_id: String) -> Result<Vec<RewindSnapshot>, String> {
    let path = session_dir(&session_id).join("rewind-snapshots/index.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    parse_rewind_snapshots(&path).map_err(|e| e.to_string())
}
```

#### Step 2: Add TypeScript types

```typescript
export interface RewindSnapshot {
  snapshotId: string;
  eventId: string;
  userMessage: string;
  timestamp: string;
  fileCount: number;
  gitCommit?: string;
  gitBranch?: string;
}
```

#### Step 3: Register command in `generate_handler![]` and `build.rs`

---

### 7.5 Conversation Timeline Enrichment

With the above changes, the conversation timeline can be dramatically improved:

```
┌─ User Message ─────────────────────────────────────────────┐
│ "Can you fix the authentication bug?"                       │
│ 📎 2 attachments  •  🕐 2026-03-14 12:28:46               │
│ [Toggle: Show system-decorated version]                     │
└─────────────────────────────────────────────────────────────┘

┌─ Assistant Turn (claude-opus-4.6) ──── 236 tokens ──────────┐
│                                                              │
│ 💭 Reasoning (click to expand)                               │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ The user wants me to fix an auth bug. Let me start by    │ │
│ │ reading the auth module to understand the current flow...│ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ "I'll investigate the authentication module..."              │
│                                                              │
│ 🔧 Tool Calls:                                              │
│  ├─ 📂 view — "view the file at src/auth/login.ts"    2.3s │
│  │   └─ Result: (click to expand) 45 lines                  │
│  ├─ 🔍 grep — "search for token validation"           0.8s │
│  │   └─ Result: 3 matches found                             │
│  └─ ✏️ edit — "fix token expiry check"                 0.1s │
│      └─ Result: Applied successfully                         │
│                                                              │
│ 🔄 Model changed: claude-opus-4.6 → gpt-5.4                │
│                                                              │
│ ⚠️ Compaction occurred (104K → 52K tokens, checkpoint #1)   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 8. Impact Assessment

### What This Enables

| Capability | Required Enrichments | Value |
|---|---|---|
| **"Why did the AI do that?"** | `reasoningText` | Transparency into model decision-making |
| **Tool call summaries without expansion** | `intentionSummary` | Dramatically better UX for scanning conversations |
| **Per-turn cost estimation** | `output_tokens` + model metrics | Budget tracking and cost optimization |
| **Tool output inspection** | `result.content`/`detailedContent` | Full conversation replay without raw events |
| **Model switch awareness** | `session.model_change` struct | Track when and why models changed |
| **Error debugging** | `session.error` struct | Surface API errors, model failures |
| **Session continuity** | `session.resume` struct + rewind snapshots | Understand session lineage |
| **Context window monitoring** | `compaction_complete` struct | Visualize token growth and compaction |
| **System-level context** | `transformed_content` | See what the LLM actually received |

### What Changes Are Needed Per Layer

| Layer | Files Changed | Scope |
|---|---|---|
| **Rust Structs** | `event_types.rs` | Add ~10 new structs, extend 2 existing |
| **Event Parser** | `events.rs` | Add ~10 match arms to `typed_data_from_raw()` and `TypedEventData` enum |
| **Turn Reconstruction** | `turns/mod.rs` | Extend 3 match arms, add intent tracking hashmap |
| **Conversation Model** | `conversation.rs` | Add ~5 fields to `ConversationTurn`, ~2 to `TurnToolCall` |
| **Tauri Bindings** | `lib.rs`, `build.rs` | Add 2 new commands (`get_tool_result`, `get_rewind_snapshots`), register in `generate_handler![]` and `build.rs` `.commands()` |
| **TypeScript Types** | `packages/types/src/index.ts` | Mirror new Rust struct fields |
| **Client Wrappers** | `packages/client/src/index.ts` | Add `invoke()` wrappers for new Tauri commands |
| **Frontend Components** | `ConversationTab.vue`, `ToolCallItem.vue`, `ToolCallDetail.vue` | Add reasoning display, intention summaries, tool result previews, timeline markers |
| **Rust Tests** | `turns/mod.rs` tests, `events.rs` tests | Add test coverage for new fields, polymorphic result handling |

---

## 9. Risks and Considerations

### 9.1 Tool Result Size

Tool results (`result.content`, `result.detailedContent`) can be extremely large (100KB+ for file views, command outputs). **Recommendation:** Store a truncated preview in `TurnToolCall` (first 500 chars) and provide a separate on-demand endpoint for full content.

### 9.2 Reasoning Text Privacy

`reasoningText` contains the model's unfiltered thought process, which may include references to user code, business logic, or sensitive patterns. Ensure the same privacy/redaction considerations apply as to assistant messages.

### 9.3 Backward Compatibility

Not all sessions will have the new fields (older CLI versions, sessions without extended thinking). All new fields should be `Option<T>` and the frontend must handle `None`/`undefined` gracefully.

### 9.4 Schema Evolution

The CLI schema is evolving rapidly (~4 releases/week). The `assistant.usage` event type could start appearing in persisted data at any time, providing per-call token breakdowns. Design the typed data enum to be extensible — the existing `Unknown(String)` catch-all is the right pattern.

### 9.5 `result` Field is Polymorphic (Critical)

The `tool.execution_complete.data.result` field is NOT always a JSON object with `.content`/`.detailedContent`. Existing test data (`events.rs:203`) shows it can be a **plain string**: `"result":"file contents"`. The implementation MUST handle both forms:

```rust
match &data.result {
    Some(Value::String(s)) => { tool_call.result_content = Some(truncate(s, 1024)); }
    Some(Value::Object(obj)) => {
        if let Some(c) = obj.get("content").and_then(|v| v.as_str()) {
            tool_call.result_content = Some(truncate(c, 1024));
        }
    }
    _ => {}
}
```

Missing this would cause silent data loss for simple tool results.

---

## 10. Multi-Model Review — Consolidated Findings

The report was independently reviewed by **Claude Opus 4.6**, **GPT 5.4**, **GPT 5.3 Codex**, and **Gemini 3 Pro**. Below is a synthesis of their feedback.

### 10.1 Universal Consensus (All 4 Models Agree)

**1. Tool result data MUST be lazy-loaded, not eagerly embedded.**
All reviewers flagged `detailedContent` (up to 100KB+ per tool call, 946 occurrences per session) as a memory/performance bomb if added to `TurnToolCall`. The unanimous recommendation:
- Store a **truncated preview** (≤1KB) in `TurnToolCall.result_content`
- Create a dedicated **`get_tool_result(session_id, tool_call_id)`** Tauri command for full content on demand
- Frontend: show preview + "Show Full Output" button

**2. Report factual claims are validated.**
All reviewers confirmed:
- 11/24 event types with typed structs ✓
- 9+ fields parsed but dropped in turn reconstruction ✓
- 13 event types falling through to `Other(Value)` ✓
- `reasoningText` missing from `AssistantMessageData` ✓
- Rewind snapshots parsed but not exposed ✓

**3. `reasoningText` should be opt-in/collapsible, not default-visible.**
Privacy and verbosity concerns: reasoning can be thousands of tokens and may contain sensitive logic. Show as a collapsible block, default collapsed, with a "💭 Reasoning" toggle.

### 10.2 Corrections to Original Report

| Issue | Source | Correction |
|---|---|---|
| **§5.3 "Checkpoint content only index parsed"** | Codex 5.3, GPT 5.4 | **INCORRECT.** `parse_checkpoints()` already loads `.md` content into `CheckpointEntry.content`, and `get_session_checkpoints` exposes it with 50KB truncation. Remove from P2 matrix. |
| **§7.2 Step 3 assumes `result` is always an object** | Opus 4.6 | **BUG.** Real data shows `result` can be a plain string. Must handle both polymorphic forms (see §9.5 above). |
| **§7.1 Step 3 "first non-empty reasoning per turn"** | Opus 4.6 | **DATA LOSS.** Turns can have multiple `assistant.message` events with distinct reasoning. Use `Vec<String>` for `reasoning_texts` (parallel to `assistant_messages`), not first-wins. |
| **Overstatement of "missingness"** | GPT 5.4 | Raw `data` is already sent to frontend via `get_session_events()`. Fields are missing from the **turn model/UI**, not from the backend entirely. |
| **Implementation guide incomplete** | GPT 5.4, Codex 5.3 | Must also update: Rust tests, `packages/client` invoke wrappers, `ToolCallItem.vue`, `ToolCallDetail.vue`, `build.rs` for new commands. |

### 10.3 Revised Priority Matrix (Post-Review)

| Priority | Item | Original | Change | Rationale |
|---|---|---|---|---|
| **P0** | `intentionSummary` on tool calls | P0 | ✅ Keep | Universal agreement — highest UX impact per effort |
| **P0** | Tool `result_content` (preview, ≤1KB) | P0 | ✅ Keep (truncated only) | Essential for conversation replay |
| **P0** | `session.error` typed struct | P1 | ⬆ **Promoted** | Feeds existing health scoring. Opus + GPT 5.4 agree |
| **P0** | `reasoningText` (collapsible, opt-in) | P0 | ⚠ Keep with caveats | High value but must be opt-in/collapsed |
| **P1** | `output_tokens` on turns | P0 | ⬇ Demoted | GPT 5.4: only P0 if cost UI is ready |
| **P1** | `session.model_change` typed struct | P1 | ✅ Keep | Timeline markers |
| **P1** | `session.resume` typed struct | P1 | ✅ Keep | Session lineage |
| **P1** | `session.compaction_complete` typed struct | P1 | ✅ Keep | Context window analysis |
| **P1** | `transformed_content` on user messages | P1 | ✅ Keep | Toggle "as typed" vs "as sent to LLM" |
| **P1** | Tool `result_detailed` (full, lazy) | P0 | ⬇ **Demoted** | Must be lazy-loaded, not eager |
| **P2** | Rewind snapshots via Tauri | P1 | ⬇ Demoted | Opus: no frontend consumer yet |
| **P2** | `abort` typed struct | P3 | ⬆ **Promoted** | Opus: abort reason feeds health scoring |
| **P2** | `attachments` on user messages | P2 | ✅ Keep | |
| **P2** | `toolTelemetry` structured parsing | P2 | ✅ Keep | |
| **~~P2~~** | ~~Checkpoint full content exposure~~ | ~~P2~~ | ❌ **Removed** | Already implemented |
| **P3** | `reasoningOpaque` | P3 | ⬇ Skip for now | Gemini: don't propagate to UI model |

### 10.4 Additional Recommendations (From Reviewers)

#### Architecture — Session-Level Caching (GPT 5.4, Codex 5.3)
`get_session_detail`, `get_session_turns`, `get_session_events`, and `get_shutdown_metrics` all currently reparse `events.jsonl` independently. Add a Tauri-side **LRU cache** keyed by `sessionId + events.jsonl mtime` to avoid redundant parsing.

#### Architecture — Two-Tier Turn Loading (Opus 4.6)
Consider splitting turn loading:
- `loadTurnsSummary()` — lightweight (no reasoning/results) for list view
- `loadTurnFull(turnIndex)` — full content for detail/expanded view

#### Architecture — HashMap for Tool Call Lookup (Codex 5.3)
Replace repeated reverse `Vec` scans in `reconstruct_turns()` with a `HashMap<String, (usize, usize)>` mapping `tool_call_id → (turn_index, tool_call_index)` for O(1) lookups.

#### Gap — `assistant.usage` Event (Opus 4.6)
Pre-build the typed struct now so it's ready when this appears in persisted data. It provides per-API-call token/cost breakdowns — far more granular than session-level `shutdownMetrics`.

#### Gap — `SessionStartData` Fields Not Surfaced (GPT 5.4)
`head_commit`, `base_commit`, `reasoning_effort`, `copilot_version`, `already_in_use` are parsed but never included in `SessionSummary` or sent to frontend. These would enrich the session detail view.

#### Gap — Compaction Duration (Gemini)
Capture `session.compaction_start` timestamps too (not just `complete`) to calculate compaction duration — a potential performance bottleneck indicator.

#### UX Recommendations (Consolidated)

| Data | UX Pattern |
|---|---|
| `reasoningText` | Collapsible block above assistant message, dimmed monospace text. Default collapsed. "💭 Reasoning (N chars)" toggle. |
| `intentionSummary` | Inline subtitle under tool call name, replacing `formatArgsSummary`. Fall back to args when `None`. |
| `result_content` | Expandable result panel in `ToolCallDetail`. Show 2-line preview, expand on click. Syntax highlight if file content. |
| `output_tokens` | Badge next to model badge: "🎯 236 tokens". Aggregate in stats. |
| `transformed_content` | Toggle on user message: "Show as sent to LLM" / "Show original". Hidden by default. |
| Model changes | Timeline marker: "🔄 Model changed: opus-4.6 → gpt-5.4" |
| Errors | Red error banner with type/message, collapsible stack trace |
| Compaction | Inline marker: "⚠️ Compaction: 104K → 52K tokens (checkpoint #1)" |

---

## Appendix A: Field Frequency Analysis (10 Sessions Sampled)

| Field | Min Occurrences | Max Occurrences | Present In |
|---|---|---|---|
| `reasoningText` | 2 | 134 | 10/10 sessions |
| `intentionSummary` | 2 | 448 | 8/10 sessions |
| `detailedContent` | 7 | 946 | 10/10 sessions |
| `toolTelemetry` | 7 | 276 | 10/10 sessions |
| `transformedContent` | 1 | 4 | 10/10 sessions |
| `reasoningEffort` | 1 | 1 | 4/10 sessions |
| `summaryContent` | 1 | 2 | 6/10 sessions |
| `compactionTokensUsed` | 1 | 2 | 6/10 sessions |
| `newModel` | 1 | 1 | 2/10 sessions |
| `infoType` | 1 | 1 | 2/10 sessions |
| `operation` (plan) | 1 | 13 | 6/10 sessions |
| `source` | 1 | 10 | 10/10 sessions |

## Appendix B: Complete Data Flow Diagram

```
events.jsonl (raw JSONL)
    │
    ▼
RawEvent { type, data: Value, id, timestamp, parentId }
    │
    ▼ parse_typed_events()
TypedEvent { raw, event_type: Enum, typed_data: TypedEventData }
    │
    ├─► 11 typed structs (SessionStart, Shutdown, UserMessage, etc.)
    │   └─► MISSING: reasoningText, reasoningOpaque, intentionSummary, phase
    │
    └─► 13 event types → TypedEventData::Other(Value)
        └─► MISSING: CompactionComplete, ModelChange, Error, Resume, etc.
    │
    ▼ reconstruct_turns()
ConversationTurn { user_message, assistant_messages, tool_calls, ... }
    │
    ├─► DROPPED: output_tokens, tool_requests, message_id, result,
    │            tool_telemetry, transformed_content, attachments, source
    │
    ▼ Tauri IPC (serde → JSON)
Frontend ConversationTurn (TypeScript)
    │                                       ┌──────────────────────┐
    ▼                                       │ get_tool_result()    │◄─ lazy on demand
Rendered UI                                 │ get_rewind_snapshots │
  MISSING: reasoning, intentions,           └──────────────────────┘
  results, token counts, markers
```
