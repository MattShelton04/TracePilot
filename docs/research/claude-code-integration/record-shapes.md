# Claude Code Record Shapes

> Part of the [Claude Code integration plan](README.md). This is a **synthetic** reference for
> fixture builders and parser work. Each shape below was confirmed against real Claude Code
> 2.1.274–2.1.289 transcripts.
>
> All values are invented: ids, paths, text and numbers. Never copy real transcripts into
> fixtures or commits. They contain emails, org ids, full system prompts and private code (see
> [data-comparison §5](data-comparison.md#5-privacy-inventory)).
>
> Fields marked *(opt)* are absent on some records or versions. Parse every field as optional
> and ignore unknown keys.

## Files

```text
<CLAUDE_CONFIG_DIR or ~/.claude>/
  projects/<cwd-slug>/<session-uuid>.jsonl                   main transcript; appended on resume
  projects/<cwd-slug>/<session-uuid>/subagents/agent-<agentId>.jsonl
  projects/<cwd-slug>/<session-uuid>/subagents/agent-<agentId>.meta.json
  projects/<cwd-slug>/<session-uuid>/tool-results/<id>.txt   oversized tool output
  projects/<cwd-slug>/memory/                                not session data; skip
  sessions/<pid>.json                                        exists only while that process runs
  file-history/<session-uuid>/<hash16>@v<N>                  file backups
  plans/<slug>.md                                            plan-mode files, named by record `slug`
```

- **Slug:** `<cwd-slug>` replaces path separators and `:` with `-` (`C:\work\demo` →
  `C--work-demo`). It is lossy, so take `cwd` from the records.
- **Retention:** Claude Code deletes transcripts after `cleanupPeriodDays` (default 30). Sessions
  started or continued in Claude Desktop or Cowork are exempt by default. Source:
  [Claude Code data usage](https://code.claude.com/docs/en/data-usage#data-retention), checked
  2026-10-05.

## Common envelope

The `user`, `assistant`, `system` and `attachment` records share this envelope:

```json
{
  "type": "user",
  "uuid": "00000000-0000-4000-8000-000000000101",
  "parentUuid": "00000000-0000-4000-8000-000000000100",
  "logicalParentUuid": null,
  "isSidechain": false,
  "timestamp": "2026-09-20T10:00:00.000Z",
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "cwd": "C:\\work\\demo",
  "gitBranch": "main",
  "version": "2.1.280",
  "entrypoint": "cli",
  "userType": "external",
  "slug": "quiet-blue-otter",
  "agentId": "a0123456789abcdef"
}
```

Field notes:
- `logicalParentUuid` appears on `compact_boundary` records.
- `slug` is optional.
- `agentId` appears only in subagent files.
- `parentUuid` is `null` on the first record and on every `compact_boundary`. Do not walk it
  to rebuild order; see [data-comparison §2](data-comparison.md#2-parser-rules-the-data-forces).
- Bookkeeping records (`ai-title`, `custom-title`, `cost-state`, `queue-operation`, `last-prompt`,
  `mode`, …) carry only `type`, `sessionId` and their own fields.

## User records

### Human prompt (opens a user turn)

```json
{ "type": "user", "promptId": "22222222-2222-4222-8222-222222222201",
  "message": { "role": "user", "content": "Add a retry to the upload client." },
  "origin": { "kind": "human" }, "promptSource": "typed", "turnOrigin": "human",
  "permissionMode": "auto" }
```

- `content` may instead be `[{ "type": "text", "text": "…" }, { "type": "image", "source": { … } }]`.
- Pasted text is inline, each block on its own lines between `<pasted_content id="1">` and
  `</pasted_content id="1">`; the closing tag repeats the id. The Conversation tab shows each
  block as pasted text.
- Older versions omit `origin`, `promptSource` and `turnOrigin`.

### Classifying the other `user` records

| Kind | How to recognise it |
| --- | --- |
| Tool result | `message.content[]` contains `tool_result` blocks (below) |
| Slash command | String content starts with `<command-name>` or `<command-message>`; `<command-args>` holds the arguments |
| Local command output | String content starts with `<local-command-stdout>` or `<local-command-stderr>`; may hold terminal colour codes |
| Local command caveat | `isMeta: true`; content starts with `<local-command-caveat>` (an instruction to the model) |
| Compact summary | `isCompactSummary: true` (+ `isVisibleInTranscriptOnly: true`) |
| Subagent hand-back | `isMeta: true`, `origin: { "kind": "peer", "from": "<agentId>", "handback": true, "body": "…" }` |
| Task notification | `origin: { "kind": "task-notification" }`, `turnOrigin: "task_notification"`; content is `<task-notification>…` |
| Other meta | `isMeta: true` (skill context, auto-continuation `origin.kind: "auto-continuation"`) |
| Interrupt marker | Text `[Request interrupted by user]` or `[Request interrupted by user for tool use]` |
| Subagent initial prompt | First record of a subagent file; `parentUuid: null` |

### Tool result

```json
{ "type": "user", "promptId": "22222222-2222-4222-8222-222222222201",
  "sourceToolAssistantUUID": "00000000-0000-4000-8000-000000000201",
  "message": { "role": "user", "content": [
    { "type": "tool_result", "tool_use_id": "toolu_demo_01", "is_error": false,
      "content": "ok" } ] },
  "toolUseResult": { "stdout": "ok\n", "stderr": "", "interrupted": false,
                     "isImage": false, "noOutputExpected": false } }
```

- **When `is_error` is true, `toolUseResult` is a plain string**, for example
  `"Error: Exit code 1\nmv: permission denied"`. Otherwise it is an object.
- `content` may be a string, `[{type:"text"}]`, `[{type:"image"}]` (Read on an image), or
  `[{type:"tool_reference"}]` (ToolSearch).
- A refused tool use carries a record-level `toolDenialKind` next to `toolUseResult`:
  `user-rejected`, `permission-rule`, `automode-blocked` or `automode-unavailable`
  (all four seen in the S3 corpus). A rejection can also carry the interrupt marker in the
  same record.

**`toolUseResult` object shapes** (successful calls):

| Tool | Shape |
| --- | --- |
| Bash | `{ stdout, stderr, interrupted, isImage, noOutputExpected, returnCodeInterpretation?, backgroundTaskId?, persistedOutputPath?, persistedOutputSize?, timedOutAfterMs? }` |
| PowerShell | `{ stdout, stderr, interrupted, isImage, backgroundTaskId?, timedOutAfterMs? }` |
| Read (text) | `{ type: "text", file: { filePath, content, numLines, startLine, totalLines, truncatedByTokenCap? } }` |
| Read (image) | `{ type: "image", file: { base64, type, originalSize, dimensions } }` (drop the base64) |
| Edit | `{ filePath, oldString, newString, originalFile, structuredPatch: [{ oldStart, oldLines, newStart, newLines, lines: [" ctx", "-old", "+new"] }], userModified, replaceAll }` |
| Write | `{ type: "create" \| "update", filePath, content, structuredPatch, originalFile, userModified }` |
| Grep | `{ mode, numFiles, filenames, content?, numLines?, numMatches?, appliedLimit? }` |
| Glob | `{ filenames, numFiles, truncated, durationMs }` |
| WebFetch | `{ url, code, codeText, bytes, result, durationMs }` |
| WebSearch | `{ query, results, durationSeconds, searchCount }` |
| AskUserQuestion | `{ questions, answers, annotations }` |
| ExitPlanMode | `{ plan, isAgent, filePath }` |
| Agent | `{ status: "async_launched", isAsync: true, agentId, description, resolvedModel, prompt, outputFile, canReadOutputFile }`. **No totals** |
| TaskStop | `{ message, task_id, task_type, command }` |
| Skill | `{ success, commandName }` |

**Persisted output marker** (tool output too large to inline):

```text
<persisted-output>
Output too large (41.5KB). Full output saved to: <projects dir>\<slug>\<session>\tool-results\abc123.txt

Preview (first 2KB):
…
```

## Assistant records

There is **one record per content block**. Every record of an API call repeats the same
`message.id`, `requestId` and (growing) `usage`. **Take usage from the last record.**

```json
{ "type": "assistant", "requestId": "req_demo_01", "apiBlockIndex": 1,
  "message": {
    "id": "msg_demo_01", "model": "claude-opus-5-5", "role": "assistant",
    "stop_reason": "tool_use",
    "content": [ { "type": "tool_use", "id": "toolu_demo_01", "name": "Bash",
                   "input": { "command": "npm test", "description": "Run tests" },
                   "caller": { "type": "direct" } } ],
    "usage": {
      "input_tokens": 2, "cache_read_input_tokens": 48000,
      "cache_creation_input_tokens": 1200,
      "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 1200 },
      "output_tokens": 310, "output_tokens_details": { "thinking_tokens": 120 },
      "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
      "service_tier": "standard", "speed": "standard", "iterations": [ { } ] } } }
```

**Usage fields**
- `input_tokens` **excludes** cache reads and writes. TracePilot's inclusive input is
  `input + cache_read + cache_creation`.
- Thinking tokens are under `usage.output_tokens_details.thinking_tokens`.

**Content blocks**

| Block | Shape | Note |
| --- | --- | --- |
| text | `{ type: "text", text }` | |
| thinking | `{ type: "thinking", thinking: "", signature: "…" }` | Usually empty (redacted) |
| tool_use | `{ type: "tool_use", id, name, input, caller }` | |

**Synthetic API error** (rate limit):

```json
{ "type": "assistant", "isApiErrorMessage": true, "error": "rate_limit", "apiErrorStatus": 429,
  "message": { "id": "msg_demo_err", "model": "<synthetic>", "stop_reason": "stop_sequence",
    "content": [ { "type": "text", "text": "You've hit your session limit · resets 8pm" } ],
    "usage": { "input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0,
               "cache_creation_input_tokens": 0 } } }
```

## System records

```json
{ "type": "system", "subtype": "compact_boundary", "parentUuid": null,
  "logicalParentUuid": "00000000-0000-4000-8000-000000000900",
  "content": "Conversation compacted", "level": "info",
  "compactMetadata": { "trigger": "auto", "preTokens": 380000, "postTokens": 12000,
    "cumulativeDroppedTokens": 368000, "durationMs": 55000,
    "preservedSegment": { "headUuid": "…", "anchorUuid": "…", "tailUuid": "…" } } }
```

- **The `logicalParentUuid` chain can loop back to the boundary.** Guard against cycles.
- The compact summary arrives as the next `isCompactSummary` user record, sometimes after a few
  attachments.

```json
{ "type": "system", "subtype": "turn_duration", "durationMs": 39000, "messageCount": 120,
  "pendingBackgroundAgentCount": 0 }
```

Other subtypes: `informational`, `away_summary`, `local_command`, `bridge_status`.

## Bookkeeping records

| Record | Shape | Use |
| --- | --- | --- |
| `ai-title` | `{ "type": "ai-title", "aiTitle": "Add upload retries", "sessionId": "…" }` | Re-emitted each turn; latest wins |
| `custom-title` | `{ "type": "custom-title", "customTitle": "Uploader work", "sessionId": "…" }` | Written when the user renames the session, then repeated many times. The latest non-blank value is the title and beats any `ai-title`, even a later one |
| `agent-name` | `{ "type": "agent-name", … }` | Title fallback |
| `cost-state` | `{ "type": "cost-state", "sessionId": "…", "totalCostUSD": 4.21, "totalAPIDuration": 900000, "totalAPIDurationWithoutRetries": 899000, "totalToolDuration": 600000, "totalDuration": 2400000, "totalLinesAdded": 120, "totalLinesRemoved": 30, "startTime": 1790000000000, "hasUnknownModelCost": false, "modelUsage": { "claude-opus-5-5": { "inputTokens": 40, "outputTokens": 90000, "thinkingTokens": 20000, "cacheReadInputTokens": 9000000, "cacheCreationInputTokens": 300000, "webSearchRequests": 0, "costUSD": 4.05 }, "claude-haiku-4-5-20251001": { "…": "side calls" } } }` | Written at exit, two per run. Last wins; includes subagents and side models |
| `pr-link` | `{ "type": "pr-link", "prNumber": 12, "prUrl": "https://github.com/acme/demo/pull/12", "prRepository": "acme/demo", "timestamp": "…" }` | |
| `queue-operation` | `{ "type": "queue-operation", "operation": "enqueue" \| "dequeue" \| "remove" \| "popAll", "content"?: "<task-notification>…", "timestamp": "…" }` | |
| `last-prompt`, `mode`, `permission-mode`, `atis-latch` | Latest value only | Events tab only |
| `file-history-snapshot` / `-delta` | `snapshot.trackedFileBackups[path].backupFileName` → `file-history/<sid>/<name>` | Null means the file did not exist yet |
| `attachment` | `{ "type": "attachment", "attachment": { "type": "<one of 29>", … }, "rendered"?: [ … ] }` | Events tab only; never FTS |

**Repository** comes from `user.serverClassifierContext.context.git_state`, which looks like
`{ cwd, root, branch, default_branch, visibility: { origin: { host: "github.com", remote: "acme/demo" } } }`.
This is undocumented, so fall back to `pr-link.prRepository`.

## Task notification (subagent or background shell finished)

```text
<task-notification>
<task-id>a0123456789abcdef</task-id>
<tool-use-id>toolu_demo_02</tool-use-id>
<output-file>…\tasks\a0123456789abcdef.output</output-file>
<status>completed</status>
<summary>Agent "Map the indexer" finished</summary>
<usage><subagent_tokens>180000</subagent_tokens><tool_uses>40</tool_uses><duration_ms>600000</duration_ms></usage>
</task-notification>
```

- It arrives in a `user` record, in `queue-operation.content`, or in
  `attachment:queued_command.prompt`.
- `<usage>` is present for subagents.
- `<status>` is `completed`, `failed` or `stopped`.
- Tag text is XML-escaped (`&gt;`, `&amp;`, `&quot;`, …), so a shell command in
  `<summary>` reads `"x &gt; out.txt"`. The parser decodes it once.
- `attachment:task_status` reports a task's state between notifications:
  `{ "type": "task_status", "taskId": "…", "taskType": "local_bash" | "local_agent", "status": "running" | "completed", "description": "…", "deltaSummary": "…", "outputFilePath": "…", "shell": …, "canContinueAgent": … }`
  (keys confirmed on real data, 2026-10-09). The background-task list reads all but the last three.

## Subagent files

`agent-<agentId>.meta.json`:

```json
{ "agentType": "general-purpose", "description": "Map the indexer",
  "toolUseId": "toolu_demo_02", "spawnDepth": 1, "requestShape": "background",
  "requestNonInteractive": true, "model": "opus",
  "worktreePath": "…", "spawnedWithWorktree": true, "worktreeBranch": "…" }
```

- `model` and the `worktree*` fields are optional.
- `toolUseId` equals the parent's `Agent` `tool_use.id`; use it as `parentToolCallId`.
- Every record in `agent-<agentId>.jsonl` has `isSidechain: true`, `agentId` and the parent's
  `sessionId`.
- Subagent files have no `cost-state`, `turn_duration` or `last-prompt`. `stop_reason` is
  usually `null`.
- Subagent usage does **not** appear in the parent file, but **is** included in the parent's
  `cost-state`.

## Liveness: `sessions/<pid>.json`

```json
{ "pid": 4242, "sessionId": "11111111-1111-4111-8111-111111111111", "cwd": "C:\\work\\demo",
  "startedAt": 1790000000000, "procStart": "<OS process start time>", "version": "2.1.289",
  "kind": "interactive", "entrypoint": "cli", "status": "busy", "updatedAt": 1790000300000,
  "statusUpdatedAt": 1790000300000, "name": "…", "pidDomain": "win32:HOST" }
```

- A session is live when the pid is alive, its start time matches `procStart`, and
  `sessionId` matches.
- `status` is `busy` or `idle`. `updatedAt` changes only on status changes, so it is not a
  heartbeat.
- **Never read the sibling `<pid>.<hash>.key` file.** It is a secret.
