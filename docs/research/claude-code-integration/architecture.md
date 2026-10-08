# Multi-Source Architecture

> Part of the [Claude Code integration plan](README.md). File references are relative to
> `crates/` unless stated otherwise. They were checked against `e13b6058`.

**Goal.** Add Claude Code as a second session source. Shape the seam so that a third provider
(Codex next) is "write a provider module plus fixtures", with no further core refactor.

## 1. Where TracePilot is coupled to Copilot today

The good news, confirmed again: **turn reconstruction, search extraction, agent runs, skill
invocations, incidents and export all consume `&[TypedEvent]`.** A source that produces typed
events gets most of the app.

Everything *around* the event stream assumes one Copilot root:

| Assumption | Where | Scale |
| --- | --- | --- |
| Session path = `<session_state_dir>/<uuid>` | 8 direct `resolve_session_path_direct` calls plus 17 via `with_session_path` (`tracepilot-tauri-bindings/src/helpers/db.rs:26`) | 25 IPC call sites. The index already stores `sessions.path`, but `IndexDb::get_session_path` (`tracepilot-indexer/src/index_db/session_reader.rs:102`) has **no callers** |
| Freshness = size + mtime of one `events.jsonl` | `EventCache`/`TurnCache` (`tauri-bindings/src/types.rs:9-25`), `load_cached_typed_events` (`commands/session/shared.rs:19-90`, 8 callers), `check_session_freshness`, the `events_file_size/mtime` DTO fields (`types.rs:31-58`), search fingerprint (`indexing/search_prepare.rs:77`), batch sizing (`indexing/batches.rs:11`) | About 15 sites. The stored analytics fingerprint is already an opaque JSON string (`session_writer.rs:92, 225-247`) |
| Snapshot = `workspace.yaml` + `events.jsonl` | `SessionFingerprint` (`tracepilot-core/src/summary/snapshot.rs:16-29`), `summary/workspace.rs`, export `builder/session.rs:23-28` (fails without `workspace.yaml`) | |
| One discovery pass, **global prune** | `indexing/reindex.rs:12-198` → `prune_deleted(&live_ids)` (`session_writer/prune.rs:11`) deletes every session not seen in that pass | Two providers would delete each other's rows |
| Metrics only from `session.shutdown` | `ShutdownData` (`core/src/models/event_types/session_lifecycle_data.rs:49`) → `extract_combined_shutdown_data` (`parsing/events/aggregate.rs:20`) | No path exists for per-call usage |
| Copilot tool names in core | `"task"` (`turns/reconstructor/tool_exec.rs:48`, `agent_runs/extract.rs:65`), `read_agent`/`write_agent` (`agent_control.rs:23-24`), `"skill"` (`skill_invocations/extract.rs:193`), shell family (`turns/utils.rs:29-80`), summarizer (`turns/ipc.rs:20-100`), indexer skip and extraction lists (`search_writer/content_extraction/limits.rs:13-24`, `tool_extraction.rs:73-135`) | About 30 literals |
| Liveness = `inuse.*.lock` | `session/discovery.rs:90-153`, `helpers/cache.rs:24,63`, `state.rs:33` | |
| Config = one Copilot home | `PathsConfig {copilot_home, tracepilot_home, session_state_dir, index_db_path}` (`config/paths.rs:7`); TracePilot's own data root lives under `<COPILOT_HOME>/tracepilot` (`core/src/paths.rs:152,168`) | `session_state_dir` appears on 64 lines in 24 bindings files |
| Frontend | Static tabs (`apps/desktop/src/config/sessionTabs.ts:42-67`), "Copilot" as the main-agent label (`chat/TurnBlock.vue:107`, `ConversationTurnList.vue:198,338`, `packages/ui/.../AgentBadge.vue:29`), AIC estimate fallback (`useSessionMetrics.ts:57-90`), setup wizard requiring a valid Copilot dir (`SetupWizard.vue:93-98`) | About 15 files for basic support, 40–50 for good support |

