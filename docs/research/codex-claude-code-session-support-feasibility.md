# Codex and Claude Code Session Support — Feasibility

> **Status:** Research only; nothing implemented.
> **Date:** 2026-10-04
> **Follow-up:** The [Claude Code integration plan](claude-code-integration/README.md)
> (2026-10-05) re-measures the Claude Code data and corrects §3.2. Do **not** follow
> `leafUuid`/`parentUuid` chains to reconstruct turns: they skip records and cycle after
> compaction. Take usage from the *last* record per message. That plan also refines §6 and
> §8 into a provider design and a task plan.
> **Evidence:** the TracePilot source at `606f5997` and the real session stores on
> one Windows machine (`~/.copilot`, `~/.claude`, `~/.codex`). All counts below
> come from scanning those stores read-only.

---

## 1. Verdict

**Feasible for both. The hardest part is TracePilot itself, not the parsers.**

| Piece of work | Difficulty | Why |
| --- | --- | --- |
| Multi-source foundation in TracePilot | **Medium–High** | Every layer (discovery, path resolution, fingerprints, event cache, indexer, config, UI) assumes one Copilot `session-state/<uuid>/events.jsonl` root. This work was proposed for VS Code in [the VS Code study](vscode-session-support-feasibility.md) but never built. |
| Claude Code provider | **Medium** | One JSONL file per session, close in shape to Copilot's event log. It has excellent per-call token and cache data, and subagents are linked cleanly. The main costs are high-volume record types that must be filtered out and usage records that must be de-duplicated. |
| Codex provider | **Medium–High** | Three generations of rollout format, plus a duplicated item representation inside each file. Subagents are separate threads, and an auto-review "guardian" creates many extra threads. Reasoning and inter-agent payloads are mostly encrypted. The data is large (3.4 GB). |
| Launching, orchestration, config editing for these tools | **Out of scope** | TracePilot's launcher, SDK bridge, live attach, config injector, MCP, skills and agent editors are built on Copilot CLI and its SDK. Supporting other agents there is a separate product decision. |

**Rough effort (one engineer who knows the codebase):**

- Foundation: 2–3 weeks.
- Claude Code (read-only, good parity on Conversation, Metrics, Timeline and Search): 2–3 weeks.
- Codex (same scope): 3–5 weeks.
- Tool-renderer and UI source-awareness: 1–2 weeks.

That totals about **8–13 weeks for both, view-only**. A throwaway spike (sessions list plus Conversation for one source) takes about one week.

**Recommendation:**

1. Build the provider abstraction first; it also unblocks VS Code.
2. Ship Claude Code second.
3. Ship Codex third.
4. Keep both behind an "Experimental" flag, because all three formats are private and change quickly.

---

## 2. What is on disk

### 2.1 Side by side

| | Copilot CLI (supported today) | Claude Code | Codex (CLI, IDE extension and Desktop app) |
| --- | --- | --- | --- |
| Root | `~/.copilot/session-state/` (`COPILOT_HOME`) | `~/.claude/projects/` (`CLAUDE_CONFIG_DIR`) | `~/.codex/sessions/YYYY/MM/DD/`, `~/.codex/archived_sessions/` (`CODEX_HOME`) |
| Unit | Directory per session (UUID) | File per session: `<project-slug>/<uuid>.jsonl` | File per thread: `rollout-<ts>-<uuidv7>.jsonl` |
| Grouping | `cwd`/repository in `workspace.yaml` | Directory named after the cwd (`C--git-TracePilot`) | `cwd` in `session_meta`/`turn_context`; `projects` table in `state_5.sqlite` |
| Metadata file | `workspace.yaml` | None. `cwd`, `gitBranch` and `version` repeat on every record; title in `ai-title` records | `state_5.sqlite` → `threads` (title, name, cwd, git sha/branch/origin, model, effort, tokens_used, source, archived, rollout_path) |
| Event log | `events.jsonl`, envelope `{type, data, id, parentId, timestamp}` | Same file; envelope `{type, uuid, parentUuid, isSidechain, timestamp, message, ...}` | Same file; envelope `{timestamp, ordinal, type, payload}` |
| Subagents | Inline in the parent log (`subagent.*`, `parentToolCallId`) | `<uuid>/subagents/agent-<id>.jsonl` + `agent-<id>.meta.json` (`toolUseId`, `agentType`, `description`) | Separate rollout and thread; `parent_thread_id` in `session_meta`; `thread_spawn_edges` table; `SubAgentActivity` items in the parent |
| Large tool output | Inline | `<uuid>/tool-results/*.txt` | Inline |
| Todos / plan | `session.db`, `plan.md` | Todo tool calls; plan-mode files in `~/.claude/plans/*.md` | `update_plan` tool calls; goals in `goals_1.sqlite` → `thread_goals` |
| Checkpoints / compaction | `checkpoints/`, `session.compaction_*` | `system` / `compact_boundary` (pre/post tokens, trigger, duration) | `compacted` records, `ContextCompaction` items, `response_item:compaction` (encrypted) |
| File history / rewind | `rewind-snapshots/` | `file-history-snapshot`/`-delta` records + `~/.claude/file-history/<session>/<hash>@vN` | None observed |
| "Session is live" signal | `inuse.<pid>.lock` | `~/.claude/sessions/<pid>.json` (`sessionId`, `cwd`, `status: busy/idle`, `version`) | `~/.codex/thread-writer-locks/<thread>.lock` |
| Run totals | `session.shutdown` (tokens, AIC, code changes, per-model metrics) | `cost-state` (USD estimate, API/tool duration, lines ±, per-model usage). Present in only some sessions | Cumulative `token_count.total_token_usage`; `threads.tokens_used` |

