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
`user.`/`assistant.` (`turns/reconstructor/mod.rs:131-170`). Every emitted event also carries
the **native record** in a new `RawEvent` field, so the Events tab can show what Claude Code
actually wrote. Records with no mapping become `Unknown(<native type>)` events.

| Claude Code record | Count (main) | Emitted event(s) | Notes |
| --- | ---: | --- | --- |
| `user` human prompt (string/text, not meta, no tool_result) | 194 | `user.message` `{content, interactionId: promptId, source: "user", attachments}` | Opens a user turn. Pasted images become attachments |
| `user` slash command / `local-command-stdout` | 22 / 19 | `user.message` `{source: "command-<name>"}` | Matches Copilot's `command-*` sources (`messages.rs:188-197`) |
| `user` isMeta (skill context, auto-continuation) | 101 | `user.message` `{source: "system"}` or folded into the skill invocation | The skill context follows the `Skill` call |
| `user` hand-back (`origin.kind: peer`, `handback: true`) | 10 | `subagent.completed` for `origin.from` (agentId → `toolUseId` via meta) plus the agent message | The result text is the subagent's report |
| `user` / `queue-operation` / `attachment:queued_command` with `<task-notification>` | 25 + 50 + 24 | `system.notification` `{kind.type: agent_completed \| shell_completed, agentId, status}` | Same shape Copilot uses. `<usage>` gives subagent totals |
| `user` interrupt marker, `interruptedMessageId` | 9 | `abort` `{reason: "user initiated"}` | |
| `user` `isCompactSummary` | 27 | Folded into `session.compaction_complete.summaryContent` | |
| `user` tool_result block (+ `toolUseResult`) | 11,437 | `tool.execution_complete` `{toolCallId, success: !is_error, result{content, detailedContent}}` | `detailedContent` is reshaped per tool (§2). Duration is the tool_use → tool_result timestamp |
| `assistant` (first block of a new `message.id`) | 11,398 messages | `assistant.turn_start` `{turnId: message.id, model}` | **One API call is one TracePilot turn**, matching Copilot's round-trip granularity. To be validated in the spike |
| `assistant` `text` block | 3,493 | `assistant.message` `{content, messageId}` | Attributed to `agentId` in subagent files |
| `assistant` `thinking` block | 7,150 (88.8% empty) | `assistant.reasoning` when non-empty | Record a `redacted` count for the UI |
| `assistant` `tool_use` block | 11,437 | `tool.execution_start` `{toolCallId, toolName: canonical, arguments: normalized, nativeToolName, mcpServerName?, mcpToolName?}` | §2 |
| `assistant` usage (last record per `message.id`) | 11,398 | **New** `tracepilot.model_call` `{model, input (inclusive), cacheRead, cacheWrite, cacheWrite5m, cacheWrite1h, output, reasoning, stopReason, agentId}` | Feeds metrics, context, prompt cache and per-turn usage. Also sets `output_tokens` on the turn |
| End of a message's tool results / next message | — | `assistant.turn_end` | |
| `assistant` model differs from the previous call | — | `session.model_change` | |
| `assistant` `<synthetic>` + `isApiErrorMessage` | 15 | `session.error` `{errorType: "rate_limit", statusCode: 429}` | Keeps the existing incident logic (`error_type == "rate_limit"`) working |
| `system:compact_boundary` | 27 | `session.compaction_start` + `session.compaction_complete` `{preCompactionTokens, trigger, durationMs}` | |
| `system:turn_duration` | 207 | Annotates the user interaction's duration | No Copilot equivalent; no promptId, so link it by position |
| `system:informational` / `away_summary` / `local_command` | 46 / 35 / 28 | `session.info` | |
| First record | — | **Synthesized** `session.start` `{sessionId, producer: "claude-code", version, startTime, context{cwd, gitRoot, branch, repository}}` | The VS Code study warns against fake Copilot telemetry; `session.start` is safe because it only carries context. **Never synthesize `session.shutdown`** |
| `cost-state` | 132 | Not an event. Becomes **provider metrics** (§3) | |
| `ai-title`, `agent-name`, `pr-link`, `last-prompt`, `mode`, `permission-mode`, `atis-latch` | about 4.4k each | Summary fields (latest wins) and PR links. Hidden from the Events tab by default | |
| `attachment:*` (29 types) | 17,575 | `Unknown("attachment:<type>")`, shown on the Events tab only. **Not indexed for FTS** | `edited_text_file`, `plan_mode`, `task_status` can feed later features |
| `file-history-snapshot` / `-delta` | 203 / 1,034 | L3: checkpoint/rewind view | |
| Subagent file records | 26 files | The same mapping with envelope `agentId`, plus `parentToolCallId = meta.toolUseId` | Merged into the parent stream in file order, after the Agent launch |

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

| TracePilot field | Copilot source | Claude Code source | Fidelity |
| --- | --- | --- | --- |
| Per-model requests | `shutdown.modelMetrics.*.requests.count` | Count of unique `message.id`s per model (transcript); `cost-state` has no count | ✅ |
| Input tokens (inclusive) | `usage.inputTokens` | `cost-state.modelUsage.*.inputTokens + cacheRead + cacheCreation`; per call from `model_call` | ✅ |
| Cache read / write | `usage.cacheReadTokens/cacheWriteTokens` (write often 0 on older runs) | `cacheReadInputTokens` / `cacheCreationInputTokens`, with the 5m/1h split per call | ✅⭐ |
| Output / reasoning | `outputTokens`, `reasoningTokens?` | `outputTokens`, `thinkingTokens` | ✅ |
| Side-model usage (Haiku) | in shutdown | **Only in `cost-state`** | 🟡: per-turn charts won't sum to the session total; show "other / unattributed" |
| AI Credits (`total_nano_aiu`) | observed | `None` | ⛔ |
| Premium requests | `requests.cost` | `None` | ⛔ |
| **Cost** | AIC (billed, or estimated from GitHub rates) | `cost-state.totalCostUSD`, an **API-equivalent estimate** (`cost_basis = provider-estimate-usd`). Fallback: price de-duplicated usage with Anthropic API rates (1h writes at 2× input, 5m at 1.25×) | 🟡: labelled estimate |
| API duration | `totalApiDurationMs` | `cost-state.totalAPIDuration` (+ `WithoutRetries`) | ✅ |
| Tool duration | per tool | per tool (ts delta) + `cost-state.totalToolDuration` | ✅ |
| Code changes (lines ±) | `codeChanges` | `cost-state.totalLinesAdded/Removed` | ✅ |
| Files modified | `codeChanges.filesModified` | Distinct `filePath` from Edit/Write `toolUseResult` + `attachment:edited_text_file` | ✅ |
| Context gauges (system/tools/conversation) | shutdown / compaction | ❌ split. Exact **total** per call | 🟡 total only |
| Cache windows / TTL | predicted (`usage_checkpoint`) | **Observed** per call; TTL 1h | ✅⭐ |
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
| Prompt cache (header countdown, windows) | ✅⭐ | L2 | Observed writes and reads, 1h TTL |
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
