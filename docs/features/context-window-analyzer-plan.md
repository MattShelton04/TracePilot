# Context Window Analyzer — Feasibility and Implementation Plan

Status: implemented from real Copilot CLI session telemetry (2026-07-18).

## Product decision

TracePilot will present this as a **context pressure and compaction analyzer**, not
an exact per-turn context ledger.

The Copilot CLI owns compaction. Its event stream provides exact context-layer
snapshots at `session.compaction_start` and `session.shutdown`. It does not
provide the exact input-context composition for every model request. TracePilot
therefore distinguishes:

- **Observed points** — exact system, conversation, and tool-definition token
  totals reported by Copilot.
- **Estimated points** — context-bearing event text accumulated between observed
  points and calibrated to the next observed conversation-token total.
- **Tool contribution estimates** — tool arguments and returned results are
  measured separately as potential conversation-input contribution, but are
  not presented as context-composition layers.

The UI must never describe estimated points as exact or claim that TracePilot
performed/saved the compaction.

## Evidence from real sessions

The prototype was exercised against a real 90-turn local session with a
successful compaction (the session identifier and content are intentionally
excluded from this document):

- `session.compaction_start` supplied `systemTokens`,
  `conversationTokens`, and `toolDefinitionsTokens`.
- `session.compaction_complete` supplied the pre-compaction total, summary,
  checkpoint, and compaction request usage, but no post-compaction layer totals.
- `session.shutdown` supplied another exact layer snapshot.
- Assistant events supplied output tokens, but there was no per-turn prompt
  input-token snapshot.

Large historical sessions (3,000+ turns and 40+ compactions in the local
corpus) establish the need for bounded payloads and cached parsing.

The SQLite `search_content` table was rejected as an input. It is a normalized
search projection, may be stale, and is not a lossless record of model context.

### Empirical follow-up

Five real sessions were compared after the first visual prototype:

| Session shape | Turns | Compactions | Shutdowns / resumes | Finding |
| --- | ---: | ---: | ---: | --- |
| Recent compacted | 90 | 1 | 2 / 1 | Shutdown is an intermediate anchor after resume, not necessarily the end |
| Very long | 3,093 | 42 | 3 / 2 | System prompt changed 12 times; tool definitions changed less often |
| Long compacted | 647 | 12 | 2 / 1 | Multiple model/prompt eras occur in one chronological log |
| Compaction-heavy | 380 | 11 | 2 / 1 | Frequent resets make naive cumulative estimates misleading |
| Short baseline | 7 | 0 | 1 / 0 | One shutdown anchor is enough to calibrate the total curve |

In every paired compaction, the sum reported at `compaction_start` exactly
matched `preCompactionTokens` at completion. Shutdown `currentTokens` differed
from its three component layers by only 3–4 tokens. These top-level anchors are
therefore reliable.

Compaction pairing must be event-ordered rather than turn-ordered. In the
3,093-turn sample all 42 starts had a completion, but 37 completed on a later
sequential turn. The earlier prototype matched by turn and consequently omitted
37 post-compaction resets. The implementation now pairs starts/completes FIFO
in raw event order, shows the start-to-complete interval, and exposes start,
complete, and paired counts so malformed logs are visible.

By contrast, the prototype's inferred message share ranged from roughly 6% to
100% in long sessions and flipped around compactions/resumes. That split was
removed. The chart now displays only Copilot's top-level System prompt, Tool
definitions, and Conversation layers.

The separate tool analysis also produced stable, actionable patterns. File
viewing was the largest estimated tool payload category in four of the five
sessions (about 25–63%); shell usage was second in two code-heavy sessions. The
short research session was instead dominated by web search/fetch. Call count
and contribution were notably different, so the UI shows both. These figures
measure captured tool arguments and returned-result volume, not how long each
payload remained resident after Copilot compaction.

Cache telemetry cannot close that gap. Shutdown events expose aggregate
model-usage cache reads/writes and compaction-complete events may expose usage
for the compaction request, but neither attributes cache status to an
individual tool result or turn. The analyzer therefore does not claim that a
result is sent uncached once and cached on later requests.

The local corpus does contain a `session.truncation.tokenLimit` value of
272,000, but that sample is from Copilot CLI 1.0.40 on 2026-05-10. The two
sessions from 2026-07-17 do not report a token/context limit field. Reported
limits are therefore rendered only for the session that emitted them and are
never promoted into model metadata or reused for newer sessions.

## Architecture

1. Reuse the existing validated session path lookup and typed-event LRU cache.
2. Build the timeline in `tracepilot-core` directly from typed `events.jsonl`
   events.
