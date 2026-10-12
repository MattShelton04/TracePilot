# SQLite database audit

This audit traces production source at `d95f6d81d8a27f9ee3b18967f00b81d76c25e723`, from SQLite schema and migrations through writes, reads, positional decoding, IPC, frontend and export consumers. Pending performance PRs, including #1022, are separate proposals. Every removal disposition is conditional on reader compatibility, measured benefit and migration policy.

Start with [correctness findings](correctness.md) for prioritized risks, existing protections and bounded verification/remediation proposals. The coordinated frozen snapshot contains **31 tables and 238 xinfo columns**, **729 sessions** (619 Copilot, 110 Claude Code), **679,345 search chunks**, and **5,825 agent runs**. All per-column distinct counts were measured exactly. These describe one installation, not product-wide adoption. Source conclusions, measured aggregate probes and controlled-copy experiments are distinguished from application-runtime confirmation and product regression tests, which were not run.

| Chapter | Use it for |
| --- | --- |
| [Complete schema](schema.md) | Every observed table/column, constraints, hidden fields, keys, indexes and current migration coverage |
| [Every-column statistics](statistics.md) | Exact NULL/non-NULL/distinct/type/zero/length/byte counts and provider availability, without raw values |
| [Physical storage](storage.md) | B-tree pages, payload/slack/overflow, FTS shadow accounting and limits of column-byte estimates |
| [Methodology and provenance](methodology.md) | Snapshot isolation, runtime differences, private-data controls and measurement boundaries |
| [Controlled experiments](experiments.md) | Complete-result equality, conditional join-removal diagnostics, expression-index read/write/storage tradeoffs and clone integrity checks |
| [Catalogue and engine metadata](catalogue.md) | Session ownership, metadata/incident/activity/file fields, migration/maintenance state, engine allocator and planner metadata |
| [Analytics and provider tables](analytics.md) | Model/tool/run/cache/agent/skill/format semantics, source-specific units, NULL coverage, consumers and persistence-only candidates |
| [Search lifecycle](search.md) | Chunk extraction, FTS external content/shadows, row identities, trigger synchronization, rebuild/cancellation and search consumer contracts |
| [Query catalogue](queries.md) | Exact source call sites, SQL templates, binding order, filters, grouping, sorting and index roles |
| [Measured query plans](query-plans.md) | 136 executed read shapes and 23 EXPLAIN-only write/lifecycle shapes, synthetic bindings and cardinality |
| [Correctness findings](correctness.md) | Priority, source assumptions versus observation status, synthetic test cases and bounded remediation |
| [Coverage manifest](coverage.json) | Machine-checked union of current migrations and the actual snapshot, including implicit indexes |
| [Validation](validation.md) | Reproduction checks, independent review and explicit limitations |

Machine-readable column records accompany the chapters: [catalogue semantics](semantics-catalogue.json), [analytics semantics](semantics-analytics.json), and [search semantics](semantics-search.json). These records preserve meaning/source/units, lifecycle, migration obligations, disposition rationale, confidence and source references. Use the Markdown chapters for decisions and the JSON for coverage checks; neither is a proposed migration.

`KEEP` retains an active purpose. `CHANGE` asks for a corrected semantic/operational contract. `CONSOLIDATE` requires demonstrated redundant projections. `DEPRECATE_REMOVE_CANDIDATE` requires a reader-deprecation rollout and later backed-up drop. `INSUFFICIENT_EVIDENCE` preserves uncertainty rather than declaring a field unused. An absent SQL projection, a NULL/zero population, or a text-search miss alone cannot justify dropping source information.

The index is a derived read model with last-good snapshot guarantees. Source/provider inputs remain authoritative; metadata and search freshness are independent. Currency units, unknown-versus-zero values, temporal attribution, session-scoped identities and FTS rowid contracts must survive optimization. Follow [ADR 0013](../adr/0013-db-migration-policy.md) and the source when historical architectural documentation differs from current behavior.

The snapshot has zero agent-selection rows, which is legitimate for an optional feature and does not justify dropping its table. Provider availability differs sharply: all 191 Claude model rows lack premium-request cost and nano-AI billing, while 190 have USD; all 951 Copilot model rows lack USD and only 39 have observed nano-AI billing. Older/missing telemetry must remain distinct from recorded zero. The analytics chapter attaches measured evidence to all 125 of its column dispositions.

The concrete correctness finding is historical chart attribution: on the selected busiest exclusion day, 7 of 38 Copilot accounting runs and 61,465,631 tokens are excluded by the parent last-active filter. The stored runs and lifetime totals remain intact. A minimal SQLite exercise also confirmed the outer-rollback/later-savepoint mechanism; it did not reproduce a Rust product failure. Checked FKs, child totals/subsets/hierarchy and both stronger FTS external-content checks passed on the controlled copy.

The expression-index experiment improved the diagnostic wide query by about 0.43 ms but consumed 20 KiB for its B-tree plus 4 KiB of schema growth, and increased the bounded replacement/rollback median from 12.42 to 14.12 ms. Defer that migration until after correcting date attribution and confirming the bundled-runtime benefit. Conditional join-removal experiments preserve complete results across eight cases and materially improve broad facets; those results describe pending #1022, not production main.

Published evidence must contain only aggregate measurements and synthetic examples. Real session content, user paths, names, identifiers, repository metadata, query terms and payload samples do not belong in these documents. Plans from a different SQLite runtime require an explicit caveat and cannot establish the bundled application's latency.
