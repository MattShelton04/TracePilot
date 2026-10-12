# Correctness findings and verification obligations

Production baseline: `d95f6d81d8a27f9ee3b18967f00b81d76c25e723`. This chapter records source reasoning, completed coordinator aggregate probes, one minimal SQLite failure-mechanism exercise, and bounded remediation proposals. The controlled query/index experiments are reported separately in [experiments.md](experiments.md); application-runtime confirmation and proposed Rust regression tests were not run. A reachable source path is evidence for investigation; it is not evidence that a user's index is corrupt.

The [catalogue](catalogue.md), [analytics](analytics.md), [search lifecycle](search.md), and [query catalogue](queries.md) document the contracts behind each finding. Pending performance PR #1022 and other candidate/combined revisions are separate from this production baseline. Their plans or timings must not be attributed to main.

## Priorities and evidence status

| Priority | Finding or obligation | Source conclusion | Production/synthetic observation |
| --- | --- | --- | --- |
| P1 investigation | Metadata batch can continue after outer transaction auto-rollback | Metadata catches individual errors without checking autocommit, unlike search batching | Minimal SQLite mechanism reproduced: lost outer transaction, one later savepoint row committed alone; not a Rust/product reproduction |
| P2 correctness | Historical accounting runs can be excluded by parent last-active date | Current daily queries retain the parent date guard before segment bounds | Selected historical day: 7 of 38 Copilot runs excluded, 61,465,631 tokens; stored runs remain intact |
| P2 validation | FTS health does not prove external-content posting equality | Health compares content/FTS row counts; integrity command omits external-content comparison option | Both stronger external-content checks passed before/after controlled-copy experiments; current health contract remains weaker |
| P2 lifecycle | Manual transaction wrapper has no scope rollback on panic/commit error | Explicit BEGIN/COMMIT/ROLLBACK wrapper has no RAII guard | Rust panic/COMMIT failure path not exercised; source-theoretical concern |
| P2 semantics | Optional billing and hierarchy fields cannot be consolidated on assumed equivalence | Currencies, unknown-versus-zero, run versus model billing, and inclusive agent tokens differ | Exact provider coverage measured; checked totals/subset/hierarchy invariants have zero violations |
| P3 plans | Timestamp indexes do not establish speed of date-expression queries | Production predicates use date()/COALESCE(); index test uses raw timestamp bounds | SQLite 3.42 diagnostic: SCAN segments and temporary GROUP BY B-tree; bundled-app plan/timing not established |
| P3 attribution | Any segment suppresses model-by-day lifetime fallback | NULL segment JSON is excluded from primary path but still blocks fallback | Zero gaps among 357 Copilot and 104 Claude sessions having both models and segments |
| P3 guarded invariant | Provider identity collision, source cancellation and hierarchy integrity | Source ownership guards and generation checks exist; run-parent links are not SQL FKs | Zero missing run/session parents in checked snapshot; provider collision/cancellation failures not observed or reproduced |

Priorities describe what to validate first, considering possible impact. They are not measured incident severities or authorization to change production schema.

The coordinator's initial aggregate checks found **zero foreign-key violations**, zero unknown source labels, zero missing session parents, zero tool outcome/timing-denominator violations, zero reversed segment boundaries, zero invalid non-NULL segment JSON, and zero unparseable non-NULL timestamps in the checked timestamp columns. The snapshot has 219 successful search markers with no search chunks; successful empty extraction is legitimate and these rows are not inherently failures. See [schema](schema.md) and [column/provider statistics](statistics.md) for measured population and constraints. These clean checks do not prove FTS posting equality or exercise the hypothetical transaction failure paths.

## Metadata batch auto-rollback risk

