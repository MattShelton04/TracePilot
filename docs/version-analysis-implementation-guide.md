# Version Analysis Implementation Guide

> **Purpose:** Step-by-step guide for addressing the coverage gaps and schema changes identified by `tracepilot versions coverage` and the [Copilot Version Analysis Report](./reports/versions/).
>
> **Audience:** TracePilot contributors working on expanding event type support.
>
> **Generated:** 2026-03-18 — Based on Copilot CLI v1.0.7 schema analysis
>
> **Status:** ✅ All 12 event types and 7 missing fields implemented (100% persisted coverage)

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Priority Tiers](#2-priority-tiers)
3. [How to Add a New Event Type (Step-by-Step)](#3-how-to-add-a-new-event-type-step-by-step)
4. [How to Add Missing Fields to Existing Structs](#4-how-to-add-missing-fields-to-existing-structs)
5. [Tier 1: High-Priority Event Types](#5-tier-1-high-priority-event-types)
6. [Tier 2: Medium-Priority Event Types](#6-tier-2-medium-priority-event-types)
7. [Tier 3: Low-Priority / Deferred](#7-tier-3-low-priority--deferred)
8. [Index DB Migration Guide](#8-index-db-migration-guide)
9. [Frontend Update Guide](#9-frontend-update-guide)
10. [Keeping Known-Events Lists in Sync](#10-keeping-known-events-lists-in-sync)
11. [Testing & Validation](#11-testing--validation)
12. [Running the Version Analyzer](#12-running-the-version-analyzer)

---

## 1. Current State

TracePilot handles **36 of 36 persisted event types** (100% coverage). All 12 previously unhandled types and 7 missing fields have been implemented.

### What's already working well

- **Forward-compatible parsing:** `Unknown(String)` catch-all in `SessionEventType` and `Other(Value)` fallback in `TypedEventData` mean new event types never crash the parser.
- **All fields `Option<T>`:** Missing or added fields on existing events don't cause deserialization failures.
- **Health scoring is tolerant:** Unknown events get `Info` severity (0.0 deduction) — they don't reduce session health scores.
- **Frontend is event-type-agnostic:** Timeline views, agent grouping, and tool rendering all operate on pre-processed `ConversationTurn` / `TurnToolCall` structures, not raw event types.

### What this guide addresses

| Category | Count | Impact |
|----------|-------|--------|
| New event types to handle | 12 | Reduce `Unknown` noise, enable new analytics |
| Missing fields on existing structs | 7 | Capture data already in sessions |
| Typing improvements | 2 | Better type safety, no functional change |
| Index DB additions | 2 | Enable version-aware queries in the desktop app |

---

## 2. Priority Tiers

### Tier 1 — High Priority (do first)

These events are either observed in local sessions, affect turn reconstruction, or provide high-value analytics data.

| Event / Change | Why |
|----------------|-----|
| `session.truncation` | Critical analytics — shows context window pressure and lost messages |
| `assistant.reasoning` | Persisted thinking traces, complements existing `reasoning_text` field |
| `system.message` | Reveals system/developer prompts — essential for understanding agent behavior |
| `SessionStartData.selected_model` | Missing field — the model chosen at session creation |
| `session.context_changed` typing | Change from `Value` to `SessionContext` — struct already exists |

### Tier 2 — Medium Priority

These events are diagnostically useful but don't affect core turn reconstruction.

| Event / Change | Why |
|----------------|-----|
| `session.warning` | User-facing warnings (rate limits, MCP failures) |
| `session.mode_changed` | Tracks interactive → plan → autopilot transitions |
| `session.task_complete` | Marks agent task completion in autopilot mode |
| `subagent.selected` / `subagent.deselected` | Custom agent activation tracking |
| `hook.start` / `hook.end` | Hook lifecycle (paired events) |
| `session.handoff` | Cross-session handoff tracking |
| `SessionErrorData.url` | Missing field |
| `SessionInfoData.url` | Missing field |
| `UserMessageData.agent_mode` | Missing field |
| `AssistantMessageData.phase` | Missing field |
| `ToolExecCompleteData.is_user_requested` | Missing field |
| `copilot_version` in index DB | Version-aware filtering in desktop app |

### Tier 3 — Low Priority / Deferred

| Event / Change | Why |
|----------------|-----|
| `session.import_legacy` | Massive nested structure, rarely triggered |
| `system.message` (display) | Displaying system prompts in the UI needs design thought |
| `AssistantMessageData.encrypted_content` | Encrypted reasoning — likely not useful to display |

---

## 3. How to Add a New Event Type (Step-by-Step)

This is the canonical recipe for adding typed support for any new event type. Every step includes the exact file and location.

### Step 1: Define the data struct

**File:** `crates/tracepilot-core/src/models/event_types.rs`

Add a new struct following these conventions:
- All fields `Option<T>` (forward compatibility — new optional fields won't break deserialization)
- `#[derive(Debug, Clone, Serialize, Deserialize)]`
- `#[serde(rename_all = "camelCase")]`
- Place it near related structs (session structs together, assistant structs together, etc.)

```rust
/// Data for `session.truncation` events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTruncationData {
    pub token_limit: Option<u64>,
    pub pre_truncation_tokens_in_messages: Option<u64>,
    pub pre_truncation_messages_length: Option<u64>,
    pub post_truncation_tokens_in_messages: Option<u64>,
    pub post_truncation_messages_length: Option<u64>,
    pub tokens_removed_during_truncation: Option<u64>,
    pub messages_removed_during_truncation: Option<u64>,
    pub performed_by: Option<String>,
}
```

### Step 2: Add the enum variant to `SessionEventType`

**File:** `crates/tracepilot-core/src/models/event_types.rs` (lines 36–88)

Add the new variant with its `#[strum(serialize)]` attribute matching the exact wire name from the schema:

```rust
#[strum(serialize = "session.truncation")]
SessionTruncation,
```

**Placement:** Group with related variants (e.g., session events near other `Session*` variants).

### Step 3: Add the wire name to `KNOWN_EVENT_TYPES`

**File:** `crates/tracepilot-core/src/models/event_types.rs` (lines 92–117)

```rust
pub const KNOWN_EVENT_TYPES: &[&str] = &[
    // ... existing entries ...
    "session.truncation",  // ← add here
];
```

### Step 4: Add the `TypedEventData` variant

**File:** `crates/tracepilot-core/src/parsing/events.rs` (lines 63–88)

```rust
pub enum TypedEventData {
    // ... existing variants ...
    SessionTruncation(SessionTruncationData),
    // Other(Value) must remain last
    Other(Value),
}
```

### Step 5: Add the parsing arm in `typed_data_from_raw()`

**File:** `crates/tracepilot-core/src/parsing/events.rs` (inside `typed_data_from_raw()`, lines 145–246)

Add before the `Unknown(_)` catch-all arm:

```rust
SessionEventType::SessionTruncation => {
    try_deser!(SessionTruncation, SessionTruncationData, "session.truncation", data)
}
```

The `try_deser!` macro (defined at line 150) handles the happy path (typed variant) and error path (`Other(Value)` + `DeserializationFailed` warning) automatically.

### Step 6: Handle in turn reconstruction (if applicable)

**File:** `crates/tracepilot-core/src/turns/mod.rs` (inside `TurnReconstructor::process()`)

If the event affects turn state, add a match arm. If not, it falls through to `_ => {}` silently — which is fine for display-only events.

```rust
// Example: truncation events don't directly affect turn state
// but could be added as metadata on the current turn
(SessionEventType::SessionTruncation, TypedEventData::SessionTruncation(data)) => {
    // Option A: Annotate the current turn with truncation info
    // Option B: Leave as _ => {} (the event is still available in raw events view)
}
```

### Step 7: Update known-events lists (3 locations!)

These **must** stay in sync:

1. **Rust:** `KNOWN_EVENT_TYPES` in `crates/tracepilot-core/src/models/event_types.rs`
2. **TypeScript (types):** `TRACEPILOT_KNOWN_EVENTS` in `packages/types/src/known-events.ts`
3. **TypeScript (CLI):** `TRACEPILOT_KNOWN_EVENTS` in `apps/cli/src/lib/version-analyzer.ts`

### Step 8: Add tests

**File:** Add tests inside `#[cfg(test)] mod tests` blocks in the relevant source files. Parsing tests go in `crates/tracepilot-core/src/parsing/events.rs` and turn reconstruction tests go in `crates/tracepilot-core/src/turns/mod.rs`.

```rust
#[test]
fn test_session_truncation_parsing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    std::fs::write(&path, r#"{"type":"session.truncation","id":"evt-1","timestamp":"2026-01-01T00:00:00Z",
        "data":{"tokenLimit":128000,"preTruncationTokensInMessages":130000,
        "preTruncationMessagesLength":50,"postTruncationTokensInMessages":100000,
        "postTruncationMessagesLength":35,"tokensRemovedDuringTruncation":30000,
        "messagesRemovedDuringTruncation":15,"performedBy":"BasicTruncator"}}"#).unwrap();
    
    let events = parse_typed_events(&path);
    assert_eq!(events.events.len(), 1);
    match &events.events[0].typed_data {
        TypedEventData::SessionTruncation(data) => {
            assert_eq!(data.token_limit, Some(128000));
            assert_eq!(data.messages_removed_during_truncation, Some(15));
        }
        _ => panic!("Expected SessionTruncation"),
    }
}
```

### Step 9: Verify

```bash
# Run Rust tests
cargo test -p tracepilot-core

# Check TypeScript types
pnpm --filter @tracepilot/cli typecheck
pnpm --filter @tracepilot/types typecheck

# Verify coverage improved
pnpm cli versions coverage
```

---

## 4. How to Add Missing Fields to Existing Structs

This is simpler than adding new event types. Because all fields are `Option<T>`, adding new optional fields is **always backward-compatible**.

### Recipe

1. **Add the field** to the existing struct in `crates/tracepilot-core/src/models/event_types.rs`:
   ```rust
   // In SessionStartData:
   pub selected_model: Option<String>,
   ```

2. **That's it for parsing.** Serde automatically deserializes missing `Option<T>` fields as `None`. No changes needed in `events.rs`, `typed_data_from_raw()`, or the `try_deser!` macro.

3. **Use the field** where needed:
   - **Turn reconstruction** (`turns/mod.rs`): If the field affects turn state
   - **Index DB** (`index_db.rs`): If the field should be queryable
   - **Tauri bindings** (`lib.rs`): If it needs to be exposed to the frontend

4. **Test** that existing events still parse correctly and new events with the field also parse.

### All 7 Missing Fields

| Struct | Field to Add | Rust Type | Schema Source |
|--------|-------------|-----------|---------------|
| `SessionStartData` | `selected_model` | `Option<String>` | `session.start.data.selectedModel` |
| `SessionErrorData` | `url` | `Option<String>` | `session.error.data.url` |
| `SessionInfoData` | `url` | `Option<String>` | `session.info.data.url` |
| `UserMessageData` | `agent_mode` | `Option<String>` | `user.message.data.agentMode` |
| `AssistantMessageData` | `encrypted_content` | `Option<String>` | `assistant.message.data.encryptedContent` |
| `AssistantMessageData` | `phase` | `Option<String>` | `assistant.message.data.phase` |
| `ToolExecCompleteData` | `is_user_requested` | `Option<bool>` | `tool.execution_complete.data.isUserRequested` |

---

## 5. Tier 1: High-Priority Event Types

### 5.1 `session.truncation`

**Why high priority:** Shows context window pressure — directly explains "why did the agent forget earlier instructions?" All 8 data fields are required in the schema, making this a data-rich event.

**Data struct:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTruncationData {
    pub token_limit: Option<u64>,
    pub pre_truncation_tokens_in_messages: Option<u64>,
    pub pre_truncation_messages_length: Option<u64>,
    pub post_truncation_tokens_in_messages: Option<u64>,
    pub post_truncation_messages_length: Option<u64>,
    pub tokens_removed_during_truncation: Option<u64>,
    pub messages_removed_during_truncation: Option<u64>,
    pub performed_by: Option<String>,
}
```

**Turn reconstruction:** Consider displaying truncation events as informational markers between turns — they explain context loss. Could add a `truncation_events: Vec<SessionTruncationData>` field to `ConversationTurn`, or simply show them in the raw events timeline.

**Index DB potential:** `tokens_removed_during_truncation` could be aggregated per-session for analytics (e.g., "sessions with heavy truncation").

**Finding examples:** Run `pnpm cli versions examples -e session.truncation` to check if any local sessions contain this event. If not, trigger it by having a very long conversation with Copilot CLI that exceeds the context window.

---

### 5.2 `assistant.reasoning`

**Why high priority:** Contains full chain-of-thought reasoning as a separate persisted event. TracePilot already handles `reasoning_text` embedded in `assistant.message`, but this is a standalone reasoning block.

**Data struct:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantReasoningData {
    pub reasoning_id: Option<String>,
    pub content: Option<String>,
}
```

**Turn reconstruction impact (YES):** The reasoning content should be collected on the current turn, similar to how `reasoning_texts` are already accumulated from `assistant.message`. In `TurnReconstructor::process()`:

```rust
(SessionEventType::AssistantReasoning, TypedEventData::AssistantReasoning(data)) => {
    if let Some(content) = &data.content {
        if let Some(turn) = self.current_turn.as_mut() {
            turn.reasoning_texts.push(AttributedMessage {
                content: content.clone(),
                parent_tool_call_id: None,
                agent_display_name: None,
            });
        }
    }
}
```

**Finding examples:** Use reasoning-capable models (Claude Opus, GPT with extended thinking) in a Copilot CLI session. Check with `pnpm cli versions examples -e assistant.reasoning`.

---

### 5.3 `system.message`

**Why high priority:** Reveals system prompts, developer instructions, and COPILOT.md content. Critical for understanding agent behavior.

**Data struct:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMessageData {
    pub content: Option<String>,
    pub role: Option<String>,       // "system" | "developer"
    pub name: Option<String>,       // Source identifier
    pub metadata: Option<SystemMessageMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMessageMetadata {
    pub prompt_version: Option<String>,
    pub variables: Option<serde_json::Value>,  // Map<String, String>
}
```

**Turn reconstruction impact (YES):** System messages establish context for the entire session. Options:
- **Option A:** Store as a top-level field on the session summary (e.g., `system_prompts: Vec<SystemMessageData>`)
- **Option B:** Show as a special "system context" section before the first turn in the conversation view
- **Option C:** Include in turn state as context annotations

**Finding examples:** System messages are injected at session start. Check with `pnpm cli versions examples -e system.message`. Most sessions should have at least one.

---

### 5.4 `SessionStartData.selected_model` (missing field)

**Why high priority:** The initial model selection is important for session analytics but isn't currently captured.

**Change:** Add one line to `SessionStartData` in `event_types.rs`:
```rust
pub selected_model: Option<String>,
```

**Downstream:** The index DB's `current_model` field currently comes from shutdown metrics. `selected_model` from `session.start` could be used as a fallback when shutdown metrics are unavailable (e.g., sessions that didn't shut down cleanly).

---

### 5.5 `session.context_changed` typing improvement

**Current state:** Stored as `ContextChanged(serde_json::Value)` — raw JSON, no type safety.

**Fix:** The `SessionContext` struct (used by `session.start` and `session.resume`) already has all the right fields. Change the `TypedEventData` variant:

```rust
// Before:
ContextChanged(serde_json::Value),

// After:
ContextChanged(SessionContext),
```

And update the parsing arm in `typed_data_from_raw()`:
```rust
// Before (line 229-232):
SessionEventType::SessionContextChanged => {
    (TypedEventData::ContextChanged(data.clone()), None)
}

// After:
SessionEventType::SessionContextChanged => {
    try_deser!(ContextChanged, SessionContext, "session.context_changed", data)
}
```

---

## 6. Tier 2: Medium-Priority Event Types

### 6.1 `session.warning`

**Data struct:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionWarningData {
    pub warning_type: Option<String>,
    pub message: Option<String>,
    pub url: Option<String>,
}
```

**Turn reconstruction:** No direct impact. Display-only — shows in the raw events timeline. Could optionally contribute to health scoring (e.g., sessions with many warnings get a slight deduction).

**Finding examples:** Trigger by using Copilot when approaching rate limits, or with misconfigured MCP servers.

---

### 6.2 `session.mode_changed`

**Data struct:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionModeChangedData {
    pub previous_mode: Option<String>,  // "interactive" | "plan" | "autopilot"
    pub new_mode: Option<String>,
}
```

**Turn reconstruction:** Could annotate turns with the active mode, but not required for basic display.

**Finding examples:** Switch between interactive and plan mode during a session: use `Shift+Tab` to toggle plan mode.

---

### 6.3 `session.task_complete`

**Data struct:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTaskCompleteData {
    pub summary: Option<String>,
}
```

**Turn reconstruction:** Marks logical task completion. Could set a flag on the final turn.

---

### 6.4 `subagent.selected` and `subagent.deselected`

**Data structs:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentSelectedData {
    pub agent_name: Option<String>,
    pub agent_display_name: Option<String>,
    pub tools: Option<Vec<String>>,
}

// subagent.deselected has no data fields — use an empty struct:
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentDeselectedData {}
```

**Turn reconstruction:** Could track which custom agent is active for subsequent turns. The `tools` list on `subagent.selected` reveals tool restrictions.

---

### 6.5 `hook.start` and `hook.end`

**Data structs:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStartData {
    pub hook_invocation_id: Option<String>,
    pub hook_type: Option<String>,  // "preToolUse", "postToolUse", "sessionStart"
    pub input: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookEndData {
    pub hook_invocation_id: Option<String>,
    pub hook_type: Option<String>,
    pub output: Option<serde_json::Value>,
    pub success: Option<bool>,
    pub error: Option<HookError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookError {
    pub message: Option<String>,
    pub stack: Option<String>,
}
```

**Turn reconstruction:** Hooks form start/end pairs via `hook_invocation_id`. Could be displayed as sub-activities within tool call timelines (hooks often run around tool calls). Consider tracking hook durations in analytics.

**Finding examples:** Define hooks in `.github/copilot/hooks/` and trigger them. See [GitHub docs on Copilot hooks](https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot).

---

### 6.6 Missing fields on existing structs

All of these follow the recipe in [Section 4](#4-how-to-add-missing-fields-to-existing-structs). Just add the `Option<T>` field to the struct — no other changes needed for parsing.

| Struct | Add | Notes |
|--------|-----|-------|
| `SessionErrorData` | `pub url: Option<String>` | URL the user can open for error details |
| `SessionInfoData` | `pub url: Option<String>` | Same pattern |
| `UserMessageData` | `pub agent_mode: Option<String>` | "interactive" / "plan" / "autopilot" / "shell" |
| `AssistantMessageData` | `pub phase: Option<String>` | Generation phase for phased-output models |
| `ToolExecCompleteData` | `pub is_user_requested: Option<bool>` | Distinguishes user-initiated vs agent-initiated tools |

---

## 7. Tier 3: Low-Priority / Deferred

### 7.1 `session.import_legacy`

**Why deferred:** Enormous nested structure containing an entire legacy session (OpenAI chat-completion format messages + timeline). Parsing this correctly requires handling 6 different message roles with variant content formats.

**If implementing:** The struct would need nested types for `LegacySession`, `LegacyChatMessage` (with role-specific content unions), and `LegacyTimelineItem`. Consider storing as `Value` initially and adding typed support incrementally.

### 7.2 `AssistantMessageData.encrypted_content`

**Why deferred:** This is encrypted model reasoning that's session-bound and stripped on resume. It's not useful for display or analytics in its encrypted form.

---

## 8. Index DB Migration Guide

If you add fields that should be queryable in the desktop app, you'll need a database migration.

### Adding `copilot_version` to the sessions table

**File:** `crates/tracepilot-indexer/src/index_db.rs`

1. Add a new migration constant (after `MIGRATION_4`):

```rust
const MIGRATION_5: &str = "
    ALTER TABLE sessions ADD COLUMN copilot_version TEXT;
    CREATE INDEX idx_sessions_copilot_version ON sessions(copilot_version);
";
```

2. Add it to the migrations array in `run_migrations()` inside `index_db.rs`:

```rust
let migrations: &[(&str, &str)] = &[
    ("Migration 1: base schema", MIGRATION_1),
    ("Migration 2: analytics", MIGRATION_2),
    ("Migration 3: model metrics", MIGRATION_3),
    ("Migration 4: activity tracking", MIGRATION_4),
    ("Migration 5: copilot version", MIGRATION_5),
];
```

3. Populate the field in `upsert_session()` by extracting `copilot_version` from the `SessionStartData`:

```rust
// In the event analytics loop:
TypedEventData::SessionStart(data) => {
    if let Some(ver) = &data.copilot_version {
        copilot_version = Some(ver.clone());
    }
    // ... existing FTS content logic ...
}
```

4. Add to the INSERT/UPDATE SQL in `upsert_session()`.

5. Bump `CURRENT_ANALYTICS_VERSION` to trigger backfill of existing sessions.

### Adding truncation analytics

If you want per-session truncation statistics:

```rust
// In MIGRATION_5 (or MIGRATION_6):
ALTER TABLE sessions ADD COLUMN truncation_count INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN total_tokens_truncated INTEGER DEFAULT 0;
```

Populate from `TypedEventData::SessionTruncation` in the event analytics loop.

---

## 9. Frontend Update Guide

The frontend is **largely event-type-agnostic** by design. Most changes are optional enhancements.

### 9.1 Required changes (for any new event type)

Only the known-events list needs updating:

**File:** `packages/types/src/known-events.ts`
```typescript
export const TRACEPILOT_KNOWN_EVENTS = [
    // ... existing ...
    "session.truncation",     // ← add new ones
    "assistant.reasoning",
    // etc.
] as const;
```

### 9.2 Optional: Event badge colors

**File:** `apps/desktop/src/views/tabs/EventsTab.vue` (line 38)

The `eventBadgeVariant()` function uses prefix matching. New events with existing prefixes (`session.`, `assistant.`, `tool.`, `subagent.`) automatically get the right color. Only add a case if a **new prefix** appears (e.g., `hook.*`):

```typescript
if (type.startsWith("hook."))    return "warning";  // ← for hook events
```

### 9.3 Optional: Display truncation info in conversation view

If you add truncation data to `ConversationTurn`, the frontend could display it:

**File:** `apps/desktop/src/views/tabs/ConversationTab.vue`

Add a truncation indicator between turns:
```vue
<template v-if="turn.truncationData">
  <div class="truncation-marker">
    ⚠️ Context truncated: {{ turn.truncationData.messagesRemoved }} messages removed
    ({{ turn.truncationData.tokensRemoved }} tokens)
  </div>
</template>
```

### 9.4 Optional: System message display

If `system.message` is stored on the session summary, display it as a collapsible section:

```vue
<details v-if="sessionDetail.systemPrompts?.length">
  <summary>System Prompts ({{ sessionDetail.systemPrompts.length }})</summary>
  <div v-for="prompt in sessionDetail.systemPrompts" class="system-prompt">
    <Badge variant="accent">{{ prompt.role }}</Badge>
    <pre>{{ prompt.content }}</pre>
  </div>
</details>
```

### 9.5 TypeScript types (if needed)

**File:** `packages/types/src/index.ts`

Add interfaces only if new data shapes cross the Tauri FFI boundary. Events sent as raw `EventItem` (with `data: Value`) don't need new interfaces — the frontend already handles arbitrary JSON.

---

## 10. Keeping Known-Events Lists in Sync

**The three canonical locations:**

| Location | Format | Used by |
|----------|--------|---------|
| `crates/tracepilot-core/src/models/event_types.rs` → `KNOWN_EVENT_TYPES` | `&[&str]` | Rust parsing, diagnostics |
| `packages/types/src/known-events.ts` → `TRACEPILOT_KNOWN_EVENTS` | `string[]` const | TypeScript type system, shared types |
| `apps/cli/src/lib/version-analyzer.ts` → `TRACEPILOT_KNOWN_EVENTS` | `string[]` const | Coverage computation in CLI |

### Sync procedure

When adding a new event type:

1. Add the wire name to all 3 locations
2. Run `pnpm cli versions coverage` to verify the count increased
3. Run `cargo test -p tracepilot-core` to verify Rust parsing works

### Future improvement

Consider generating the TypeScript lists from the Rust source, or using a shared JSON file as the single source of truth with a CI check that verifies all three locations match.

---

## 11. Testing & Validation

### Rust tests

```bash
# Run all core tests (includes parsing, turns, health):
cargo test -p tracepilot-core

# Run indexer tests:
cargo test -p tracepilot-indexer

# Run with output to see test names:
cargo test -p tracepilot-core -- --nocapture
```

**What to test for each new event type:**

1. **Parsing test:** JSON string → `parse_typed_events()` → verify correct `TypedEventData` variant
2. **Missing fields test:** Same JSON but with some fields omitted → verify it still parses (all `None`)
3. **Extra fields test:** JSON with unknown fields → verify it still parses (serde ignores extras with `deny_unknown_fields` NOT set)
4. **Turn reconstruction test** (if applicable): Build a sequence of events including the new type → verify turns are built correctly

### TypeScript checks

```bash
# Type-check the CLI:
pnpm --filter @tracepilot/cli typecheck

# Type-check the types package:
pnpm --filter @tracepilot/types typecheck

# Run UI tests:
pnpm --filter @tracepilot/ui test

# Run desktop tests:
pnpm --filter @tracepilot/desktop test
```

### Integration validation

```bash
# Check that coverage number improved:
pnpm cli versions coverage

# Look for the new event type in local sessions:
pnpm cli versions examples -e session.truncation

# Generate updated report:
pnpm cli versions report --output docs/copilot-version-analysis.md
```

### Triggering events for testing

Some events are difficult to trigger naturally. Here's how to generate them:

| Event | How to trigger |
|-------|---------------|
| `session.truncation` | Have a very long conversation that exceeds the context window (~128K tokens) |
| `assistant.reasoning` | Use a reasoning-capable model (Claude Opus, GPT with extended thinking) |
| `system.message` | Should appear automatically at session start — check existing sessions |
| `session.warning` | Approach rate limits, or configure a failing MCP server |
| `session.mode_changed` | Use `Shift+Tab` to switch between plan mode and interactive mode |
| `session.task_complete` | Use autopilot mode and let the agent complete a task |
| `hook.start` / `hook.end` | Define hooks in `.github/copilot/hooks/` |
| `subagent.selected` | Use `@explore` or other custom agent prefixes |
| `session.handoff` | Start a session from Copilot Workspace |
| `session.import_legacy` | Import a pre-events session (if you have old session data) |

---

## 12. Running the Version Analyzer

The version analyzer CLI is the primary tool for tracking coverage and detecting schema changes.

### Commands

```bash
# List installed versions:
pnpm cli versions list

# Show all sequential diffs:
pnpm cli versions diff

# Diff specific versions:
pnpm cli versions diff 1.0.5 1.0.7

# Show current coverage:
pnpm cli versions coverage

# Generate full report:
pnpm cli versions report --output docs/copilot-version-analysis.md

# Find sessions with a specific event type:
pnpm cli versions examples -e session.truncation

# Show all observed event types ranked by frequency:
pnpm cli versions examples
```

### JSON output for scripting

All commands support `--json` for machine-readable output:

```bash
pnpm cli versions coverage --json | jq '.unhandledPersistedCount'
pnpm cli versions list --json | jq '.[].version'
```

### When to re-run

- After adding new event type support (to verify coverage improved)
- After a new Copilot CLI version is installed (to detect schema changes)
- Periodically as part of maintenance (to track the evolving gap)

---

## Appendix: Complete Change Checklist

For implementing all Tier 1 + Tier 2 changes, here's the full list of files that would be modified:

### Rust files
- [ ] `crates/tracepilot-core/src/models/event_types.rs` — New structs, new enum variants, missing fields, `KNOWN_EVENT_TYPES`
- [ ] `crates/tracepilot-core/src/parsing/events.rs` — New `TypedEventData` variants, new `try_deser!` arms
- [ ] `crates/tracepilot-core/src/turns/mod.rs` — New match arms for turn-affecting events
- [ ] `crates/tracepilot-indexer/src/index_db.rs` — Migration 5 (`copilot_version`, optional analytics columns)

### TypeScript files
- [ ] `packages/types/src/known-events.ts` — Add new event names
- [ ] `apps/cli/src/lib/version-analyzer.ts` — Add new event names to inline list

### Optional frontend files
- [ ] `apps/desktop/src/views/tabs/EventsTab.vue` — Badge colors for new prefixes (e.g., `hook.*`)
- [ ] `apps/desktop/src/views/tabs/ConversationTab.vue` — Display truncation markers, system prompts

### Test files
- [ ] `crates/tracepilot-core/src/parsing/events.rs` (`#[cfg(test)] mod tests`) — Parsing tests for new event types
- [ ] `crates/tracepilot-core/src/turns/mod.rs` (`#[cfg(test)] mod tests`) — Turn reconstruction tests (if applicable)
- [ ] `crates/tracepilot-indexer/src/index_db.rs` (`#[cfg(test)] mod tests`) — Migration tests (if DB changes)

### Documentation
- [ ] `docs/copilot-version-analysis.md` — Regenerate after changes
- [ ] `docs/research/copilot-cli-evolution-risks.md` — Update with implementation status
