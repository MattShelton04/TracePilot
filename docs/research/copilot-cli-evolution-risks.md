# Copilot CLI Evolution Risks & Adaptation Strategies

> **Research Date:** 2026-03-14
> **CLI Versions Analyzed:** 0.0.328 through 1.0.5 (95 releases, 168 days)
> **Data Sources:** Changelog analysis, official JSON schemas across 6 installed versions (0.0.410, 0.0.422, 1.0.2, 1.0.3, 1.0.4, 1.0.5), live session data from 74 sessions, git history

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [How Session State Is Written](#2-how-session-state-is-written)
3. [Event Types: Complete Catalog & Growth Trajectory](#3-event-types-complete-catalog--growth-trajectory)
4. [Schema Evolution Evidence](#4-schema-evolution-evidence)
5. [Release Cadence & Versioning](#5-release-cadence--versioning)
6. [Risk Assessment](#6-risk-assessment)
7. [Adaptation Strategies](#7-adaptation-strategies)
8. [Testing Strategy](#8-testing-strategy)
9. [CI/CD Integration](#9-cicd-integration)
10. [Appendix: Raw Data](#appendix-raw-data)

---

## 1. Executive Summary

GitHub Copilot CLI is one of the **fastest-iterating developer tools** currently in production, averaging **4 releases per week** with an average gap of 1.8 days between releases. The session data format has evolved significantly—from 41 event types in v0.0.410 to **62 event types in v1.0.5**—with new types being added in roughly every major version bump.

**Critical finding:** The CLI ships an **official JSON Schema** at `~/.copilot/pkg/universal/{version}/schemas/session-events.schema.json` that formally defines every event type. This schema is our most reliable contract and should be the cornerstone of TracePilot's compatibility strategy.

**Key risks:**
- New event types appear frequently (18 added in a single version jump)
- Context fields were expanded in v1.0.4 (`headCommit`, `baseCommit`, `hostType`)
- The schema enforces `additionalProperties: false` on all 62 event variants — meaning strict parsing will break on schema changes
- No formal deprecation process exists; event types are only added, never removed (so far)
- The `version` field in `session.start.data` has been stuck at `1` across all observed versions — it's not being incremented with schema changes

**Good news:**
- The core envelope (`id`, `timestamp`, `parentId`, `type`, `data`) has never changed
- The schema file itself is the versioning mechanism — it ships with every CLI version
- Additive changes (new event types, new optional fields) are the norm
- No event types have ever been removed

---

## 2. How Session State Is Written

### 2.1 Directory Structure

Each session creates a directory at `~/.copilot/session-state/{UUID}/`:

```
{UUID}/
├── workspace.yaml              # Session metadata (ALWAYS present)
├── events.jsonl                # Event log (69% of sessions)
├── session.db                  # SQLite database (47% of sessions)
├── plan.md                     # Plan mode artifact (32% of sessions)
├── vscode.metadata.json        # VS Code integration (65% of sessions)
├── checkpoints/                # Compaction summaries (ALWAYS present)
│   ├── index.md
│   └── 001-{slug}.md
├── files/                      # Session workspace files (ALWAYS present)
├── research/                   # Research artifacts (84% of sessions)
└── rewind-snapshots/           # Rewind state (61% of sessions)
    └── index.json
```

### 2.2 workspace.yaml

The primary metadata file. Always present. Schema varies based on whether the session was started in a git repository:

**In a git repo:**
```yaml
id: c86fe369-c858-4d91-81da-203c5e276e33
cwd: C:\git\Portify
git_root: C:\git\Portify
repository: MattShelton04/Portify
host_type: github                          # Added ~v1.0.4
branch: Matt/Playwright_CLI_Setup
summary: "Playwright Usability Review And Documentation"
summary_count: 2
created_at: 2026-03-12T05:43:25.270Z
updated_at: 2026-03-12T06:52:57.136Z
```

**Outside a git repo:**
```yaml
id: a2ce0859-ccf5-4d9a-92d0-9868fbb48fbd
cwd: C:\git\prototype
summary_count: 0
created_at: 2026-03-14T04:53:29.045Z
updated_at: 2026-03-14T04:53:29.045Z
```

**Key observations:**
- `git_root`, `repository`, `branch`, `host_type` are **conditionally present** (only in git repos)
- `summary` is **absent** for short-lived or abandoned sessions
- `summary_count` is always present (even when 0)
- Field order is not guaranteed (varies across sessions)
- **No schema version field** in workspace.yaml itself

### 2.3 events.jsonl

Line-delimited JSON. Every event shares a common envelope:

```json
{
  "type": "event.type.name",
  "data": { /* event-specific payload */ },
  "id": "uuid-v4",
  "timestamp": "ISO-8601",
  "parentId": "uuid-of-parent | null"
}
```

Some events also include:
- `"ephemeral": true` — transient events not persisted to disk (defined in schema but rarely seen in stored events)

**The `version` field** appears in `session.start.data.version` and has been `1` across all observed sessions (from v0.0.409 through v1.0.5). This field is described in the schema as "Schema version number for the session event format" but has never been incremented.

### 2.4 session.db

Per-session SQLite database. Always includes the standard tables:

```sql
CREATE TABLE todos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','done','blocked')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE todo_deps (
    todo_id TEXT NOT NULL,
    depends_on TEXT NOT NULL,
    PRIMARY KEY (todo_id, depends_on),
    FOREIGN KEY (todo_id) REFERENCES todos(id),
    FOREIGN KEY (depends_on) REFERENCES todos(id)
);
```

**Custom tables** may also exist — the agent can create arbitrary tables during a session (e.g., `review_findings`, `bugs`, `test_cases`, `csv_data`). These are **unpredictable in schema**.

### 2.5 rewind-snapshots/index.json

Versioned format with stable structure:

```json
{
  "version": 1,
  "snapshots": [
    {
      "snapshotId": "uuid",
      "eventId": "uuid",
      "userMessage": "full user prompt text",
      "timestamp": "ISO-8601",
      "fileCount": 0,
      "gitCommit": "sha",
      "gitBranch": "branch-name",
      "backupHashes": [],
      "files": {}
    }
  ],
  "filePathMap": {}
}
```

This is the **only file with an explicit version field** at the format level. It has been `1` across all observed sessions.

### 2.6 checkpoints/

Markdown files created during context compaction:
- `checkpoints/index.md` — chronological listing of checkpoints
- `checkpoints/001-{slug}.md` — full checkpoint with `<overview>`, `<history>` sections

These are free-form markdown and less likely to break parsers.

---

## 3. Event Types: Complete Catalog & Growth Trajectory

### 3.1 Official Schema: 62 Event Types (v1.0.5)

The CLI ships a JSON Schema at `~/.copilot/pkg/universal/{version}/schemas/session-events.schema.json`. This defines the `SessionEvent` type as an `anyOf` union of all event variants:

| # | Event Type | Category | Key Data Fields | Observed in Live Data |
|---|---|---|---|---|
| 1 | `session.start` | Session | sessionId, version, producer, copilotVersion, startTime, selectedModel, reasoningEffort, context, alreadyInUse | ✅ (53 occurrences) |
| 2 | `session.resume` | Session | resumeTime, eventCount, selectedModel, reasoningEffort, context, alreadyInUse | ✅ (4) |
| 3 | `session.error` | Session | errorType, message, stack, statusCode, providerCallId | ✅ (5) |
| 4 | `session.idle` | Session | backgroundTasks | ❌ (ephemeral) |
| 5 | `session.title_changed` | Session | title | ❌ (ephemeral) |
| 6 | `session.info` | Session | infoType, message | ✅ (33) |
| 7 | `session.warning` | Session | warningType, message | ❌ |
| 8 | `session.model_change` | Session | previousModel, newModel, previousReasoningEffort, reasoningEffort | ✅ (33) |
| 9 | `session.mode_changed` | Session | previousMode, newMode | ❌ |
| 10 | `session.plan_changed` | Session | operation | ✅ (40) |
| 11 | `session.workspace_file_changed` | Session | path, operation | ✅ (2) |
| 12 | `session.import_legacy` | Session | legacySession, importTime, sourceFile | ❌ |
| 13 | `session.handoff` | Session | handoffTime, sourceType, repository, context, summary, remoteSessionId | ❌ |
| 14 | `session.truncation` | Session | tokenLimit, pre/postTruncationTokens/Messages, performedBy | ❌ |
| 15 | `session.snapshot_rewind` | Session | upToEventId, eventsRemoved | ❌ |
| 16 | `session.shutdown` | Session | shutdownType, errorReason, totalPremiumRequests, totalApiDurationMs, sessionStartTime, codeChanges, modelMetrics, currentModel | ✅ (44) |
| 17 | `session.context_changed` | Session | cwd, gitRoot, repository, hostType, branch, headCommit, baseCommit | ✅ (11) |
| 18 | `session.usage_info` | Session | tokenLimit, currentTokens, messagesLength | ❌ |
| 19 | `session.compaction_start` | Session | *(empty data)* | ✅ (81) |
| 20 | `session.compaction_complete` | Session | success, error, pre/postCompactionTokens, summaryContent, checkpointNumber, checkpointPath, compactionTokensUsed, requestId | ✅ (81) |
| 21 | `session.task_complete` | Session | summary | ❌ |
| 22 | `session.tools_updated` | Session | model | ❌ (new in v1.0.4) |
| 23 | `session.background_tasks_changed` | Session | *(empty data)* | ❌ (new in v1.0.4) |
| 24 | `user.message` | User | content, transformedContent, attachments, source, agentMode, interactionId | ✅ (491) |
| 25 | `pending_messages.modified` | User | *(empty data)* | ❌ |
| 26 | `assistant.turn_start` | Assistant | turnId, interactionId | ✅ (7977) |
| 27 | `assistant.intent` | Assistant | intent | ❌ (ephemeral) |
| 28 | `assistant.reasoning` | Assistant | reasoningId, content | ❌ |
| 29 | `assistant.reasoning_delta` | Assistant | reasoningId, deltaContent | ❌ (ephemeral) |
| 30 | `assistant.streaming_delta` | Assistant | totalResponseSizeBytes | ❌ (ephemeral) |
| 31 | `assistant.message` | Assistant | messageId, content, toolRequests, reasoningOpaque, reasoningText, encryptedContent, phase, outputTokens, interactionId, parentToolCallId | ✅ (20875) |
| 32 | `assistant.message_delta` | Assistant | messageId, deltaContent, parentToolCallId | ❌ (ephemeral) |
| 33 | `assistant.turn_end` | Assistant | turnId | ✅ (7963) |
| 34 | `assistant.usage` | Assistant | model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cost, duration, initiator, apiCallId, providerCallId, parentToolCallId, quotaSnapshots, copilotUsage, reasoningEffort | ❌ |
| 35 | `abort` | Control | reason | ✅ (28) |
| 36 | `tool.user_requested` | Tool | toolCallId, toolName, arguments | ✅ (4) |
| 37 | `tool.execution_start` | Tool | toolCallId, toolName, arguments, mcpServerName, mcpToolName, parentToolCallId | ✅ (44380) |
| 38 | `tool.execution_partial_result` | Tool | toolCallId, partialOutput | ❌ |
| 39 | `tool.execution_progress` | Tool | toolCallId, progressMessage | ❌ |
| 40 | `tool.execution_complete` | Tool | toolCallId, success, model, interactionId, isUserRequested, result, error, toolTelemetry, parentToolCallId | ✅ (44372) |
| 41 | `skill.invoked` | Skill | name, path, content, allowedTools, pluginName, pluginVersion | ✅ (17) |
| 42 | `subagent.started` | Subagent | toolCallId, agentName, agentDisplayName, agentDescription | ✅ (1020) |
| 43 | `subagent.completed` | Subagent | toolCallId, agentName, agentDisplayName | ✅ (1001) |
| 44 | `subagent.failed` | Subagent | toolCallId, agentName, agentDisplayName, error | ✅ (6) |
| 45 | `subagent.selected` | Subagent | agentName, agentDisplayName, tools | ❌ |
| 46 | `subagent.deselected` | Subagent | *(empty data)* | ❌ |
| 47 | `hook.start` | Hook | hookInvocationId, hookType, input | ❌ |
| 48 | `hook.end` | Hook | hookInvocationId, hookType, output, success, error | ❌ |
| 49 | `system.message` | System | content, role, name, metadata | ❌ |
| 50 | `system.notification` | System | content, kind | ✅ (257) |
| 51 | `permission.requested` | Permission | requestId, permissionRequest | ❌ (ephemeral) |
| 52 | `permission.completed` | Permission | requestId, result | ❌ (ephemeral) |
| 53 | `user_input.requested` | Input | requestId, question, choices, allowFreeform, toolCallId | ❌ |
| 54 | `user_input.completed` | Input | requestId | ❌ |
| 55 | `elicitation.requested` | Input | requestId, message, mode, requestedSchema | ❌ |
| 56 | `elicitation.completed` | Input | requestId | ❌ |
| 57 | `external_tool.requested` | External | requestId, sessionId, toolCallId, toolName, arguments, traceparent, tracestate | ❌ |
| 58 | `external_tool.completed` | External | requestId | ❌ |
| 59 | `command.queued` | Command | requestId, command | ❌ |
| 60 | `command.completed` | Command | requestId | ❌ |
| 61 | `exit_plan_mode.requested` | Plan | requestId, summary, planContent, actions, recommendedAction | ❌ |
| 62 | `exit_plan_mode.completed` | Plan | requestId | ❌ |

### 3.2 Event Type Growth Over Time

| CLI Version | Date | Event Types | Delta | Notable Additions |
|---|---|---|---|---|
| v0.0.410 | 2026-02-14 | 41 | — | Initial schema with core types |
| v0.0.422 | 2026-03-05 | 59 | **+18** | permission.*, elicitation.*, external_tool.*, command.*, exit_plan_mode.*, session.mode_changed, session.plan_changed, session.task_complete, session.workspace_file_changed, subagent.deselected, assistant.streaming_delta |
| v1.0.2 | 2026-03-06 | 59 | 0 | No event type changes |
| v1.0.3 | 2026-03-09 | 60 | **+1** | system.notification |
| v1.0.4 | 2026-03-11 | 62 | **+2** | session.background_tasks_changed, session.tools_updated |
| v1.0.5 | 2026-03-13 | 62 | 0 | No event type changes |

**Growth rate:** ~0.12 new event types per release, but bursty — sometimes 18 in one release, sometimes 0.

### 3.3 Event Types Observed vs. Schema-Defined

Of 62 schema-defined types, **24 have been observed** in live session data (39%). Many events are ephemeral (not persisted to disk) or represent rare interactions (legacy imports, external tools, etc.).

**Most common events by volume:**
1. `tool.execution_start` — 44,380 occurrences
2. `tool.execution_complete` — 44,372
3. `assistant.message` — 20,875
4. `assistant.turn_start` — 7,977
5. `assistant.turn_end` — 7,963

---

## 4. Schema Evolution Evidence

### 4.1 The Official Schema File

**Location:** `~/.copilot/pkg/universal/{version}/schemas/session-events.schema.json`

This is a **JSON Schema (2019-09 draft)** file that ships with every CLI version. It defines:
- The `SessionEvent` type as an `anyOf` discriminated union
- All 62 event variants with full property definitions
- `additionalProperties: false` on every variant (strict mode)
- Required fields: `id`, `timestamp`, `parentId`, `type`, `data` (on all variants)

**This schema is our most reliable compatibility contract.**

### 4.2 Concrete Field Changes Observed

#### `session.start.data.context` field additions (v1.0.4):
```
Before v1.0.4: ['branch', 'cwd', 'gitRoot', 'repository']
After  v1.0.4: ['baseCommit', 'branch', 'cwd', 'gitRoot', 'headCommit', 'hostType', 'repository']
```

New fields: `baseCommit`, `headCommit`, `hostType` (to support Azure DevOps repository identification, per changelog v0.0.422).

#### `session.shutdown.data` — Stable:
Fields have been identical across all 6 analyzed versions:
```
['codeChanges', 'currentModel', 'errorReason', 'modelMetrics',
 'sessionStartTime', 'shutdownType', 'totalApiDurationMs', 'totalPremiumRequests']
```

#### `workspace.yaml` — Added `host_type` field (observed from ~v1.0.4+)

### 4.3 The Session Logging Format Overhaul (v0.0.342)

The **most significant breaking change** occurred in v0.0.342 (2025-10-15):

> "Overhauled our session logging format: Introduced a new session logging format that decouples how we store sessions from how we display them in the timeline. The new format is cleaner, more concise, and scalable. New sessions are stored in `~/.copilot/session-state`. Legacy sessions are stored in `~/.copilot/history-session-state`."

This was a **full format migration**. All sessions created before v0.0.342 use a completely different format in a different directory. TracePilot should only target the new format (`session-state/`).

### 4.4 Versioning Mechanisms (or Lack Thereof)

| Mechanism | Status | Notes |
|---|---|---|
| `session.start.data.version` | Always `1` | Defined as "Schema version number" but never incremented |
| `rewind-snapshots/index.json.version` | Always `1` | The only file-level version field |
| `copilotVersion` in `session.start` | Tracks CLI version | e.g., "1.0.5" — most reliable version indicator |
| JSON Schema file | Ships per version | Machine-readable contract, best source of truth |
| `workspace.yaml` | No version field | Schema varies by context (git vs non-git) |
| `session.db` | No version field | Standard tables + arbitrary custom tables |

**Critical observation:** The `session.start.data.version: 1` field is the intended versioning mechanism but has never been incremented despite significant schema changes (18 new event types, new context fields). This means **it cannot be relied upon** for forward compatibility detection. Use `copilotVersion` instead.

---

## 5. Release Cadence & Versioning

### 5.1 Release Statistics

| Metric | Value |
|---|---|
| Total releases tracked | 95 (v0.0.328 through v1.0.5) |
| Time span | 168 days (Sep 26, 2025 — Mar 13, 2026) |
| Average releases per week | **4.0** |
| Minimum gap between releases | 0 days (same-day releases) |
| Maximum gap between releases | 11 days |
| Average gap | 1.8 days |

### 5.2 Monthly Distribution

| Month | Releases |
|---|---|
| 2025-09 | 3 |
| 2025-10 | 23 |
| 2025-11 | 11 |
| 2025-12 | 8 |
| 2026-01 | 23 |
| 2026-02 | 20 |
| 2026-03 | 7 (partial) |

### 5.3 Version Numbering

The CLI jumped from `0.0.423` to `1.0.2` on 2026-03-06 (GA release). The `1.0.x` versions increment the patch version. There is no published SemVer guarantee.

### 5.4 Schema Changes Per Release

Not every release changes the event schema. Based on the 6 versions with installed schemas:

- Schema-changing releases: **3 out of 6** (50%)
- Schema-stable releases: **3 out of 6** (50%)

**But**: the sample is biased toward recent versions. The 0.0.410→0.0.422 jump (which added 18 types) spans 12 intermediate releases, so the per-release change rate is lower.

---

## 6. Risk Assessment

### 6.1 Risk Matrix

| Risk | Likelihood | Impact | Mitigation Difficulty | Priority |
|---|---|---|---|---|
| **New event types added** | Very High (every few weeks) | Low (if handled gracefully) | Low | **P0** |
| **New fields on existing event types** | High (seen in v1.0.4) | Medium (deserialization may fail) | Low | **P0** |
| **workspace.yaml field additions** | Medium | Low | Low | P1 |
| **session.db schema changes** | Low (standard tables unchanged) | Low | Low | P2 |
| **Event type semantics change** | Low | High | High | P1 |
| **Event type removal** | Very Low (never observed) | High | Medium | P2 |
| **Full format overhaul** | Very Low (happened once, v0.0.342) | Critical | Very High | P3 |
| **rewind-snapshots format change** | Low (versioned) | Medium | Low | P2 |
| **New file types in session directory** | Medium | Low (just ignore) | None | P3 |
| **`additionalProperties: false` conflicts** | Medium | High | Medium | **P0** |

### 6.2 Highest-Risk Data Structures

1. **events.jsonl event data payloads** — These change the most. New fields are added to existing events, and new event types appear frequently. The `additionalProperties: false` in the schema suggests the CLI team considers the schema authoritative, but TracePilot should be more permissive.

2. **`session.start.data.context`** — This object grew from 4 to 7 fields between v1.0.3 and v1.0.4. It's likely to grow further as more hosting platforms and VCS features are supported.

3. **`assistant.message.data`** — The richest data payload with 11 fields. New fields like `encryptedContent` and `phase` suggest ongoing extension.

4. **`tool.execution_start.data`** — Added `mcpServerName`, `mcpToolName`, `parentToolCallId` fields over time as MCP and sub-agent features evolved.

### 6.3 Lowest-Risk Data Structures

1. **Event envelope** (`id`, `timestamp`, `parentId`, `type`) — Rock solid, never changed
2. **`session.shutdown.data`** — Identical across all analyzed versions
3. **`session.db` standard tables** — `todos` and `todo_deps` schemas unchanged
4. **`rewind-snapshots/index.json`** — Versioned and stable

### 6.4 What Happens When New Event Types Are Added

Based on observed behavior:
1. New types are **additive only** — no types have ever been removed
2. New types follow the same envelope pattern (`id`, `timestamp`, `parentId`, `type`, `data`)
3. Some new types are **ephemeral** (not persisted to events.jsonl) — these never appear in stored session data
4. New types may appear in existing event trees (new child events under existing parents)

**TracePilot impact:** If the parser encounters an unknown `type` value, it should log a warning and preserve the raw event data without attempting to deserialize the `data` payload into a typed struct.

### 6.5 Deprecation Patterns

There is **no formal deprecation process** observed in the changelog or schema. Changes follow these patterns:

1. **Additive only** — new event types and fields are added, old ones remain
2. **Config renames** — e.g., `launch_messages` → `companyAnnouncements`, `merge_strategy` → `mergeStrategy` (these affect config, not session data)
3. **Feature flags** — new features start behind `--experimental` flag
4. **Legacy migration** — the one format overhaul (v0.0.342) provided a migration path via `--resume`

---

## 7. Adaptation Strategies

### 7.1 Schema Evolution Handling

#### Strategy: Lenient Parsing with Schema-Aware Validation

**DO:**
```rust
// Use #[serde(deny_unknown_fields)] only for the envelope
// Use #[serde(flatten)] with a HashMap catch-all for data payloads

#[derive(Deserialize)]
struct EventEnvelope {
    id: String,
    timestamp: String,
    #[serde(rename = "parentId")]
    parent_id: Option<String>,
    #[serde(rename = "type")]
    event_type: String,
    data: serde_json::Value,  // Keep raw for unknown types
    #[serde(default)]
    ephemeral: Option<bool>,
}
```

**For known event types, parse `data` into typed structs with extra-field tolerance:**
```rust
#[derive(Deserialize)]
#[serde(default)]  // Allow missing fields with defaults
struct SessionStartData {
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    version: Option<u32>,
    producer: Option<String>,
    #[serde(rename = "copilotVersion")]
    copilot_version: Option<String>,
    // ... known fields ...

    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,  // Catch new fields
}
```

**DON'T:**
- Don't use strict deserialization that fails on unknown fields
- Don't hard-code an exhaustive enum of event types
- Don't rely on `session.start.data.version` (it's always 1)

#### Strategy: Forward-Compatible Event Type Handling

```rust
enum KnownEventType {
    SessionStart,
    SessionShutdown,
    UserMessage,
    AssistantMessage,
    ToolExecutionStart,
    ToolExecutionComplete,
    // ... all 62 known types ...
}

enum ParsedEvent {
    Known(KnownEventType, TypedPayload),
    Unknown(String, serde_json::Value),  // Preserve raw data
}
```

### 7.2 Feature Detection vs. Version Checking

**Recommendation: Use feature detection, not version checking.**

The `copilotVersion` in `session.start.data` is available but version checking is brittle because:
- Features don't always align with version numbers
- The 0.0.x → 1.0.x jump was not accompanied by major schema changes
- Backported fixes can appear in any version

**Feature detection approach:**
```rust
fn has_host_type_support(event: &SessionStartEvent) -> bool {
    event.data.context.as_ref()
        .and_then(|ctx| ctx.get("hostType"))
        .is_some()
}

fn has_mcp_tool_info(event: &ToolExecutionStartEvent) -> bool {
    event.data.get("mcpServerName").is_some()
}
```

### 7.3 Schema Diffing Strategy

**Key insight:** The official schema at `~/.copilot/pkg/universal/{version}/schemas/session-events.schema.json` is machine-readable. TracePilot should leverage this:

```rust
// At startup or periodically, load and diff the schema
fn detect_schema_changes(
    known_schema_path: &Path,
    installed_schema_path: &Path,
) -> SchemaChanges {
    let known = load_schema(known_schema_path);
    let installed = load_schema(installed_schema_path);

    SchemaChanges {
        new_event_types: installed.event_types() - known.event_types(),
        removed_event_types: known.event_types() - installed.event_types(),
        modified_events: diff_event_schemas(&known, &installed),
    }
}
```

This allows TracePilot to:
1. Detect new event types automatically
2. Warn when event schemas change
3. Auto-generate placeholder UI for unknown event types

### 7.4 workspace.yaml Handling

```rust
#[derive(Deserialize)]
struct WorkspaceMetadata {
    id: String,
    cwd: String,
    #[serde(default)]
    git_root: Option<String>,
    #[serde(default)]
    repository: Option<String>,
    #[serde(default)]
    host_type: Option<String>,
    #[serde(default)]
    branch: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    summary_count: Option<u32>,
    created_at: String,
    updated_at: String,

    #[serde(flatten)]
    extra: HashMap<String, serde_yaml::Value>,  // Catch new fields
}
```

### 7.5 session.db Handling

```rust
fn discover_tables(conn: &Connection) -> Vec<TableInfo> {
    // Don't assume specific tables exist
    let tables = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .query_map([], |row| row.get::<_, String>(0))
        .collect();

    tables.iter().map(|name| {
        let columns = conn.prepare(&format!("PRAGMA table_info({})", name))
            .query_map([], |row| /* extract column info */)
            .collect();
        TableInfo { name, columns }
    }).collect()
}
```

### 7.6 Handling Unknown Event Types Gracefully

TracePilot should implement a **three-tier rendering strategy**:

1. **Rich rendering** — For well-known event types (user.message, assistant.message, tool.*, session.start/shutdown) with custom UI components
2. **Generic rendering** — For known-but-simple event types (session.info, abort, etc.) with a key-value data display
3. **Raw rendering** — For completely unknown event types, show the type name and raw JSON data payload in a collapsible viewer

```typescript
function renderEvent(event: SessionEvent) {
  if (RICH_RENDERERS[event.type]) {
    return RICH_RENDERERS[event.type](event);
  }
  if (GENERIC_RENDERERS[event.type]) {
    return GENERIC_RENDERERS[event.type](event);
  }
  return <UnknownEventRenderer type={event.type} data={event.data} />;
}
```

---

## 8. Testing Strategy

### 8.1 Schema Snapshot Testing

Maintain a collection of `session-events.schema.json` files from each CLI version and test parsing against all of them:

```
tests/
├── schemas/
│   ├── v0.0.410.schema.json
│   ├── v0.0.422.schema.json
│   ├── v1.0.2.schema.json
│   ├── v1.0.3.schema.json
│   ├── v1.0.4.schema.json
│   └── v1.0.5.schema.json
├── fixtures/
│   ├── session-v0.0.410/
│   │   ├── workspace.yaml
│   │   ├── events.jsonl
│   │   └── ...
│   └── session-v1.0.5/
│       └── ...
└── schema_compat_test.rs
```

**Test cases:**
1. Parse events from older CLI versions with current TracePilot
2. Parse events from newer CLI versions (simulated by adding unknown types)
3. Verify unknown fields don't cause deserialization failures
4. Verify unknown event types are preserved in raw form
5. Test workspace.yaml with missing optional fields

### 8.2 Synthetic Event Generation

Generate test events with unknown types to verify forward compatibility:

```rust
#[test]
fn test_unknown_event_type_preserved() {
    let json = r#"{"type":"session.new_feature","data":{"foo":"bar"},"id":"abc","timestamp":"2026-01-01T00:00:00Z","parentId":null}"#;
    let event = parse_event(json).unwrap();
    assert!(matches!(event, ParsedEvent::Unknown(..)));
    assert_eq!(event.event_type(), "session.new_feature");
}

#[test]
fn test_known_event_with_extra_fields() {
    let json = r#"{"type":"session.start","data":{"sessionId":"x","version":1,"newField":"surprise"},"id":"abc","timestamp":"2026-01-01T00:00:00Z","parentId":null}"#;
    let event = parse_event(json).unwrap();
    // Should parse successfully, preserving the extra field
    assert!(event.has_extra_field("newField"));
}
```

### 8.3 Real Session Data Testing

Maintain a curated set of anonymized real session data covering:
- Different CLI versions (0.0.410, 0.0.422, 1.0.2, 1.0.3, 1.0.4, 1.0.5)
- Git vs non-git sessions
- Sessions with custom DB tables
- Sessions with/without rewind snapshots
- Very short sessions (no events.jsonl)
- Very long sessions (multiple compactions)

### 8.4 Property-Based Testing

Use property-based testing to verify invariants:

```rust
proptest! {
    #[test]
    fn event_round_trips(event_json in arbitrary_event_json()) {
        let parsed = parse_event(&event_json);
        assert!(parsed.is_ok(), "Should never fail on valid JSON with unknown type");
        let serialized = serialize_event(&parsed.unwrap());
        // Verify essential fields preserved
        assert_eq!(parsed.unwrap().id(), deserialized.id());
    }
}
```

---

## 9. CI/CD Integration

### 9.1 Automated Schema Change Detection

Create a CI job that runs on a schedule (daily) to detect CLI updates:

```yaml
# .github/workflows/copilot-cli-schema-watch.yml
name: Copilot CLI Schema Watch
on:
  schedule:
    - cron: '0 6 * * *'  # Daily at 6 AM
  workflow_dispatch:

jobs:
  check-schema:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install latest Copilot CLI
        run: curl -fsSL https://gh.io/copilot-install | bash

      - name: Extract and compare schema
        run: |
          SCHEMA_DIR="$HOME/.copilot/pkg/universal/*/schemas"
          LATEST_SCHEMA=$(ls -t $SCHEMA_DIR/session-events.schema.json | head -1)
          VERSION=$(basename $(dirname $(dirname $LATEST_SCHEMA)))

          # Compare with our known schema
          if ! diff -q "$LATEST_SCHEMA" "tests/schemas/latest.schema.json" > /dev/null 2>&1; then
            echo "::warning::Schema changed in CLI version $VERSION"
            cp "$LATEST_SCHEMA" "tests/schemas/v${VERSION}.schema.json"

            # Generate diff report
            python scripts/schema-diff.py \
              tests/schemas/latest.schema.json \
              "$LATEST_SCHEMA" \
              > schema-diff-report.md

            # Update latest
            cp "$LATEST_SCHEMA" tests/schemas/latest.schema.json
          fi

      - name: Create issue on schema change
        if: steps.check-schema.outputs.changed == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `Copilot CLI schema changed in v${version}`,
              body: diffReport,
              labels: ['schema-change', 'automated']
            });
```

### 9.2 Schema Diff Script

Create a Python script that generates human-readable diffs between schema versions:

```python
# scripts/schema-diff.py
# Compare two session-events.schema.json files
# Output: new event types, removed event types, field changes per event

def diff_schemas(old_path, new_path):
    old = extract_event_types(old_path)
    new = extract_event_types(new_path)

    added = new.keys() - old.keys()
    removed = old.keys() - new.keys()

    for event_type in sorted(new.keys() & old.keys()):
        old_fields = extract_fields(old[event_type])
        new_fields = extract_fields(new[event_type])
        if old_fields != new_fields:
            report_field_changes(event_type, old_fields, new_fields)
```

### 9.3 Changelog Monitoring

Monitor the Copilot CLI changelog for mentions of session format, events, or schema changes:

```yaml
- name: Check changelog for relevant changes
  run: |
    git -C copilot-cli-repo log --oneline -1 -- changelog.md
    grep -i "session\|events\|schema\|format\|events\.jsonl\|workspace" \
      copilot-cli-repo/changelog.md | head -20
```

### 9.4 Compatibility Matrix Testing

Run TracePilot's parser test suite against session data from multiple CLI versions:

```yaml
strategy:
  matrix:
    cli-version: ['0.0.410', '1.0.2', '1.0.3', '1.0.4', '1.0.5', 'latest']
steps:
  - name: Parse test fixtures for ${{ matrix.cli-version }}
    run: cargo test --test schema_compat -- --version ${{ matrix.cli-version }}
```

---

## Appendix: Raw Data

### A.1 Complete Event Envelope Schema (v1.0.5)

Every event includes these fields:
```json
{
  "id": { "type": "string", "format": "uuid", "description": "Unique event identifier (UUID v4)" },
  "timestamp": { "type": "string", "format": "date-time", "description": "ISO 8601 timestamp" },
  "parentId": { "anyOf": [{"type": "string", "format": "uuid"}, {"type": "null"}] },
  "ephemeral": { "type": "boolean", "description": "When true, not persisted to disk" },
  "type": { "type": "string", "const": "<event-type>" },
  "data": { "type": "object", "properties": { ... } }
}
```

Required fields vary by event type but always include `id`, `timestamp`, `parentId`, `type`, `data`.

### A.2 Version → Context Fields Mapping

| CLI Version | `session.start.data.context` fields |
|---|---|
| 0.0.410 — 1.0.3 | `branch`, `cwd`, `gitRoot`, `repository` |
| 1.0.4 — 1.0.5 | `baseCommit`, `branch`, `cwd`, `gitRoot`, `headCommit`, `hostType`, `repository` |

### A.3 workspace.yaml Field Catalog (Observed)

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | UUID string | Yes | Session identifier |
| `cwd` | Path string | Yes | Working directory |
| `git_root` | Path string | No | Only in git repos |
| `repository` | String ("owner/repo") | No | Only in git repos |
| `host_type` | String ("github" \| "ado") | No | Added ~v1.0.4 |
| `branch` | String | No | Only in git repos |
| `summary` | String | No | AI-generated, absent for abandoned sessions |
| `summary_count` | Integer | Yes | 0 if summary never generated |
| `created_at` | ISO 8601 | Yes | |
| `updated_at` | ISO 8601 | Yes | |

### A.4 Schema File Locations

The official session events schema ships with each CLI version:
```
~/.copilot/pkg/universal/{version}/schemas/session-events.schema.json
```

Additionally, an API schema for the CLI's JSON-RPC server:
```
~/.copilot/pkg/universal/{version}/schemas/api.schema.json
```

### A.5 Key Changelog Entries Affecting Session Format

| Version | Date | Impact |
|---|---|---|
| v0.0.334 | 2025-10-03 | Removed on-exit usage stats from persisted session history |
| v0.0.342 | 2025-10-15 | **Major:** Overhauled session logging format, moved to `session-state/` |
| v0.0.374 | 2026-01-02 | Added auto-compaction, checkpoints |
| v0.0.385 | 2026-01-19 | Enabled infinite sessions with compaction checkpoints |
| v0.0.393 | 2026-01-23 | Exposed MCP server/tool names in tool.execution_start events |
| v0.0.399 | 2026-01-29 | Sessions get AI-generated names (summary field) |
| v0.0.410 | 2026-02-14 | Reduced memory growth by evicting transient events after compaction |
| v0.0.422 | 2026-03-05 | Session usage metrics persisted to events.jsonl; Azure DevOps support |
| v1.0.2 | 2026-03-06 | Major version bump (GA) |
| v1.0.4 | 2026-03-11 | OpenTelemetry instrumentation; Azure DevOps repo identification |

---

## Summary of Recommendations

1. **Parse leniently, validate lazily.** Use `serde(flatten)` with `HashMap<String, Value>` catch-alls. Never fail on unknown fields or event types.

2. **Leverage the official schema.** The `session-events.schema.json` file is TracePilot's best contract. Load it at startup to detect changes automatically.

3. **Use `copilotVersion`, not `data.version`.** The version field in session.start is always 1. The CLI version string is the real indicator of capabilities.

4. **Implement three-tier event rendering.** Rich → Generic → Raw fallback for unknown events.

5. **Monitor the schema on CI.** Daily checks for schema changes with auto-generated issues.

6. **Collect schema snapshots.** Archive every version's schema for regression testing.

7. **Expect 2-3 new event types per month.** Plan for this in the architecture — don't hard-code event type lists.

8. **Treat workspace.yaml as fully optional except `id`, `cwd`, `created_at`, `updated_at`.** All other fields are conditional.

9. **Don't assume session.db tables.** Dynamically discover tables and columns.

10. **Watch the changelog RSS/commits** for session-format-related entries.
