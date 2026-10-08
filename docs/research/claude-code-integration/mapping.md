# Claude Code → TracePilot Mapping

> Part of the [Claude Code integration plan](README.md). Counts are from the corpus described in
> [data-comparison.md](data-comparison.md). "L1/L2/L3" are the levels in
> [implementation-plan.md](implementation-plan.md).

**Legend**

| Mark | Meaning |
| --- | --- |
| ✅ | Good fidelity |
| 🟡 | Partial or derived |
| ❌ | Not available |
| ⛔ | Copilot-only by design |
| ⭐ | Better than Copilot |

## 1. Records → normalized events

The provider emits TracePilot's existing `TypedEvent`s, putting Copilot wire names in
`raw.event_type`. The turn reconstructor dispatches on those names and on prefixes such as
`user.`/`assistant.` (`turns/reconstructor/mod.rs:131-170`).

- **`raw.data` always holds the canonical, Copilot-shaped payload** for `raw.event_type`. A
  serialized event stream must reconstruct the same turns when reparsed, because
  `parse_typed_events` derives `typed_data` from `raw.data` (`parsing/events/typed.rs:435`).
- Every emitted event also carries the sanitized **native record**, in `RawEvent.native` once
  F7a lands (in `ClaudeParse.natives` until then). The Events tab can then show what Claude
  Code actually wrote.
- Records with no mapping become `Unknown(<native type>)` events. Their `raw.data` is the
  sanitized native record, which reparses to the same `Other` payload.

| Claude Code record | Count (main) | Emitted event(s) | Notes |
| --- | ---: | --- | --- |
| `user` human prompt (string/text, not meta, no tool_result) | 194 | `user.message` `{content, interactionId: promptId, source: "user", attachments}` | Opens a user turn. Pasted images become attachments |
| `user` slash command / `local-command-stdout` | 22 / 19 | `user.message` `{source: "command-<name>"}` | Matches Copilot's `command-*` sources (`messages.rs:188-197`). A typed `/compact` is written twice: first as plain text (`/compact`, only a `promptId`), then, after the compaction, as the `<command-name>` record. The text opens the command turn and the later record folds into it as `system.message` (S3 census: all 15 such records) |
| `user` isMeta (skill context, auto-continuation) | 101 | Never `user.message`. Skill context → `skill.context_delivered`; other meta → `system.message` (§1.1) | A `user.message` always closes the active turn, whatever its `source` (§1.1) |
| `user` hand-back (`origin.kind: peer`, `handback: true`) | 10 | `subagent.completed` for `origin.from` (agentId → `toolUseId` via meta) plus the agent message | The result text is the subagent's report. No turn |
| `user` / `queue-operation` / `attachment:queued_command` with `<task-notification>` | 25 + 50 + 24 | One `system.notification` `{kind.type: agent_completed \| shell_completed, agentId, status}` per notification, de-duplicated across the three carriers (§1.3). Plus `user.message {source: "system"}` only when the notification wakes an idle session (§1.1) | Same shape Copilot uses. `<usage>` gives subagent totals |
| `user` interrupt marker, `interruptedMessageId` | 9 | `session.warning` `{warningType: "user_interrupt"}`, then `abort` `{reason: "user initiated"}` | Ends the interrupted call (§1.2). The warning makes it an incident in its turn |
| `user` tool result with `toolDenialKind` | 38 | `tool.execution_complete` (failed), then `session.warning` `{warningType: "tool_denied", denialKind}` | A denial incident. When the same record interrupts the call, it adds no second, interrupt warning |
| `user` `isCompactSummary` | 27 | Folded into `session.compaction_complete.summaryContent`. Never `user.message` | |
| `user` tool_result block (+ `toolUseResult`) | 11,437 | `tool.execution_complete` `{toolCallId, success: !is_error, result{content, detailedContent}}` | `detailedContent` is reshaped per tool (§2). Duration is the tool_use → tool_result timestamp |
| `assistant` (first block of a new `message.id`) | 11,398 messages | `assistant.turn_start` `{turnId: message.id, model}` | **One API call is one TracePilot turn**, matching Copilot's round-trip granularity. S3 kept it: a median of 8 turns per interaction (p90 146), against a Copilot median of 41 turns per session |
| `assistant` `text` block | 3,493 | `assistant.message` `{content, messageId}` | Attributed to `agentId` in subagent files |
| `assistant` `thinking` block | 7,150 (88.8% empty) | `assistant.reasoning` when non-empty | Record a `redacted` count for the UI |
| `assistant` `tool_use` block | 11,437 | `tool.execution_start` `{toolCallId, toolName: canonical, arguments: normalized, nativeToolName, mcpServerName?, mcpToolName?}` | §2 |
| `assistant` usage (last record per `message.id`) | 11,398 | **New** `tracepilot.model_call` `{model, requestId, inputTokens (inclusive), cacheReadTokens, cacheWriteTokens, cacheWriteByTtl {"300", "3600"}, outputTokens, reasoningTokens, stopReason}`, owner in the envelope `agentId` | One per call on the visible branch, right after its `assistant.turn_start` and outside the parent chain; the usage is the call's last record. Rewound calls are billed but emit none. Feeds per-turn usage (`ConversationTurn.usage`, and `output_tokens` when no message has them) and indexed cache windows |
| End of a call (§1.2) | — | `assistant.turn_end`, only for completed calls | Not at live EOF and not after an interrupt |
| `assistant` model differs from the previous call | — | `session.model_change` | |
| `assistant` `<synthetic>` + `isApiErrorMessage` | 15 | `session.error` `{errorType: "rate_limit", statusCode: 429}` | Keeps the existing incident logic (`error_type == "rate_limit"`) working |
| `system:compact_boundary` | 27 | `session.compaction_start` + `session.compaction_complete` `{preCompactionTokens, trigger, durationMs}` | |
| `system:turn_duration` | 207 | Ends the open call (§1.2), then shown on the Events tab | No Copilot equivalent; no promptId, so link it by position |
| `system:informational` / `away_summary` / `local_command` | 46 / 35 / 28 | `session.info` | |
| First record | — | **Synthesized** `session.start` `{sessionId, producer: "claude-code", version, startTime, context{cwd, gitRoot, branch, repository}}` | The VS Code study warns against fake Copilot telemetry; `session.start` is safe because it only carries context. **Never synthesize `session.shutdown`** |
| `cost-state` | 132 | Not an event. Becomes **provider metrics** (§3) | |
| `ai-title`, `agent-name`, `pr-link`, `last-prompt`, `mode`, `permission-mode`, `atis-latch` | about 4.4k each | Summary fields (latest wins) and PR links. Hidden from the Events tab by default | |
| `attachment:*` (29 types) | 17,575 | `Unknown("attachment:<type>")`, shown on the Events tab only. **Not indexed for FTS** | `edited_text_file`, `plan_mode`, `task_status` can feed later features |
| `file-history-snapshot` / `-delta` | 203 / 1,034 | L3: checkpoint/rewind view | |
| Subagent file records | 26 files | The same mapping with envelope `agentId`, plus `parentToolCallId = meta.toolUseId` | Inserted into the parent stream as described in §1.3 |

