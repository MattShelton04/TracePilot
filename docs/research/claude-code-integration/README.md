# Claude Code Session Integration — Plan

> **Status:** Research and plan; nothing implemented. Revised after review (2026-10-05):
> canonical event payloads, meta-record and turn-end rules, usage reconciliation, split
> foundation acceptance, enable/disable ordering, estimated cache expiry, package contracts.
> **Date:** 2026-10-05
> **Builds on:** [Codex and Claude Code feasibility](../codex-claude-code-session-support-feasibility.md)
> (breadth across both tools). This set goes deeper on Claude Code, re-measures the data and
> corrects several earlier claims. It also designs the abstraction so Codex can be added later
> without another core refactor.
> **Evidence:** TracePilot at `e13b6058`, plus read-only scans of the real session stores on
> one Windows machine:
> - **Claude Code:** 62 main and 26 subagent transcripts, 679 MB, versions 2.1.274 → 2.1.289,
>   2026-09-17 → 2026-10-05.
> - **Copilot CLI:** 618 session dirs (407 with `events.jsonl`), 2.6 GB of events, 50 CLI
>   versions, 2026-02-13 → 2026-10-04.

## Documents

| Document | What it answers |
| --- | --- |
| [data-comparison.md](data-comparison.md) | What Claude Code writes, how it differs from Copilot, the parser rules the data forces, and corrections to the earlier study |
| [mapping.md](mapping.md) | Mapping tables: records → TracePilot events, tools → renderers, features/tabs → support level, metrics and cost |
| [architecture.md](architecture.md) | Integration styles considered, the provider abstraction, analytics mixing, the Codex stress test |
| [implementation-plan.md](implementation-plan.md) | Implementation levels, task breakdown, dependencies and parallel lanes, estimates, acceptance criteria, **kickoff** |
| [record-shapes.md](record-shapes.md) | Synthetic reference of every Claude Code record and file shape, for parser and fixture work |

---

## 1. Answers in brief

**Can we integrate Claude Code sessions?** Yes. The transcript format is rich and well behaved:
- 0 malformed lines.
- Exact per-API-call token and cache usage, which Copilot's transcripts do not have.
- Structured tool results that line up with TracePilot's existing renderers.
- Subagents that link to their parent tool call in 26 of 26 cases.

The hard part is TracePilot's single-source assumption, not the parser.

**What style of integration?** A **provider abstraction with a translation layer**. This is
called "A+" in [architecture.md](architecture.md) §2:

- A `SessionProvider` trait owns everything source-specific: discovery, fingerprinting,
  parsing, liveness and capabilities.
- Each provider translates its native records into TracePilot's existing normalized event model
  (`TypedEvent`). Turn reconstruction, search extraction, agent runs, incidents and export then
  work unchanged.
- A small set of **source-neutral additions** covers what Copilot's model cannot express:
  - a per-model-call usage event
  - the native record on each event
  - the native tool name
  - a cost basis
  - per-session capabilities

  Providers never fake Copilot-only telemetry (`session.shutdown`, `usage_checkpoint`, lock
  files, `workspace.yaml`).

**Do we need to abstract a lot first?** A moderate amount, done once:
- About 25 IPC call sites rebuild `<session_state_dir>/<uuid>`. They must resolve through the
  index's stored path instead; that column exists but nothing reads it today.
- Caches and freshness checks key on one file's size and mtime. They need an opaque
  `source_version` instead.
- Pruning, reindex and config assume one root.
- The frontend needs a `source` field and capability-driven tab gating.

None of this changes Copilot behaviour. A `CopilotProvider` wraps today's code, verified by
golden tests.

**Do we need to double up tool renderers?** **No.** Normalize in the Rust provider:
- Each Claude tool maps to a canonical tool kind, and its arguments and `toolUseResult` are
  reshaped to fit.
- The native name is kept for display.
- About 9 of the 15 existing renderers are reused as-is.
- No new renderer is needed.
- The shell renderer needs a small fix: its title is hard-coded to "PowerShell".

Doing this in the frontend would not work, because the structured `toolUseResult` never
reaches it. It would also leave the Rust argument summarizer, subagent detection, search and
analytics on Copilot names.