### 2.2 Volume on this machine

| | Copilot CLI | Claude Code | Codex |
| --- | --- | --- | --- |
| Sessions | 613 | 55 main + 21 subagent transcripts in 7 project dirs | 818 threads (433 active, 385 archived); 323 are guardian auto-review subagents; 297 spawn edges |
| Size | 6.9 GB | 630 MB | 859 MB active + 2.5 GB archived. `thread_history_1.sqlite` is a further 926 MB |
| Versions seen | many | 2.1.274 → 2.1.289 (12 versions since 2026-09-17) | 0.39.0 → 0.159.2 |
| Clients | CLI | `entrypoint: cli` only | `Codex Desktop` 832, `codex-tui` 203, `codex_vscode` 13 (`session_meta.originator`) |

---

## 3. Claude Code format

### 3.1 Record types (counted across all 76 transcripts)

```
15924 attachment            ← system reminders, env, skills, file snapshots…
10428 assistant:tool_use    10427 user:tool_result
 6506 assistant:thinking     3158 assistant:text       336 user:str
 3999 permission-mode / mode / atis-latch / last-prompt (bookkeeping)
 3819 ai-title     934 file-history-delta   874 pr-link   491 queue-operation
  316 agent-name   295 system   171 file-history-snapshot  116 cost-state
   99 bridge-session  62 frame-link  …
```

`system` subtypes seen: `compact_boundary`, `turn_duration`, `informational`, `local_command`, `away_summary`, `bridge_status`. Around 35 `attachment.type` values were seen. They include `environment`, `model`, `skill_listing`, `instructions`, `prompt_snapshot` (the full system prompt), `edited_text_file`, `plan_mode`, `task_status`, `hook_system_message` and `thinking_drop`.

### 3.2 Facts that drive the parser design

