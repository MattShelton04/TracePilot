# Enabling New Event Types in Session-Level Views

> **Purpose**: This report documents the complete data pipeline from raw log events to UI rendering, identifies which events are currently invisible at the session level (Conversation & Timeline tabs), and outlines the exact changes needed to surface them.

---

## Table of Contents

1. [Current Architecture Overview](#1-current-architecture-overview)
2. [What's Displayed Where Today](#2-whats-displayed-where-today)
3. [The Gap: Events Not Visible in Session Views](#3-the-gap-events-not-visible-in-session-views)
4. [Detailed Data Flow](#4-detailed-data-flow)
5. [Enablement Strategy](#5-enablement-strategy)
6. [Implementation Guide by Event Type](#6-implementation-guide-by-event-type)
7. [Recommended Approach](#7-recommended-approach)
8. [File Reference](#8-file-reference)

---

## 1. Current Architecture Overview

```
events.jsonl  (raw log, one JSON object per line)
      │
      ├─► parse_events_jsonl()                          → Vec<RawEvent>
      │     { type, data, id, timestamp, parentId }
      │
      ├─► parse_typed_events()                          → Vec<TypedEvent>
      │     { raw, event_type: SessionEventType, typed_data: TypedEventData::Foo(FooData) }
      │
      ├─► [Turns path] reconstruct_turns()              → Vec<ConversationTurn>
      │     TurnReconstructor state machine
      │     ✅ user.message, assistant.message, assistant.turn_start/end
      │     ✅ tool.execution_start/complete, subagent.started/completed/failed
      │     ✅ assistant.reasoning, session.model_change, abort
      │     ❌ All other events silently skipped (_ => {})
      │
      ├─► [Events path] paginated slice                 → EventsResponse
      │     All events visible in EventsTab (raw JSON viewer)
      │
      └─► [Indexer path] upsert_session()               → SQLite index.db
            ✅ session.error       → incidents["error"]
            ✅ session.warning     → incidents["warning"]
            ✅ session.compaction_complete → incidents["compaction"]
            ✅ session.truncation  → incidents["truncation"]
            ❌ All other events → ignored for incident purposes
```

**Frontend consumption:**

```
Tauri Commands
  ├─► get_session_turns      → store.turns[]       → ConversationTab, 3 Timeline views
  ├─► get_session_incidents  → store.incidents[]    → OverviewTab ONLY
  └─► get_session_events     → store.events         → EventsTab ONLY (raw viewer)
```

---

## 2. What's Displayed Where Today

### Events consumed by the Turn Reconstructor (visible in Conversation/Timeline)

| Wire Event | Used In | How |
|---|---|---|
| `user.message` | ConversationTurn.userMessage | Opens new turn |
| `assistant.message` | ConversationTurn.assistantMessages | Appended with agent attribution |
| `assistant.turn_start` | ConversationTurn.turnId | Sets turn metadata |
| `assistant.turn_end` | ConversationTurn.isComplete | Finalizes turn |
| `assistant.reasoning` | ConversationTurn.reasoningTexts | Thinking/chain-of-thought |
| `tool.execution_start` | TurnToolCall (push new) | Started tool call |
| `tool.execution_complete` | TurnToolCall (update) | Completed tool call |
| `subagent.started` | TurnToolCall.isSubagent=true | Agent attribution |
| `subagent.completed` | TurnToolCall.success/duration | Subagent result |
| `subagent.failed` | TurnToolCall.error | Subagent failure |
| `session.model_change` | ConversationTurn.model | Updates active model |
| `abort` | Turn finalized incomplete | Turn aborted |

### Events only in OverviewTab (incident aggregates)

| Wire Event | Incident Type | Severity |
|---|---|---|
| `session.error` | `"error"` | `"error"` |
| `session.warning` | `"warning"` | `"warning"` |
| `session.compaction_complete` | `"compaction"` | `"info"` or `"warning"` |
| `session.truncation` | `"truncation"` | `"warning"` |

### Events only in EventsTab (raw JSON viewer)

All events are visible here as raw JSON, but there's no structured rendering — just type badges and a JSON detail panel.

---

## 3. The Gap: Events Not Visible in Session Views

These events exist in the data but are **invisible in Conversation and Timeline tabs**:

| Wire Event | What It Represents | Impact on User Understanding |
|---|---|---|
| `session.error` | Errors (rate limits, API failures) | **High** — users can't see when/why the agent stalled |
| `session.warning` | Warnings from the runtime | **Medium** — context for unexpected behavior |
| `session.compaction_start` | Context window compaction begins | **High** — explains sudden context shifts |
| `session.compaction_complete` | Compaction finished (with token counts) | **High** — shows how much context was lost |
| `session.truncation` | Messages truncated from context | **High** — explains missing context |
| `session.plan_changed` | Agent's plan was updated | **Medium** — shows planning evolution |
| `session.mode_changed` | Mode switch (e.g., plan→act) | **Medium** — explains behavior changes |
| `session.task_complete` | A task finished | **Low** — mostly informational |
| `session.context_changed` | Context window modified | **Medium** — explains what files are loaded |
| `session.workspace_file_changed` | File changed in workspace | **Low** — informational |
| `session.handoff` | Session handed off | **Medium** — explains session transitions |
| `session.info` | Informational session event | **Low** — general info |
| `system.notification` | System-level notification | **Medium** — may explain pauses |
| `system.message` | System message injected | **Medium** — shows system interventions |
| `skill.invoked` | A skill was triggered | **Low** — already partially visible via tool calls |
| `hook.start` / `hook.end` | Pre/post hooks executed | **Low** — debugging aid |
| `tool.user_requested` | User explicitly requested a tool | **Medium** — intent tracking |
| `subagent.selected` / `subagent.deselected` | Agent routing decisions | **Low** — internal routing |
| `session.start` / `session.shutdown` / `session.resume` | Lifecycle events | **Low** — bookkeeping |
| `session.import_legacy` | Legacy session imported | **Low** — one-time event |

**Priority events to surface**: `session.error`, `session.compaction_*`, `session.truncation`, `session.warning`, `session.plan_changed`, `session.mode_changed`

---

## 4. Detailed Data Flow

### 4.1 Rust: Turn Reconstructor (`crates/tracepilot-core/src/parsing/turns/mod.rs`)

The `TurnReconstructor` is a state machine that processes `TypedEvent`s sequentially. Its main loop has a `match` on `TypedEventData` variants:

```rust
// Simplified — each match arm mutates the current turn being built
match &event.typed_data {
    TypedEventData::UserMessage(d) => { /* open new turn */ }
    TypedEventData::AssistantMessage(d) => { /* append message to current turn */ }
    TypedEventData::AssistantTurnStart(d) => { /* set turn metadata */ }
    TypedEventData::AssistantTurnEnd(d) => { /* finalize current turn */ }
    TypedEventData::Reasoning(d) => { /* append reasoning text */ }
    TypedEventData::ToolExecStart(d) => { /* push new TurnToolCall */ }
    TypedEventData::ToolExecComplete(d) => { /* update existing TurnToolCall */ }
    TypedEventData::SubagentStarted(d) => { /* mark tool call as subagent */ }
    TypedEventData::SubagentCompleted(d) => { /* set subagent completion */ }
    TypedEventData::SubagentFailed(d) => { /* set subagent failure */ }
    TypedEventData::ModelChange(d) => { /* update session model tracking */ }
    TypedEventData::Abort => { /* finalize incomplete turn */ }
    _ => {} // ← ALL OTHER EVENTS SILENTLY DROPPED
}
```

**Key insight**: The `_ => {}` catch-all is why new events don't appear. The reconstructor simply doesn't know about them.

### 4.2 Rust: ConversationTurn struct (`crates/tracepilot-core/src/models/conversation.rs`)

The `ConversationTurn` struct has no field for "session-level events that occurred during this turn." To surface events like errors or compactions inline with the conversation, a new field would be needed.

### 4.3 TypeScript: Session Detail Store (`apps/desktop/src/stores/sessionDetail.ts`)

- `store.turns` is populated by `get_session_turns` → `ConversationTurn[]`
- `store.incidents` is populated by `get_session_incidents` → `SessionIncident[]`
- These are **completely separate data paths** with no cross-referencing

### 4.4 TypeScript: Conversation Tab (`apps/desktop/src/views/tabs/ConversationTab.vue`)

- Iterates `store.turns` and renders each turn as a chat bubble sequence
- Uses `useConversationSections` to split each turn into agent-attributed sections
- No awareness of incidents or session-level events

### 4.5 TypeScript: Timeline Views

All three timeline views (`AgentTreeView`, `TurnWaterfallView`, `NestedSwimlanesView`) consume only `store.turns` and render tool calls as their primary visual elements. None reference `store.incidents` or `store.events`.

---

## 5. Enablement Strategy

There are **two viable approaches**, each with different trade-offs:

### Approach A: Embed Events in ConversationTurn (Rust-side enrichment)

**Concept**: Add a new field to `ConversationTurn` (e.g., `session_events: Vec<TurnSessionEvent>`) and have the `TurnReconstructor` capture relevant events that occur between turn boundaries.

**Changes required**:

| Layer | File | Change |
|---|---|---|
| **Rust model** | `crates/tracepilot-core/src/models/conversation.rs` | Add `session_events: Vec<TurnSessionEvent>` to `ConversationTurn`; define `TurnSessionEvent { event_type, timestamp, severity, summary, data }` |
| **Rust parser** | `crates/tracepilot-core/src/parsing/turns/mod.rs` | Add match arms in the reconstructor for `SessionError`, `SessionWarning`, `CompactionStart`, `CompactionComplete`, `SessionTruncation`, `PlanChanged`, `ModeChanged` etc. → push to `current_turn.session_events` |
| **TS types** | `packages/types/src/index.ts` | Add `sessionEvents?: TurnSessionEvent[]` to `ConversationTurn` interface |
| **TS UI** | `apps/desktop/src/views/tabs/ConversationTab.vue` | Render `turn.sessionEvents` as inline banners/chips between messages |
| **TS UI** | Timeline views | Render events as markers on the timeline |

**Pros**: 
- Events are automatically scoped to the correct turn
- No additional IPC calls needed
- Timeline views get events for free through existing `store.turns`

**Cons**: 
- Modifies the core Rust model (wider blast radius)
- Increases `ConversationTurn` payload size
- Events between turns (before first user message) need special handling

### Approach B: Client-Side Merge (Frontend temporal join)

**Concept**: Load both `store.turns` and `store.incidents` in the consuming components, then merge them by timestamp to insert inline event markers.

**Changes required**:

| Layer | File | Change |
|---|---|---|
| **TS store** | `apps/desktop/src/stores/sessionDetail.ts` | Ensure `loadIncidents()` is called alongside `loadTurns()` in timeline views |
| **TS composable** | New composable `useTimelineEvents.ts` | Merge `turns[]` and `incidents[]` by timestamp; produce `TimelineItem = Turn | Incident` union |
| **TS UI** | `apps/desktop/src/views/tabs/ConversationTab.vue` | Use composable; render incident items as inline banners between turns |
| **TS UI** | Timeline views | Use composable; render incident markers on the timeline |

**Pros**:
- No Rust changes needed
- Leverages existing `get_session_incidents` data
- Incidents already have severity, summary, and detail fields

**Cons**:
- Limited to the 4 event types currently indexed as incidents (error, warning, compaction, truncation)
- Temporal matching is approximate (incidents have timestamps but no turn association)
- Would need to expand incident types in the Rust indexer to cover more events
- Additional IPC call in views that don't currently load incidents

### Approach C: Hybrid (Recommended)

Combine both approaches for maximum coverage:
1. **Short-term**: Use Approach B for the 4 existing incident types — they already have structured data in the index DB
2. **Medium-term**: Use Approach A to embed high-value events (`session.error`, `compaction_*`, `truncation`, `plan_changed`, `mode_changed`) directly in `ConversationTurn` for precise turn-scoped display

---

## 6. Implementation Guide by Event Type

### 6.1 `session.error` (High Priority)

**Current state**: Indexed as incident; visible in OverviewTab and EventsTab only.

**Rust changes (Approach A)**:

```rust
// In crates/tracepilot-core/src/models/conversation.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnSessionEvent {
    pub event_type: String,           // "session.error", "session.compaction_complete", etc.
    pub timestamp: Option<DateTime<Utc>>,
    pub severity: String,             // "error", "warning", "info"
    pub summary: String,              // Human-readable summary
    pub data: Option<serde_json::Value>,  // Raw event data for detail view
}

// Add to ConversationTurn:
pub session_events: Vec<TurnSessionEvent>,
```

```rust
// In crates/tracepilot-core/src/parsing/turns/mod.rs — add match arm:
TypedEventData::SessionError(d) => {
    let is_rate_limit = d.error_type.as_deref() == Some("rate_limit");
    if let Some(turn) = self.current_turn.as_mut() {
        turn.session_events.push(TurnSessionEvent {
            event_type: "session.error".into(),
            timestamp: event.raw.timestamp,
            severity: "error".into(),
            summary: if is_rate_limit {
                format!("Rate limit hit: {}", d.message)
            } else {
                d.message.clone()
            },
            data: Some(event.raw.data.clone()),
        });
    }
}
```

**TypeScript changes**:

```typescript
// In packages/types/src/index.ts — add interface:
export interface TurnSessionEvent {
  eventType: string;
  timestamp?: string;
  severity: 'error' | 'warning' | 'info';
  summary: string;
  data?: unknown;
}

// Add to ConversationTurn:
sessionEvents?: TurnSessionEvent[];
```

**UI rendering** (ConversationTab — inline banner between messages):

```html
<!-- After assistant messages, before tool calls -->
<div v-for="evt in turn.sessionEvents?.filter(e => e.severity === 'error')"
     :key="evt.timestamp"
     class="session-event-banner error">
  <span class="event-icon">⚠️</span>
  <span class="event-summary">{{ evt.summary }}</span>
  <span class="event-time">{{ formatTime(evt.timestamp) }}</span>
</div>
```

### 6.2 `session.compaction_start` / `session.compaction_complete` (High Priority)

**Same pattern as 6.1** — add match arms in the turn reconstructor. Compaction events are particularly important because they explain sudden context loss.

```rust
TypedEventData::CompactionStart => {
    if let Some(turn) = self.current_turn.as_mut() {
        turn.session_events.push(TurnSessionEvent {
            event_type: "session.compaction_start".into(),
            timestamp: event.raw.timestamp,
            severity: "info".into(),
            summary: "Context compaction started".into(),
            data: Some(event.raw.data.clone()),
        });
    }
}
TypedEventData::CompactionComplete(d) => {
    let summary = format!(
        "Compaction {}: {} → {} tokens",
        if d.success == Some(true) { "succeeded" } else { "failed" },
        d.input_tokens.unwrap_or(0),
        d.output_tokens.unwrap_or(0)
    );
    if let Some(turn) = self.current_turn.as_mut() {
        turn.session_events.push(TurnSessionEvent {
            event_type: "session.compaction_complete".into(),
            timestamp: event.raw.timestamp,
            severity: if d.success == Some(true) { "info" } else { "warning" }.into(),
            summary,
            data: Some(event.raw.data.clone()),
        });
    }
}
```

**UI suggestion for Timeline views**: Show compaction events as a vertical dashed line across the waterfall/swimlane with a tooltip showing token counts.

### 6.3 `session.truncation` (High Priority)

```rust
TypedEventData::SessionTruncation(d) => {
    let summary = format!(
        "Truncated {} tokens ({} messages)",
        d.tokens_truncated.unwrap_or(0),
        d.messages_truncated.unwrap_or(0)
    );
    if let Some(turn) = self.current_turn.as_mut() {
        turn.session_events.push(TurnSessionEvent {
            event_type: "session.truncation".into(),
            timestamp: event.raw.timestamp,
            severity: "warning".into(),
            summary,
            data: Some(event.raw.data.clone()),
        });
    }
}
```

### 6.4 `session.plan_changed` (Medium Priority)

```rust
TypedEventData::PlanChanged(d) => {
    if let Some(turn) = self.current_turn.as_mut() {
        turn.session_events.push(TurnSessionEvent {
            event_type: "session.plan_changed".into(),
            timestamp: event.raw.timestamp,
            severity: "info".into(),
            summary: "Agent plan updated".into(),
            data: Some(event.raw.data.clone()),
        });
    }
}
```

### 6.5 `session.mode_changed` (Medium Priority)

```rust
TypedEventData::ModeChanged(d) => {
    let summary = format!("Mode changed to: {}", d.new_mode.as_deref().unwrap_or("unknown"));
    if let Some(turn) = self.current_turn.as_mut() {
        turn.session_events.push(TurnSessionEvent {
            event_type: "session.mode_changed".into(),
            timestamp: event.raw.timestamp,
            severity: "info".into(),
            summary,
            data: Some(event.raw.data.clone()),
        });
    }
}
```

### 6.6 `session.warning`, `system.notification`, `system.message` (Medium Priority)

Same pattern — add match arms, push to `turn.session_events`.

### 6.7 Low-Priority Events

`hook.start/end`, `skill.invoked`, `subagent.selected/deselected`, `session.info`, `session.start/shutdown/resume`, `session.import_legacy`, `session.workspace_file_changed`, `session.task_complete`, `session.context_changed`, `tool.user_requested` — these can be enabled with the same pattern if desired, but provide less user value.

---

## 7. Recommended Approach

### Phase 1: Quick Win — Client-Side Incident Merge

**Effort**: Small | **Impact**: Surfaces the 4 most important event types immediately

1. In `ConversationTab.vue` and Timeline views: call `store.loadIncidents()` alongside `store.loadTurns()`
2. Create a `useTimelineIncidents(turns, incidents)` composable that assigns each incident to a turn by timestamp range (`turn.timestamp ≤ incident.timestamp < nextTurn.timestamp`)
3. Render incidents as colored banner rows between chat bubbles or as markers on timeline bars
4. The data is already indexed and available — no Rust changes needed

### Phase 2: Rust Enrichment — Embed Events in Turns

**Effort**: Medium | **Impact**: Precise turn-scoped events, more event types

1. Add `TurnSessionEvent` struct and `session_events: Vec<TurnSessionEvent>` to `ConversationTurn`
2. Add match arms in `TurnReconstructor` for high-priority events (error, compaction, truncation, warning, plan_changed, mode_changed)
3. Update TS types
4. Replace Phase 1 composable with direct `turn.sessionEvents` rendering
5. Add timeline markers (vertical lines, icons) in waterfall/swimlane views

### Phase 3: Rich Event Rendering

**Effort**: Large | **Impact**: Full event visibility with interactive details

1. Dedicated event marker components with expandable detail panels
2. Compaction events show before/after token counts with a visual diff
3. Error events show retry status and resolution
4. Plan changes show diff of old → new plan
5. Filter/toggle controls to show/hide event types in each view
6. Event counts in tab badges (e.g., "Conversation (2 ⚠️)")

---

## 8. File Reference

### Sync Points (3 files must stay aligned for event types)

| File | Role |
|---|---|
| `crates/tracepilot-core/src/models/event_types.rs` | Canonical Rust enum of all event types |
| `packages/types/src/known-events.ts` | TypeScript list of recognized event types |
| `apps/cli/src/version-analyzer.ts` | CLI version analysis of event types |

### Key Files for Implementation

| File | Lines | What to Change |
|---|---|---|
| `crates/tracepilot-core/src/models/conversation.rs` | 25–70 | Add `TurnSessionEvent` struct + `session_events` field |
| `crates/tracepilot-core/src/parsing/turns/mod.rs` | ~413 | Add match arms for new event types in `TurnReconstructor` |
| `packages/types/src/index.ts` | 90–111 | Add `TurnSessionEvent` interface + field on `ConversationTurn` |
| `apps/desktop/src/stores/sessionDetail.ts` | 185+ | Ensure `loadIncidents()` is called in relevant tab loaders |
| `apps/desktop/src/views/tabs/ConversationTab.vue` | 103+ | Render inline event banners |
| `apps/desktop/src/components/timeline/AgentTreeView.vue` | 170+ | Add event markers to tree nodes |
| `apps/desktop/src/components/timeline/TurnWaterfallView.vue` | 80+ | Add event marker lines to waterfall |
| `apps/desktop/src/components/timeline/NestedSwimlanesView.vue` | 146+ | Add event markers to swimlanes |
| `crates/tracepilot-indexer/src/index_db.rs` | 481+ | (Optional) Index additional event types as incidents |

### Existing Incident Rendering (Reference Implementation)

| File | Lines | What It Does |
|---|---|---|
| `apps/desktop/src/views/tabs/OverviewTab.vue` | 151–198 | Renders incident list with severity badges, summaries, expandable JSON detail |
| `apps/desktop/src/views/tabs/EventsTab.vue` | 39–42 | Color-codes event type badges |