### 1.1 User records that must not open a turn

The reconstructor treats every `user.message` as a new interaction. It finalizes the active turn
and opens another (`turns/reconstructor/messages.rs:39`). `source` only changes the label
(`system_initiated`, `messages.rs:188-197`). So "emit `user.message` with `source: system`"
would split one prompt's work into several turns. Each meta kind therefore maps to an event
that keeps the active interaction:

| Meta record | Emit | Why it keeps the turn |
| --- | --- | --- |
| Skill context (the `isMeta` record after a `Skill` call) | At the `Skill` `tool_use`: `tool.execution_start {toolName: "skill"}`, then `skill.invoked {name}` with `parentId` = that start event. At the meta record: `skill.context_delivered {content}` with `parentId` = the `skill.invoked` id | The reconstructor attaches the skill to the tool call and folds the delivered context (`reconstructor/skills.rs:23-37`) |
| Auto-continuation and other `isMeta` text | `system.message {content}` | Appended to the current turn's system messages (`messages.rs:168-181`) |
| Compaction summary (`isCompactSummary`) | `session.compaction_complete.summaryContent` | Session event, attached to the current turn |
| Subagent hand-back | `subagent.completed` (+ agent message attributed to the subagent) | Subagent events are owned by the tool call |
| Task notification **while a call is running**, or queued (`queue-operation`, `attachment:queued_command`) | `system.notification` only | Session event, no new interaction |
| Task notification that **wakes an idle session**: a standalone `user` record after the previous call ended with `end_turn`, which the model then answers | `system.notification` + `user.message {source: "system", content}` | It really starts a new model interaction. This matches how Copilot logs its own notifications (a system-initiated turn) |
| Slash command output (`local-command-stdout`) | `user.message {source: "command-<name>"}`, only when it is the first record of a new interaction; otherwise `system.message` | Matches Copilot's `command-*` prompts |