- **Each content block is its own record.** There were 22,426 assistant records but only 10,395 unique `message.id` values, with up to 14 records per message. Every block repeats the same `message.usage`. **Token totals must be de-duplicated by `message.id`/`requestId`, or they inflate by about 2×.**
- **Turns form a tree, not a list.** `uuid`/`parentUuid` link records, and `leafUuid` in `last-prompt` marks the live branch. Rewinds and edits create branches, so turn reconstruction should follow the chain from the leaf.
- **Usage is rich.** Each API call reports `input_tokens`, `cache_read_input_tokens` and `cache_creation_input_tokens`, split into `ephemeral_5m` and `ephemeral_1h`. It also reports `output_tokens`, `thinking_tokens` and `service_tier`/`speed`. This is **observed** cache data, which is stronger than the *predicted* cache expiry TracePilot derives for Copilot.
- **Thinking is mostly redacted.** 6,400 thinking blocks were empty, carrying only a signature; 819 had readable text.
- **Tool results are structured.** `toolUseResult` carries `structuredPatch` + `originalFile` for Edit/Write, `stdout`/`stderr`/`interrupted` for Bash, `filenames`/`numLines` for Grep, and `agentId`/`resolvedModel` for Agent. This maps well onto the existing diff, shell and grep renderers.
- **Subagents link cleanly.** `meta.json` gives `toolUseId`, which becomes the `parentToolCallId` TracePilot already uses. Subagent records also carry `isSidechain: true` and `agentId`.
- **Most volume is noise.** The `attachment` records (system reminders, tool listings, the full prompt snapshot) are most of the volume. They belong on the Events tab, but not in the conversation or FTS index by default.
- **Retention is a concern.** Claude Code deletes old transcripts after `cleanupPeriodDays` (default believed to be 30; verify against current docs). TracePilot's index keeps only derived data, so the Conversation tab would go empty for expired sessions. This needs a decision: accept it, or keep an optional copy.
- **Privacy.** Records include `session_context` (the user's email), `credential_org`, account UUIDs in `bridge-session`, and the full system prompt. Export redaction rules must cover these.

### 3.3 Mapping to TracePilot's model

| TracePilot concept | Claude Code source |
| --- | --- |
| `UserMessage` | `type:user` with string or `text` content and `promptId` |
| `AssistantMessage` / reasoning | `assistant` `text` / `thinking` blocks grouped by `message.id` |
| `ToolExecutionStart`/`Complete` | `tool_use` block ↔ `tool_result` block (`tool_use_id`), plus `toolUseResult` |
| `TurnStart`/`TurnEnd`, duration | `promptId` boundaries; `system:turn_duration` |
| `CompactionComplete` | `system:compact_boundary` (`preTokens`, `postTokens`, `trigger`) |
| `ModelChange` | `message.model` changes; `attachment:model` |
| Shutdown metrics | `cost-state` (when present), otherwise summed per-call usage |
| Summary / title | `ai-title` (latest), `agent-name`, first user prompt |
| Repository | Not recorded. Derive from the cwd's git remote, or `pr-link.prRepository` |
| Session errors / aborts | `[Request interrupted by user]` text; `stop_reason`; `<synthetic>` model records |

---

## 4. Codex format

### 4.1 Record types (counted across all 824 rollouts)

```
137525 event_msg:item_completed        74110 event_msg:token_count
 68351 response_item:reasoning          50778 response_item:custom_tool_call (+50775 output)
 28857 token_usage_record               19987 response_item:message
 14192 response_item:function_call      6751 response_item:agent_message
  6696 turn_context   5518 task_started  5253 task_complete  4684 thread_settings_applied
  3072 world_state    1048 session_meta  654 compacted       65 turn_aborted
   523 {record_type:state} + 220 bare function_call/message/reasoning  ← 2025 legacy format
```

`item_completed.item.type` values: `Reasoning` 58k, `CommandExecution` 40k, `AgentMessage` 12k, `FileChange` 9k, `SubAgentActivity` 6.5k, `UserMessage` 3.3k, `McpToolCall` 3.1k, `ImageView`, `CollabAgentToolCall`, `Extension` (image generation), `ContextCompaction`, `WebSearch`, `FunctionCallOutput` and `DynamicToolCall`.

### 4.2 Facts that drive the parser design

- **There are three format generations.**
  1. A 2025 legacy header (`{id, timestamp, instructions}`) with bare items.
  2. `session_meta` + `response_item` + `event_msg`.
  3. Newer records: `ordinal`, `item_completed`, `token_usage_record`, `world_state` and `thread_settings_applied`.

  The Codex app also **rewrites old rollouts in place**: there is a `rollout-migrations/` directory and a `rollout_migration_state` table. Only the 6 files it skipped still use the legacy shape. Files can therefore change without new activity, which matters for fingerprinting.
- **The same activity is recorded twice.** `response_item` is the model-facing transcript (function calls, `apply_patch` text). `event_msg:item_completed` is the UI-facing view (`CommandExecution` with `exit_code`, `duration`, `stdout`/`stderr`; `FileChange` with per-file changes). A provider must pick one per session (prefer `item_completed` when present) or it double-counts.
- **Subagent rollouts include part of the parent's history.** `subagent_history_start_ordinal` appears in their `session_meta`, and there are more `session_meta` records (1,048) than files (824). Parsing a child naively would duplicate the parent's turns.
- **Most threads may not be what users expect.** 323 of 818 threads are the automatic `guardian` review subagent (`model: codex-auto-review`). The list should hide or fold them by default.
- **Reasoning is mostly encrypted.** `encrypted_content` is always present; only 10,834 of 68,351 reasoning items have a readable `summary`, and `raw_content` was always empty. Inter-agent `agent_message` payloads are also partly `encrypted_content`.
- **Context-window data is good.** `token_count` gives cumulative `total_token_usage` and per-call `last_token_usage` (`input`, `cached_input`, `cache_write`, `output`, `reasoning_output`), plus `model_context_window`. That is enough for context-growth and cache-hit charts. There is no breakdown by system prompt, tools and history, and no TTL.
- **Metadata is already indexed.** `state_5.sqlite` → `threads` holds title, name, cwd, git sha/branch/origin URL, model, reasoning effort, tokens used, archived flag, `rollout_path` and parent/child edges. TracePilot should read it as a **read-only metadata overlay**, opened with `mode=ro`; the Codex app writes it in WAL mode. Rollouts should remain the source of truth. `thread_history_1.sqlite` is Codex's own projection cache and should not be relied on.
- **There is no cost data.** Codex runs on ChatGPT plans or API keys and records tokens only. Any dollar figure would be an API-rate estimate.

### 4.3 Mapping to TracePilot's model

| TracePilot concept | Codex source |
| --- | --- |
| `UserMessage` | `item_completed:UserMessage` (or `response_item:message` role=user, skipping `<environment_context>` injections) |
| `AssistantMessage` | `item_completed:AgentMessage` |
| Reasoning | `Reasoning.summary_text` (when present) |
| Tool start/complete | `CommandExecution`, `FileChange`, `McpToolCall`, `WebSearch`, `ImageView`, `DynamicToolCall` (single completed item, so start = complete) |
| Turn boundaries | `task_started` / `task_complete` / `turn_aborted` (`turn_id`) |
| Model / effort | `turn_context.model` / `effort`; `thread_settings_applied` |
| Subagents | `SubAgentActivity` (`agent_thread_id`, `agent_path`) + child rollout + `thread_spawn_edges` |
| Inter-agent messages | `send_message` / `wait_agent` / `followup_task` calls + `agent_message` records (payload may be encrypted) |
| Todos | Latest `update_plan` arguments (flat list, no dependencies) |
| Objective | `thread_goal_updated` / `goals_1.sqlite` (analogous to Copilot's autopilot objective) |
| Compaction | `compacted`, `ContextCompaction` |

---

## 5. Feature-by-feature fidelity

✅ good · 🟡 partial/derived · ❌ not available · ⛔ Copilot-only by design

| TracePilot feature | Claude Code | Codex | Notes |
| --- | --- | --- | --- |
| Session list, search, FTS | ✅ | ✅ | Repository must be derived for Claude Code |
| Conversation (messages, tools) | ✅ | ✅ | Tool names differ; see §6.4 |
| Reasoning display | 🟡 mostly redacted | 🟡 summaries only | |
| Subagents / agent tree | ✅ | ✅ | Codex needs child-thread stitching and guardian filtering |
| Inter-agent messages view | 🟡 (`SendMessage`, task notifications) | 🟡 (encrypted payloads) | |
| Events tab (raw) | ✅ | ✅ | Show native records; filter noisy types |
| Token metrics per model | ✅ (after de-dup) | ✅ | |
| Cost | 🟡 USD estimate (`cost-state`) | 🟡 estimate from rates | AIC/premium requests do not apply |
| Context window growth | 🟡 total only | 🟡 total + window size | No system/tools/history split |
| Prompt cache | ✅ observed hits/writes + TTL tier | 🟡 observed hits, no TTL | Claude's data is better than Copilot's here |
| Compactions | ✅ | ✅ | |
| Todos tab | 🟡 from tool calls | 🟡 from `update_plan` | No dependency graph |
| Checkpoints / rewind | 🟡 file-history snapshots | ❌ | |
| Explorer tab | 🟡 subagents/, tool-results/ | ❌ single file | |
| Code impact | ✅ `structuredPatch`, `cost-state` lines | ✅ `FileChange` | |
| Live refresh / "running" badge | ✅ `sessions/<pid>.json` | 🟡 writer locks | |
| Alerts / notifications | 🟡 | 🟡 | Rely on the live signal |
| Export | ✅ via turns | ✅ via turns | Extend redaction for Claude Code's `session_context` |
| Import | ❌ | ❌ | Import writes Copilot session dirs |
| Launcher, SDK bridge, live attach, worktree orchestration | ⛔ | ⛔ | |
| Config injector, MCP, skills, agents editors | ⛔ | ⛔ | `.claude/agents` is already discovered for Copilot |

---

## 6. What has to change in TracePilot

The good news from the VS Code study still holds: turn reconstruction (`reconstruct_turns(&[TypedEvent])`), analytics and FTS operate on normalized events and turns. A source that can produce `Vec<TypedEvent>` gets most of the app for free. The hard part is everything that locates, fingerprints and caches those events.

### 6.1 Coupling inventory

There are 342 non-test references to `events.jsonl`, `workspace.yaml` or `session_state_dir`, across about 60 Rust files in every crate. The key ones:

| Assumption | Where |
| --- | --- |
| One root of `<uuid>/` dirs | `tracepilot-core/src/session/discovery.rs` (`discover_sessions`, `resolve_session_path*`) |
| Fingerprint = `workspace.yaml` + `events.jsonl` | `tracepilot-core/src/summary/snapshot.rs` (`SessionFingerprint`, `load_session_snapshot`) |
| Event cache keyed by one file's size/mtime | `tracepilot-tauri-bindings/src/commands/session/shared.rs` (`load_cached_typed_events`) |
| Reindex takes one `session_state_dir` | `tracepilot-indexer/src/indexing/reindex.rs` and its callers |
| One configured Copilot home | `TracePilotConfig.paths`, `tracepilot-core/src/paths.rs` |
| Liveness via `inuse.*.lock` | `discovery.rs::has_lock_file` |
| Copilot wire names on `RawEvent` | Events tab, `SessionEventType`, ~75 typed variants |
| Copilot tool names | `packages/ui/src/components/renderers/registry.ts`, `packages/ui/src/utils/toolCall.ts`, `agentTypes.ts`, `agentComms/*` |
| AIC/premium-request fields | 9 frontend files; `pricing-data.json` is GitHub-billing-centric |

### 6.2 Proposed shape

This is the VS Code study's `SessionProvider` design, with the lessons from these formats added:

```rust
trait SessionProvider: Send + Sync {
    fn source(&self) -> SessionSource;                 // Copilot | ClaudeCode | Codex
    fn discover(&self, cancel: &dyn Fn() -> bool) -> Result<Vec<DiscoveredSession>>;
    fn fingerprint(&self, s: &DiscoveredSession) -> Result<SourceFingerprint>; // multi-file
    fn load_summary(&self, s: &DiscoveredSession) -> Result<SessionSummary>;
    fn load_typed_events(&self, s: &DiscoveredSession) -> Result<ParsedEvents>;
    fn is_live(&self, s: &DiscoveredSession) -> bool;
    fn capabilities(&self) -> SourceCapabilities;     // drives UI gating
}
```

- **Identity.** Add a `session_source` column (new migration) and resolve sessions through the index's `path` column, not `<root>/<id>`. All three use UUIDs (Codex uses v7), so collisions are not a real risk, but resolution must be source-aware. `host_type` is not a source discriminator; the VS Code study made the same point.
- **Fingerprints.** Each source needs a different fingerprint:
  - Claude Code: main JSONL + `subagents/*.jsonl`.
  - Codex: own rollout + child rollouts + `threads.updated_at_ms`.

  Generalize `SessionFingerprint` to a list of `(path, size, mtime)`.
- **Translating to `TypedEvent`.** Fabricate a `RawEvent` whose `type` is a Copilot-equivalent name where a mapping exists. Keep the native record in `data` so the Events tab stays truthful. Unmapped records fall through to `Unknown(String)`, which already exists.
- **Capabilities.** `SourceCapabilities` (has_todos_db, has_aic, has_context_breakdown, has_checkpoints, can_launch, …) hides tabs and KPIs instead of showing zeros.
- **Config.** Add per-source enable toggles and roots that honor `CLAUDE_CONFIG_DIR` and `CODEX_HOME`. Add a Codex option for whether to include archived threads and guardian threads.

### 6.3 Alternative considered: transcoding to Copilot-shaped directories

TracePilot could write synthetic `<uuid>/events.jsonl` + `workspace.yaml` mirrors into an app-owned folder and add that folder as a second root. That needs almost no changes to the indexer or cache, so it is a good **one-week spike** to test the parsers in the real UI.

It is a poor product design:

- It duplicates gigabytes (Codex alone is 3.4 GB).
- It needs a sync daemon.
- It leaves Copilot-only UI visible.
- It still requires fabricating Copilot wire events, which is the same mapping work as the provider approach.

### 6.4 Tool-name normalization

The renderers are keyed by Copilot names: `view`, `edit`, `create`, `grep`, `glob`, `powershell`, `task`, `read_agent`, `write_agent`, `web_fetch`, and others. Argument keys also differ; Copilot `edit` uses `path`/`old_str`/`new_str`, while Claude Code's `Edit` uses `file_path`/`old_string`/`new_string`.

Normalize in the provider, not the UI. Add a `canonical_tool` (or map to the Copilot name) and adapt arguments, keeping the original name for display. Examples:

| Canonical | Claude Code | Codex |
| --- | --- | --- |
| shell | `Bash`, `PowerShell` | `exec`, `shell`, `shell_command`, `CommandExecution` |
| view | `Read` | — (reads happen via shell) |
| edit / create | `Edit`, `Write` (`structuredPatch`) | `apply_patch`, `FileChange` |
| grep / glob | `Grep`, `Glob` | — |
| task (subagent) | `Agent` | `spawn_agent` / `SubAgentActivity` |
| read/write agent | `SendMessage`, `TaskStop` | `send_message`, `wait_agent`, `followup_task`, `interrupt_agent` |
| todos | Todo tools | `update_plan` |
| web | `WebFetch`, `WebSearch` | `WebSearch` item |

Per the repo's [visual regression guidance](../visual-regression.md), synthetic renderer fixtures should be added for each new canonical mapping.

---

## 7. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Private formats change quickly. Claude Code shipped 12 versions in 2.5 weeks; Codex rewrites old rollouts in place | High | Experimental flag; tolerant parsing (everything `Option`, `Unknown` fallbacks, which TracePilot already does); per-source diagnostics; real-data validation spike before each phase |
| Double counting (Claude per-block usage; Codex `response_item` vs `item_completed`; subagent history prefixes) | High | Explicit de-dup rules + fixture tests built from real records |
| Volume: Codex 3.4 GB + guardian threads | Medium | Hide guardian/archived by default; use the `threads` table for the list and parse rollouts lazily or in Phase 2 |
| Claude Code transcript retention (`cleanupPeriodDays`) | Medium | Document it; optionally offer to keep a copy |
| Reading SQLite files another app writes in WAL mode (`state_5.sqlite`) | Medium | `mode=ro`, short-lived connections, never write; treat as optional overlay |
| Sensitive content (email, org/account IDs, full system prompts) | Medium | Exclude `attachment`/bookkeeping records from FTS; extend export redaction |
| User expectations: "why is cost/context breakdown/todos graph empty?" | Medium | Capability-driven UI and a per-source "what's available" note |
| Product identity: README, site and UI copy say "Copilot CLI" in ~95 frontend files | Low | Decide positioning before broad copy changes |

---

## 8. Suggested plan

1. **Spike (1 week).** Write standalone parsers for both formats that emit `Vec<TypedEvent>`. Test them on real data via the transcoding shortcut (§6.3) to see how much of the UI works unchanged. Confirm the de-dup and subagent-stitching rules.
2. **Foundation (2–3 weeks).** Add the `SessionProvider` trait with a Copilot implementation that wraps today's code with no behavior change. Add a `session_source` migration, multi-file fingerprints, a provider-aware event cache, multi-root reindex, config toggles, a source filter in the list and capability gating.
3. **Claude Code (2–3 weeks).** Provider, tool normalization, subagent linking, `cost-state` → metrics, observed prompt-cache windows, liveness from `~/.claude/sessions`.
4. **Codex (3–5 weeks).** `threads`-table overlay, format-generation detection, `item_completed`-first parsing, child-thread stitching, guardian folding, `token_count` → context chart, `update_plan` → todos.
5. **Later, if wanted.** Pricing entries for direct Anthropic/OpenAI rates (the registry already models `provider-wholesale`), cross-tool analytics ("same repo across Copilot, Claude Code and Codex"), and VS Code Copilot Chat on the same abstraction.

## 9. Open questions

- Should TracePilot stay "for Copilot CLI" with experimental extras, or become a general coding-agent session viewer? This affects how much UI copy and branding changes.
- Show guardian/auto-review Codex threads at all, or fold them into their parent?
- Should cost for Claude Code/Codex be shown as API-equivalent USD, or hidden for subscription users?
- Is a TracePilot-owned copy of expiring Claude Code transcripts acceptable, given that it duplicates data the user may expect to be cleaned up?
