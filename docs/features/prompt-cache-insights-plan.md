# Prompt-cache insights — implementation plan

Status: **Phases 1–3 implemented** (2026-09-19). Phase 4 (enrichments) and the optional
Timeline band and alert are not started. See [§13](#13-implementation-notes) for where the
implementation differs from this plan.
Related:
[Copilot session store research](../research/copilot-session-store-db.md),
[1.0.83 alignment](../reports/versions/2026-09-12-v1.0.83-alignment.md),
[subagent analysis](subagent-analysis-plan.md).

## 1. Summary

Copilot CLI 1.0.83 persists a `session.usage_checkpoint` event whenever a session goes idle.
It records the CLI's own prompt-cache expiry per model and a fingerprint of the prompt prefix
(tools, system-prompt segments, conversation hashes, model, effort). TracePilot already parses
the event (`UsageCheckpointData`), but it keeps the cache fields as untyped JSON and doesn't
display them.

This plan turns that data into:

1. a **live cache countdown** for active sessions;
2. **resume markers** in the Conversation tab showing whether you replied while the cache was
   warm or after it had expired;
3. **prefix-change causes**, i.e. why a cache would break: tools, system prompt, model, effort,
   or a history rewrite;
4. a **Prompt cache** section in Metrics, plus cross-session figures in Analytics.

`events.jsonl` is the only required source. Other sources are optional enrichments and are
labelled as such. Older sessions degrade to clearly labelled estimates or show nothing.

## 2. Goals and non-goals

**Goals**
- Tell the user, in plain terms, when the prompt cache is predicted to expire and whether
  each reply came before or after that point.
- Explain which part of the prompt prefix changed between interactions.
- Do this without new data collection, using only persisted session events.
- Keep every claim traceable to a confidence level (§4).

**Non-goals**
- Estimating money saved or lost. The UI talks about tokens re-sent, not dollars. This is
  consistent with the existing cache wording in `MetricsCacheBreakdown.vue`.
- Confirming per-request cache hits from `events.jsonl` alone. The event log can't do this
  (§3.3).
- Writing to, or depending on, CLI-owned stores.

## 3. Evidence (verified against local data, 2026-09-19)

### 3.1 What is persisted

`session.usage_checkpoint` (schema: `UsageCheckpointData`, CLI 1.0.83):

| Field | Schema status | Observed |
|---|---|---|
| `totalNanoAiu` | required | Cumulative session cost at checkpoint time |
| `totalPremiumRequests` | internal | |
| `modelCacheState[]` → `{modelId, cacheExpiresAt, cacheTtlSeconds}` | **internal** (typed in schema) | `gpt-5.6-luna` has a TTL of 1800 s (24 of 25 checkpoints). `gpt-5-mini` has 86400 s (1). |
| `promptCacheBreakState[]` | **internal, `x-opaque-json`** | Per `conversation` (only `"main"` seen), then per model: `initiator`, `prompt_tokens`, `cache_read`, `cache_write`, `frontier_tokens`, `ttl_seconds`, `cache_expires_at`, `completed_at`, `reasoning_effort`, `tool_count`, `tool_tokens`, `tools[]{name, schema_hash, safe}`, `system_segments[]{segment, hash, tokens}`, `conversation{message_count, points[]{index, hash}}`, `cache_config`, `transport`, `api_endpoint` |

**When it is written.** In the eleven 1.0.83 sessions examined, a checkpoint appears after the
last `assistant.turn_end` of an interaction, when the agent goes idle. It is not written after
every turn. Sessions with no model call have none. One interaction with queued prompts
produced a single checkpoint (25 checkpoints across 13 sessions).

**How expiry is computed.** `cacheExpiresAt` equals the baseline request's *start* time plus
the TTL. For example, a request completed at 00:21:21 is recorded with an expiry of 00:51:17,
a gap of 1796 s. This is the CLI's model of the provider cache. It is not a guarantee from the
provider.

### 3.2 What is not persisted

The schema defines two **ephemeral** events that never reach disk:

- `assistant.usage`: per-request `cacheReadTokens`, `cacheWriteTokens` and `cacheExpiresAt`.
- `prompt_cache_break`: the CLI's own diagnosis of a miss, with fields such as `primaryReason`,
  `contributingReasons`, `toolsAdded/Removed/Redefined`, `systemSegmentsChanged`,
  `rewriteSource` (e.g. compaction), `shortfallTokens`, `retentionRatio` and `agentName`.

These are available to a live client such as TracePilot's SDK bridge. They are not available
when reading files offline.

### 3.3 The limitation the design must respect

A checkpoint's baseline request is the **last request of the interaction**. In every checkpoint
examined, it completed 0 s before the checkpoint was written. It is not the request that
resumed the session. So `events.jsonl` tells us:

- when the CLI predicted the cache would expire (authoritative for the CLI's view);
- whether the prefix changed between two idle points, and how;
- the cost of each interaction (`totalNanoAiu` delta);

but **not** whether the first request after a pause actually hit the cache. Per-request
confirmation needs the Chronicle store or the live bridge (§8).

Validation that the TTL prediction matches reality, using per-request Chronicle rows: calls made
within 5 minutes of the previous one hit 331 of 348 times. The one call made after the 30-minute
TTL missed. That is consistent with the prediction, but a sample of one isn't proof. §11 includes
a controlled test.

## 4. Confidence levels (shown in the UI)

| Level | Label in UI | Source | Used for |
|---|---|---|---|
| **Predicted** | "Predicted by Copilot CLI" | `modelCacheState.cacheExpiresAt` from a checkpoint | Countdown and warm/expired classification (1.0.83+) |
| **Observed** | "Observed" | Per-request cache reads (optional enrichment, §8) | Confirming that a resume actually missed or hit |
| **Estimated** | "Estimated" (dashed style) | Idle gap plus the TTL registry (§5.4) | Sessions before 1.0.83, or models with no checkpoint |
| **Unavailable** | hidden or "—" | nothing usable | Never guess without a TTL source |

Copy rules: never say "wasted". Say "about 54k tokens re-sent without cache" and qualify it with
the level. Every chip carries its level in a tooltip.

## 5. Domain model and algorithms

All of this lives in `tracepilot-core` as pure functions over typed events. There's no IO, and
it's deterministic, so the logic is easy to test.

### 5.1 Typed parsing (lenient)

`crates/tracepilot-core/src/models/event_types/session_lifecycle_data.rs`:

```rust
pub struct UsageCheckpointData {
    pub total_nano_aiu: u64,
    pub total_premium_requests: Option<f64>,
    pub model_cache_state: Option<Vec<ModelCacheState>>,   // was Vec<Value>
    pub prompt_cache_break_state: Option<Vec<serde_json::Value>>, // stays opaque on the wire
}
pub struct ModelCacheState { pub model_id: String, pub cache_expires_at: Option<String>,
                             pub cache_ttl_seconds: Option<u64> }  // all tolerant
```

Add `prompt_cache/baseline.rs` with `fn parse_baselines(&[Value]) -> Vec<CacheBaseline>`. Every
field is optional. Unknown fields are ignored. A malformed entry is skipped and counted in
diagnostics (`parsing/diagnostics.rs`), and never fails the session.

```rust
pub struct CacheBaseline {
    pub conversation: String,            // "main" or agent-scoped
    pub model: String,
    pub initiator: Option<String>,       // user | agent | sub-agent
    pub completed_at: Option<Timestamp>, pub cache_expires_at: Option<Timestamp>,
    pub ttl_seconds: Option<u64>,
    pub prompt_tokens: Option<u64>, pub cache_read: Option<u64>, pub cache_write: Option<u64>,
    pub frontier_tokens: Option<u64>,
    pub reasoning_effort: Option<String>,
    pub tools: Vec<ToolFingerprint>,          // name + schema_hash + safe
    pub system_segments: Vec<SegmentFingerprint>, // name + hash + tokens
    pub conversation_points: Vec<(u32, String)>, pub message_count: Option<u32>,
    pub cache_config: Option<Value>,
}
```

Keep the parse as `Value` on the event struct so that export and the raw Events tab stay
lossless.

### 5.2 Idle windows

Walk the typed events once:

- **Start of an idle window.** A `session.usage_checkpoint` event. If there's no checkpoint,
  use the last `assistant.turn_end` before the next `user.message` (fallback path).
- **End of an idle window.** The next `user.message` from the main agent (ignore
  `parentAgentTaskId` child prompts). Also end it on a `session.resume` followed by a user
  message, or on `session.shutdown`, or leave it **open** for a live session.
- **Model at resume.** The effective main model is tracked through `session.model_change` and
  `session.resume.selectedModel`.
- **Expiry.** Use `modelCacheState[model].cacheExpiresAt` from the checkpoint that started the
  window. If the resume model has no entry, classify with the registry TTL (Estimated).

```rust
pub struct CacheWindow {
    pub index: u32,
    pub idle_start: Timestamp, pub resume_at: Option<Timestamp>,
    pub model: Option<String>,
    pub expires_at: Option<Timestamp>, pub ttl_seconds: Option<u64>,
    pub outcome: WindowOutcome,          // Warm | Expired | Open | SessionEnded | Unknown
    pub confidence: Confidence,          // Predicted | Observed | Estimated | Unavailable
    pub resumed_turn_index: Option<u32>, pub resumed_interaction_id: Option<String>,
    pub uncached_prefix_tokens: Option<u64>, // frontier_tokens of the starting baseline
    pub interaction_nano_aiu: Option<u64>,   // delta totalNanoAiu to next checkpoint
    pub prefix_changes: Vec<PrefixChange>,   // see 5.3, vs the previous baseline
}
```

- **Warm.** `resume_at < expires_at`.
- **Expired.** `resume_at >= expires_at`.
- **Open.** No resume yet, and the session is live (lock file or `open-sessions-state.json`).
  The UI shows a countdown.
- **SessionEnded.** A shutdown happened first.
- Clock handling: use CLI timestamps only (UTC, from the same process). Never use local wall
  time, except for the live countdown, which compares against `Date.now()`. Clamp small
  negative skews to 0.

### 5.3 Prefix-change detection

Compare consecutive baselines for the **same conversation and model**:

| Change | Rule | Label |
|---|---|---|
| Model switch | model differs, or a `session.model_change` falls between them | "Model changed A → B" |
| Effort | `reasoning_effort` differs | "Effort high → xhigh" |
| Tools added/removed | set difference on `name` | "+2 tools / −1 tool". Show names only when `safe == true`, otherwise "custom tool". |
| Tool redefined | same name, different `schema_hash` | "Tool definition changed" |
| System prompt | segment hash differs | "System prompt: instructions changed" (segment names) |
| History rewrite | first differing `conversation.points[i].hash` where `i < prev.message_count` | "History rewritten at message i". The cause is taken from any `session.compaction_complete` / `session.truncation` / `session.context_cleared` in between. |
| Cache config | `cache_config` differs | "Cache configuration changed" |

A prefix change means "this would have broken the cache". It is not proof that a miss
happened, so label it "likely cache break" unless an Observed source confirms it.

### 5.4 TTL registry (for the Estimated fallback)

At index time, record every `(model, cacheTtlSeconds)` observed in any checkpoint in a new
table, `model_cache_ttl_observations`. For an estimate, use the most common TTL observed for the
model. If there isn't one, use a small built-in table in `packages/types` (`cacheTtlDefaults`)
that the user can override in Settings. If neither exists, return **Unavailable**. Never
silently assume a TTL.

## 6. Where it appears (views)

| # | View | Change | Updates live? | Fallback |
|---|---|---|---|---|
| 1 | **Session header** (`SessionDetailView` header area, next to the live/auto-refresh controls) | Chip: "Cache warm · 17:42" (green), "expiring · 3:10" (amber, under 5 min), "Cache expired 12m ago" (neutral). Tooltip gives the model, TTL and "Predicted by Copilot CLI". | Yes. It ticks on the client from `expires_at`, and the window re-derives on each refresh. | Hidden when there is no Predicted expiry. Estimated values are never shown as a live countdown. |
| 2 | **Conversation tab** (`ConversationTurnList.vue`, chat view) | A divider between interactions: "idle 47m · cache expired 17m before this reply". A chip on the resumed user turn: warm, cold resume or likely cache break. A tooltip lists the prefix changes. | Yes, on turn refresh. | Estimated dividers use a dashed style and the "Estimated" label. No divider when Unavailable. |
| 3 | **Metrics tab** (new `MetricsPromptCacheSection.vue` below `MetricsCacheBreakdown`) | A strip of idle windows (warm or expired), counts, re-sent prefix tokens, a table of prefix changes, and interaction cost deltas. | On refresh. | For sessions before 1.0.83: "Cache timing isn't recorded for this CLI version", with the estimate available behind a toggle. |
| 4 | **Analytics dashboard** (`AnalyticsCacheHealthRow.vue`) | Adds "Replies after predicted expiry %", "Median idle before reply", and the top prefix-change causes. | On index update. | These figures cover only sessions with Predicted data. The denominator is shown ("from 13 sessions"). |
| 5 | **Model Comparison** | An "Observed cache TTL" column from the registry. | On index update. | "—" |
| 6 | **Timeline tab** (optional, phase 3) | Cache windows as a background band on the waterfall. | On refresh. | Hidden. |
| 7 | **Alerts** (optional, phase 3, off by default) | "Session X is waiting on you and its cache expires in 5 min." Extends `alertWatcher.ts` and pairs with the attention inbox proposal. | Yes. | Only for Predicted data. |

`ConversationTurn` in IPC is **not** extended. Instead, the conversation view fetches
`get_session_prompt_cache` and merges by `interactionId` (falling back to the turn timestamp).
This keeps the turn fingerprints in `sessionFingerprint.ts` stable and avoids re-sending cache
data with every turn page.

## 7. Backend architecture

| Layer | Change |
|---|---|
| `tracepilot-core` | Type `ModelCacheState`. Add a new module `analytics/prompt_cache/` with `baseline.rs` (lenient parser), `windows.rs` (§5.2), `changes.rs` (§5.3), `mod.rs` → `fn build_prompt_cache_timeline(events, ttl_registry) -> PromptCacheTimeline`. Add the diagnostics counter `prompt_cache_baseline_parse_failures`. |
| `tracepilot-tauri-bindings` | Add `commands/session/prompt_cache.rs` → `get_session_prompt_cache(session_id)`, cached by the same file-fingerprint mechanism that Metrics uses. Register it in `ipc_command_names.rs` (see `docs/tauri-command-registration.md`). |
| `tracepilot-indexer` | New tables `session_cache_windows` (one row per window: session_id, idx, idle_start, resume_at, model, expires_at, ttl_s, outcome, confidence, prefix_tokens, interaction_nano_aiu, changes_json) and `model_cache_ttl_observations(model, ttl_s, count, last_seen)`. Bump **`CURRENT_ANALYTICS_VERSION` 9 → 10** so existing sessions are re-extracted without changing source files. Add aggregate queries to `analytics_queries/`. |
| `packages/types` / `packages/client` | `PromptCacheTimeline`, `CacheWindow`, `PrefixChange`, `Confidence`; client wrapper; `cacheTtlDefaults`. |
| `apps/desktop` | Add `usePromptCache(sessionId)` composable (live-aware, reuses `useSessionTurnsRefresh` triggers) and the components listed in §6. |
| `apps/cli` version analyzer | Add a watch rule: flag any schema diff touching `UsageCheckpointData`, `UsageCheckpointModelCacheState`, `AssistantUsageData` or `PromptCacheBreakData`, because they are internal. |

Performance: this is one linear pass per session. Checkpoints are rare (fewer than one per
interaction). Hook-heavy sessions (6.5k hook events) add nothing, because they are skipped by
event type.

## 8. Optional enrichments (off by default, later phases)

1. **Live bridge (experimental SDK bridge connected).** Subscribe to the ephemeral
   `assistant.usage` and `prompt_cache_break` events (the bridge already carries an `ephemeral`
   flag, `bridge/mod.rs`). This makes the header chip Observed and uses the CLI's own
   `primaryReason`. Keep these in memory for the attached session only.
2. **Chronicle per-request rows.** `assistant_usage_events` gives an exact `cache_read_tokens`
   for the request that resumed the session, which upgrades windows to **Observed**. Use the
   read-only adapter proposed in the
   [session store research](../research/copilot-session-store-db.md), with capability detection,
   and never make it required.

## 9. Fallback matrix

| Situation | Behaviour |
|---|---|
| CLI < 1.0.83 (no checkpoints) | Windows come from `assistant.turn_end` → `user.message`. Estimated if the registry has a TTL for the model, otherwise Unavailable. There are no prefix changes. The session-level cache ratio in Metrics is unchanged. |
| 1.0.83+ but no checkpoint yet (first interaction still running, or no model call) | Header chip hidden. No windows. |
| `promptCacheBreakState` missing or unparseable | Expiry still comes from `modelCacheState` (Predicted). Prefix changes are omitted and a diagnostic is recorded. |
| `modelCacheState` missing but a baseline has `cache_expires_at` | Use the baseline's value (Predicted). |
| Both missing | Estimated via the registry, or Unavailable. |
| Resume model differs from the checkpoint's models | Treat as a model switch. The window is "Expired / model changed", and the expiry is irrelevant. |
| TTL is 0 or absent (e.g. a BYOK provider) | "No prompt cache reported for this model". Never shown as expired. |
| Non-`main` conversations appear in the break state | Excluded from session views in phase 1. They could be surfaced per agent later in the Metrics "By agent" drilldown. |
| Crashed session (no shutdown) | Windows up to the last event. The last one is "Unknown" unless the session is live. |
| Resumed across CLI restarts (`session.resume`) | Resume time comes from the user message after the resume event. The CLI restores its expiry from the checkpoint, so the same rule applies. |
| Fields renamed in a future CLI | Lenient parse. The version-analyzer watch rule fires. Degrade to the level still supported. |

## 10. Delivery phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **1. Core and Metrics** | Typed parsing, windows, changes, command, Metrics section, fixtures | All §11 fixtures pass. Real-app check on 1.0.83 sessions and a 1.0.40 session (hidden or estimated). |
| **2. Conversation and header** | Resume dividers, turn chips, live header countdown | Live session in `pnpm app:start`: the countdown matches the checkpoint, and a divider appears after a reply. |
| **3. Analytics and registry** | Indexer tables, analytics version 10, Analytics and Model Comparison figures, optional Timeline band and alert | Re-index completes. Figures reconcile with the per-session views. |
| **4. Enrichments** | Chronicle and/or live bridge Observed upgrades | A controlled test confirms Observed matches Predicted. |

Put it behind a feature flag `promptCacheInsights`, recommended on, for phases 1–3. Phase 4
gets its own setting.

## 11. Testing

- **Fixtures** (sanitized, under `crates/tracepilot-core/tests/fixtures/versions/`):
  - warm resume;
  - expired resume;
  - open (no resume);
  - tools added mid-session;
  - effort change;
  - compaction rewrite between baselines;
  - model switch at resume;
  - missing `promptCacheBreakState`;
  - malformed baseline;
  - pre-1.0.83 session;
  - TTL 0.
- **Unit tests:** classification boundary (`resume_at == expires_at` → Expired), clock skew
  clamp, registry mode selection, safe/unsafe tool name redaction.
- **Frontend:** chip states and labels per confidence level. Countdown formatting and its
  transition to expired. `prefers-reduced-motion`.
- **Real app** (per `AGENTS.md`): 1440×960, 960×640, 2560×1440. One live 1.0.83 session and one
  historical session each from 0.0.409, 1.0.40 and 1.0.83.
- **Controlled validation:** in a fresh gpt-5.6-luna session, reply at about 25 minutes and at
  about 35 minutes. With Chronicle enrichment on, the Observed result should agree with
  Predicted.

## 12. Risks and open questions

- **Internal schema.** `modelCacheState` and `promptCacheBreakState` are marked internal or
  opaque. Mitigations: lenient parsing, the watch rule, and confidence labels.
- **Provider TTL semantics.** Some providers refresh the TTL on each cache read. The CLI already
  models this ("used to refresh expiration after a cache read"), so we trust its value rather
  than recomputing it.
- **Claude TTL.** No Claude checkpoints exist locally yet. The registry fills in as data arrives.
- **Open question: resume request.** Should Metrics show the cost of the interaction that
  followed an expired window? The data is there (the `totalNanoAiu` delta), but attributing it
  to the cache is speculative. The proposal is to show it neutrally as "interaction cost".

## 13. Implementation notes

What shipped, and where it deliberately differs from the plan above.

**Where the code lives**

| Layer | Location |
|---|---|
| Typed checkpoint | `ModelCacheState` in `session_lifecycle_data.rs` (all fields optional, unknown fields kept in `extra`) |
| Core reconstruction | `crates/tracepilot-core/src/prompt_cache/` (`baseline`, `builder`, `state`, `outcome`, `changes`, `model`) → `build_prompt_cache_timeline(events, ttl_lookup)` |
| IPC | `get_session_prompt_cache` (`commands/session/prompt_cache.rs`), reusing the parsed-event LRU |
| Index | Migration 17: `session_cache_windows`, `session_cache_ttls`; analytics version 10; `AnalyticsData.promptCache` |
| Desktop | `usePromptCache`, `PromptCacheHeaderChip`, `CacheResumeDivider` (chat and compact views), `MetricsPromptCacheSection`, `AnalyticsPromptCachePanel`, Model Comparison "Cache TTL" column |
| CLI | `WATCHED_EVENT_TYPES` in the version analyzer |
| Flag | `features.promptCacheInsights`, default on |

**Deviations from the plan**

- **Main-agent prompts are identified by `agentId`, not `parentAgentTaskId`.** In real 1.0.83
  logs, root prompts carry a `parentAgentTaskId` too; sub-agent events are the ones with an
  envelope `agentId`, matching turn reconstruction.
- **An agent wake-up resumes a window.** When a background sub-agent finishes, the main agent
  makes a model call without a user prompt (observed in real sessions). The first main
  `assistant.turn_start` after a checkpoint therefore resumes the window, with
  `resumeSource: "agent"`. A later checkpoint with no resume in between supersedes the
  earlier idle point.
- **A shutdown does not close a window.** If the session is later resumed (`session.resume`
  then a prompt), the window is classified normally, since the provider cache does not depend
  on the CLI process. `sessionEnded` is only reported when nothing followed.
- **Liveness is not an input to the core.** The final unanswered window is `pending`; the
  header shows a countdown only while `is_session_running` is true, and the Metrics table
  labels it "No reply yet". This keeps the reconstruction pure and cacheable.
- **Checkpoints exist before 1.0.83.** 1.0.75+ writes `modelCacheState` without
  `promptCacheBreakState`, so those sessions get predicted timing without prefix changes.
- **Prefix changes compare the baseline before the idle window with the one after the
  resumed interaction.** When either fingerprint is missing, model and effort changes come
  from `session.model_change`, and history rewrites from compaction, truncation or
  context-clear events seen while idle. Cache-config changes list the changed keys (real
  sessions flip `incremental_input`).
- **The TTL registry is per session, not a global counter table.** `session_cache_ttls`
  rows are replaced on reindex, so counts cannot double. The estimate uses the most common
  TTL per model, and a tie picks the shorter TTL. There is no built-in `cacheTtlDefaults`
  table or Settings override: without an observed TTL a window is **unavailable** rather
  than guessed. The registry is read lazily, only for sessions that need an estimate.
- **Only predicted windows are indexed.** Estimates depend on the registry that the index
  feeds, so they are computed on demand. Cross-session figures cover predicted windows only.
- **`interactionNanoAiu` is shown neutrally** as "Next interaction" usage, answering the
  open question in §12.
- **Diagnostics** are reported on the timeline (`malformedEntryCount`) rather than in
  `ParseDiagnostics`, since a malformed cache entry never affects event parsing.