**Do analytics get mixed?** **One index, one set of tables, with a `source` dimension.**
- Analytics pages default to *All sources* for source-neutral metrics: sessions, tokens, cache
  hit rate, tools by canonical kind, code impact, durations.
- A source filter scopes every analytics page.
- **Money is never summed silently across sources.** Copilot shows AI Credits, which are
  billed. Claude Code shows API-equivalent USD, which is an estimate. A combined
  "API-equivalent" view is possible because 1 AIC = $0.01 at the same list rates, but it must
  be labelled.

See [architecture.md](architecture.md) §5.

**What are the main limitations?** See [mapping.md](mapping.md) §4 for the full list. The
main ones:
1. Claude Code **deletes transcripts after 30 days by default** (`cleanupPeriodDays`; confirmed
   in [Claude Code's docs](https://code.claude.com/docs/en/data-usage#data-retention)).
   TracePilot respects that rolling window (decision D3): expired sessions drop out of the
   index the same way deleted Copilot sessions do.
2. **88.8% of thinking blocks are redacted.**
3. **No context breakdown** into system / tools / conversation; only exact totals per call.
4. **No todos.** Claude Code turns its task tools (`TaskCreate`/`TaskUpdate`/`TodoWrite`) on
   by default only for older models (Claude 3.x, Opus 4–4.7, Sonnet 4–4.6, Haiku 4.5). None
   were called in the observed Opus 5.x corpus, so TracePilot doesn't parse them: calls show
   as generic tools and Claude sessions have no Todos tab.
5. Background task output is written under `%TEMP%`, outside `~/.claude`.
6. No launching, steering or SDK features. Only "copy resume command" is cheap.
7. The format changes fast: 12 versions in 18 days.

## 2. Effort

Engineer-days assume someone familiar with the codebase. Tests, fixtures and visual checks are
included. Detail and task IDs are in [implementation-plan.md](implementation-plan.md).

| Level | What the user gets | Effort (eng-days) | Calendar: 1 lane | Calendar: 3 parallel lanes |
| --- | --- | --- | --- | --- |
| **L0 Spike** | Parser emits `TypedEvent`s; dev dump plus a throwaway mirror into the real UI. Validates turn grouping, usage de-duplication and subagent stitching. The parser is kept. | 4–6 | 1 wk | 1 wk |
| **L1 Basic** *(internal milestone)* | Claude sessions appear in the list (source badge and filter), search, Conversation and Events. Generic tool rendering plus subagents. Session totals from `cost-state`. Copilot-only tabs hidden. Enabled from Settings → Experimental. | +33–45 (cumulative 37–51) | 8–10 wks | 3–4 wks |
| **L2 Good** *(first release target, Experimental flag)* | Normalized tools on the rich renderers. Metrics with exact per-model token and cache totals and an API-equivalent USD estimate. Context chart (totals). Observed prompt-cache windows with estimated expiry from the recorded TTL tier. Timeline/agent tree. Live badge. Source filter on analytics. Pricing aliases. Fixtures and VRT. | +25–35 (cumulative 62–86) | 12–17 wks | 5–7 wks |
| **L3 Parity** | Source-aware analytics everywhere (tool analysis by canonical kind, code impact, model comparison across sources, session comparison), background tasks, file-history checkpoints, Explorer, export with redaction, copy and branding pass, docs | +15–23 (cumulative 77–109) | 16–22 wks | 7–10 wks |
| **L4 Extras** | Opt-in archive of expiring transcripts; estimated context breakdown from `prompt_snapshot`; "resume in terminal"; cross-source repo views; Node CLI support | 3–8 each | — | — |
| **Codex provider** (after L2 foundation) | Same as L2 for Codex | 15–25 | 3–5 wks | 2–3 wks |

These numbers are higher than the earlier study's 5–8 weeks for Claude Code. They now count work
the code audit found:
- the path-resolution call sites
- cache and freshness keys
- per-source pruning
- the missing per-call usage path
- source enable/disable and per-source purge
- the AI Credits fallback that would misprice Claude tokens
- pricing aliases and the 1h cache-write rate
- fixtures and visual regression

**Cheaper alternative, not recommended:** a separate "Claude viewer" page that parses straight
into `ConversationTurn`, with no index, search or analytics, takes about 2–3 weeks. It throws
the work away when Codex arrives and splits the product into two apps, which contradicts the
goal of easy future providers. See [architecture.md](architecture.md) §2.

## 3. Recommendation

1. Start the **L0 spike** and the **foundation** together (lanes B and A in
   [implementation-plan.md §4](implementation-plan.md#4-parallelism-and-dependencies)). The
   spike's parser and translator become the production `ClaudeCodeProvider` core. The
   foundation lands behind a behaviour-preserving `CopilotProvider` with golden tests.
   [Kickoff](implementation-plan.md#7-kickoff) lists the first work packages.
2. Ship **L2 behind the experimental *Claude Code sessions* setting** (§5). L1 is an internal
   milestone, not a release; it shows "zeros" in too many places.
3. Do **L3** based on user feedback. Start **Codex** once the L2 foundation exists. The
   [Codex stress test](architecture.md#7-codex-stress-test) lists the generalizations that make
   it a provider-only job.

## 4. Decisions (2026-10-05)

| # | Decision | Outcome |
| --- | --- | --- |
| D1 | Product positioning | **Stay Copilot-first.** Claude Code is an experimental extra. Use source-neutral copy only in shared UI. Revisit "coding-agent session viewer" when Codex lands |
| D2 | Claude Code cost | **API-equivalent USD**, labelled as an estimate. It is valid for both subscription and API billing because it is a common yardstick, not a bill |
| D3 | Expiring transcripts | **Respect Claude Code's rolling window.** No archive now; expired sessions leave the index like deleted Copilot sessions. An opt-in archive stays a possible L4 item (E1) |
| D4 | Subagents | **Fold into the parent session.** Subagent files are stitched into the parent's event stream, like Copilot's inline subagents. The `parent_session_id`/`role` columns still exist so Codex can choose |
| D5 | Tool names | **TracePilot's standard set.** Copilot's names are the canonical vocabulary, plus `shell`, `todo` and `plan` ([mapping.md §2](mapping.md#2-tools--canonical-kinds--renderers)) |

## 5. Enabling and disabling Claude Code

Users control Claude Code with **one experimental setting**, following the existing feature-flag
pattern (`FeaturesConfig` in `tracepilot-tauri-bindings/src/config/features.rs`, `DEFAULT_FEATURES`
in `@tracepilot/types`, and the `experimentalFlags` list in
`apps/desktop/src/components/settings/SettingsExperimental.vue`):

- **Settings → Experimental → "Claude Code sessions"** (`features.claudeCodeSessions`, default
  **off**). Description: "Index and view Claude Code sessions from `~/.claude` alongside
  Copilot CLI sessions."
- **Claude Code folder.** When the setting is on, Settings → Data & Storage shows a "Claude
  Code folder" path field (`sources.claudeCode.configDir`). It defaults to `CLAUDE_CONFIG_DIR`,
  else `~/.claude`, and is validated like the Copilot folder.
- **Turning it on** registers the `ClaudeCodeProvider` and starts an incremental reindex of that
  source only. The session list gains the source badge and filter once at least two sources
  are active.
- **Turning it off** unregisters the provider and **purges the Claude Code rows from the index**
  (`DELETE … WHERE source = 'claudeCode'`, cascading to analytics tables). This keeps every
  query, chart and search free of hidden rows. Turning it back on rebuilds them in seconds,
  since transcripts are capped by the 30-day window.
  - The order matters: bump the source's config generation and cancel its indexing jobs, then
    purge, then invalidate caches.
  - Index writes commit only while their generation is current, so an in-flight job cannot
    write rows back ([architecture §3.4](architecture.md#34-identity-index-and-resolution)).
  - Changing the folder is a disable followed by an enable.
- **Copilot cannot be turned off** while TracePilot is Copilot-first (D1). The setup wizard is
  unchanged until positioning changes.
- **Per-session gating** comes from `SourceCapabilities`. The global flag only decides whether
  the provider runs.
