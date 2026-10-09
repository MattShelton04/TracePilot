# Claude Code vs Copilot CLI — Data Comparison

> Part of the [Claude Code integration plan](README.md). All numbers come from read-only scans
> of one Windows machine on 2026-10-05. They are a single user's corpus, so treat rates as
> indicative and structural findings as strong.
>
> - **Claude Code:** 62 main transcripts and 26 subagent transcripts in 7 project dirs. 679 MB
>   total, of which 551 MB is main transcripts. Versions 2.1.274 → 2.1.289; 2026-09-17 →
>   2026-10-05; `entrypoint: cli` on all 58,042 records.
> - **Copilot CLI:** 618 session dirs. 407 have `events.jsonl` (873,264 lines, 2.60 GB, 0
>   malformed). 50 CLI versions, 0.0.409 → 1.0.91; 2026-02-13 → 2026-10-04.

## 1. Side by side

| | Copilot CLI | Claude Code |
| --- | --- | --- |
| Root | `~/.copilot/session-state/` (`COPILOT_HOME`) | `~/.claude/projects/` (`CLAUDE_CONFIG_DIR`) |
| Unit | Directory per session `<uuid>/` | File per session `<cwd-slug>/<uuid>.jsonl`. The slug is lossy (`C:\git\TracePilot` → `C--git-TracePilot`); read `cwd` from the records instead |
| Event envelope | `{type, data, id, parentId, timestamp, agentId?}` | `{type, uuid, parentUuid, logicalParentUuid?, isSidechain, timestamp, sessionId, cwd, gitBranch, version, agentId?, …}` plus a per-type body |
| Metadata | `workspace.yaml`: cwd, git_root, branch, repository (507/618), summary, name | None. Inferred as follows: `cwd`/`gitBranch` on 100% of user and assistant records; title from `ai-title` (re-emitted each turn, latest wins) and `agent-name`; repository from `serverClassifierContext.git_state.visibility.origin` (owner/repo) or `pr-link.prRepository` |
| Turn unit | `user.message` (interaction), then `assistant.turn_start/turn_end` per model round-trip. Median 41 turns and 2 user messages per session | One record **per content block**. Group blocks by `message.id`: one id is one API call. `promptId` is on every user record; `system:turn_duration` closes a prompt (207 in total) |
| Messages / reasoning | `assistant.message` with `toolRequests[]`; reasoning sometimes present | `text` / `thinking` / `tool_use` blocks. **7,070 of 7,960 thinking blocks are empty** (88.8%, signature only) |
| Tool calls | `tool.execution_start` + `tool.execution_complete` joined by `toolCallId`. Complete events carry no `toolName`. 268k calls, 98.6% succeed | `tool_use` block ↔ `tool_result` block (`tool_use_id`) plus a structured **`toolUseResult`**. That is an object on success (12,878) and a plain string `"Error: …"` when `is_error` (299 of 299) |
| Large output | Inline. `content` is capped around 20 KB, except `view` | Over about 40 KB: `<persisted-output>` preview plus a file under `<sid>/tool-results/` (61 files, all referenced) |
| Subagents | **Inline** in the parent log. Events carry `parentToolCallId`; 67% of all tool calls run inside subagents | **Separate files**: `<sid>/subagents/agent-<id>.jsonl` plus `.meta.json` (`toolUseId`, `agentType`, `description`, `spawnDepth`, worktree info). `toolUseId` matches the parent `Agent` call 26 of 26 times. Records are `isSidechain: true` with `agentId`. No usage is shared with the parent file |
| Subagent result | `subagent.completed` (`totalTokens`, `totalToolCalls`, `durationMs`, in 1,914 of 5,496) | The `Agent` tool result only says `async_launched`. The report arrives later as an `isMeta` user record (`origin.kind: peer`, `handback: true`). Totals come in a `<task-notification><usage>` inside `queue-operation` or `attachment:queued_command` |
| Per-call usage | **None in the normal stream.** Only `assistant.message.outputTokens` | **Every API call**: `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` split into `ephemeral_5m`/`ephemeral_1h`, `output_tokens`, `output_tokens_details.thinking_tokens`, `server_tool_use`, `iterations[]` |
| Session totals | `session.shutdown` once per process run (600 in 386 sessions), with per-model `requests{count,cost}`, `usage{input, output, cache_read, cache_write, reasoning}`, `totalNanoAiu`, `codeChanges`, and context gauges | `cost-state` written at exit (132 in 61 of 62 sessions; 2 per run, 4 for resumed sessions). Holds `totalCostUSD`, API/tool/wall durations, lines ±, and `modelUsage{model: tokens, costUSD}` |
| Token semantics | `inputTokens` **includes** cache read and write (e.g. 97,702 = 79,528 + 18,156 + 18) | `input_tokens` **excludes** cache read and creation (the Anthropic API convention) |
| Cache TTL | Predicted from `session.usage_checkpoint` (58 events, newest versions only) | **Observed**: 10,107 of 10,120 API calls wrote 1h-TTL cache and 0 wrote 5m |
| Context window | `systemTokens` / `toolDefinitionsTokens` / `conversationTokens` split at shutdown and compaction | Exact total per call (input + cache read + cache creation). No split. The full system prompt and tools are in `attachment:prompt_snapshot` (225) |
| Compaction | `session.compaction_start/complete` (724 / 718) | `system:compact_boundary` (30). `compactMetadata` has `trigger`, `preTokens`, `postTokens`, `durationMs` and `preservedSegment`. The next `isCompactSummary` user record holds the summary |
| Todos / plan | `session.db` `todos` + `todo_deps` (232 sessions); `plan.md` (148) | No `TodoWrite`/`Task*` calls in this corpus: the task tools are default-on only for older models (Opus 4–4.7, Sonnet 4–4.6, Haiku 4.5), and every call here used Opus 5.x, so they are out of scope. Plan mode: `EnterPlanMode`/`ExitPlanMode` (8 each), `~/.claude/plans/<slug>.md` |
| Checkpoints / rewind | `checkpoints/` (all dirs), `rewind-snapshots/` (298) | `file-history-snapshot` (203) / `file-history-delta` (1,034) → `~/.claude/file-history/<sid>/<hash>@vN` (1,042 files, all resolve) |
| Liveness | `inuse.<pid>.lock` (44) plus activity in the last 24h | `~/.claude/sessions/<pid>.json`: `sessionId`, `status: busy/idle`, `procStart` (guards against PID reuse), `updatedAt`. **Richer than Copilot's lock** |
| Errors | `session.error` (rate_limit 80, …), `abort` (251) | `<synthetic>` model records (15; 14 are 429 session-limit errors with `quotaLimits`), `[Request interrupted by user]` (9), `toolDenialKind` (38) |
| Background work | `system.notification` (`agent_completed`, `shell_completed`) | `run_in_background` (Bash 58, PowerShell 26) → `<task-notification>`. Output is in `%TEMP%\claude\<slug>\<sid>\tasks\*.output`, **outside `~/.claude`** |
| Bookkeeping noise | `hook.*` (5.4% of bytes) | `attachment` (19,460 records, 29 types), plus `mode`/`permission-mode`/`atis-latch`/`last-prompt` (about 4.4k each) and `ai-title` (4,221). Keep the latest value or show on the Events tab only |
| Retention | Kept until the user deletes them | **Deleted after `cleanupPeriodDays`** (default 30 per the docs; unset on this machine). The oldest file is 18 days old, so expiry is not yet observed |

