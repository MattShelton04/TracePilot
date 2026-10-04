# Reasoning effort, user turns and shell exit codes

Status: **Implemented**. This is the reference for how TracePilot attributes reasoning effort,
groups agent turns into user turns, and shows shell exit codes.
Related: [Copilot session store research](../research/copilot-session-store-db.md),
[prompt-cache insights](prompt-cache-insights-plan.md).

## 1. What users see

- **Effort chips.** The session header, Overview and Metrics show the main agent's current
  reasoning effort, for example "high effort". Overview reads "Model default" when no effort
  was chosen. Each turn in the Compact and Timeline views shows the effort it ran at.
- **Metrics → Reasoning effort.** One row per model and effort used in the session, with
  averages per user turn: requests, tool calls, wall time, reasoning tokens, API time and
  AI Credits.
- **Model Comparison → Reasoning effort.** The same table across every indexed session in the
  current filters, with a session count. It answers questions like "how many more reasoning
  tokens does xhigh spend than medium for the same model?"
- **Exit-code chip.** A shell call that completed but whose process exited non-zero shows an
  amber `exit N` chip instead of the green tick. It isn't a failure: agents run linters, tests
  and probes that are expected to exit non-zero. Only a tool the CLI reports as failed shows
  the red failed state.

## 2. Definitions

### Agent turn

One `ConversationTurn`, which is one model request loop between `assistant.turn_start` and
`assistant.turn_end`. "Requests / turn" counts these. A system message injected mid-turn
splits one agent turn into two `ConversationTurn`s with the same `turnId`, the first being
incomplete. The continuation isn't counted as a separate request. `turnId` restarts at `"0"`
for each run, so distinct `turnId`s are not a valid count.

### User turn

Everything from one message the user typed until the next one. Steering and queued messages,
tool iterations, autopilot continuations and system notifications (for example, a background
agent finishing) stay inside the user turn they belong to. `ConversationTurn.userTurnIndex`
records the grouping. `crates/tracepilot-core/src/turns/user_turns.rs` assigns it.

A message counts as typed by the user when it has content, isn't an autopilot continuation,
and either:

- has `source` `user` or `command-*`, or
- has no `source` (CLIs before 1.0.91) and doesn't start with `<system_notification>`.

Notification-sourced messages set `ConversationTurn.systemInitiated`.

### Attribution with `originatingMessageId`

Copilot CLI 1.0.91 stamps each main-agent `assistant.message` with the `messageId` of the user
message that started the run. It stays the same across tool iterations and steering. The
assigner uses it first:

1. If the origin already started a user turn, the agent turn joins it. This covers steering
   that arrives mid-run.
2. If the origin is a typed message that hasn't started yet, a new user turn begins.
3. Otherwise it falls back to ordering. A typed, non-steering user message starts a new user
   turn, and everything else joins the current one.

Older sessions have no `originatingMessageId` or `messageId` and use rule 3 only. Runs woken by
a notification carry no origin, or the notification's own ID, so they join the current user
turn rather than starting one. The Timeline swimlanes use `userTurnIndex` and apply the same
typed-message fallback when it's absent.

### Effort per turn

`SessionEffortTracker` (`parsing/events/session_model.rs`) follows main-agent events in order:

- `session.start` sets the effort, and `session.resume` sets it only when present.
- `session.model_change` sets it when present. It clears it when the new effort is absent but
  `previousReasoningEffort` is set, which means the user switched back to the model default.
- `user.message.responsesReasoning.effort` overrides it for that message when present.
- Subagent events are ignored.

Each `ConversationTurn.reasoningEffort` is the effort in force when the turn started.
`SessionSummary.currentReasoningEffort` is the effort at the end of the log.

## 3. Request figures from the session store

`events.jsonl` doesn't record per-request reasoning tokens, API time or cost. Copilot CLI's
session store (`<COPILOT_HOME>/session-store.db`, CLI 1.0.69+) does, in
`assistant_usage_events`. `tracepilot_core::session_store` reads it under these rules:

- **Location.** Only for sessions whose parent directory is named `session-state`. The store is
  that directory's sibling. Imported or relocated sessions read nothing.
- **Read-only and capped.** The connection is read-only with `query_only` and a 250 ms busy
  timeout, and never checkpoints. Columns are probed, so missing ones read as empty instead of
  failing. One connection per thread is reused for up to 30 seconds.
- **One indexed query per session**, filtered by `session_id`. It runs inline during the
  normal session re-index, never as a separate sweep. The reverted enrichment in #845/#846
  re-read the store on its own schedule; this design doesn't.

`effort_usage::build_effort_usage` attributes rows to user turns:

- Rows with a `parent_tool_call_id` belong to subagents. They go to the user turn that owns
  that tool call, and are counted separately from the main-agent figures.
- Main-agent rows go to the user turn running at `created_at`.
- Compaction rows are skipped.
- When a user turn has rows, the store's model and effort take precedence over the
  event-derived values.

The store's `turn_index` doesn't match TracePilot's turns, so it isn't used.

Event-backed averages (requests, tool calls, time) cover every user turn. Store-backed averages
(reasoning tokens, API time, AI Credits) divide by `observedUserTurns`, the user turns that had
recorded requests. The table footnote shows that coverage. Validated against local data,
main-agent store rows matched the event-derived agent-turn count exactly in 28 of 29 sessions,
and differed by one in the other.

## 4. Storage

- Index migration 22 adds `session_effort_usage`, keyed by session, model and effort, with
  `''` for unknown values. Analytics version 18 re-extracts existing sessions once.
- `IndexDb::query_analytics` aggregates it into `AnalyticsData.reasoningEffort` using the same
  date and repository filters as the dashboard.
- `get_session_effort_usage` builds a single session's figures live from cached events and the
  store, so running sessions are current without waiting for the index.

## 5. Exit codes

`TurnToolCall.exitCode` is set for shell tools (`bash`, `powershell`, `local_shell` and the
`read_`/`write_` variants). It prefers `shellExecution.exitCode` (CLI 1.0.91+), and otherwise
reads the trailing footer of the output:

- `<shellId: N completed with exit code X>`
- `<exited with exit code X>`
- `Process exited with code X.`

In local data, 4,243 of 50,243 shell completions exited non-zero while the CLI marked them
successful. Only 120 were marked failed. Most of the non-zero exits came from lint and
typecheck (about 29%), tests (26%) and builds (7%). That's why the chip is a caution rather than
an error.
