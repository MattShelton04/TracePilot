# Reasoning headings and session activity

## Evidence (2026-09-20)

Read-only inspection of 391 local `session-state/*/events.jsonl` files covered
872,159 events, with session start versions from 0.0.409 to 1.0.86. These are
observations from one machine, not estimates of all Copilot usage. Resumed sessions
are grouped by their original `session.start.copilotVersion`.

| Cohort | Sessions | Visible reasoning messages | Leading bold heading | `report_intent` calls |
| --- | ---: | ---: | ---: | ---: |
| All | 391 | 38,854 | 3,357 (8.6%) | 16,196 |
| Start versions through 1.0.55 | 370 | 38,723 | 3,226 (8.3%) | 16,196 |
| Start versions 1.0.71–1.0.86 | 21 | 131 | 131 (100%) | 0 |

Only nine of the 21 newer sessions contain visible reasoning (all start at 1.0.79
or later). All 131 newer reasoning messages identify `gpt-5.6-luna`; this sample
does not establish the same behavior for other models. The 370 older sessions
include 310 with reasoning, 95 with at least one heading and 309 with intent calls.
Headings already occur in 0.0.410-era data; a CLI-version gate would be incorrect.

The initial count recognizes a leading `**heading**` followed by whitespace/end.
The UI uses the stricter standalone-line form, a 160-character limit, and no nested
Markdown. It does not guess a title from ordinary prose. Newer observed headings
are 7–48 characters long. Twenty-eight newer messages have multiple bold headings;
the preview uses the first heading of each message and expansion retains all text.

The audit counted nonempty `assistant.message.data.reasoningText` and standalone
`assistant.reasoning.data.content` separately. The latter has zero instances in
this sample. It inspected event types, populated assistant fields, tool request
fields, and newer session database schemas without changing the source files.
No private session content, identifiers, paths, or original prompts are fixtures.

## Where the objective went

TracePilot's existing objective is the latest `report_intent.arguments.intent`.
Copilot's [official changelog](https://github.com/github/copilot-cli/blob/main/changelog.md)
records removal of the legacy intent-reporting tool in 1.0.64. The installed
1.0.86 schema declares `assistant.intent` ephemeral, and its UI subscribes to
that live event. [GitHub's SDK event reference](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events#assistantintent)
also documents this. There are no persisted `assistant.intent` events in this
local corpus. An offline viewer cannot recover that exact live value.

However, 1,177 of 1,251 tool requests in the newer cohort (94.1%) carry a nonempty
`intentionSummary`, across 14 sessions. TracePilot already joins this field to
`TurnToolCall` by tool-call ID. This is useful saved activity text, but a tool's
intention is not necessarily the session's overall objective.

Preserve explicit legacy objectives when present. Otherwise use the latest saved
tool intention for the same agent, label it **Activity**, identify its source in
the banner tooltip, and retain the event/tool deep link. Do not invent an objective
from user prompts or arbitrary reasoning prose. If neither source exists, omit the
banner. Main-agent and child-agent scopes must remain separate.

## Related enrichment

- `reasoningBlocks` is a provider-tagged object. Newer OpenAI Responses payloads
  contain `blocks[].summary[]` entries with `type: "summary_text"` and `text`.
  Of 204 newer messages with this structure, 110 have nonempty summaries. All
  also have `reasoningText`; nine differ in formatting. Keep nonempty legacy text
  authoritative and use structured summaries only when it is absent/blank, avoiding
  duplicates and never interpreting encrypted content. Use the same extraction in
  conversation reconstruction and full-text indexing.
- Tool intentions also improve replay titles using the same scoped objective
  selector, rather than allowing a child agent's intent to name the parent's turn.
- The persisted `session.autopilot_objective_changed` schema contains operation,
  ID and status, not objective text; none occur locally. This is distinct from the
  progress intent. It cannot fill the existing banner from this dataset.
- Assistant `phase`, model-call telemetry, and `session.usage_checkpoint` are
  additional signals, but do not contain a replacement persisted intent. They are
  outside this change's reasoning/activity display scope.

## Implementation and validation plan

1. Add conservative, shared heading extraction with old/plain/malformed fallbacks.
   Show previews in shared reasoning rows (conversation and replay) and subagent
   rows. Keep full original reasoning accessible by expansion.
2. Add structured visible-summary fallback in Rust; use it in reconstruction and
   indexing. Test canonical-text precedence, malformed/unknown providers, empty
   and encrypted-only data, and child attribution.
3. Extend objective selection with a source-aware tool-intention fallback. Keep
   legacy precedence, chronological selection, duplicate counting, scope and
   deep links. Use it for main-agent/subagent banners and replay titles.
4. Run relevant Rust/frontend tests, workspace typechecks and repository checks.
   Verify real older and newer sessions in the Windows Tauri app through the
   repository automation skill at 1440×960, 960×640 and 2560×1440. Keep captures local.