Raw counts of non-test lines:

| Reference | core | indexer | bindings | export | orchestrator |
| --- | ---: | ---: | ---: | ---: | ---: |
| `events.jsonl` | 34 | 4 | 16 | 4 | 6 |
| `workspace.yaml` | 22 | 3 | 3 | 5 | 3 |
| `session_state_dir` | 4 | 16 | 64 | 0 | 6 |

## 2. Integration styles considered

| Style | Description | Verdict |
| --- | --- | --- |
| **Separate viewer** | A Claude page with its own parser straight to `ConversationTurn`; no index, search or analytics | **Rejected.** About 2–3 weeks, but it is a dead end: no search or analytics, and the work is thrown away for Codex. It is two products in one shell |
| **(C) Transcode to Copilot dirs** | Write synthetic `<uuid>/events.jsonl` + `workspace.yaml` mirrors into an app folder | **Spike only.** Duplicates data (Codex: 3.4 GB), needs a sync daemon, fakes lock files and shutdown events, leaves Copilot UI visible, and hides in-place rewrites |
| **(B) Native turns** | Provider builds `ConversationTurn`, summary and analytics rows directly | **Rejected.** Every event consumer (FTS extractor `extractor.rs:23-250`, agent runs, skills, incidents, context timeline, `get_tool_result`, export, about 8 IPC commands and 6 extractors) needs a second implementation. That duplicates about 2.5k lines of subagent/attribution logic |
| **(A) Translate to Copilot-shaped `TypedEvent`s** | Provider emits Copilot wire events | Reuses everything, but has nowhere to put per-call usage, observed cache, the native record or native tool names, and would force a fake `session.shutdown` |
| **A+ (recommended)** | (A) for conversation semantics, plus a **small set of source-neutral additions**, plus a `SessionProvider` seam | Reuses about 90% of the backend unchanged, with no fake Copilot telemetry |

## 3. The A+ design

### 3.1 Provider seam (`tracepilot-core/src/provider/`)

```rust
pub enum SessionSource { Copilot, ClaudeCode /*, Codex */ }   // serde: "copilot" | "claudeCode"

pub struct SessionLocator {          // what the index stores and IPC resolves to
    pub source: SessionSource,
    pub id: SessionId,               // native UUID (both sources use UUIDs)
    pub primary_path: PathBuf,       // dir (Copilot) or file (Claude/Codex); stored in sessions.path
    pub parent_id: Option<SessionId>,// session family (Codex child threads); None when folded
    pub role: SessionRole,           // Primary | Subagent | Guardian | …; drives default visibility
    pub source_bytes_hint: u64,      // replaces the events.jsonl stat in batches.rs
}

pub struct SourceFingerprint {       // replaces SessionFingerprint {workspace, events}
    pub files: Vec<(PathBuf, Option<FileFingerprint>)>, // sorted; None = optional file absent
    pub version_token: Option<String>,                  // provider-opaque (e.g. Codex overlay row version)
}                                    // serialized → sessions.source_fingerprint; hashed → `source_version`

pub struct ProviderSnapshot {
    pub summary: SessionSummary,     // provider fills title, repo, branch, cwd, created/updated_at
    pub events: Option<Vec<TypedEvent>>, // normalized IR; None = no event log yet
    pub turns: Option<Vec<ConversationTurn>>, // reconstructed while summarizing, kept for reuse
    pub metrics: Option<SessionMetrics>, // provider-reported totals (Claude cost-state); None for Copilot
    pub diagnostics: Option<ParseDiagnostics>,
    pub fingerprint: SourceFingerprint,  // read before parsing; strict contract as today
}

pub trait SessionProvider: Send + Sync {
    fn source(&self) -> SessionSource;
    fn capabilities(&self) -> SourceCapabilities;
    fn discover(&self, cancel: &dyn Fn() -> bool) -> Result<Vec<SessionLocator>>;
    fn fingerprint(&self, s: &SessionLocator) -> Result<SourceFingerprint>;
    fn load_snapshot(&self, s: &SessionLocator, strict: bool, cancel: &dyn Fn() -> bool)
        -> Result<ProviderSnapshot>;
    fn liveness(&self, s: &SessionLocator) -> Liveness; // Running{pid, status} | Idle | Unknown
    fn artifacts(&self, s: &SessionLocator) -> Result<SessionArtifacts> { Ok(Default::default()) } // todos, plan, checkpoints, rewind, file roots
    fn resolve(&self, id: &SessionId) -> Result<Option<SessionLocator>>; // used when the index is empty
}

pub struct ProviderRegistry { providers: Vec<Arc<dyn SessionProvider>> } // one per source; built from SourcesConfig
// discover_each() returns a per-source Result, so one failed source never hides another's inventory
```

