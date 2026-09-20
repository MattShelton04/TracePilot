# Reasoning headings and recorded objectives

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
the preview uses the first heading of each message. When expanded, that opening
heading stays in the header and is omitted from the display body. Later headings
and body indentation remain intact; stored reasoning and search content are unchanged.

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
The inspected per-session databases and the shared session store also expose no
intent/objective columns that could supply a replacement.

However, 1,177 of 1,251 tool requests in the newer cohort (94.1%) carry a nonempty
`intentionSummary`, across 14 sessions. TracePilot already joins this field to
`TurnToolCall` by tool-call ID. This is useful saved activity text, but a tool's
intention is not necessarily the session's overall objective.

Preserve explicit legacy objectives and their event/tool deep links. When no
explicit objective exists, omit the banner. Tool intentions and reasoning headings
describe individual actions and can become stale; keep them alongside their own
tool/reasoning rows instead of inferring a persistent session objective. Main-agent
and child-agent scopes remain separate.

Recorded session objectives have no running/done badge. A missing shutdown record
does not establish that work is ongoing, and a shutdown does not prove the objective
was achieved. Subagent banners can still use their separately tracked worker status.

## Related enrichment

- `reasoningBlocks` is a provider-tagged object. Newer OpenAI Responses payloads
  contain `blocks[].summary[]` entries with `type: "summary_text"` and `text`.
  Of 204 newer messages with this structure, 110 have nonempty summaries. All
  also have `reasoningText`; nine differ in formatting. Keep nonempty legacy text
  authoritative and use structured summaries only when it is absent/blank, avoiding
  duplicates and never interpreting encrypted content. Use the same extraction in
  conversation reconstruction and full-text indexing.
- Replay titles prefer the main agent's explicit objective, then its assistant
  message, then its first tool intention. Child-agent intents and messages cannot
  name the parent's turn. This fallback describes only the individual replay step.
- The persisted `session.autopilot_objective_changed` schema contains operation,
  ID and status, not objective text; none occur locally. This is distinct from the
  progress intent. It cannot fill the existing banner from this dataset.
- Assistant `phase`, model-call telemetry, and `session.usage_checkpoint` are
  additional signals, but do not contain a replacement persisted intent. They are
  outside this change's reasoning/activity display scope.

## Implementation and validation plan

1. Add conservative, shared heading extraction with old/plain/malformed fallbacks.
   Show previews in shared reasoning rows (Chat, Compact, Timeline and replay) and subagent
   rows. Keep subagent headings visible when expanded too, omit duplicate opening
   headings from displayed bodies, and preserve the full original stored text.
2. Add structured visible-summary fallback in Rust; use it in reconstruction and
   indexing. Test canonical-text precedence, malformed/unknown providers, empty
   and encrypted-only data, and child attribution.
3. Preserve explicit objectives, chronological selection, duplicate counting,
   scope and deep links. Omit banners when no objective was recorded and avoid
   inferring session status from shutdown metadata. Scope replay title fallbacks
   to the main agent.
4. Run relevant Rust/frontend tests, workspace typechecks and repository checks.
   Verify real older and newer sessions in the Windows Tauri app through the
   repository automation skill at 1440×960, 960×640 and 2560×1440. Keep captures local.

## Validation completed

- Initial full `pnpm test`: 3,732 tests passed across all frontend packages.
  Follow-up objective, reasoning, replay and cache regressions: 120 tests passed.
  Workspace typechecks, changed-file Biome, rustfmt and file-size/doc-link checks passed.
- `cargo test --workspace --exclude tracepilot-desktop`: 1,578 passed, five ignored,
  zero failures. This includes structured-summary search/reconstruction agreement,
  child attribution, canonical text precedence and encrypted/malformed fallbacks.
- The real Windows Tauri app was started with `pnpm app:start` and attached using
  the pinned Playwright CLI. Real older and newer sessions verified inline headings,
  full-text expansion, generic legacy labels, source-tool reveal, and subagent
  heading behavior. Chat layout was checked
  at 1440×960, 960×640 and 2560×1440, with no horizontal document overflow; screenshots
  were visually inspected. Compact and Timeline were checked at 1440×960.
- Follow-up live checks verified no inferred Activity banner in all three conversation
  modes, neutral legacy objectives with working source links, persistent expanded
  subagent headings without duplicated body titles, and cache expiry alongside
  Resume for ended sessions. Older
  sessions without recorded cache timing still omit the cache chip. Countdown
  transitions for ended sessions are covered by clock-controlled component tests.
- Live inspection also corrected two nearby gaps: Compact previously omitted all
  reasoning, and idle/cancelled subagents incorrectly animated their explicit objective
  banner as running. Compact now uses the shared reasoning component; inactive workers
  show an idle banner.
- Captures and raw local analysis remain in ignored directories. Only aggregate
  findings and synthetic tests are committed.
