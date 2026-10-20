# `index.db` schema reference

This is every table, column and index in the session index as of migration 26.
[README.md](README.md) explains the design. The DDL lives in
[`migrations/`](../../crates/tracepilot-indexer/src/index_db/migrations/).
`schema_doc_matches_migrations` compares this page with a freshly migrated
database, so keep it current when you change the schema.

Conventions:

- Timestamps are RFC 3339 UTC text unless stated otherwise. Per-day grouping uses `date(...)` and so follows UTC days.
- *NULL = unknown* means the source didn't record a value, which is different from 0.
- **Not read** marks a column that is written but used by no index query. Several
  such columns hold data that can't be reconstructed from anything else, so they
  are not drop candidates by default.
- Booleans are stored as `INTEGER` 0/1.

Every child table has `FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE`,
and the metadata writer replaces each child table's rows wholesale. The exceptions
are the network lookups `session_branch_pull_requests` (kept across rewrites) and
`pull_request_status` (keyed by pull request, not session).

## Catalogue

### `sessions`

One row per indexed session from any source, written by the metadata pass. It
holds session-lifetime totals that lists and KPI cards can read without joins.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | TEXT PK | The provider's native session UUID. Shared across sources; `source` says who owns it. |
| `path` | TEXT NOT NULL | Where the provider keeps the session: the Copilot session directory, or the Claude Code transcript file. |
| `summary` | TEXT | Session title or summary from the provider. Indexed by `sessions_fts`. |
| `repository` | TEXT | Repository label from the provider; a display label, not a canonical identity. |
| `branch` | TEXT | Git branch, if recorded. |
| `cwd` | TEXT | Working directory recorded by the source. |
| `created_at` | TEXT | When the source says the session started. |
| `updated_at` | TEXT | Last source activity. For Copilot, the later of `workspace.yaml`'s `updated_at` and the last event other than `session.shutdown`; for Claude Code, the last main-transcript record. The date filter `date(COALESCE(updated_at, created_at))` selects sessions for lists and KPIs. |
| `event_count` | INTEGER | Number of source events or records, counted per provider. Not comparable across sources. |
| `indexed_at` | TEXT NOT NULL | SQLite `datetime('now')` of the last successful metadata write. **Not read.** |
| `host_type` | TEXT | Host label from the source (for example `cli`). |
| `turn_count` | INTEGER | Reconstructed main-conversation turns. NULL = unknown, 0 = empty. "Hide empty sessions" filters on it. |
| `current_model` | TEXT | Most recent model observed. |
| `total_premium_requests` | REAL | Copilot premium-request units (fractional). NULL for sources without premium requests. |
| `total_api_duration_ms` | INTEGER | Total model API time, which is not wall-clock time. Used for throughput figures. |
| `workspace_mtime` | TEXT | Copilot `workspace.yaml` mtime when the session was parsed. Superseded by `source_fingerprint`. **Not read.** |
| `total_tokens` | INTEGER | Lifetime input + output tokens. Input already includes cache reads and writes. |
| `total_cost` | REAL | Lifetime premium-request cost (the sum of per-model `requests.cost`). **In premium-request units, not USD.** |
| `tool_call_count` | INTEGER | Reconstructed tool invocations, including ones still pending. |
| `lines_added` | INTEGER | Lines added, as reported by the provider. |
| `lines_removed` | INTEGER | Lines removed, as reported by the provider. |
| `events_mtime` | TEXT | Mtime of the events file or transcript when parsed. Superseded by `source_fingerprint`. **Not read.** |
| `events_size` | INTEGER | Size in bytes of the events file or transcript when parsed. **Not read.** |
| `analytics_version` | INTEGER | Extraction version of the stored analytics. A value below the source's current version forces a re-extract. |
| `error_count` | INTEGER | Session errors, including rate limits. Counts every error, even beyond the `session_incidents` detail cap. |
| `rate_limit_count` | INTEGER | The part of `error_count` that was rate limits. |
| `compaction_count` | INTEGER | Context compactions. |
| `truncation_count` | INTEGER | Context truncations. |
| `total_compaction_input_tokens` | INTEGER | Input tokens spent on compactions. **Not read.** |
| `total_compaction_output_tokens` | INTEGER | Output tokens spent on compactions. **Not read.** |
| `search_indexed_at` | TEXT | Last successful search write. NULL = search not indexed (or invalidated). Set even when a session has nothing searchable. |
| `search_extractor_version` | INTEGER | Extractor version of the stored search content. |
| `copilot_version` | TEXT | Latest Copilot CLI version seen in `session.start`/`resume`. |
| `total_nano_aiu` | INTEGER | Observed Copilot AI Credits in nano-AIU (10⁹ = 1 credit). NULL = not observed. |
| `source_fingerprint` | TEXT | Serialized source identity of the last successful metadata write. Freshness checks compare it, with `analytics_version`, against the files on disk. |
| `search_source_fingerprint` | TEXT | Source identity of the last successful search write. For Copilot this covers only the events file, so it never equals `source_fingerprint`. |
| `source` | TEXT NOT NULL | Owning provider: `copilot` or `claudeCode`. Writers refuse cross-source overwrites. |
| `parent_session_id` | TEXT | Parent session for subagent or child sessions. No foreign key, because the parent may not be indexed. |
| `role` | TEXT NOT NULL | `primary`, `subagent` or `guardian`. |
| `hidden` | INTEGER NOT NULL | Derived from `role` (guardians are hidden by default). **Not read**: lists filter on `role` instead. |
| `source_format_version` | TEXT | Reserved for a provider format version. Nothing sets it yet; format drift goes to `session_format_observations`. **Not read.** |
| `cost_usd` | REAL | Provider-priced USD for sources not billed in AI Credits. NULL = no figure. Copilot writes none. |
| `linked_pr_count` | INTEGER NOT NULL | Rows in `session_pull_requests` for the session. 0 = none linked. |
| `primary_pr_host` | TEXT | Host of the session's primary pull request (`is_primary`). NULL = none. |
| `primary_pr_owner` | TEXT | Owner of the primary pull request. |
| `primary_pr_repo` | TEXT | Repository of the primary pull request. |
| `primary_pr_number` | INTEGER | Number of the primary pull request. |