This is implemented (WP2). The Rust in `crates/tracepilot-core/src/provider/` is the
reference; the sketch above is kept in sync with it.

- **`CopilotProvider`** wraps today's functions with **no behaviour change**:
  `discover_sessions_cancellable`, `SessionFingerprint` as a 2-entry `SourceFingerprint`,
  `load_session_snapshot`, `has_lock_file`, `read_todos`, `parse_checkpoints`,
  `parse_rewind_index` and `plan.md`.
- **Regression guard:** golden tests over `tracepilot-test-support` fixtures. Index rows, turns
  and analytics must be byte-identical before and after the refactor.
- **Placement:** a module in `tracepilot-core` keeps the dependency graph unchanged. If the
  Claude and Codex parsers grow large, split them into a `tracepilot-providers` crate that
  depends on core.

### 3.2 Source-neutral IR additions

These are the only additions to the normalized model. Each one also serves Codex.

| Addition | Shape | Consumers |
| --- | --- | --- |
| **`tracepilot.model_call` event** | `ModelCallData { model, request_id, input_tokens (inclusive), cache_read_tokens, cache_write_tokens, cache_write_by_ttl: Option<{ttl_s → tokens}>, output_tokens, reasoning_tokens, duration_ms, stop_reason, context_window_tokens }`; owner via envelope `agentId`. A standalone event (Codex reports usage on `token_count` records unrelated to message ids) | (a) `metrics_from_model_calls()` in `summary/enrichment.rs` when there is no `session.shutdown`; (b) a "total only" anchor in `context_window/builder.rs` (anchors need the 3-way split today, `points.rs:206-220`); (c) an observed-hit path in `prompt_cache/builder.rs` with `CacheConfidence::Observed`; (d) optional per-turn usage on `ConversationTurn` |
| **`RawEvent.native`** | `Option<NativeRecord { source, record_type, data }>`, sanitized (no image base64, no file contents). `raw.data` stays canonical | Events tab and export show truthful records while `event_type` and `data` stay canonical (the reconstructor dispatches on prefixes, `reconstructor/mod.rs:131-137`, and reparsing derives typed data from `raw.data`) |
| **`native_tool_name`** | On `ToolExecStartData` and `TurnToolCall` | Display, filters, tool analysis breakdown |
| **`SessionMetrics` from the provider** | Maps into `ShutdownMetrics` with AIC and premium requests **`None`, not 0**, plus a cost figure: `cost_amount`, `cost_unit` (`aic \| usd`) and `cost_basis` (below) | Metrics tab, analytics, comparisons |
| **`SourceCapabilities`** | `can_resume`, `can_launch`, `can_steer`, `has_aic`, `has_premium_requests`, `has_context_breakdown`, `has_todos`, `has_checkpoints`, `has_plan`, `has_explorer`, `has_hidden_roles`, … Static per source, with optional per-session overrides (e.g. "todos tool used") | Tab gating, IPC refusal, KPI visibility |

