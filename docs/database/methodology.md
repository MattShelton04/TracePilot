# SQLite audit methodology and reproduction

The source, validated snapshot, complete population/storage measurements, query plans and controlled-copy experiments are available. Measurements ran serially in an explicitly granted quiet window. These are SQLite diagnostics, not application startup or UI benchmarks.

The production source baseline is `d95f6d81d8a27f9ee3b18967f00b81d76c25e723`. Its reconstructed migration schema contains **29 tables and 229 `table_xinfo` columns**, including virtual hidden columns, FTS shadow tables, `sqlite_schema` and `sqlite_sequence`. Current migration version is **25**, with versions **1–11 and 13–25**; there is no migration 12. The validated installation matches these application definitions and has **31 tables / 238 columns**, adding sqlite_stat1/stat4's nine engine columns. The generated coverage manifest covers the reconstructed/snapshot union: **31 tables, 238 columns and 70 objects** (66 sqlite_schema records plus four implicit WITHOUT ROWID primary indexes). Source-reference locations are validated by the coverage checker; its final total and outcome belong in [validation](validation.md). Counts describe this snapshot, not product-wide usage.

## Evidence layers

| Layer | Method | What it establishes |
| --- | --- | --- |
| Source semantics | Follow migrations, writers, reads, positional/name decoding, builders, IPC, frontend and export consumers; record pinned source references per column. | Meaning, ownership, unit, lifecycle, compatibility and disposition; no population or speed claim. |
| Reconstructed schema | `schema.py` executes extracted migration SQL in a fresh in-memory database, including the v9 search-column pre-hook. | Current expected objects, keys, relationships and columns; no user data access. |
| Frozen snapshot | `snapshot.py` uses a read-only live source and SQLite online backup, then validates the destination and records provenance. | One committed database state with an explicit pinned read boundary, including committed WAL content. |
| Aggregate measurements | `measure.py` traverses every discovered table/column serially; `storage.mjs` supplies dbstat when Python lacks it. | Population, NULL/type/cardinality/value-length summaries, relationships and physical B-tree accounting. |
| Query evidence | `plans.py` executes reviewed parameterized cases, records EXPLAIN QUERY PLAN and three bounded result iterations per case. | Plans and timings under the recorded audit runtime/bindings/cache context; no app startup or IPC timing. |
| Publication and coverage | `report.py` checks complete measurement shape, rejects unreviewed object names, emits aggregate reports/coverage; `verify.py` checks the source/schema/semantic/document union. | Discoverable evidence with explicit missing-data reasons and complete column/object linkage. |

The deliverables are [schema](schema.md), [statistics](statistics.md), [storage](storage.md), [session/engine catalogue](catalogue.md), [analytics](analytics.md), [search lifecycle](search.md), [source query catalogue](queries.md), [measured plans](query-plans.md), [correctness findings](correctness.md), [controlled experiments](experiments.md), [coverage manifest](coverage.json) and [validation](validation.md). Per-column machine records are [catalogue](semantics-catalogue.json), [analytics](semantics-analytics.json) and [search](semantics-search.json); [the audit index](README.md) explains how to use the chapters.

`schema.py` uses `sqlite_schema`, `PRAGMA table_list`, `table_xinfo`, `index_list`, `index_xinfo` and `foreign_key_list`. A declared NOT NULL flag is reported separately from primary-key behavior: rowid-table TEXT/composite primary keys are not silently rewritten as NOT NULL. Index origin, collation, descending order, partial/expression columns and rowid aliases remain visible. `table_xinfo.hidden` distinguishes ordinary columns (0), virtual-table hidden columns (1), virtual generated columns (2) and stored generated columns (3). FTS command/rank handles have execution contexts, not ordinary persisted text populations; the search audit explains them.

Snapshot/source reconciliation found no differences in shared-table columns, keys, index_xinfo, foreign keys, implicit rowids, WITHOUT ROWID or STRICT flags. Raw DDL also matches, apart from spacing in schema_version and indentation in the search_content_ai trigger; both are token-identical definitions. The only snapshot-only tables are the SQLite-generated sqlite_stat1/stat4. Their presence is reconciled explicitly, rather than treating source reconstruction as a substitute for observed schema.