**WP1 test:** a fixture holding one human prompt, plus every meta kind above except the
idle-session notification, produces exactly one user turn. Adding an idle-session notification
produces exactly one more turn, with `system_initiated = true`.

### 1.2 Turn boundaries

One API call (`message.id`) is one TracePilot assistant turn. `assistant.turn_end` is
synthesized only when the end is known:

| Situation | Detection | Emit |
| --- | --- | --- |
| Completed call | A later record starts a new `message.id` or a new interaction, or a `system:turn_duration` follows, and every `tool_use` in the call has its `tool_result` | `assistant.turn_end` after the last `tool_result`, emitted when the later record arrives so meta records in between (skill context) still reach the open turn |
| Ended at EOF | The file ends after a call whose last `stop_reason` is final (`end_turn`, `stop_sequence`, `max_tokens`, `refusal`) with no tool result pending | `assistant.turn_end`, so an ended session's last turn is complete |
| Interrupted call | Interrupt marker or `interruptedMessageId` | `abort {reason: "user initiated"}`; no `turn_end`. The open tool calls stay incomplete |
| Missing tool result, not at EOF | Later records exist but a `tool_use` never got a `tool_result` (crash, rewind) | `assistant.turn_end`; the call stays incomplete; diagnostic `missing_tool_results += 1` |
| Live EOF | The file ends inside a call, or with tool results still pending | Nothing. The turn stays open, as a live Copilot turn does |
| Synthetic API error | `<synthetic>` + `isApiErrorMessage` | `session.error`; not a model call |

Apart from the EOF row, `stop_reason` is not used to decide completeness: it is mostly
`null` in subagent files (data-comparison rule 11), and a `null` stop reason never ends a call.

### 1.3 Ordering, ids, branches and subagents

- **Native order.** Records are read in file order, and the Events tab shows them in that order.
- **Event ids.** An event made from a record gets `id = "<record uuid>:<n>"`, where `n` is the
  event's 0-based position among the events from that record. A synthesized event uses
  `"<anchor record uuid>:<kind>"`: `session.start` is anchored on the first record, and
  `turn_end` / `model_change` on the record that triggered them. A `turn_end` at EOF uses
  `"<last record uuid>:eof_turn_end"`, because that record may already anchor the previous
  call's `turn_end`. A record without a uuid uses `line-<n>` (prefixed with the agent id in a
  subagent file). `parentId` is the previous
  event in the same stream unless a rule above sets it, such as the skill links. Ids are
  stable across re-parses of an unchanged file.
- **Duplicate notifications.** One background completion can appear as a `user` record, a
  `queue-operation` and an `attachment:queued_command`. Key it by (`agentId` or task id,
  status) and emit one `system.notification` at the first carrier. Later carriers stay
  native-only on the Events tab; count them in `duplicate_notifications`.
