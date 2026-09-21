# Handover — Copilot session-store enrichment

Branch: `feat/session-store-enrichment` (off `main`). Not yet pushed / no PR at
the time of writing.

This implements `docs/features/copilot-session-store-enrichment-design.md`
(phases 1–5). Phase 6 is deliberately unstarted — see [What is not done](#what-is-not-done).

---

## 1. What this feature is

Copilot CLI 1.0.40+ keeps `~/.copilot/session-store.db`: session metadata,
flattened turns, compaction checkpoints, touched files, extracted PR/issue/commit
references, and — the reason this exists — **one row per model request** with its
tokens, timings and recorded charge.

The `assistant.usage` event carrying that detail live is marked *ephemeral* and
never reaches `events.jsonl`. So for historical sessions this file is the only
local record of where the credits and the latency went.

It is an **optional, read-only enrichment**. `events.jsonl` stays authoritative
for everything TracePilot already shows.

### The three states that must never collapse

Every response and every table separates:

| State | Meaning |
|---|---|
| `enabled: false` | the user turned the setting off |
| `available: false` | no source installed, or it could not be read |
| available + empty | the source was read and recorded nothing |

Only **18 of 391** locally logged sessions had any request rows, so *absence of
rows is not evidence of zero usage*. Every figure travels with its coverage.

---

## 2. Current status

| Phase | Status | Verified how |
|---|---|---|
| 1. Adapter and evidence model | Done | 41 unit tests in `crates/tracepilot-core/src/session_store/tests/` |
| 2. Index lifecycle + minimal UI | Done | 15 tests in `crates/tracepilot-indexer/src/index_db/tests/session_store.rs` + running app |
| 3. Linked work + search qualifiers | Done | 12 tests in `search_reader/work_ref_tests.rs` + running app |
| 4. Attribution + cache observations | Done | `prompt_cache/tests/observations.rs`, `enrichment/attribution.rs` |
| 5. Aggregate performance | Done | indexer tests + desktop component tests |
| 6. Optional extensions | **Not started, by design** | n/a |

### Checks last run (all green unless noted)

```
cargo test --workspace --exclude tracepilot-desktop     pass
cargo clippy --workspace --exclude tracepilot-desktop   0 warnings
pnpm typecheck                                          pass (all projects)
pnpm test                                               pass
node scripts/check-file-sizes.mjs                       pass
node scripts/check-doc-links.mjs                        pass
```

**Two pre-existing failures that are NOT from this branch** (both reproduce on a
clean tree — verified by stashing):

- `pnpm check:design-system` → `apps/desktop/src/components/session/FileContextMenu.vue:84`
  uses `z-index: calc(var(--z-overlay) + 1)`. Untouched by this work.
- `pnpm lint` (biome) → one `useIndexOf` warning in `packages/ui/src/components/TabNav.vue`.
  Untouched by this work.

---

## 3. Where the code lives

### Core — `crates/tracepilot-core/src/session_store/`

The evidence layer. Reads and normalises the external file; knows nothing about
persistence.

| File | Purpose |
|---|---|
| `open.rs` | `SourceBinding` (which Copilot home owns which store) and `SourceReader` |
| `capability.rs` | Probes real tables/columns; builds NULL-substituting projections |
| `values.rs` | Cell extraction that keeps *absent* and *present-but-unusable* apart |
| `decimal.rs` | `ExactDecimal` / `Rational` — i128, checked, no floats |
| `billing.rs` | Reproduces a recorded charge from its itemised entries |
| `model.rs` | `StoreRequest`, `BillingItem`, `RequestInitiator`, … |
| `work_ref.rs` | PR / issue / Git-ref normalisation and resolution |
| `reconcile.rs` | Compares requests to shutdown accounting, scope-aware |
| `stats.rs` | Distributions, quantiles, cache-reuse ratios |
| `status.rs` | `SourceAvailability`, `FieldCoverage`, `ReconciliationReport` |

Also `crates/tracepilot-core/src/prompt_cache/observation.rs` — recorded reuse
attached beside a window's prediction.

### Indexer — `crates/tracepilot-indexer/`

| Path | Purpose |
|---|---|
| `index_db/migrations/020_session_store_enrichment.sql` | Six tables |
| `index_db/enrichment/writer.rs` + `rows.rs` | Atomic per-session replacement |
| `index_db/enrichment/reader.rs` | Paged ledger, refs, coverage, status |
| `index_db/enrichment/attribution.rs` | Request → agent-run / compaction joins |
| `index_db/enrichment/lifecycle.rs` | Source status, snapshot identity, reconciliation |
| `index_db/analytics_queries/request_performance.rs` | Cross-session aggregates |
| `indexing/enrichment.rs` | The independent refresh pass |

### Bindings — `crates/tracepilot-tauri-bindings/`

Commands in `commands/session/session_store.rs` and
`commands/search/enrichment.rs`:

```
get_session_store_status        get_session_request_usage
get_session_work_refs           get_request_performance
get_model_request_performance   get_agent_request_rollups
refresh_session_enrichment
```

Setting: `features.sessionStoreEnrichment` (default **on**), config version
bumped 11 → 12.

### Frontend

| Area | Files |
|---|---|
| Ledger | `components/metrics/MetricsRequestLedger*.vue`, `composables/session/useRequestLedger.ts`, `utils/requestLedger.ts` |
| Related work | `components/session/RelatedWorkPanel.vue`, `utils/workRefs.ts`, `composables/useSessionWorkRefs.ts` |
| Settings | `components/settings/SettingsSessionStore.vue` |
| Comparison | `components/modelComparison/ModelObservedPerformance.vue`, `composables/useObservedRequestPerformance.ts`, `utils/requestPerformance.ts` |
| Agents | `components/metrics/MetricsAgentBreakdown.vue`, `utils/agentRequestRollups.ts` |
| Cache observations | `components/metrics/MetricsPromptCacheSection.vue`, `utils/cacheObservations.ts` |
| Background sweep | `composables/useSessionStoreSweep.ts` (wired in `App.vue`) |
| Search qualifiers | `utils/parseQualifiers.ts`, `stores/search/{query,facets,executor}.ts` |

Contracts: `packages/types/src/sessionStore.ts`, `packages/client/src/sessionStore.ts`,
mocks in `packages/client/src/mock/sessionStore.ts` +
`packages/client/src/internal/sessionStoreMocks.ts`.

---

## 4. Invariants — do not break these

These are not style preferences. Each one exists because the alternative
produces a confident, wrong statement about someone's money or latency.

1. **Read-only, always.** `SQLITE_OPEN_READ_ONLY` + `PRAGMA query_only`, a 250 ms
   busy timeout and a total read budget. Never `configure_connection` (it would
   try to switch the CLI's database to WAL). No `VACUUM`, checkpoint, migration
   or `immutable=1`.
2. **Capabilities, not versions.** `schema_version` has been observed at **1 and
   at 8** for near-identical schemas. Probe tables/columns; a missing optional
   column costs one *cell*, not the feature.
3. **A failed read is not an empty read.** Only a read the core adapter confirms
   successful may prune cached rows. A locked store marks rows stale and keeps
   `last_success_at`.
4. **Enrichment tables are NOT in `child_rows::DELETE_SQLS`.** A baseline reindex
   fires on any `events.jsonl` change and *cannot* repopulate them. Adding them
   there would destroy data on every unrelated edit. (Same reasoning as the
   existing `search_content` exclusion — see the comment at
   `session_writer.rs:97`.)
5. **Exact decimals stay strings** end to end. A nano-AIU total exceeds
   `Number.MAX_SAFE_INTEGER`; a per-batch rate is not representable in binary
   floating point. `Number()` on either corrupts the figure the feature exists
   to explain.
6. **Recorded zero ≠ null.** `cacheReadTokens: 0` is "recorded no reuse";
   `null` is "not recorded". They must render differently and belong to
   different populations.
7. **The recorded total is the charge.** Items *explain* it. Never replace it
   with the item sum, and never multiply it by `request_multiplier` again.
8. **Source binding gates eligibility.** A session qualifies only if it came from
   the bound Copilot home's `session-state` directory. A matching UUID on an
   imported session must not acquire unrelated telemetry.
9. **No transcripts.** Counters, timings, billing entries, refs and provenance
   only. Prompts, responses, FTS content and checkpoint prose stay in the source.
10. **A bare `#123` is not a verified link.** It gets the session's repository as
    *unverified context*; cross-repository mentions are ordinary. Enterprise
    hosts come from the reference itself, never from `host_type` (a kind, not a
    hostname).
11. **"commit" values are Git refs.** Only 59 of 85 observed ones were 7–40 hex.
    SHA-shaped is a *candidate*, not proof a commit exists.
12. **Reconciliation always names its scope and metric set.** "Reconciled" alone
    is not a claim a reader can act on. Matching credits is not evidence of
    matching token attribution.
13. **`CacheConfidence` has no `Observed` variant.** An expiry *prediction* and
    an observed reuse count answer different questions. A later request reusing
    tokens is not evidence the prediction was wrong.
14. **Generations.** A rebuilt store reuses row IDs. Page cursors carry their
    generation and are rejected — never honoured — across a replacement. A new
    generation is switched in only after a full successful sweep.
15. **Enrichment failure never reaches `reindex_sessions`.** Its `Err(_)` arm
    escalates to a full rebuild of the whole index; an optional locked file must
    not cost the user that.

---

## 5. Things that look like bugs but are correct

- **Most sessions show no requests.** Only 18/391 locally had any. The UI says
  "No requests recorded for this session", which is different from "no source".
- **Compaction shows a scope difference, not a mismatch.** A compaction request's
  tokens sit outside shutdown *model* totals while its charge is already inside
  session credits. `reconcile_session` tries `allRequests` then
  `excludingCompaction` and reports which matched.
- **A compaction row's flat `cache_write_tokens` can be 0 while its billing
  entries contain 10,364.** Observed in real data. Both survive; the
  disagreement is recorded, neither side is rewritten.
- **`join_status` is often `unavailable`.** No agent ID and no run to join to is
  the ordinary case for a root request. The request still appears in the ledger.
- **p95 is frequently `null`.** Suppressed below 20 valid samples; count and
  median remain. That is a presentation threshold, not a confidence statement.
- **Turn attribution is absent.** 85/383 rows have no matching source turn and
  the exploratory text match produced several different index offsets. No safe
  rule exists, so none was invented.

---

## 6. How to verify against a real app

An isolated data root avoids touching the author's real Copilot data:

```powershell
pnpm app:start -DataRoot 'C:\Users\mattt\AppData\Local\Temp\tracepilot-enrichment-qa'
pnpm exec playwright-cli -s=tracepilot-desktop attach --cdp=http://127.0.0.1:9222
pnpm exec playwright-cli -s=tracepilot-desktop resize 1440 960
```

That root already contains two synthetic sessions and a synthetic
`session-store.db` (schema_version 8) built for this work. It exercises: an
explicit PR URL, a bare issue number, a SHA-shaped Git ref, a branch-name Git
ref, a subagent request, a compaction request with the flat-vs-billing
disagreement, and a request with several unrecorded fields.

**Gotcha:** the setup wizard cannot be driven reliably through the Playwright
CLI. Stop the app, set `setupComplete = true` in
`<root>\tracepilot\config.toml`, and restart.

### What was observed in the running app (2026-09-21)

- Migration 20 applied; source bound with `availability = ready`,
  `capabilities = requests,workRefs,sessions`, `source_schema_version = 8`.
- 4 requests, 10 billing items, 5 work refs, 2 coverage rows, 4 links written.
- Session 1 reconciled as `scopeDifference` / `excludingCompaction`.
- Ledger rendered with the shutdown-vs-recorded disclaimer, the reconciliation
  verdict *with its scope and metrics*, coverage counts, and `—` /
  "Not recorded" for a null cache counter.
- Related work rendered all four reference kinds with the correct claims,
  including "Candidate commit — the text looks like a SHA; no commit was
  verified" and `owner/alpha (unverified)` for a bare number. The explicit
  GitHub URL was the only one rendered as a link.
- Session 1's ledger reported "Different accounting scope, over
  excludingCompaction. Compared: requests, inputTokens, outputTokens,
  cacheReadTokens."
- **The exact-decimal path was proven end to end.** A request charge of
  `33407.5` nano-AIU — stored as a SQLite `REAL` in an `INTEGER`-affinity
  column — travelled through the adapter, the index, IPC and the UI as the
  string `33407.5`, displayed as `0.000033 AIC`, and the drawer reported
  "Items reproduce the recorded charge".
- Zero console errors at all three viewports. Column sets adapt: 7 columns at
  960, 10 at 1440, 12 at 2560, with every field reachable in the drawer.

---

## 7. What is not done

### Phase 6 (deliberately out of scope — each needs its own design + fixtures)

- Structured checkpoint fallback from the store's `checkpoints` table.
- Store-only session discovery (records with no local session directory). The
  current index prunes sessions absent from disk, so this needs separate
  storage and lifecycle first.
- A versioned optional export section. Exports are currently unchanged and
  explicitly exclude enrichment — the reason is recorded at
  `crates/tracepilot-export/src/builder/session.rs`.
- CLI version-analyzer DDL extraction for schema watch.
- `dynamic_context_items` / `forge_*` tables. All empty locally; schema presence
  is not a reason to build a feature.

### Known gaps within phases 1–5

- **Turn attribution** — see invariant 13 and §5. Requires fixtures beyond the
  local sample.
- **`copilot_usage_model`** has no non-NULL local examples; per-item model
  overrides need synthetic compatibility cases.
- **Latency budgets** (250 ms busy timeout, 5 s read budget, 5-minute sweep) are
  the design's starting points, **not measured**. They need measurement against
  a large synthetic store.
- **Custom-root binding.** Only the configured Copilot home's normal
  `session-state` directory is bound. Imported sessions and custom roots are
  excluded by design for this release.

---

## 8. Remaining work on this branch

- [x] Verify in the running app at 1440×960, 960×640 and 2560×1440.
- [ ] Push the branch and open a PR.

---

## 9. Commits on this branch

```
e4714723  feat(core): read-only Copilot session-store adapter
7b5251a8  feat(indexer): enrichment tables and an independent refresh pass
c598b556  test(indexer): expect schema version 20 after the enrichment migration
fdbb0262  feat(ipc): session-store enrichment commands, contracts and setting
a8f55339  feat(prompt-cache): recorded reuse beside the expiry prediction
00e616a9  feat(desktop): request ledger, related work, settings and comparison data
2174a702  docs: record what shipped and why exports stay unchanged
fc2a8e56  style: clear clippy warnings in the enrichment path
```