Indexes:
- `idx_sessions_updated_at`: newest-first session list.
- `idx_sessions_nonempty_updated_at`: partial index for the list with empty sessions hidden.
- `idx_sessions_repo_updated`: repository filter. Also covers repository-only lookups.
- `idx_sessions_source`: source filter.

`sessions_ai`/`_au`/`_ad` triggers keep `sessions_fts` in sync.

### `sessions_fts`

An external-content FTS5 index (`content='sessions'`, `unicode61`) over session
metadata, used for the quick search in the toolbar. Its rowid is `sessions.rowid`.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | FTS | `sessions.id` |
| `summary` | FTS | `sessions.summary` |
| `repository` | FTS | `sessions.repository` |
| `branch` | FTS | `sessions.branch` |

## Analytics rollups

### `session_model_metrics`

Lifetime usage per session and model, used for model distribution and comparison.
For a session with no `session_segments` rows, the per-day model chart places
this usage on the session's last-activity day, and the date range selects it by
that day.
Primary key: `(session_id, model_name)`.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | TEXT | Owning session. |
| `model_name` | TEXT | Model name exactly as the provider reports it; not normalized across providers. |
| `input_tokens` | INTEGER | Input tokens, **including** cache reads and writes (Claude values are normalized to match Copilot's). |
| `output_tokens` | INTEGER | Output tokens. |
| `cache_read_tokens` | INTEGER | The part of `input_tokens` read from the prompt cache. |
| `cache_write_tokens` | INTEGER | The part of `input_tokens` written to the prompt cache. |
| `cost` | REAL | Premium-request cost for this model. Not USD. |
| `request_count` | INTEGER | Number of API requests. |
| `reasoning_tokens` | INTEGER | Reasoning tokens. NULL = unknown. Not added to output again. |
| `total_nano_aiu` | INTEGER | Observed AI Credits for this model. NULL = not observed, in which case queries fall back to token-based estimates. |
| `cost_usd` | REAL | Provider USD for this model. NULL = no figure. |

### `session_segments`

One row per accounting run: a Copilot `session.shutdown` (a resumed session has
several) or a provider run. Per-day token, activity, premium-request, USD and
model charts attribute usage to the day the run ended, and the date range
selects runs by that day alone: a run that ended in the range counts even when
its session was resumed after it. With a date filter, headline totals take the
sessions last active in the range and subtract their runs that ended outside it
(see [incremental analytics](../architecture/incremental-analytics.md)).
Primary key: `(session_id, end_timestamp)`.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | TEXT | Owning session. |
| `start_timestamp` | TEXT NOT NULL | When the run started. **Not read.** |
| `end_timestamp` | TEXT NOT NULL | When the run ended; per-day charts bucket on its UTC date. |
| `total_tokens` | INTEGER | Input + output tokens in the run. |
| `total_requests` | INTEGER | API requests in the run. **Not read.** |
| `total_premium_requests` | REAL | Premium-request units in the run. |
| `total_api_duration_ms` | INTEGER | Model API time in the run. **Not read.** |
| `current_model` | TEXT | The run's model. **Not read**: per-model attribution uses the JSON. |
| `model_metrics_json` | TEXT | Per-model usage and billing for the run (a serialized `ModelMetricDetail` map), decoded for the per-day model chart. |
| `total_nano_aiu` | INTEGER | AI Credits observed for the run as a whole. Per-model billing in the JSON is optional, so this may be the only run-level figure. Subtracted from headline AI Credits when the run ended outside the date range. |
| `cost_usd` | REAL | Provider USD for the run. NULL = no figure. |

Indexes: `idx_session_segments_end_ts` supports raw `end_timestamp` ranges. The
per-day charts filter on `date(end_timestamp)` and join from `sessions`, so they
don't use it today.

### `session_tool_calls`

Usage per tool name, after names are normalized across providers. Feeds tool
analysis and its rankings. Primary key: `(session_id, tool_name)`.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | TEXT | Owning session. |
| `tool_name` | TEXT | Canonical tool name. |
| `call_count` | INTEGER | Invocations, including pending ones. |
| `success_count` | INTEGER | Invocations known to have succeeded. |
| `failure_count` | INTEGER | Invocations known to have failed. Calls with an unknown outcome count in neither. |
| `total_duration_ms` | INTEGER | Sum of known durations. |
| `calls_with_duration` | INTEGER | Calls with a known duration: the denominator for the average. |

### `session_native_tool_calls`

The provider's own tool spellings under each canonical name, so a Claude Code
`Bash` call can display as itself. Copilot writes none.
Primary key: `(session_id, tool_name, native_tool_name)`.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | TEXT | Owning session. |
| `tool_name` | TEXT | Canonical name; matches `session_tool_calls.tool_name`. |
| `native_tool_name` | TEXT NOT NULL | The provider's spelling. |
| `call_count` | INTEGER NOT NULL | Calls under this pair (a subset of the canonical row). |
| `success_count` | INTEGER NOT NULL | Calls known to have succeeded. |
| `failure_count` | INTEGER NOT NULL | Calls known to have failed. |
| `total_duration_ms` | INTEGER NOT NULL | Sum of known durations. |
| `calls_with_duration` | INTEGER NOT NULL | Denominator for the average duration. |

### `session_activity`

A weekday × hour heatmap of tool calls. Primary key: `(session_id, day_of_week, hour)`.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | TEXT | Owning session. |
| `day_of_week` | INTEGER NOT NULL | Weekday (UTC) when the call started, Monday = 0. |
| `hour` | INTEGER NOT NULL | Hour (UTC), 0–23. |
| `tool_call_count` | INTEGER | Calls that started in this bucket. Calls with no start time are omitted. |

### `session_modified_files`

Files the session changed, for the code-impact view. Primary key: `(session_id, file_path)`.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | TEXT | Owning session. |
| `file_path` | TEXT | Path as recorded. Queries normalize slash direction when grouping. |
| `extension` | TEXT | File extension without the dot, as recorded. NULL if none. |

### `session_incidents`

A per-session log of errors, rate limits, warnings, compactions and
truncations, for the incident drill-down. Every error and rate limit keeps its
row, so the rows agree with `sessions.error_count`; warnings, compactions and
truncations share a cap of 100 rows per session (`MAX_INCIDENTS_PER_SESSION`).
The totals on `sessions` are not capped.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | INTEGER PK | Rowid. Not stable across reindexes. |
| `session_id` | TEXT NOT NULL | Owning session. |
| `event_type` | TEXT NOT NULL | `error`, `warning`, `compaction` or `truncation`. A rate limit is an `error` row whose `detail_json` has `errorType: "rate_limit"` (summary `Rate limit hit`). |
| `source_event_type` | TEXT NOT NULL | Normalized event type the incident came from (for example `session.error`). |
| `timestamp` | TEXT | When the event happened. |
| `severity` | TEXT | `error`, `warning` or `info`. |
| `summary` | TEXT | Readable one-line summary. |
| `detail_json` | TEXT | The source event's data as JSON. Most of this table's size. |

Indexes: `idx_session_incidents_session` serves `WHERE session_id = ? ORDER BY timestamp`.
`idx_session_incidents_type` has no reader.

### `session_cache_windows`

Prompt-cache idle windows that carry a checkpoint-predicted expiry (Copilot CLI
1.0.75+), for prompt-cache analytics. Older sessions get estimated windows
computed on demand instead. Primary key: `(session_id, window_index)`.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | TEXT | Owning session. |
| `window_index` | INTEGER NOT NULL | Position in the session's cache timeline. |
| `idle_start` | TEXT NOT NULL | When the conversation went idle. **Not read.** |
| `resume_at` | TEXT | When it resumed. NULL = still pending or the session ended. |
| `idle_seconds` | INTEGER | Length of the idle gap. |
| `model` | TEXT | Model at resume (or while idle, if pending). |
| `expires_at` | TEXT | Predicted cache expiry. **Not read.** |
| `ttl_seconds` | INTEGER | Cache TTL for this window. 0 = no cache. **Not read.** |
| `outcome` | TEXT NOT NULL | `warm`, `expired`, `modelChanged`, `noCache`, `pending`, `sessionEnded` or `unknown`. |
| `resume_source` | TEXT | NULL for a user prompt, `system`, or `agent` when the agent woke itself. |
| `prefix_tokens` | INTEGER | Size of the cacheable prefix; drives the estimate of tokens re-sent after an expiry. |
| `interaction_nano_aiu` | INTEGER | AI Credits for the resumed interaction. **Not read.** |
| `change_kinds` | TEXT | Comma-separated prefix-change kinds (for example `tools,history`). |

### `session_cache_ttls`

Prompt-cache TTLs that checkpoints reported, per model. They feed the estimates
for older sessions and the Model Comparison view.
Primary key: `(session_id, model, ttl_seconds)`.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | TEXT | Owning session. |
| `model` | TEXT NOT NULL | Model. |
| `ttl_seconds` | INTEGER NOT NULL | Observed TTL. 0 = no cache. |
| `observation_count` | INTEGER NOT NULL | How often it was observed; the most common TTL wins. |

### `session_agent_runs`

One row per subagent invocation, reconstructed from subagent events or task
arguments. Powers the Agents explorer. Primary key: `(session_id, run_key)`.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | TEXT | Owning session. |
| `run_key` | TEXT NOT NULL | Launching tool-call ID, or the runtime agent ID when none was recorded. |
| `tool_call_id` | TEXT | Launching tool call; the deep link into the conversation. |
| `agent_id` | TEXT | Runtime agent instance ID. **Not read.** |
| `parent_run_key` | TEXT | `run_key` of the launching run. NULL = launched by the main agent. Used during extraction. **Not read.** |
| `parent_agent_name` | TEXT | Name of the launching agent. NULL = main agent. |
| `depth` | INTEGER NOT NULL | Nesting depth; 0 = launched by the main agent. |
| `agent_name` | TEXT NOT NULL | Agent name. Grouped case-insensitively. |
| `agent_type` | TEXT | Provider agent type. |
| `display_name` | TEXT | Display label. |
| `description` | TEXT | Launch description. |
| `execution_mode` | TEXT | `sync` or `background`. |
| `started_at` | TEXT | Run start. Queries fall back to `sessions.created_at`. |
| `ended_at` | TEXT | Run end. Used during extraction (duration, sibling overlap). **Not read.** |
| `outcome` | TEXT NOT NULL | `completed`, `failed`, `cancelled` or `incomplete`. |
| `error_text` | TEXT | Terminal error message. |
| `requested_model` | TEXT | Model the launch arguments asked for. **Not read.** |
| `model` | TEXT | Model actually used. |
| `configured_model` | TEXT | Model from `subagent.configured`. |
| `configured_effort` | TEXT | Reasoning effort from `subagent.configured`. **Not read.** |
| `context_tier` | TEXT | Context tier from `subagent.configured`. **Not read.** |
| `multi_turn` | INTEGER | Whether the run was multi-turn. NULL = unknown. |
| `first_dispatched_model` | TEXT | First model actually dispatched. |
| `explicit_model_override` | TEXT | Overriding model recorded at dispatch. **Not read.** |
| `model_override_reason` | TEXT | Why the model was overridden. |
| `configured_model_preference` | TEXT | Configured model preference recorded at dispatch. **Not read.** |
| `configured_matches_actual` | INTEGER | Whether the configured model matched the dispatched one. |
| `total_tool_calls` | INTEGER | Tool calls the CLI reported for the run. |
| `total_tokens` | INTEGER | Tokens the CLI reported. **May include descendants: never sum across a hierarchy.** |
| `duration_ms` | INTEGER | Run duration. |
| `own_nano_aiu` | INTEGER | The run's own AI Credits, excluding descendants (1.0.83+), so safe to sum. |
| `follow_up_count` | INTEGER NOT NULL | Follow-up messages sent to the run. |
| `peak_siblings` | INTEGER NOT NULL | Peak number of concurrent runs under the same parent, including this one. |
| `turn_index` | INTEGER NOT NULL | Main-conversation turn that launched the run. |
| `event_index` | INTEGER | Launch event position. |
| `source` | TEXT NOT NULL | Where the row came from: `events` or `task_args`. Not the session's provider. **Not read.** |
| `messages_sent` | INTEGER NOT NULL | Messages this run sent (a broadcast counts once). |
| `messages_received` | INTEGER NOT NULL | Messages delivered to the run after launch. |
| `peer_messages` | INTEGER NOT NULL | Messages exchanged with agents outside its own ancestry. Both peers count each message, so sums double-count. |
| `queued_messages` | INTEGER NOT NULL | Messages that arrived while the run was busy. |

Indexes: `idx_agent_runs_name_started` serves the per-agent detail
(`agent_name = ? COLLATE NOCASE`). `idx_agent_runs_started` has no reader:
date ranges filter on `date(COALESCE(started_at, s.created_at))`.

### `session_agent_selections`

When the user selects or deselects a custom agent in the main conversation
(`subagent.selected`/`deselected`). Primary key: `(session_id, event_index)`.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | TEXT | Owning session. |
| `event_index` | INTEGER NOT NULL | Event position. |
| `agent_name` | TEXT | Selected agent. NULL for a deselection. |
| `display_name` | TEXT | Display label. |
| `selected` | INTEGER NOT NULL | 1 = selected, 0 = deselected. |
| `timestamp` | TEXT | When it happened. Queries fall back to `sessions.created_at`. |

### `session_skill_invocations`

One row per skill use. Powers Skills analytics: which skills are used, which
used skills aren't installed, and how much context each use injects.
Primary key: `(session_id, event_index)`.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | TEXT | Owning session. |
| `event_index` | INTEGER NOT NULL | Source event position; the deep link into the conversation. |
| `turn_index` | INTEGER NOT NULL | Main-conversation turn. |
| `tool_call_id` | TEXT | The skill-loading tool call. **Not read.** |
| `timestamp` | TEXT | When it happened. Queries fall back to `sessions.created_at`. |
| `skill_name` | TEXT NOT NULL | Name as recorded. |
| `normalized_name` | TEXT NOT NULL | Case-folded identity key. |
| `skill_path` | TEXT | Recorded `SKILL.md` path. NULL for SDK-provided skills. |
| `normalized_directory` | TEXT | Case-folded directory, used to match installed skills. |
| `description` | TEXT | Skill description. |
| `source` | TEXT | Where the skill came from (for example `project` or `personal-copilot`). Not the session's provider. |
| `trigger` | TEXT | `user-invoked` or `agent-invoked`. NULL = unknown. |
| `agent_id` | TEXT | Runtime agent that invoked it. NULL = main agent. |
| `agent_name` | TEXT | That agent's name. |
| `model` | TEXT | Model active at the time. |
| `plugin_name` | TEXT | Providing plugin. |
| `plugin_version` | TEXT | Plugin version. **Not read.** |
| `content_sha256` | TEXT | Hash of the invoked content, for drift against the installed file. |
| `frontmatter_tokens` | INTEGER | Estimated per-turn listing cost. |
| `instruction_tokens` | INTEGER | Estimated tokens this use injected. |
| `origin` | TEXT NOT NULL | `event`, or `tool_call_fallback` for a skill tool call that had no event. |

Indexes: `idx_skill_invocations_name_ts` serves the per-skill detail.
`idx_skill_invocations_ts` has no reader: date ranges filter on
`date(COALESCE(timestamp, s.created_at))`.

### `session_format_observations`

Format drift a source reports per session: unmapped record and attachment types,
and producer versions. Shown in Settings diagnostics.
Primary key: `(session_id, kind, name)`.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | TEXT | Owning session. |
| `kind` | TEXT NOT NULL | `record`, `attachment` or `version`. |
| `name` | TEXT NOT NULL | Sanitized type name or version. |
| `record_count` | INTEGER NOT NULL | Occurrences in the session. |

### `session_pull_requests`

The GitHub pull requests a session is linked to, from
`tracepilot_core::pull_requests`: Claude Code's `pr-link` records and the output of
`gh pr` commands, GitHub MCP tools and the user's prompts. Addresses that only
appear in fetched pages, files or the assistant's text are not stored.
Primary key: `(session_id, host, owner, repo, number)`.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | TEXT | Owning session. |
| `host` | TEXT NOT NULL | `github.com`, a `*.ghe.com` tenant or the session's own GitHub Enterprise host, lowercase. |
| `owner` | TEXT NOT NULL | Repository owner, in the case first seen. |
| `repo` | TEXT NOT NULL | Repository name, in the case first seen. |
| `number` | INTEGER NOT NULL | Pull request number. |
| `roles` | INTEGER NOT NULL | Bits: created 1, updated 2, merged 4, reviewed 8, mentioned 16. |
| `evidence` | INTEGER NOT NULL | Bits naming what established the link (`PullRequestEvidence`). **Not read.** |
| `is_primary` | INTEGER NOT NULL | The one row per session that stands for it in the list and header. |
| `head_ref` | TEXT | Head branch, when the transcript named it. |
| `base_ref` | TEXT | Base branch, when the transcript named it. |
| `title` | TEXT | Title, when the transcript recorded one. Untrusted display text. |
| `first_seen_at` | TEXT | First evidence. |
| `last_seen_at` | TEXT | Latest evidence. |
| `event_index` | INTEGER | Event that established the strongest role. |

Indexes: `idx_session_pull_requests_pr` finds the sessions linked to one pull request.

### `session_pushed_branches`

Branches a session pushed to a GitHub remote, parsed from `git push` output.
Primary key: `(session_id, host, owner, repo, branch)`.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | TEXT | Owning session. |
| `host` | TEXT NOT NULL | Remote host, lowercase. |
| `owner` | TEXT NOT NULL | Remote repository owner. |
| `repo` | TEXT NOT NULL | Remote repository name. |
| `branch` | TEXT NOT NULL | Remote branch name. |
| `first_push_at` | TEXT | First push. |
| `last_push_at` | TEXT | Latest push. |
| `push_count` | INTEGER NOT NULL | Pushes of this branch in the session. |

### `session_branch_pull_requests`

Pull requests found on GitHub whose head is a branch the session pushed. Looked
up over the network, so a metadata rewrite keeps them.
Primary key: `(session_id, host, owner, repo, branch, number)`.

Each lookup of a branch replaces all of that branch's rows. When no pull
request matched, it writes one marker row with `number = 0`, so the branch's
last lookup time (`MAX(fetched_at)`) is still known. Readers skip `number = 0`.
`host`, `owner` and `repo` are stored as in `session_pushed_branches`.

| Column | Type | Meaning |
| --- | --- | --- |
| `session_id` | TEXT | Owning session. |
| `host` | TEXT NOT NULL | Repository host. |
| `owner` | TEXT NOT NULL | Repository owner. |
| `repo` | TEXT NOT NULL | Repository name. |
| `branch` | TEXT NOT NULL | The pushed branch. |
| `number` | INTEGER NOT NULL | Pull request number; `0` marks a lookup that matched none. |
| `fetched_at` | TEXT NOT NULL | When GitHub was asked. |

### `pull_request_status`

The last known state of each pull request on GitHub, shared by every session
linked to it. Looked up over the network; reindexing keeps it.
Primary key: `(host, owner, repo, number)`, compared case-insensitively.

| Column | Type | Meaning |
| --- | --- | --- |
| `host` | TEXT NOT NULL | Repository host. |
| `owner` | TEXT NOT NULL | Repository owner. |
| `repo` | TEXT NOT NULL | Repository name. |
| `number` | INTEGER NOT NULL | Pull request number. |
| `state` | TEXT | `open`, `closed` or `merged`. NULL = unknown. |
| `is_draft` | INTEGER | Draft pull request. |
| `title` | TEXT | Title on GitHub. |
| `head_ref` | TEXT | Head branch. |
| `base_ref` | TEXT | Base branch. |
| `head_owner` | TEXT | Owner of the head repository (differs for forks). |
| `created_at` | TEXT | When it was opened. |
| `merged_at` | TEXT | When it was merged. |
| `closed_at` | TEXT | When it was closed. |
| `review_decision` | TEXT | `approved`, `changes_requested` or `review_required`. |
| `checks_state` | TEXT | Combined status of the head commit's checks. |
| `fetched_at` | TEXT NOT NULL | When GitHub was last asked. |
| `error` | TEXT | The last lookup's failure (for example `NOT_FOUND: ...`). NULL = it succeeded. A failure keeps the state columns from the last success. |

## Search

### `search_content`

One row per searchable chunk (a message, reasoning block, tool call or result,
error and so on), written by the search pass. It is about 80% of the file.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | INTEGER PK AUTOINCREMENT | Chunk ID and FTS rowid. Never reused. |
| `session_id` | TEXT NOT NULL | Owning session. |
| `content_type` | TEXT NOT NULL | `CHECK`-constrained kind: `user_message`, `assistant_message`, `reasoning`, `tool_call`, `tool_result`, `tool_error`, `error`, `compaction_summary`, `system_message`, `subagent` or `checkpoint`. Weights relevance ranking. |
| `turn_number` | INTEGER | Conversation turn, used to reveal a hit. |
| `event_index` | INTEGER | Source event position. Several chunks can share one. |
| `timestamp_unix` | INTEGER | Event time in Unix seconds. |
| `tool_name` | TEXT | Canonical tool name for tool chunks. The native name is kept in `metadata_json`. |
| `content` | TEXT NOT NULL | The searchable text. Must not be blank. Prompts are stored in full and assistant replies and reasoning up to 256 KB, one row per event; tool, error, compaction and system text is cut to a smaller per-kind limit (`content_extraction/limits.rs`). |
| `metadata_json` | TEXT | Per-kind extras (native tool name, checkpoint number, system role). |

Indexes:
- `idx_search_content_session_ts_type`: per-session filters and ordering, and per-session deletes and cascades.
- `idx_search_content_session_event`: the context before and after a hit (`session_id = ? AND event_index < ?`).
- `idx_search_content_type_ts`: content-type filter in time order.
- `idx_search_content_tool`: tool filter and tool facets.
- `idx_search_content_timestamp`: date-range browsing and time sorting.

`search_content_ai`/`_au`/`_ad` keep `search_fts` in sync.

### `search_fts`

An external-content FTS5 index over `search_content.content` (`content_rowid='id'`,
`unicode61`, `automerge=8`). Results are ranked by `rank` weighted by
`content_type`. Its shadow tables (`search_fts_data`, `_idx`, `_docsize` and
`_config`) belong to SQLite.

| Column | Type | Meaning |
| --- | --- | --- |
| `content` | FTS | `search_content.content` |

## Bookkeeping

### `schema_version`

One row per migration applied ([ADR 0013](../adr/0013-db-migration-policy.md)).

| Column | Type | Meaning |
| --- | --- | --- |
| `version` | INTEGER NOT NULL | Migration number. The current version is `MAX(version)`. |
| `applied_at` | TEXT | When it was applied. |

### `maintenance_state`

Key/value throttle state for `maintenance()`.

| Column | Type | Meaning |
| --- | --- | --- |
| `key` | TEXT PK | Only `last_run_epoch` is used. |
| `value` | TEXT | Unix seconds of the last maintenance pass in which at least one step succeeded. |