- **Visible branch (rewind and edit forks).**
  - A **fork** is a parent record whose children start different interactions, or different
    `message.id`s that are not parallel `tool_use` blocks of one call.
  - Parallel-tool siblings are the normal shape, not forks: children share a `message.id`,
    or are `tool_result`s of one call.
  - The **visible leaf** is the last main-chain record in file order. Walk `parentUuid` from
    it with a cycle guard, only to learn which child each **fork** kept;
    `logicalParentUuid` is followed only across compaction boundaries.
  - **Abandoned** = the subtrees of a fork's other children. Every other record is visible,
    including the parallel-tool siblings the walk itself never visits. A plain leaf walk
    loses about 9.2k records (data-comparison rule 2), so the walk must never define the
    visible set directly.
  - Records on abandoned branches stay on the Events tab, marked as abandoned in the native
    annotation. They are left out of Conversation turns and counted in diagnostics.
  - Calls on abandoned branches still count toward usage, because they were billed.
  - The corpus had no forks, so a synthetic rewind fixture defines this behaviour. Claude's
    own session reader (the Agent SDK's `get_session_messages`) can be a dev-only comparison
    oracle in S3. It is never a runtime dependency.
- **Subagent insertion.** All observed `Agent` launches are asynchronous
  (`status: "async_launched"`): the `tool_result` comes back immediately and completion
  arrives as a hand-back or notification.
  - Each child stream is inserted as one contiguous block right after its launching
    `tool.execution_start`. It opens with a synthesized `subagent.started`.
  - This position never depends on whether the result exists yet, so live files behave the
    same as ended ones. Ownership comes from `parentToolCallId`, not position.
  - Several children of one launch point are ordered by first-record timestamp, then by
    `agentId`.
  - A nested child (a subagent launched from a subagent file) follows the same rule inside
    its parent child's block.
  - **Missing `meta.json`:** link the child through the `agentId` in the parent's `Agent`
    `toolUseResult`. If neither exists, append it at the end of the stream, owned by its
    `agentId` and with no `parentToolCallId`, and count it in `orphan_subagents`.
  - **Test:** two parallel children and one nested child reconstruct with every child
    attached to the right tool call.

## 2. Tools → canonical kinds → renderers

**Principle:** TracePilot adopts Copilot's tool names as its **canonical vocabulary**; they are
already what every renderer, summarizer and analytics query uses. Neutral names are added only
where Copilot has none.

Each provider ships a **normalization table**, so core match arms never gain per-provider
branches. Each row maps to:
- a canonical name
- an argument rename/reshape
- a result reshape from the native structured result

The native name is kept in `TurnToolCall.native_tool_name` for display and filtering.

Abbreviations in the table: **TUR** = `toolUseResult` (Claude's structured tool result);
**SP** = `structuredPatch`.

| Claude tool | Calls | Canonical | Argument mapping | Result reshape (from TUR) | Renderer | Level |
| --- | ---: | --- | --- | --- | --- | --- |
| `Bash` | 9,172 | `shell` *(new neutral alias of the shell family)* | `command`, `description` as-is. `run_in_background` → `mode: "background"`, `timeout` | `stdout` + `stderr`. Exit code from `returnCodeInterpretation` or `is_error`. `persistedOutputPath` → lazy full output | ShellOutput (title from native name) | L2 |
| `PowerShell` | 690 | `powershell` | as-is | as Bash | ShellOutput | L2 |
| `Read` | 1,308 | `view` | `file_path → path`, `offset/limit → view_range` | Text: content = `file.content`, plus `startLine`. Image: placeholder with dimensions; drop base64 | ViewCode | L2 |
| `Edit` | 700 | `edit` | `file_path → path`, `old_string → old_str`, `new_string → new_str`, keep `replace_all` | Optional: real line numbers from `SP` | EditDiff | L2 |
| `Write` (new file) | ~890 total | `create` | `file_path → path`, `content → file_text` | — (TUR `type: create`) | CreateFile | L2 |
| `Write` (overwrite) | (same) | `apply_patch` | Synthesize unified patch text from `SP` | `SP` → patch | ApplyPatch | L2 |
| `MultiEdit` (not in the current built-in tool list; older transcripts only) | 0 | `apply_patch` | Build a patch from `SP` | | ApplyPatch | L2 |
| `NotebookEdit` | 0 | generic | — | — | Generic | — |
| `Grep` | 127 | `grep` | `pattern`, `path`, `glob`, `output_mode`, `head_limit`, `-n/-A/-B/-C` match; `-i → ignore_case` | Current parser handles Claude's output | GrepResult | L2 |
| `Glob` | 8 | `glob` | as-is | `filenames[]` → newline list | GlobTree | L2 |
| `Agent` (was `Task`) | 26 | `task` | `subagent_type → agent_type` (**required** for subagent detection, `tool_exec.rs:48-53`), `run_in_background → mode`, `model`, `description`, `prompt`, `isolation` kept | `agentId`, `resolvedModel`. Totals come from the task notification, not the result | SubagentCard / Markdown | **L1** |
| `SendMessage` | 1 | `write_agent` | `to → agent_id`, `message` | — | WriteAgent | L2 |
| `TaskStop` / `KillShell` | 13 | `stop_agent` or `stop_powershell` by `task_type` | `task_id → agent_id`/`shellId` | | Generic | L2 |
| `TaskOutput` / `BashOutput` (not observed) | 0 | `read_agent` / `read_powershell` | rename | `<retrieval_status>` → body | ReadAgent / ShellOutput | L3 |
| `Monitor` | 12 | generic | — | — | Generic | — |
| `TaskCreate/Update/List/Get`, legacy `TodoWrite` (default-on only for Opus 4–4.7, Sonnet 4–4.6, Haiku 4.5; not observed) | 0 | `todo` *(new)* | as-is | Latest list. `blockedBy` → dependencies | **New TodoListRenderer**; also synthesizes the Todos tab | L3 |
| `EnterPlanMode` / `ExitPlanMode` | 8 / 8 | `plan` *(new)* | `plan` | TUR `plan`, `filePath` → Overview plan | Markdown | L3 |
| `WebFetch` | 32 | `web_fetch` | `url`, `prompt` | `result` | Markdown | L2 |
| `WebSearch` | 20 | `web_search` | `query` | `results` → annotation JSON for source cards | WebSearch | L2 |
| `Skill` | 3 | `skill` | `skill` already matches | Following isMeta context → skill invocation | Skill row | L2 |
| `AskUserQuestion` | 17 | `ask_user` | `questions[]` → `requestedSchema` (one property per question, `oneOf` options) | `answers` → `{qN: answer}` JSON | AskUser | L2 |
| `ToolSearch` | 40 | generic | — | `matches[]` | Generic | — |
| `mcp__<server>__<tool>` (not observed) | 0 | unchanged | — | — | Generic; backend fills `mcpServerName`/`mcpToolName` (split on `__`, which is unambiguous unlike Copilot's `-`) | L2 |
| Harness tools (`SubagentHandback`, `Artifact`, `ScheduleWakeup`, …) | 23 | unchanged | — | — | Generic | — |

**Implementation rules (C4).** The table lives in `provider/claude_code/tools.rs` (arguments)
and `tool_results.rs` (results).
- A record's TUR is used only when the record carries one `tool_result` and TUR is an object.
  Otherwise the `tool_result` text is the content.
- Shell exit codes go in `shellExecution.exitCode`:
  - success → 0, or 1 when `returnCodeInterpretation` is set (Claude Code writes it only for
    exit code 1);
  - failure → the `Exit code N` first line;
  - background commands (including timed-out ones, which Claude Code backgrounds) and
    interrupts → unknown.
- Shell content is `stdout` then `stderr`. Image output (`isImage`) keeps the `[image]` text,
  and the reader also drops that `stdout`. `persistedOutputPath`/`persistedOutputSize` are
  copied into the result as values; the file is never opened.
- Read content is `N. line` numbered from `file.startLine`. An empty file keeps Claude's text.
- Edit adds `detailedContent` with `@@ -a,b +c,d @@` hunks from `SP`.
- Two names depend on the result, so the start event is rewritten when the result arrives.
  Until then, the start mapping stands:
  - `Write` with TUR `type: update` (and `MultiEdit`) → `apply_patch`, whose argument is
    Copilot's `*** Begin Patch` grammar with the `SP` hunks;
  - `TaskStop` with `task_type: local_bash` → `stop_powershell` with `shellId`; any other
    `task_type` stays `stop_agent`.
- AskUserQuestion questions become `q1`, `q2`, … properties. `multiSelect` uses
  `type: array` with `items.anyOf`. Answers are keyed the same way.
- WebSearch becomes `{text: {value, annotations}}`: string results are joined, and links
  become `url_citation` annotations.

Claude Code tools with no Copilot counterpart render generically (wrench icon, JSON args, plain
text). That is already the fallback.

Copilot-only renderers with no Claude source:
- `sql`
- `store_memory`
- `report_intent` (this also drives the objective banner)
- `list_agents`

**Places that must move to canonical names** so the mapping fixes them all at once:

| Place | Location |
| --- | --- |
| Rust argument summarizer | `turns/ipc.rs:12-105` |
| Shell family | `turns/utils.rs:29-80` |
| Subagent detection | `tool_exec.rs:48` |
| Agent runs | `agent_runs/extract.rs:65,226,276` |
| Skills | `skill_invocations/extract.rs:193` |
| Indexer skip lists and result extraction | `search_writer/content_extraction/limits.rs:13-24`, `tool_extraction.rs:73-135` |
| TS summarizer, icons and categories | `packages/ui/src/utils/toolCall.ts` |
| Renderer registry | `renderers/registry.ts` |
| Shell renderer title | `ShellOutputRenderer` (hard-coded "PowerShell") |

## 3. Metrics, cost and analytics fields

C5 returns totals in the provider snapshot, the consuming summary's
`shutdownMetrics`, and the existing metrics IPC response, without emitting a
`session.shutdown` event. Its optional
`coverage` records the snapshot position, observed call count and tail call count.
`coverage.partial` is always true: even a snapshot with no tail does not prove the
session ended or that every call was persisted. Request counts cover recorded calls
only; side-model token usage from `cost-state` has no recorded request count.
Snapshot durations and line counts retain their recorded coverage; distinct modified
files come from recorded results and edited-file attachments. Indexed Claude catalog
rows expose `metricsPartial: true`, including rows written before C5.

WP13 (C11) prices the tail from recorded calls at verified Anthropic API rates, including
each call's 5m/1h cache-write split. A snapshot-only cost keeps `providerEstimate`; adding
a priced tail or pricing calls without a snapshot uses `tracepilotEstimate`. If any required
model, usage or write tier is unknown, the current `costAmount` is absent. The covered
estimate remains available as `coverage.snapshotCost` with unit `usd` and basis
`providerEstimate`. Existing index
billing columns retain only their Copilot meaning; Claude USD costs are not written
into those columns. Source-aware cost analytics and presentation remain C10/U2/U3.

| TracePilot field | Copilot source | Claude Code source | Fidelity |
| --- | --- | --- | --- |
| Per-model requests | `shutdown.modelMetrics.*.requests.count` | Count of unique `message.id`s per model (transcript); `cost-state` has no count | ✅ |
| Input tokens (inclusive) | `usage.inputTokens` | `cost-state.modelUsage.*.inputTokens + cacheRead + cacheCreation`; per call from `model_call` | ✅ |
| Cache read / write | `usage.cacheReadTokens/cacheWriteTokens` (write often 0 on older runs) | `cacheReadInputTokens` / `cacheCreationInputTokens`, with the 5m/1h split per call | ✅⭐ |
| Output / reasoning | `outputTokens`, `reasoningTokens?` | `outputTokens`, `thinkingTokens` | ✅ |
| Side-model usage (Haiku) | in shutdown | **Only in `cost-state`** | 🟡: per-turn charts won't sum to the session total; show "other / unattributed" |
| AI Credits (`total_nano_aiu`) | observed | `None` | ⛔ |
| Premium requests | `requests.cost` | `None` | ⛔ |
| **Cost** | AIC: `costBasis: billed` from shutdown, or `tracepilotEstimate` from GitHub rates | `cost-state.totalCostUSD`: `costBasis: providerEstimate`, `costUnit: usd`, an API-equivalent estimate and not a bill. With a tail or no snapshot: price the de-duplicated usage with Anthropic API rates (1h writes at 2× input, 5m at 1.25×), `costBasis: tracepilotEstimate`. Vocabulary in [architecture §3.2](architecture.md#32-source-neutral-ir-additions) | 🟡: labelled estimate |
| API duration | `totalApiDurationMs` | `cost-state.totalAPIDuration` (+ `WithoutRetries`) | ✅ |
| Tool duration | per tool | per tool (ts delta) + `cost-state.totalToolDuration` | ✅ |
| Code changes (lines ±) | `codeChanges` | `cost-state.totalLinesAdded/Removed` | ✅ |
| Files modified | `codeChanges.filesModified` | Distinct `filePath` from Edit/Write `toolUseResult` + `attachment:edited_text_file` | ✅ |
| Context gauges (system/tools/conversation) | shutdown / compaction | ❌ split. Exact **total** per call | 🟡 total only |
| Cache windows / TTL | predicted (`usage_checkpoint`) | **Observed** reads and writes per call, with the TTL tier from the `cache_creation` split (all 1h in this corpus). Expiry is still an estimate ([architecture §3.7](architecture.md#37-prompt-cache-expiry-is-an-estimate)) | ✅⭐ |
| Incidents | `session.error`, `abort`, compaction failures | `<synthetic>` 429s, interrupts, `toolDenialKind`, tool errors | ✅ |
| Agent runs | `subagent.*` + `task` calls | `Agent` calls + subagent files + hand-backs + notifications | ✅ |
| Skills | `skill` tool + `skill.invoked` | `Skill` tool + meta context | ✅ |
| Model IDs | `claude-opus-4.6`, `gpt-5.4`, … | `claude-opus-5-5`, `claude-haiku-4-5-20251001` | Alias rule: `-(\d)-(\d)` → `-$1.$2`, strip `-YYYYMMDD`. Then it matches the pricing registry and **the same model can be compared across sources** |

## 4. Feature and tab support

| TracePilot feature | Claude Code | Level | Notes / limitation |
| --- | --- | --- | --- |
| Session list, cards, search (FTS) | ✅ | L1 | Source badge and filter. Attachments are excluded from FTS |
| Title / summary | ✅ | L1 | Latest `ai-title` → `agent-name` → first prompt |
| Repository / branch / cwd | ✅ / ✅ / ✅ | L1 | Repository from `git_state` origin → `pr-link` → none |
| Conversation (prompts, messages, tools) | ✅ | L1 | Generic tool rendering at L1; rich at L2 |
| Reasoning | 🟡 | L1 | 88.8% redacted; show a "redacted" count |
| Subagents (cards, agent tree, Messages view) | ✅ | L1/L2 | Cards at L1; tree, Timeline and Messages at L2 |
| Events tab | ✅ | L1 | Native records; bookkeeping hidden by default |
| Overview | 🟡 | L1 | No checkpoints, `plan.md` or shutdown type. Plan from `ExitPlanMode` at L3 |
| Metrics tab | ✅ | L2 | Exact tokens and cache; USD estimate; no AIC or premium requests |
| Context tab | 🟡 | L2 | Exact total per call; no category split. Estimated split from `prompt_snapshot` at L4 |
| Prompt cache (header countdown, windows) | ✅⭐ | L2 | Observed writes and reads; estimated expiry from the recorded TTL tier, or "unknown" |
| Todos tab | 🟡 | L3 | Only when the task tools were used (older models by default). Otherwise hidden |
| Checkpoints / rewind | 🟡 | L3 | From file-history (no Copilot-style checkpoint summaries) |
| Explorer tab | 🟡 | L3 | `subagents/`, `tool-results/`, plans; there is no session directory per se |
| Timeline (swimlane, waterfall) | ✅ | L2 | Per-call timestamps; tool durations |
| Live refresh / running badge | ✅⭐ | L2 | `sessions/<pid>.json` busy/idle |
| Alerts / notifications | 🟡 | L3 | Based on the liveness status change |
| Analytics dashboard | ✅ | L2 | Source filter; cost split by source |
| Tool analysis | ✅ | L3 | Group by canonical kind with native-name breakdown |
| Code impact | ✅ | L3 | |
| Model comparison | ✅⭐ | L3 | Cross-source comparison of the same model |
| Session comparison | ✅ | L3 | Billing deltas suppressed across sources |
| Export (Markdown/JSON) | ✅ | L3 | Source field; record-level redaction (data-comparison §5) |
| Import | ⛔ | — | Import writes Copilot dirs. Block it for other sources |
| Resume | 🟡 | L2 | "Copy `claude --resume <id>`" (run in the session cwd) |
| Launcher, SDK steering, live attach, config injector, MCP / skills / agents editors, context capture | ⛔ | — | Copilot-only; hidden through capabilities |
| Worktrees, repo registry | ✅ | — | Already generic. The registry picks up Claude cwds via `distinct_session_cwds` |
| Node CLI (`apps/cli`) | ❌ | L4 | Reads Copilot dirs directly |

### Limitations to communicate in the UI

1. **Retention.** Claude Code deletes transcripts after `cleanupPeriodDays` (default 30;
   Desktop/Cowork sessions are exempt). Per decision D3, TracePilot respects that rolling
   window: expired sessions leave the index on the next reindex, the same as deleted Copilot
   sessions. Analytics therefore cover roughly the last 30 days of Claude Code use. An opt-in
   archive (E1) is deferred.
2. **Thinking** is mostly redacted by Claude Code itself.
3. **The context split** is not recorded.
4. **Cost** is an API-equivalent estimate, not a bill. Subscription users pay differently.
5. **Side-model usage** (Haiku) appears only in session totals, not per turn.
6. **Background task output** in `%TEMP%` may be gone. Show the notification summary only.
7. **No todos** unless Claude Code's task tools were used. They are default-on only for older models.
8. **No launching or steering** from TracePilot.
9. **Fast-moving format.** Unknown records show up on the Events tab, and a per-source
   diagnostics panel reports unmapped types.
10. **The corpus is one user's.** MCP, `Task*`/`TodoWrite`, team tools and macOS paths were
    not observed. Handling for them is designed from public docs and must be
    flagged as unverified until real samples exist.