3. Count turns from chronological `assistant.turn_start` events. Do not trust
   producer `turnId` values.
4. Reuse the current event order/turn pipeline; do not add a separate database
   or rollback parser.
5. Return a bounded DTO through `get_session_context_timeline`.
6. Render a responsive SVG stacked-area chart in a new **Context** session tab.

## Reconstruction

For each turn, estimate conversation additions from:

- user, assistant, reasoning, system, and skill text → message context;
- tool arguments, results, and errors → tool context.

The estimator is intentionally dependency-free and matches the repository's
existing convention: `ceil(UTF-8 bytes / 4)`. Within each interval ending at an
observed anchor, scale accumulated context-bearing text to Copilot's exact
conversation total. System and tool-definition layers come from the observed
anchor. No semantic sub-division of conversation is inferred.

At compaction:

- before = Copilot's observed pre-compaction total;
- the pre state is placed at the start turn and the reset at the completion
  turn, which may be several turns later;
- after = explicit post layers when future CLI versions provide them;
- otherwise after = unchanged system/tool definitions plus the compaction
  output-token count (or summary-text estimate) as conversation;
- savings is marked estimated whenever the after state is estimated.

## UI

- Three layers: system prompt, tool definitions, conversation.
- Legend toggles affect rendering only; totals retain the full context value.
- Solid anchor dots and an “Observed” badge distinguish exact snapshots.
- Dashed compaction markers have a full-height hit target and open a diagnostic
  card with start/completion turns, before, after, removed, checkpoint, and
  estimation status. A scrollable history provides a second selection route.
- Nothing is selected on entry. Hovering previews a point; clicking locks its
  turn, total, phase, and source, and the locked tooltip takes precedence over
  later hover movement.
- Mouse-wheel zoom, direct drag-panning, accessible zoom controls, and
  turn/time axis modes support long sessions. Time mode uses balanced
  active-time coordinates: ordinary intervals retain their real duration, long
  shutdown/resume boundaries are capped at three typical active-turn
  intervals, and other extreme outliers at four. Short session boundaries are
  not expanded, and compressed boundaries receive an axis break marker.
- Pre-compaction and shutdown anchors have dedicated selection targets.
  Post-compaction points remain in the geometry so the reset is visible, but do
  not add a second selectable marker. User messages, model changes, resumes,
  and truncations are always-present event points integrated into the legend.
- Pressure lines show the median level at which compaction was observed in the
  current session. When `session.truncation` reports a hard token limit, that is
  shown separately. Copilot does not currently report a model-owned compaction
  trigger, so neither line is labeled as one.
- Tool diagnostics aggregate estimated argument/returned-result contribution
  by type, with list and keyboard-accessible donut-chart views. Donut segments
  expose calls, arguments, results, estimated tokens, and percentage on hover
  or focus. Expensive calls use a compact ranked comparison; selecting one
  immediately prefetches the full captured result before opening the shared
  TracePilot rich renderer.
- Selecting a graph point lazily loads the existing turn reconstruction and
  exposes every tool call in that turn. User-message event details retain the
  complete original message; transformed message content is still used for
  context estimation when available.
- Empty, loading, error, and no-anchor states use existing TracePilot patterns.

## Performance and compatibility

- No index/database dependency or schema migration.
- Event parsing uses the existing cache and blocking worker pattern.
- The response contains O(turns + compactions + tool types) summaries and at
  most 50 individual tool calls with 2,000-character argument/result previews.
  Full results remain behind the existing lazy tool-result command.
- An eight-session frontend LRU reuses a timeline immediately and performs only
  a file-size/mtime freshness probe before deciding whether to reconstruct it.
- Active sessions refresh through the session tab loader.
- While Context remains open, session-detail fingerprint changes trigger a
  silent freshness probe/reconstruction. Timeline objects and selected
  entities are reconciled by stable keys, so zoom, pan, axis mode, layer
  toggles, and valid selections survive background updates.
- Historical schemas with partial compaction payloads remain supported.
- The command permission is granted to both the main and popped-out viewer
  capabilities, so the Context tab has the same behavior in either window.

## Verification

- Unit tests for anchor fidelity, calibration, missing post-compaction totals,
  empty sessions, and contributor bounds.
- Tauri command tests for validation and event loading.
- Vue tests for geometry, toggles, selection, compaction details, and empty/error
  states.
- Typecheck, Rust tests, frontend tests, formatting, and design-system checks.
- Manual visual check in dark and light themes using the real 90-turn session,
  followed by a long-session responsiveness check.