## 2. Parser rules the data forces

These are requirements for `ClaudeCodeProvider`. Each one is backed by a measured case.

1. **Process records in file order, never by timestamp.** Timestamps go backwards 3,950 times
   (median 5 ms, max 339 s). The causes are attachments, `file-history-delta` and `pr-link`
   written out of order.
2. **Do not reconstruct the conversation by walking `parentUuid` from the leaf.**
   - There were 0 rewind or edit forks across 62 sessions. All 1,093 multi-child parents are
     the parallel-tool shape.
   - A leaf walk skips about 9.2k records.
   - The `logicalParentUuid` chain **cycles in 12 of 62 sessions**: a compaction's logical
     parent is a preserved record written *after* the boundary.
   - Use uuids only for annotation, with a cycle guard.
   - This **refutes** the earlier study's "follow `leafUuid`" advice.
   - Having no forks in this corpus does not show forks are handled. Event order stays file
     order. Conversation shows the visible branch, defined in
     [mapping.md §1.3](mapping.md#13-ordering-ids-branches-and-subagents) and tested with a
     synthetic rewind fixture.
3. **De-duplicate usage by `message.id`, taking the *last* record.**
   - 24,670 assistant records collapse to 11,398 messages (up to 19 records per message).
   - Naive sums inflate by 2.15× for input, 2.16× for cache read, 2.36× for cache creation and
     2.56× for output.
   - In 189 messages `output_tokens` grows across the block records. Taking the first record
     undercounts output by 5%.
   - `requestId` maps 1:1 to `message.id`.
4. **Normalize token semantics at ingest.** TracePilot input = `input_tokens` +
   `cache_read_input_tokens` + `cache_creation_input_tokens`, to match Copilot's inclusive
   `inputTokens`. Analytics computes non-cached input as `input − cache_read`
   (`analytics/dashboard/models.rs:139-152`); feeding it Anthropic's exclusive value makes every
   cache rate wrong.
5. **Treat `cost-state` as authoritative for session totals, and transcripts for per-call
   detail.**
   - `cost-state` totals are always at least the transcript sums. They include Haiku side calls
     (`claude-haiku-4-5-20251001` never appears in any transcript), subagents, and calls that
     are not persisted, such as compaction.
   - Example session: cost-state output was 1,048,530; the main transcript had 383,519 and
     its subagents 377,141.
   - Never add subagent usage on top of `cost-state`; it already includes it.
   - Unpersisted calls make the gap legitimately large. Two ended sessions are 7% and 13%
     above their transcript sums on the *same* model, so reconcile rather than gate on a
     percentage ([implementation-plan.md L0](implementation-plan.md#l0--spike-validate-before-building)).
   - **Snapshots are cumulative across resumes.** In all 5 resumed sessions, the later
     snapshot equals the earlier one plus the calls written between them, exactly to the
     token. Each exit writes an identical pair.
   - A snapshot covers the records before its file position. Current total = last snapshot +
     de-duplicated calls after it (the tail).
   - A session never yet exited has no `cost-state`, and a resumed one that is still running
     has a non-empty tail. In both cases, add or fall back to the de-duplicated transcript sum
     and label the total partial.
6. **Classify `user` records before treating them as prompts.** In main files there are:

   | Kind | Count |
   | --- | ---: |
   | tool_result | 11,437 |
   | Human prompts | 194 (178 with `origin.kind = human`) |
   | `isMeta` (including 10 subagent hand-backs, `origin.kind = peer`) | 101 |
   | `isCompactSummary` | 27 |
   | Slash commands (`<command-name>`) | 22 |
   | `local-command-stdout` | 19 |
   | Task notifications | 25 |
   | Interrupt markers | 9 |

   Only human prompts open a user turn.
7. **`toolUseResult` is polymorphic**: a string exactly when `is_error`, an object otherwise.
   Content blocks may be a string, `text[]`, `image[]` (Read on images, 802) or
   `tool_reference[]` (ToolSearch).
8. **Bound memory on huge lines.** The largest line is 1.36 MB and 63 lines exceed 1 MB. All
   of them are Read results on images, whose base64 is stored twice (message plus
   `toolUseResult.file.base64`). Don't keep image base64 in the turn cache or the FTS index.
9. **Expect the live file to be appended while it is read.** Tolerate a partial last line. The
   existing `visit_events_jsonl` already skips malformed lines.
10. **Expect unknown record types and keys every release.** 19 record types and 29 attachment
    types were seen, and new keys appeared within 18 days. Everything is `Option`; unknown
    records become events with the native record attached, so the Events tab stays truthful.
11. **Subagent `stop_reason` is mostly `null`** (964 of 1,212). Don't infer "incomplete" from
    it.
12. **The tool set depends on the environment.** This corpus has harness tools
    (`SubagentHandback`, `Artifact`, `ScheduleWakeup`, `Monitor`) and no MCP calls. Unknown
    tools must render generically, which already works.

## 3. Corrections to the earlier study

| Earlier claim ([feasibility §3](../codex-claude-code-session-support-feasibility.md)) | Now | Impact |
| --- | --- | --- |
| About 35 attachment types | 29 | None |
| Usage repeats per block; de-dup by `message.id` (about 2×) | Confirmed: 2.15–2.56×. **Take the last record** | Parser rule 3 |
| Turns form a tree; follow `leafUuid` from `last-prompt` | **Refuted.** No forks seen; leaf walks lose records and cycle in 12 sessions | Parser rule 2 |
| `thinking_tokens` in usage | Under `usage.output_tokens_details.thinking_tokens` | Field path |
| `cost-state` "present in only some sessions" | 61 of 62 (all except the live one); written at exit | It can be the primary total |
| Subagent totals available from the Agent result | **No.** The Agent result only says `async_launched`; totals come in `<task-notification><usage>` | Subagent card stats need the notification, or must be summed from the subagent transcript |
| Repository is "not recorded" | `serverClassifierContext.git_state.visibility.origin` holds host/owner/repo (7,575 records) | Use with fallbacks; undocumented field |
| Prompt cache: "observed hits/writes + TTL tier" | Confirmed, and **every write is 1h TTL** (10,107 of 10,120) | Cache-expiry UI must use 60 min; pricing must use the 1h write rate |
| Thinking "mostly redacted" | 88.8% empty | Same |
| Retention default 30 days | **Confirmed** by [Claude Code docs](https://code.claude.com/docs/en/data-usage#data-retention): `cleanupPeriodDays`, default 30; Desktop/Cowork sessions exempt. Not overridden on this machine | Sessions lapse with the window (decision D3) |

The frontend audit also claimed that Claude's `Read` line numbering does not match the `view`
renderer's regex. **That is wrong for current versions.** The observed `58\t…` form matches
`/^(\d+)(?:\. |\t|: ?)(.*)$/` in `packages/ui/src/utils/toolFileContent.ts:5`. The real hazard
is trailing reminder text appended to the result, which breaks the "every line numbered" rule.
Build the `view` content from `toolUseResult.file.content` + `startLine` instead.

## 4. What Claude Code has that Copilot does not

This is worth surfacing, not just tolerating:

- **Per-call usage and observed cache behaviour.** This allows exact per-turn token and cost
  charts, context growth per call, and real cache hits, writes and expiry. For Copilot,
  TracePilot predicts these from sparse checkpoints.
- **Precise liveness and busy/idle status** from `sessions/<pid>.json`.
- **Per-tool durations** with 0 negative intervals. Medians: Bash 1.5 s, PowerShell 5.7 s,
  Read 0.03 s, Edit 1.6 s.
- **Structured edit patches** (`structuredPatch` with real line numbers, `originalFile`).
  These give better diffs than Copilot's `old_str`/`new_str` snippets.
- **PR links** (`pr-link`: 935 records, 49 distinct PRs) for linking sessions to PRs.
- **Git working-tree state per request** (`git_state.status`).

## 5. Privacy inventory

Redact these from export, and exclude them from FTS by default:

| Data | Where |
| --- | --- |
| User email | `attachment:session_context.context.userEmail` and its `rendered[]` (113); also in tool stdout (9) |
| Org / account IDs | `credential_org.organizationUuid` (82), `bridge-session.owner*Uuid` (99), `artifact-autoreact-ledger.accountUuid` (3) |
| Full system prompt and tools | `attachment:prompt_snapshot` (225) |
| Full CLAUDE.md / AGENTS.md text | `attachment:instructions`, `nested_memory` |
| Exact model-facing text | `attachment.rendered[]` (14,918) |
| Plan and quota status | `quotaLimits` on 429 records |
| Remote-control URLs | `system:bridge_status.url` (repeated in its `content`), `frame-link.frameUrl` |
| Tool I/O | Duplicated 2–4× per call (`input`, `wireToolInputs`, `toolUseResult`, `bashEditDiff`). Secrets in tool I/O were seen in 2 sessions |

The export redaction engine is generic regex over all JSON strings
(`tracepilot-export/src/redaction/engine.rs`). It covers the content when the user turns it on.
The record-level rules (C14, `tracepilot-core/src/provider/claude_code/privacy.rs`) apply to
every Claude Code export, whatever the user's redaction options:
- The email, org and account ids, `quotaLimits` and `frameUrl` are redacted at any depth.
- Attachment `rendered[]` and the `system:bridge_status` URL and `content` are redacted.
- `prompt_snapshot`, `instructions` and `nested_memory` attachments keep only their `type`.
- The `wireToolInputs` and `bashEditDiff` copies are omitted. `input` and `toolUseResult`
  stay, so secrets in tool I/O still need the user's secret redaction.

FTS never indexes these records (C6).