[Metadata batching](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/indexing/reindex.rs#L243) uses `with_transaction`, then catches each preparation/session write error and continues to the next session. [Session replacement](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L209) creates a session savepoint and attempts rollback/release on failure. Ordinary statement errors preserve the surrounding transaction. An SQLite failure that aborts the entire outer transaction is a different boundary: a later top-level savepoint can commit independently when released, even though the final batch COMMIT fails.

The corresponding [search batch error path](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L139) explicitly checks `is_autocommit()` and stops if an individual error ended the outer transaction. Metadata has no corresponding guard in the reviewed loop. This is a source-theoretical risk, **not an observed production failure**. A successful earlier batch is intentionally durable; the concern is later session writes escaping the intended current-batch boundary.

Proposed bounded remediation: after a metadata write error, abort the current batch when the connection has returned to autocommit. Keep isolated-session recovery for errors that leave the outer transaction active. Review progress accumulation so a rolled-back current batch is not counted as persisted.

Proposed product regression, on an in-memory/disposable schema only: prepare two or three unrelated fixture sessions; use a test-only trigger with `RAISE(ROLLBACK, 'synthetic batch abort')` during the first/second session write; then assert that no later session from that batch becomes committed, last-good rows remain, the reported result is an error, and a separate fresh batch can succeed. Repeat with a normal `RAISE(ABORT, ...)` to prove that ordinary per-session failure still permits valid siblings within the intact outer transaction. This Rust/product regression was not run.

Completed coordinator evidence: a **minimal SQLite transaction/savepoint exercise** ended the outer transaction and then committed **one row** from a subsequent savepoint alone. This demonstrates the engine mechanism behind the concern. It did not call the Rust metadata pipeline, provoke an actual disk-full/I/O fault, or show occurrence in the production index. The proposed product regression above remains unrun.

## Historical daily attribution

The [parent filter](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/filters.rs#L29) selects sessions by `date(COALESCE(updated_at, created_at))`. [Daily token/activity/premium-cost charts](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs#L108), [daily models](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/model_usage_by_day.rs#L47), and [daily USD](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/source_cost.rs#L59) reuse that parent filter and append segment-end dates. Appending the segment bounds prevents out-of-range points from leaking into the chart, but does not recover in-range runs rejected by the parent date guard.

Illustrative synthetic story: a fixture session starts October 1, records an accounting run ending October 2, then resumes and last updates October 8. A chart filtered to October 1–3 rejects the session because its last-active day is October 8, so its October 2 run disappears. The story contains no real session identity or user data.

The bounded aggregate below counts the excluded runs without outputting identifiers, model names, repositories or content. The coordinator selected the busiest historical exclusion day privately: **38 Copilot runs** end on that day, of which **7 runs / 61,465,631 tokens** are excluded by the parent last-active filter. Selection favors observing the issue; it is not an unbiased estimate of typical chart impact.

```sql
SELECT s.source,
       COUNT(*) AS in_range_runs,
       SUM(CASE WHEN date(COALESCE(s.updated_at, s.created_at)) < :from_date
                  OR date(COALESCE(s.updated_at, s.created_at)) > :to_date
                THEN 1 ELSE 0 END) AS excluded_by_parent_date,
       SUM(CASE WHEN date(COALESCE(s.updated_at, s.created_at)) < :from_date
                  OR date(COALESCE(s.updated_at, s.created_at)) > :to_date
                THEN m.total_tokens ELSE 0 END) AS excluded_tokens
FROM session_segments m JOIN sessions s ON s.id = m.session_id
WHERE s.source IN ('copilot', 'claudeCode')
  AND date(m.end_timestamp) >= :from_date
  AND date(m.end_timestamp) <= :to_date
GROUP BY s.source;
```

Across all 715 runs, **82** have a different UTC endpoint day from their parent's last-active day: **81 Copilot runs / 1,932,451,324 tokens**, and **1 Claude run / 26,485,105 tokens**. This counts endpoint-day disagreement, not total corpus loss. Exclusion depends on the selected interval; wider intervals can include both dates. The rows and session-lifetime accounting remain present, and the separate session/segment total probe found zero mismatches in 387 Copilot and 110 Claude sessions with segments. [Segment populations](statistics.md#session_segments).

Proposed remediation: build separate filter scopes for session-lifetime KPIs and segment-day series. Segment series retain repository/source/hide-empty restrictions while applying time bounds to the segment end, independently of parent last activity. Preserve and document the existing lifetime KPI contract rather than silently changing all totals.

Proposed tests: the two-run synthetic story above; a run ending outside the interval; an unknown date; each source independently; repo/hide-empty filters; USD NULL versus zero; and equality of daily model/token accounting when model usage is available. Test historical intervals both before and after a later resume. Source versions need changing only if persisted extraction semantics change; a query-only correction does not automatically require reindexing.

## FTS consistency and rebuild boundaries

Both FTS indexes use external content. [Health reporting](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L172) compares backing-content and FTS `COUNT(*)`, plus pending markers. An external-content read can retrieve backing rows even when term postings differ. Equal counts therefore do not certify MATCH/rank/highlight correctness. [The current integrity command](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L158) requests internal integrity checking without the stronger external-content comparison option. No divergence is asserted.

Proposed verification on a disposable copy, using a compatible SQLite runtime: invoke the external-content comparison form, record only pass/fail and sanitized error category, and verify complete query-result equality for synthetic terms after insert/update/delete and rebuild. The engine command is a special INSERT and must never be described or executed as a read-only SELECT on the source database.

```sql
-- Disposable copy only; these are FTS control writes.
INSERT INTO search_fts(search_fts, rank) VALUES('integrity-check', 1);
INSERT INTO sessions_fts(sessions_fts, rank) VALUES('integrity-check', 1);
```

Proposed remediation: label current health as a lightweight availability/count check; expose or schedule the stronger check only under an explicit bounded maintenance policy. Do not rebuild a healthy source database merely to investigate a count assertion.

Completed controlled-copy evidence: external-content `rank=1` checks for **both search_fts and sessions_fts passed before and after** the experiments; FK checks found zero violations; the frozen original's hash remained unchanged. No posting divergence was observed in those checks. Passing stronger checks does not make the current lightweight health predicate equivalent to them. [Experiment protocol/results](experiments.md).

[Per-session search writes](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L204) temporarily drop only the insert trigger, preserve delete/update synchronization, index the new AUTOINCREMENT range in one statement, and restore triggers within the transaction. [Bulk writes](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L333) drop all three triggers, replace requested content, rebuild the whole index and recreate triggers before commit. Error/failed-COMMIT paths attempt rollback and trigger restoration. This protection exists already; it is not evidence that cancellation leaves triggers absent.

Proposed regression tests retain a synthetic last-good MATCH result and successful search marker through cancellation after deletion, during an insert chunk, before FTS indexing/rebuild, and before commit. Assert all expected triggers exist, source-content/FTS equality holds, marker/fingerprint remain last-good on rollback, and a subsequent unrelated update is searchable. Exercise standalone, shared-batch and bulk paths. These product regression tests were not run; the smaller disposable-copy maintenance/equality checks belong to [controlled experiments](experiments.md).

## Manual transaction lifetime

[`with_transaction`](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L75) issues explicit `BEGIN DEFERRED`, commits on closure success, and rolls back on closure error. A panic skips the explicit match cleanup; COMMIT failure returns through `?` without an explicit rollback in this helper. Its comment about replacing a pair that could leak on panics is stronger than the current guard implementation. Connection drop can still cause rollback; the concern is code that catches a panic/error and reuses the same connection. The bulk writer also uses manual BEGIN, although it has explicit normal-error and failed-COMMIT cleanup.

Proposed remediation: use an RAII transaction/scope guard where the existing connection API permits it, preserving nested-savepoint behavior and primary error reporting. If manual delimiters remain, explicitly handle commit failure and unwinding, and check transaction state before reuse. Do not infer persisted corruption from an open transaction alone.

Proposed synthetic tests: panic caught outside the helper; deferred constraint/COMMIT error on a disposable schema; normal closure error; successful commit; and a later independent transaction. Assert `is_autocommit()` is true and temporary writes are absent after each failed transaction. Normal batch-cancellation semantics must remain unchanged.

## Currency, unknown values and hierarchy

[Capability-based billing filtering](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/billing.rs#L14) distinguishes legacy premium-request cost, observed nano-AI units and provider USD. Never combine these amounts in a SQL SUM under a generic `cost` label. NULL means absent/unpriced/unknown where the column contract says so; zero is recorded zero. Nullable reasoning, timing, configuration booleans and content estimates likewise carry availability information. [Model distribution decoding](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/model_distribution.rs#L37) has explicit presence sentinels for optional usage and billing.

The segment scalar `total_nano_aiu` is an **independent observed run total**. [Run-level extraction](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/events/aggregate.rs#L160) takes/differences shutdown total billing; [per-model JSON extraction](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/events/aggregate.rs#L136) independently takes/differences model metrics. Per-model billing is optional. Overlap can exist, but neither equality nor completeness is guaranteed. Its omission from current analytics SELECT projections makes persistence review possible; it does not justify consolidation or loss of unique recovery information.

[Agent-run semantics](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/agent_runs/model.rs#L94) distinguish potentially descendant-inclusive `total_tokens` from exclusive `own_nano_aiu`. Peer-message counts increment both participating peers; a sum is not a unique-delivery count. `calls_with_duration` is the timing denominator; tool `call_count` includes pending invocations while success/failure counters require known outcomes. Native tool rows are subsets of canonical tool rows.

Completed aggregate probes checked 4,269 Copilot and 851 Claude canonical-tool rows: zero outcomes exceeding calls, zero timed denominators exceeding calls, zero checked negative counters. **229 Copilot calls** have unknown/pending outcomes, versus zero in the Claude aggregate; this is why call_count and the known-outcome success denominator differ. All 851 native groups have a canonical counterpart and no measured count/duration exceeding that counterpart. Across 5,686 Copilot and 139 Claude agent runs, there are zero unresolved run parents, queued counts exceeding received counts, or checked invalid counters. Exclusive billing exists on only **18 Copilot runs**, and zero Claude runs. These are coverage results, not a reason to replace unknown billing with zero.

Session/segment totals agree for all 387 Copilot and 110 Claude sessions with segments; checked USD mismatch/partial-segment flags are zero. Those equalities do not prove run-total billing equals optional per-model billing. Copilot has **54 scalar segment billing observations**, versus **39 lifetime model-row observations** in a different row grain. Unique-information review still precedes any removal. [Provider coverage and complete column evidence](statistics.md). Removal candidates follow reader deprecation, recovery/export review and a later backed-up migration; zero population alone is insufficient.

## Date predicates and index alternatives

The [standalone segment-end index](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L349) and [its plan test](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/plan.rs#L235) establish a raw timestamp range path. [Actual date bounds](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/filters.rs#L76) use `date(end_timestamp)`. Agents and skills additionally use date of a timestamp COALESCE with a parent column. An index existing is not evidence that these predicates range-scan it. Python-runtime plans are diagnostic until compared with the application's bundled runtime and compile options.

Proposed alternatives, chosen only after measurements:

- Use half-open raw bounds `end_timestamp >= :from_utc AND end_timestamp < :day_after_to_utc` only after proving that every relevant writer stores a consistently normalized, lexicographically sortable UTC representation with compatible fractional precision. Mixed offsets/representations invalidate a naive text-bound replacement even when `date()` currently works.
- Use an expression index matching `date(end_timestamp)` when preserving SQLite date interpretation is required, then compare write amplification and plan/latency gains. This does not automatically optimize a cross-table COALESCE.
- Materialize a documented UTC date bucket with a versioned derivation/backfill when a broad indexed date contract is needed. Treat migration and extraction freshness separately; avoid adopting a new column before its consumers and benefit are demonstrated.

Completed diagnostic evidence: the actual day-chart shape on SQLite **3.42.0** scans segments, looks up parents through the session primary-key index, and uses a temporary B-tree for GROUP BY. All **715** segment end strings in the snapshot end in `+00:00` and contain fractional seconds; none use `Z` or another trailing representation. This supports investigating raw UTC bounds but does not prove fixed fractional precision or every future/provider writer contract. Expression-index timings/storage/write-cost comparisons are in [controlled experiments](experiments.md); the bundled application's SQLite plan and user-visible latency have not been established.

Completed expression-index screen: full histograms matched for wide/day/empty inputs. Diagnostic medians were **1.5845 → 1.1508 ms** wide, **0.2414 → 0.0869 ms** selected latest day, and **0.2062 → 0.0721 ms** empty. The added index occupies **20 KiB / 5 pages** and expands sqlite_schema by another **4 KiB**, took **6.48 ms** to create, and raised the bounded 715-row delete/reinsert/rollback median from **12.4178 → 14.1189 ms**. The low absolute read benefit and added write/storage cost support **deferring** this migration until the historical filter contract is fixed and a bundled-runtime rerun justifies it. These experiments preserve the existing filter's result, so equality does not fix its attribution problem.

Proposed regression tests cover UTC midnight, explicit offsets crossing UTC dates, mixed fractional precision, inclusive end-day behavior, missing/invalid timestamps and historical resumed sessions. Query-result equality is required before speed claims. These product regressions were not run.

## Daily model attribution and missing JSON

[Primary model-day rows](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/model_usage_by_day.rs#L56) require non-NULL `model_metrics_json`; [the fallback](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/model_usage_by_day.rs#L104) excludes sessions whenever any segment exists. The writer serializes with `.ok()`. A segment lacking JSON can still contribute scalar daily tokens, while preventing lifetime-model fallback. Malformed non-NULL JSON errors the decoder instead of being silently ignored. Ordinary writer serialization failure is not assumed common.

Completed snapshot evidence narrows this concern: **all 715 segment rows have non-NULL model JSON**, with zero malformed values. The focused no-JSON fallback-gap probe found **zero** affected sessions among **357 Copilot and 104 Claude** sessions with both lifetime models and segments. Thus the NULL-JSON condition is **not observed in this frozen snapshot**. Empty-model-map semantics and the proposed synthetic unavailable-attribution regressions were not exercised. [Segment statistics](statistics.md#session_segments).

Proposed verification: aggregate sessions with lifetime model rows and segments but no non-NULL segment JSON; JSON validity counts; segment totals with empty model maps; and source-specific model availability. Do not print JSON. Proposed tests include a segment with NULL JSON, empty map, invalid JSON and valid usage with absent optional billing.

Proposed remediation: make the unavailable-model attribution contract explicit, preserve temporal accounting accuracy, and expose coverage rather than assigning lifetime totals to an arbitrary run/day. If fallback eligibility changes, test against double-counting sessions with both valid and unavailable segment models.

## Guarded provider identity and cancellation

Session IDs are native identities rather than `(source, id)` composite keys. [Source conflict checking](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L144) refuses to overwrite an existing row owned by another source. Search invokes the same guard. This is a guarded identity assumption, not an observed collision. A composite-key migration would affect FKs, IPC identities, deep links, source locators and export; it is not a bounded optimization without collision evidence.

[Source-scoped prune/purge](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L21) checks the source generation after deletes hold the write lock and rolls back if stale. Metadata rechecks generation before batch commit; search checks cancellation between phases. A complete source inventory is required before pruning. Metadata and search have independent successful fingerprints and can intentionally describe different last-good extraction moments during refresh.

Observed algorithm versions match the production derivation: all **619 Copilot** sessions store analytics/search versions **18/4**, and all **110 Claude** sessions **30/9**. Copilot's successful metadata and search fingerprint strings differ in all 619 rows, while Claude's are equal in all 110. The Copilot mismatch is **intentional representation scope**, not stale-data evidence: [metadata serializes full SessionFingerprint and search serializes only its events member](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/provider/copilot/mod.rs#L202). Do not compare the two strings as interchangeable freshness certificates or collapse them based on Claude's equality.

The 219 successful empty search extractions split into **217 Copilot** and **2 Claude** sessions. Of the Copilot rows, **211 have NULL event_count** and **6 have positive turns**; the two Claude sessions have zero turns. An extraction with no eligible searchable content can still be successful. These population categories alone cannot identify a missing-content bug; source extraction/eligibility and last-good markers need review.

Proposed tests: two synthetic providers attempting one identity; stale generation before/after delete; partial/incomplete inventory that must not prune; cancellation during preparation and writing; independently stale metadata/search versions; and parent cascade affecting only the intended source. Assert source ownership, last-good rows, trigger presence and successful markers remain consistent. The schema does not FK-enforce `session_agent_runs.parent_run_key`; aggregate orphan checks must be accompanied by source reconstruction review before treating missing parents as corruption.

## Evidence boundaries

The coordinator owns snapshot/schema/statistics/storage/plan/evidence measurements. Exact column/provider aggregates, focused correctness probes, alternate-runtime diagnostic plan and the minimal SQLite auto-rollback exercise are incorporated above. [Controlled experiments](experiments.md) own their execution/result status. [Methodology](methodology.md) records the private snapshot and runtime boundary; public reports withhold identifying binding values. Application-runtime confirmation, product fault-injection/regression tests and user-visible latency were not measured in this audit. A passing snapshot invariant does not rule out theoretical failure paths; a failing minimal synthetic mechanism does not establish production occurrence.