Implemented (WP11, C7): `ModelCallData` and `SessionEventType::ModelCall`;
`summary::metrics_from_model_calls` (always partial coverage) is the fallback in
`summary_from_events` when there is no `session.shutdown`; the reconstructor sums calls into
`ConversationTurn.usage` through the same ownership as messages. The context anchor and
`CacheConfidence::Observed` remain C8.

WP13 (C11) prices known Claude calls with a complete recorded cache-write TTL split.
Snapshot-only cost keeps `providerEstimate`; snapshot plus priced tail, or recorded calls
without a snapshot, uses `tracepilotEstimate`. An unknown model or missing TTL leaves the
current cost absent while preserving token totals and `coverage.snapshotCost`. Missing
input or output usage also stays unpriced; a recorded zero remains a known zero.

**Wire compatibility.** Every new field is optional, with
`#[serde(default, skip_serializing_if = "Option::is_none")]`. Copilot `events.jsonl` lines and
IPC JSON therefore serialize exactly as before; F7a proves this with a round-trip test.

**Cost basis.** This is the one vocabulary used by every document, DTO and label (serialized in
camelCase). It answers "who produced this number, and is it a bill?":

| `cost_basis` | Meaning | Example |
| --- | --- | --- |
| `billed` | The provider reports it as charged usage | Copilot AIC from `session.shutdown` |
| `providerEstimate` | The provider's own estimate, not a bill | Claude Code `cost-state.totalCostUSD` |
| `tracepilotEstimate` | TracePilot priced recorded usage from its pricing registry | Copilot AIC from GitHub rates; Claude live tail at Anthropic API rates |

When there is no cost figure, the field is absent, never 0. Premium requests are a separate
Copilot-only count, not a cost basis.

**Never synthesize** `session.shutdown`, `session.usage_checkpoint`, `inuse.*.lock` or
`workspace.yaml`. Shutdown semantics drive segment detection (`aggregate.rs:11-15`), "ended"
UI and health logic; the VS Code study (§10.1.4) reached the same conclusion. Synthesizing
`session.start` is acceptable because it only carries context.

### 3.3 Tool normalization

There is one static table per provider:
`&[(native_name, canonical_name, ArgRemap, ResultReshape)]`. Core match arms stay keyed on
canonical names and never gain per-provider branches.

- Copilot's names become TracePilot's documented canonical vocabulary.
- Neutral additions: `shell`, `todo`, `plan`.
- The full table is in [mapping.md](mapping.md) §2.

The reshape has to happen in Rust:

- The frontend only receives a 1 KB result preview plus lazily fetched text
  (`TurnToolCall.resultContent`; `get_tool_result`). It never sees `toolUseResult`.
- The Rust summarizer, subagent detection, skill extraction, FTS extraction, tool analysis,
  code impact and Markdown export all read tool names and arguments. One mapping fixes them
  all; a frontend adapter would fix only the renderers.
- Rich-render toggles in Settings stay one per renderer instead of being duplicated per source.

### 3.4 Identity, index and resolution

- **Migration M22** adds four columns to `sessions`:
  - `source TEXT NOT NULL DEFAULT 'copilot'`
  - `parent_session_id`
  - `role` / `hidden`
  - `source_format_version`

  It also extends the upsert (`session_writer.rs:112-187`) and `SESSION_COLUMNS`. Bump
  `CURRENT_ANALYTICS_VERSION` (17) only if derived rows change.
- **The primary key stays the native UUID.** `validate_session_id` requires a UUID
  (`tauri-bindings/src/validators/id.rs:20`), and every source uses UUIDs. The `ON CONFLICT(id)` upsert gets a
  guard so a row from a different source never overwrites silently; the clash is logged as a
  diagnostic.