## Runtime provenance and interpretation

| Runtime | Version identified | Capabilities / use |
| --- | --- | --- |
| Application bundled library | rusqlite **0.32.1**, libsqlite3-sys **0.30.1**, SQLite **3.46.0** | SQLite version verified from the locked package's cached `sqlite3.h`; bundled build recipe includes `SQLITE_ENABLE_DBSTAT_VTAB` and `SQLITE_ENABLE_STAT4`. This is source/library evidence, not a PRAGMA query against a newly launched app. |
| Python audit runtime | Python **3.11.5**, SQLite **3.42.0** | Snapshot, schema reconstruction, statistics and plan execution. This installation lacks DBSTAT and STAT4. It cannot reproduce the application's STAT4-aware planner. |
| Node storage fallback | Node **22.19**, SQLite **3.50.4** | dbstat aggregate accounting only; DBSTAT available, STAT4 absent. It is not the application's query planner. |

Pinned application inputs: [manifest bundled feature](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/Cargo.toml#L28), [libsqlite3-sys lock entry](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/Cargo.lock#L2709), [rusqlite lock entry](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/Cargo.lock#L4290). The locked cached package records upstream revision `499cc7bb986e04cc66e6ed762522f7ea449178d1`: [SQLite header version](https://github.com/rusqlite/rusqlite/blob/499cc7bb986e04cc66e6ed762522f7ea449178d1/libsqlite3-sys/sqlite3/sqlite3.h#L149), [bundled DBSTAT flag](https://github.com/rusqlite/rusqlite/blob/499cc7bb986e04cc66e6ed762522f7ea449178d1/libsqlite3-sys/build.rs#L126), [bundled STAT4 flag](https://github.com/rusqlite/rusqlite/blob/499cc7bb986e04cc66e6ed762522f7ea449178d1/libsqlite3-sys/build.rs#L134).

Before another reproduction, record the actual Python/Node versions and `PRAGMA compile_options`; do not assume all machines share these builds. Plans run under Python 3.42 should be labelled diagnostic, then confirmed under application SQLite 3.46 with its actual compile options before accepting a planner/index optimization. Existing sqlite_stat4 records can be inventoried by a runtime that does not use STAT4, but their presence does not make that runtime STAT4-aware.

The application writer configures WAL, synchronous NORMAL, foreign_keys ON and a five-second busy timeout, then a 64 MiB suggested page cache and temp_store MEMORY. The application reader uses read-only flags and adds a busy timeout without the writer configuration. The audit uses its own read-only connection with query_only ON, a 32 MiB suggested page cache, temp_store FILE and one SQLite worker thread. Values such as `foreign_keys`, `synchronous`, `cache_size` and `temp_store` are connection-local observations. A snapshot reader reporting `foreign_keys=0` reflects that reader's default; it does **not** establish disabled foreign keys in the application writer. [Writer connection settings](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/sqlite/connection.rs#L16) and [index writer/reader settings](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L10) identify the source contract; [SQLite PRAGMA documentation](https://www.sqlite.org/pragma.html) specifies the individual settings.

## Snapshot boundary and failure rules

The coordinator must explicitly contain `allowHeavyAudit: true` before source access; the audit does not grant itself a window. `snapshot.py` requires a fresh Git-ignored destination within the worktree and rejects the source as a destination. It opens the source with `mode=ro`, starts a read transaction, and reads sqlite_schema to pin the snapshot. Online backup copies 256 pages per step and checks the coordinator/time/disk budget between steps. The source connection performs no migrations, ANALYZE, vacuum or checkpoint. This is a WAL-aware SQLite operation, not a raw main-file copy. See the [SQLite backup API](https://www.sqlite.org/backup.html).

Do not open the live source with `immutable=1`: that option asserts that no process can change the file and skips normal locking/change detection. Only the successfully closed, validated frozen destination is reopened immutable. A read-only live connection still participates in SQLite's WAL/read-lock mechanics and may require available sidecar access; read-only flags do not prove zero sidecar or concurrency effects. See [SQLite URI semantics](https://www.sqlite.org/uri.html).

Provenance is written only after backup completion, destination integrity_check=`ok`, foreign_key_check count, schema/version inventory and SHA-256. The private sidecar records UTC start/pin/finish, Git revision, Python/SQLite/compile options, source-connection PRAGMAs, source main/WAL/SHM byte sizes before/after, destination bytes/hash and coordinator state. The source file sizes can change because another process writes; they are observations around the snapshot, not the frozen database's page allocation.

If interrupted, a partially written destination can remain. Without successful provenance it is invalid evidence: do not measure it, publish it or treat it as resumable. Use a new fresh destination for the next authorized attempt. A missing/incomplete provenance record or hash mismatch invalidates measurements even if a file opens. Measurement output is written incrementally; absence of finished_utc/correctness/storage or any required table/column causes publication rejection. Query output can finish with explicit unavailable cases, so completion of the file does not imply that every requested query was measured.

## Bounds and scheduling

All heavy steps run serially. Budget checks poll the coordinator and free disk about every two seconds and stop if the grant is revoked, cannot be read, or free disk falls below **2 GiB**. SQLite progress handlers check every 10,000 VM operations; backup checks at each page step. Snapshot has a **600-second** operation budget; measurement and plans use **1,200 seconds**. Measurement aggregate batches allow up to **600 seconds** each, individual distinct-cardinality work **180 seconds**, and each query result iteration **30 seconds**, all also subject to the enclosing budget.

Measurement sets a **128 MiB soft / 256 MiB hard SQLite heap limit**; plans and the Node dbstat helper set the **256 MiB hard limit**. This limits SQLite allocations, not total Python/Node process RSS. Snapshot uses the 32 MiB suggested cache and page-step budget without a hard heap limit. Measurements, plans and experiments redirect SQLite temporary files to an ignored `sqlite-temp` directory. Disk checks are cooperative guards, not per-file quotas. The Node helper runs as an owned subprocess; the parent polls its budget and terminates that helper on interruption. These settings deliberately differ from the app and must accompany timing evidence.

## Statistics, rowids and storage

Every table's exact row count is the denominator for SQL NULL/non-NULL and SQLite runtime-type populations; zero-row percentages are **N/A**, not 0%. Empty text and numeric zero are separate from NULL. Non-NULL cardinality and maximum frequency come from `GROUP BY column` without returning grouped values. This is exact under the column's SQLite equality/collation rules, not bytewise uniqueness: NOCASE and SQLite numeric equality can group different representations. `COUNT(DISTINCT column)` also excludes NULL, but any separately introduced expression/collation must be checked before treating it as equivalent. An interrupted/resource-limited cardinality is labelled unavailable with a reason; there is no unlabelled approximation or sample extrapolation.

Numeric extrema/means use only integer/real runtime values and are withheld for recognized identifiers and absolute epoch timestamps. Text lengths count SQLite characters; BLOB lengths count bytes. Logical text/BLOB byte totals use BLOB casts and exclude integer encoding, record headers, B-tree structure, index copies and unused page space. Mixed-type and zero-row fixtures test these distinctions. Source paths, IDs, prompts, repository labels, raw JSON, individual indexed values and sqlite_stat4 samples never appear in public aggregate output.

Implicit rowid/`_rowid_`/`oid` is accounted separately; INTEGER PRIMARY KEY aliases the same value and storage, rather than creating another allocated column. WITHOUT ROWID tables have no implicit rowid. TEXT/composite primary-key indexes are distinct physical structures. External-content FTS virtual text exposes content already owned by sessions/search_content; logical bytes must not be added again as a physical allocation. Hidden FTS command/rank columns are described in their query context; their all-NULL scalar projection is not proof of unused storage.

dbstat reports each physical B-tree's pages, allocated/payload/unused bytes, overflow pages/bytes and maximum cell payload. Payload, slack and overflow are subdivisions of allocated bytes. Freelist pages, structural pointer-map pages and live WAL/SHM bytes are separate. `sqlite_schema` and `sqlite_master` are aliases, not two physical allocations. Reconcile page_size × page_count against B-tree pages, freelist and residual structural pages; value-length totals are not projected drop-column savings. [SQLite dbstat](https://www.sqlite.org/dbstat.html) defines the physical counters.

## Reproduction commands

Run from the audited checkout root. The operator supplies `$source` (the authorized database path) and `$coordinator` (the existing coordinator JSON path) privately. Neither value is written into this document. Choose a fresh ignored run directory for every snapshot attempt; the example label below is synthetic. Do not edit the coordinator to create a grant.

```powershell
$scratch = ".agent/database-audit/example"
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$frozen = Join-Path $scratch "frozen.db"
$evidence = Join-Path $scratch "measurements.json"
$cases = "scripts/database/cases.json"
$plans = Join-Path $scratch "plans.json"

# Source-only schema reconstruction; no installation database opened.
python -B scripts/database/schema.py --out "$scratch/current-schema.json"

# Only after the external coordinator grants the quiet window.
python -B scripts/database/snapshot.py --source "$source" --out "$frozen" --coordinator "$coordinator"
python -B scripts/database/measure.py --snapshot "$frozen" --out "$evidence" --coordinator "$coordinator"
python -B scripts/database/plans.py --snapshot "$frozen" --cases "$cases" --out "$plans" --coordinator "$coordinator"
```

The full read-query reproduction uses the checked-in [136 reviewed SELECT cases](../../scripts/database/cases.json); Python `-B` suppresses generated bytecode caches. `plans.py` executes these read cases and has no plan-only mutation mode. Numeric scalar output is allowed only when the case explicitly sets `reviewed_numeric_aggregate_output: true` and its numeric result was reviewed as an aggregate. A numeric result or COUNT-prefixed SQL alone is not sufficient review: later selected expressions could still be identifiers or private data.

The additional 23 mutation/freshness/maintenance shapes were collected separately as EXPLAIN-only evidence. Their full SQL and synthetic bindings are in [measured query plans](query-plans.md). To reproduce one, open the validated frozen snapshot read-only with query_only ON, prefix its published statement with `EXPLAIN QUERY PLAN`, and bind only its published synthetic parameters. For example, prepare `EXPLAIN QUERY PLAN UPDATE sessions SET search_source_fingerprint = NULL WHERE source = ?` with `copilot`. Step only the EXPLAIN statement, never the underlying mutation; record its planner rows, not execution timing. Do not put mutation statements in the plans.py SELECT case file. Apply the same coordinator grant, provenance/hash checks and resource settings as the read-query pass.

For an optional minimal demonstration, create this separate synthetic count case. It does not replace full workload coverage. Synthetic parameter strings belong in the published case definition, while actual selected bindings and result/identifier digests remain private.

```powershell
$syntheticCases = Join-Path $scratch "synthetic-cases.json"
@'
{
  "cases": [
    {
      "id": "synthetic-source-count",
      "sql": "SELECT COUNT(*) FROM sessions WHERE source = ?",
      "synthetic_bindings": ["copilot"],
      "workflow": "source-filtered session count",
      "priority": 1,
      "reviewed_numeric_aggregate_output": true
    }
  ]
}
'@ | Set-Content -LiteralPath $syntheticCases -Encoding utf8NoBOM

python -B scripts/database/plans.py --snapshot "$frozen" --cases "$syntheticCases" --out "$scratch/synthetic-plans.json" --coordinator "$coordinator"
```

`plans.py` optionally uses `private_binding_selection_sql` to select representative parameters inside SQLite. Public plan reports retain synthetic case bindings and a binding-method label; real binding values, error text and result/identifier digests stay private. For executed read cases, three runs fully iterate results, record count/time and compare ordered digests; raw rows are not serialized, and scalar quantities require the explicit reviewed-aggregate flag above. The first run is not an OS-cold-cache guarantee and subsequent runs share a connection. Stable repeated digests show repeatability for those runs, not before/after equivalence for an optimization or deterministic ordering without a SQL tie-break.

After reviewing the complete aggregate evidence, generate public schema/statistics/storage/coverage documents and validate them:

```powershell
python -B scripts/database/report.py --evidence "$evidence"
pnpm exec biome format --write docs/database/coverage.json
python -B scripts/database/verify.py
python -B -m unittest discover -s scripts/database -p "test_audit.py"
node scripts/check-doc-links.mjs docs/database/methodology.md docs/README.md scripts/README.md
```

The synthetic unittest command creates only its own ignored scratch databases and exercises schema/hidden columns, NULL/type/cardinality/privacy contracts, committed-WAL backup, false-gate refusal, incomplete-report rejection and source-revision provenance. `verify.py` requires generated coverage/statistics/storage documents and checks every semantic reference location. New measurements carry `source_revision` from snapshot provenance; `report.py` uses that revision. Legacy measurement JSON without it requires `--source-revision <full-audited-SHA>` copied from the matching snapshot provenance. Conflicting or malformed revisions are rejected. `report.py` emits schema.md, statistics.md, storage.md and coverage.json; it does not automatically publish private plan JSON or its digests. Review unknown object names and sanitized correctness/plan evidence before adding them to public docs.

## Measurement provenance

| Field | Status |
| --- | --- |
| Snapshot UTC start / pinned-read / finish | 2026-10-12T12:18:56.323186Z / 12:18:56.333745Z / 12:19:01.618681Z |
| Snapshot validated bytes / SHA-256 | 578,736,128 bytes; `df944bb23c6f37dd32c033f46e4d5e0712cea13c0f27feb46ae20503482a8b54`, verified before/after measurements and experiments. This requested artifact digest is public; row/result-content digests remain private. |
| Source main / WAL / SHM bytes before and after | Both observations: main 578,736,128; WAL 0; SHM 32,768 bytes. Equal sizes do not establish unchanged content independently of the snapshot boundary. |
| Actual snapshot migration versions / objects / columns | Ledger MAX 25, 24 rows (1–11,13–25); application definitions match source; 31 tables / 238 columns / 66 sqlite_schema records; coverage additionally accounts four implicit WITHOUT ROWID PK indexes (70 objects total) |
| Destination integrity / FK violation counts | integrity_check `ok`; foreign_key_check 0 violations; measured core relationship/content/range/JSON/order checks 0 violations, except 219 successful markers with no rows (a diagnostic compatible with empty extraction) |
| Actual reader PRAGMAs / compile options | SQLite 3.42.0, Python 3.11.5; WAL, page_size 4096, page_count 141293, freelist_count 239, auto_vacuum 2, user_version 0, schema cookie 368, UTF-8; reader foreign_keys 0, synchronous 2, cache_size -32768, temp_store 1, mmap_size 0, busy_timeout 5000. Compile options include FTS5 and omit DBSTAT/STAT4; private provenance contains the complete option list. Cookie 368 is not migration version 25. |
| Population/cardinality completion and unavailable cells | UTC 2026-10-12T12:19:12.075862Z–12:19:51.576290Z, SQLite 3.42.0. All discovered tables/columns complete; [statistics](statistics.md) records per-cell exactness and NULL denominators; 729 sessions (619 Copilot / 110 Claude Code). |
| dbstat reconciliation and storage runtime | Node SQLite 3.50.4; 141,293 × 4096 = 578,736,128 bytes. Freelist 239 pages / 978,944 bytes; other structural pages 708,608 bytes. B-tree allocation plus freelist plus structural residual reconciles to frozen page bytes; [storage](storage.md) details allocations. |
| Plan case IDs, selected-binding methods, runtime and elapsed samples | 136 SELECT cases, three complete iterations each, no unavailable or unstable-result cases; UTC 2026-10-12T12:20:32.958073Z–12:21:18.719558Z. Another 23 mutation/freshness/maintenance shapes received EXPLAIN only; no mutation ran on the frozen snapshot. See [plans](query-plans.md). |
| Synthetic tooling contracts / document checks run results | Source/schema/semantic/report coverage validates 31 tables / 238 columns and 70 objects, including implicit WITHOUT ROWID primary indexes. Synthetic contract, source-reference and repository check results are recorded in [validation](validation.md). |
| CI / PR command runtime and outcome | **UNMEASURED**; no CI or PR runtime estimate asserted |

This is a database/documentation audit. No UI behavior changes, native app launch or screenshot is needed to establish these source/document findings. Any later code optimization must obtain its own proportionate tests, application-runtime plan evidence, compatibility checks and user-workflow measurements; pending PR results remain separate from production-source findings.