- **Resolution:** `with_session_path` becomes `with_session_locator(state, id, |provider, locator| …)`.
  It resolves via the index (`get_session_path` + new `get_session_source`) and falls back to
  `registry.resolve`. All 25 call sites move.
  - Implemented (WP6) as `IndexDb::get_session_locator` plus `ProviderRegistry::locate`. A
    stored locator is trusted only when its source is registered, that provider `owns` it (a
    path under the provider's current `root`, named by the id; Copilot requires exactly
    `<session-state>/<id>`) and it still exists. Anything else re-resolves through the
    providers, so a row from a disabled source or an older root never reaches a command.
  - Commands that need a capability refuse with the typed `UNSUPPORTED` error: resume and
    context capture (`canResume`), SDK steering (`canSteer`) and the file browser
    (`hasExplorer`, rooted at the provider's first file root, which must lie under its root).
    Export still reads Copilot's layout and refuses other sources until C14. Import refuses
    to keep an id the index holds for another source.
- **Pruning is per source**, so one source can never delete another's rows.
  - A source is pruned only after a **complete inventory** of its configured root. If
    discovery was cancelled, hit an I/O error, or found the root missing or unreadable, that
    source is not pruned in that run.
  - Expired Claude Code transcripts drop out on the next complete reindex, respecting Claude
    Code's rolling window (decision D3).
  - **Disabling a source purges its rows** (`DELETE FROM sessions WHERE source = ?`, cascading
    to child tables). Queries therefore never need an "enabled sources" filter. Re-enabling
    rebuilds them.
- **Config generations stop stale writes.** Each source has a generation counter, bumped on
  every enable, disable or root change. An indexing job records the generation of each source
  in its registry snapshot, and every write transaction for a source checks it is still
  current before commit. Otherwise the transaction rolls back. Disabling therefore runs in
  this order:
  1. Bump the generation and cancel the source's running jobs.
  2. Purge its rows.
  3. Invalidate its event, turn, search and analytics caches.

  A job that started before the disable can no longer write Claude rows back after the purge.
  A root change is a disable of the old root followed by an enable of the new one.
  - Implemented (WP10) in `mutate_config`: the config is published and the generation bumped
    under one write lock, so no pass pairs the new config with an old generation. The purge
    (`IndexDb::purge_source`) runs after the lock drops, then the commands clear the caches and
    start a reindex of that source only. Every full incremental pass also sweeps rows of
    disabled sources, in case a purge failed.
- **Freshness** becomes an opaque `source_version` (a hash of the serialized
  `SourceFingerprint`) in the caches and in `FreshnessResponse`. The old `events_file_*` fields
  stay populated for Copilot during the transition. The frontend already compares them only for
  equality. Implemented (WP6) as `SourceFingerprint::source_version`; for other sources the
  legacy fields carry the total size and latest mtime of the fingerprinted files.

### 3.5 Config and setup

- **Enable flag:** `features.claudeCodeSessions` (experimental, default off) in `FeaturesConfig`
  (`tauri-bindings/src/config/features.rs`), mirrored in `DEFAULT_FEATURES` (`@tracepilot/types`)
  and listed in `experimentalFlags` in `SettingsExperimental.vue`. The flag decides whether
  `ClaudeCodeProvider` is registered in the `ProviderRegistry`. UX is in
  [README §5](README.md#5-enabling-and-disabling-claude-code).
- **Root path:** `sources.claudeCode.configDir` (new `SourcesConfig`, specta-exported).
  - Default: `CLAUDE_CONFIG_DIR`, else `~/.claude`.
  - Validated through `canonicalize_user_path` ([ADR 0012](../../adr/0012-filesystem-trust-boundary.md)).
  - Shown in Settings → Data & Storage only when the flag is on.
  - The Copilot paths stay in `PathsConfig` unchanged, which keeps the config migration additive.
- **Toggle effects:** the provider registry is rebuilt on config change. Enabling triggers a
  reindex of that source. Disabling follows the generation ordering in §3.4: cancel, purge,
  then invalidate.
- **Setup wizard** is unchanged while TracePilot is Copilot-first (decision D1). It still
  requires a valid Copilot folder (`SetupWizard.vue:93-98`,
  `tauri-bindings/src/commands/config_cmds.rs:103-108`). Allowing a Claude-only setup, and
  moving TracePilot's data root out of `<COPILOT_HOME>/tracepilot` for such installs, belongs
  with a future positioning change.

### 3.6 Liveness and live refresh

- There is no file watcher today. The frontend polls `check_session_freshness`; keep it that
  way.
- `ClaudeCodeProvider::liveness` reads `~/.claude/sessions/<pid>.json` and requires all of the
  following:
  - the pid is alive
  - the process start time matches `procStart` (guards against PID reuse)
  - `sessionId` matches

  It returns `Running { status: busy | idle }`. This is richer than Copilot's lock-plus-24h
  heuristic.
- **Incremental parse of an appended file** is an optimization, not a requirement. The current
  full re-parse on freshness change is acceptable at observed sizes (median 4.6 MB, max 52 MB).
  Add it only if the perf budget (`perf-budget.json`) shows a regression.

### 3.7 Prompt-cache expiry is an estimate

Claude Code transcripts record what each call **did**: cache reads, and cache writes split by
TTL tier (`cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`). They do
not say whether the cache is still warm. Following
[Anthropic's prompt-caching guide](https://platform.claude.com/docs/en/build-with-claude/prompt-caching):
- The TTL tier comes from the call's recorded split. Every write in this corpus was 1h, but a
  hard-coded 1h is wrong for a session that writes 5m entries.
- A cache read refreshes the entry's lifetime. Expiry therefore counts from the start of the
  last request that read or wrote that prefix, not from the first write.
- With no recorded tier, the state is **unknown**, not expired.
- Indexed analytics (C10) store one window per main-agent prompt that follows a call: from the
  last call before it to the first call after it, with the tier of the latest call that wrote
  cache (the shorter one when a call wrote both). The outcome compares the resume with that
  estimate. Recorded tiers never feed the cross-session TTL registry
  (`session_cache_ttls`), which estimates Copilot windows.
- An observed hit only shows the prefix matched *then*. The next request may change tools,
  system prompt or model and miss. The UI says "estimated" and never promises a hit.

## 4. Frontend shape

- **Types:** add `SessionSource`, `SourceCapabilities` and a static capability map in a new
  `packages/types/src/sources.ts`, emitted from Rust through specta where possible.
- **New fields:**
  - `source` on `SessionListItem` (generated), `SessionDetail` and `SearchResult`
  - `sources?` on `SearchFilters`
  - `source?` on the analytics options
  - `nativeToolName?` on `TurnToolCall`
- **Tab gating:** `mapSessionTabs(caps)` (`config/sessionTabs.ts:61`) plus a router guard for
  deep links to hidden tabs. Precedents exist: `hasPlan`/`hasCheckpoints` and the Timeline
  Messages view shown only when subagents exist.
- **Labels:** the main-agent label comes from the source (`Copilot` / `Claude Code`) in the
  three hard-coded places.
- **Cost:** `useSessionMetrics` must **not** fall back to Copilot AIC estimation when
  `cost_basis` is not GitHub. That fallback would silently show "estimated AI Credits" for
  Claude sessions.
- **Renderers:** show `nativeToolName` in the tool header, waterfall and swimlanes. The
  ShellOutput title comes from the tool, not a hard-coded "PowerShell". Add one new
  `TodoListRenderer`. No other renderer duplication.

## 5. Analytics: mixed, with a source dimension

**Decision: one index and one schema, with `source` as a first-class filter and group-by. Never
two separate analytics stacks.**

Reasons:
- Everything the dashboards aggregate is source-neutral once normalized: sessions, durations,
  tokens, cache, tools by canonical kind, files and lines changed, incidents and models.
- A shared schema lets users answer cross-source questions: "same repo across Copilot and
  Claude Code", "Opus 5.5 under Copilot vs Claude Code".

| Metric family | Default view | Rule |
| --- | --- | --- |
| Session counts, durations, activity heatmap | All sources, stackable by source | — |
| Tokens (input inclusive, cache read/write, output, reasoning) | All sources | Normalize token semantics at ingest ([data-comparison.md](data-comparison.md) §2, rule 4) or cache rates are wrong |
| Cache hit rate | All sources, with a per-source split | Claude's is observed and Copilot's is from shutdown totals; same formula after normalization |
| Tools | Group by **canonical** kind; drill into native names | Avoids `view` vs `Read` noise |
| Code impact | All sources | — |
| Models | Group by **normalized model id** (alias rule in [mapping.md](mapping.md) §3) | Enables cross-source model comparison |
| **Cost** | **Split by source and never summed silently.** Copilot shows AI Credits (billed or GitHub-rate estimate); Claude Code shows API-equivalent USD (`cost-state`, an estimate). An optional "API-equivalent total" is allowed, because 1 AIC = $0.01 at list token rates. It must be labelled as an estimate across billing models | The billing semantics differ (usage-billed vs subscription) |
| Premium requests, AIC coverage | Copilot only | Hidden when the filter excludes Copilot |
| Agents and skills | All sources | Agent types differ (`explore` vs `Explore`); normalize case only |

Implementation:
- **Backend:** add `source` to `build_date_repo_filter`
  (`tracepilot-indexer/src/index_db/helpers/filters.rs:12`, 6 uses), the agents and skills queries, `list_sessions_filtered` (`session_reader.rs:28`) and
  `SearchFilters` (`search_reader/mod.rs:41`).
- **Frontend:** filter state and cache keys (`stores/analytics.ts:34-46,77-92`), the page
  header select, and client options. About 6 files.
- A segmented side-by-side "compare sources" view is L3 or later.

### Pricing

WP13 keeps Claude Code pricing in `packages/types/src/claude-code-pricing-data.json`,
separate from Copilot's registry, persisted defaults and pricing settings. The Rust Claude
provider embeds that same data; the frontend opts in through `calculateClaudeCodeTokenCost`.
The rows have `provider-wholesale` provenance, an Anthropic source URL and verification
date. `claudeCodeCostBasisLabel` supplies **Claude Code estimate** and **TracePilot estimate**
labels for the source-aware USD presentation in U2. These are API-equivalent token estimates,
not subscription charges, and exclude unrecorded server-tool fees and pricing modifiers.
New or unsupported variants stay unpriced until their rates are verified. Copilot's lookup
and rate data stay unchanged.

- **Model ids:** `claude-opus-5-5` / `claude-haiku-4-5-20251001` need an alias rule to match
  the Claude pricing rows (`claude-opus-5.5`, …). Prefer `cost-state.totalCostUSD` when present.
- **Cache-write rate:** when TracePilot must price Claude usage itself (live session, missing
  `cost-state`), it needs the 1-hour rate. Anthropic's published API rates are 1h writes at
  2× base input and 5m writes at 1.25×. The registry's single `cacheWritePerM` is the 5m rate.
  **Every observed Claude Code write was 1h**, so using the registry as-is would underprice
  cache writes by 37.5%. Add an optional `cacheWrite1hPerM` (or a TTL multiplier) to the
  registry entries.
- **Provenance:** mark the rows `provider-wholesale` (the registry already models it), with
  source URL and verification date, like the GitHub rows.

## 6. What *not* to abstract

- **Orchestrator features** stay Copilot-only behind capabilities: launcher, SDK bridge (7.3k
  lines), live attach, config injector, MCP, skills and agents editors, version manager,
  context capture. Worktrees, templates and the repo registry are already generic.
- **Import** stays Copilot-only, because it writes Copilot directories.
- **No core `MetadataOverlay` trait.** Codex's `state_5.sqlite` overlay is read inside its own
  provider.
- **No per-provider renderer sets.**

## 7. Codex stress test

Each Codex trait from the [feasibility study §4](../codex-claude-code-session-support-feasibility.md)
is checked against the seam. The aim is to keep shortcuts that only fit Claude out of shared
layers.

| Codex trait | Pressure | How the seam absorbs it |
| --- | --- | --- |
| One rollout per thread; subagents are separate threads (`parent_thread_id`, `thread_spawn_edges`) | A session is a *family* of files | `SessionLocator.parent_id` + `role`. Index columns from M22. The provider chooses whether to fold or list. A fold emits child events with envelope `agentId` + `parentToolCallId`, exactly like Claude subagents. Pruning never deletes a child whose parent survives |
| Read-only SQLite metadata overlay (`state_5.sqlite`) | Summary from a DB; discovery may be DB-driven | Internal to the provider (`mode=ro`, short-lived; `core/src/utils/sqlite` helpers). The overlay row version goes into `SourceFingerprint.version_token` |
| Duplicated `response_item` vs `item_completed` | Double counting | Provider-internal de-dup. A provider-agnostic `ignored_records` / `dropped_duplicates` counter in `ParseDiagnostics` (`parsing/diagnostics.rs:49`), plus provider fixture tests |
| Rollouts rewritten in place | Size and mtime alone may miss changes | Fingerprint over the file list plus `version_token`. Caches and the frontend use the opaque `source_version` |
| Subagent rollouts replay a parent-history prefix | Duplicate turns | Provider skips ordinals below the start. The parent fingerprint includes children |
| 323 of 818 threads are guardian auto-review | List and analytics noise | `SessionRole::Guardian` → `hidden`. Default filters exclude hidden roles; `has_hidden_roles` capability |
| Per-call `token_count` with `model_context_window` | Same need as Claude | `ModelCall` (standalone event) + `context_window_tokens` |
| `update_plan` todos; goals DB | Todos without `session.db` | `artifacts()` → `TodoList { items, deps: Option }`; reuse `TodosResponse` |
| 3 format generations | Version detection | Provider-internal. `source_format_version` replaces UI uses of `copilot_version` |
| 3.4 GB | Batching cost | `source_bytes_hint`; per-provider enable and "include archived" config |
| Writer-lock liveness | Different signal | `Liveness` enum; no lock-file assumption outside the Copilot provider |
| Encrypted reasoning | Nothing to show | `encrypted_content` already exists and is ignored by `visible_reasoning()` |

Designs that would have fitted **only** Claude Code, and the generalization chosen instead:

| Claude-only design | Generalization |
| --- | --- |
| "Session = one JSONL + `subagents/`" | File-list fingerprint + version token |
| "Subagents always folded" | `parent_id` + `role`; the provider chooses |
| "Metadata lives in records" | Provider-internal overlay |
| "Liveness = pid JSON" | `Liveness` enum |
| "One Claude tool table" | Per-provider normalizer table + `native_tool_name` |
| "Usage per `message.id`" | Standalone `ModelCall` event |
| "Cost = `cost-state` USD" | `estimated_cost_usd` + `cost_basis` enum |

**Acceptance tests for the foundation.** There are two milestones, because consumers become
provider-aware only in F4–F6:
1. **F2 (seam):** `CopilotProvider` parity with today's direct loaders for summaries, events,
   turns, metrics, fingerprints and liveness, plus a registry-level `FixtureProvider` smoke
   test (register, discover, load). Re-running unchanged consumers alone would leave the
   wrapper untested.
2. **Q1 (pipeline):** a stub `FixtureProvider` (test-only) that emits a hand-written event
   stream gets through discovery, indexing, search, Conversation and analytics with **zero
   changes outside `provider/`**. If it doesn't, the seam leaks.
   - Implemented (WP11) in `tracepilot-indexer/tests/foundation_acceptance.rs`, outside
     `tracepilot-core` and against public APIs only. It found one leak: the summary builder
     was crate-private, so `summary::summary_from_events` is now public. A new source still
     adds its `SessionSource` variant, which the compiler routes to the per-source analytics
     version and the bindings registry.
