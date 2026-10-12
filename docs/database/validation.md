# Validation and independent review

The production source under audit is commit `d95f6d81d8a27f9ee3b18967f00b81d76c25e723`. The audit branch changes documentation and standalone diagnostic tooling; it changes no application queries, migrations, dependencies or schema. [Methodology](methodology.md) records the frozen snapshot, runtimes, resource limits and reproduction commands.

## Evidence and coverage

- Read-only online backup pinned a consistent source transaction, including committed WAL state. The validated snapshot passed full `integrity_check`; subsequent work checked its SHA-256 against provenance. Experiments modified only a separate disposable backup.
- The source schema and snapshot share identical column, key, index, foreign-key and rowid metadata. Their shared DDL differs only in `schema_version` whitespace and `search_content_ai` indentation. The snapshot additionally contains SQLite-managed `sqlite_stat1` and `sqlite_stat4`; their nine columns are included.
- Coverage comprises **31 tables, 238 declared/hidden columns, 27 implicit rowid interfaces and 70 object paths**. The latter consists of 66 `sqlite_schema` records plus four WITHOUT ROWID primary-key access paths reported only through `index_list`. There are six triggers, no views and no generated columns. FTS hidden interfaces and all eight shadow tables have individual records.
- Every column has exact NULL/non-NULL counts, observed storage types, exact non-NULL cardinality and peak frequency. Empty tables retain explicit zero counts and undefined percentages. Numeric and length statistics preserve privacy withholding and applicability distinctions. Physical B-trees, freelist and structural bytes reconcile exactly to **578,736,128 bytes** without adding FTS external content twice.
- All 136 expanded SELECT cases executed three times; none was unavailable or produced unstable ordered output in those repetitions. Another 23 mutation/lifecycle shapes were prepared with EXPLAIN only. [Query plans](query-plans.md) disclose full SQL, synthetic binding shapes, selection assumptions, cardinalities and diagnostic timings.
- Eight pending-search-change comparisons preserved complete duplicate-sensitive result multisets. Segment-index experiments preserved all histograms and restored the selected rows after rollback. Both FTS external-content integrity checks and foreign-key checks passed before and after those copy experiments. [Experiments](experiments.md) distinguish expression-index storage from schema-page growth and read timings from bounded write costs.

These checks establish the recorded snapshot and diagnostic results. They do not establish native application latency, product-wide field adoption, absence of theoretical failure paths, or backward compatibility of a future column removal.

## Independent challenge

GPT-6.1 Sol agents with High reasoning owned catalogue/engine metadata, analytics/provider tables, and search/query/index analysis. A separate GPT-6.1 Sol High reviewer first challenged source coverage and then independently checked completed aggregate evidence. Source review followed direct and dynamic SQL, positional decoding, source reconstruction, IPC/front-end/export consumers and the distinction between persisted SQL projections and re-extracted session details.

The reviewer checked all column denominators/cardinalities, engine objects, source references, storage reconciliation, query-case outcomes, experiment equality, historical-date attribution counts and private-data boundaries. The review specifically challenged unsupported “unused” conclusions and the 20 analytics persistence candidates. It found no contradictory current SQL read for those candidates, but their source/detail meanings and compatibility obligations remain explicit; none is authorized for removal by this audit.

Review corrections removed 13 diagnostic error strings from the SQL-template count, corrected an unsupported claim that scalar run billing was recoverable from per-model JSON, distinguished the candidate index's 20 KiB from the additional 4 KiB schema page, and strengthened the audit tool's resource limits, provenance, incomplete-evidence rejection and explicit aggregate-output gating. The final evidence review supports the conditional recommendations and requires no additional database scans.

## Reusable checks

From the repository root, without accessing the operator's database:

```powershell
python -B scripts/database/verify.py
python -B -m unittest discover -s scripts/database -p test_audit.py -v
pnpm lint
node scripts/check-file-sizes.mjs
node scripts/check-doc-links.mjs
```

The coverage verifier reconstructs the current schema in memory, compares definitions against the manifest, verifies every discovered object/column has an owner, validates repository path/line references and checks that every column appears in both statistics tables. It verifies reference locations, not the semantic truth of each reference; source review supplies that additional evidence. It detects future schema drift instead of silently treating this audit as current.

Synthetic contracts cover committed WAL backup with an unchanged source, refusal before source access when coordination denies work, mixed SQLite types/NULL/empty values, sensitive-value withholding, current migration/FTS coverage and rejection of incomplete publication inputs. They also exercise explicit aggregate-output authorization so a COUNT projection cannot accidentally disclose an identifier from another numeric expression. Scratch databases and raw review notes remain ignored.

Local checks against the publication files on the audited source base:

| Command/check | Outcome |
| --- | --- |
| `python -B scripts/database/report.py --evidence <ignored-measurements.json>` | Passed stricter completeness/storage reconciliation checks and regenerated schema, statistics, storage and coverage from completed evidence. No database opened. |
| `python -B scripts/database/verify.py` | Passed: 31 tables, 238 columns, 70 object paths, 1,362 repository reference locations. |
| `python -B -m unittest discover -s scripts/database -p test_audit.py -v` | All seven tests passed. New missing-evidence/privacy regressions failed for the expected behavioral reasons before safeguards were added. |
| `pnpm lint` | Passed; two informational notices remain in unchanged source files. No new warnings/errors. |
| `node scripts/check-file-sizes.mjs` | Passed, zero allow-listed violations. The restricted Windows attempt could not spawn Git; the same unmodified check passed with normal subprocess access. |
| `node scripts/check-doc-links.mjs` | Passed across 184 Markdown files. |
| Privacy and schema reconciliation review | Public files contain no matched private absolute paths, credential patterns or raw result digests. Independent manual review checked identifying values, synthetic query bindings and the conditional removal claims. |

The checks above precede the documentation commit; the source revision remains the pinned production baseline. Repository pre-commit/pre-push outcomes and hosted CI status belong to the PR, where the publication commit can be identified without self-referential hashes. The Markdown/link checks and lint do not require a Rust build or native app launch.

## Publication boundary

Public reports contain schema/source names, aggregate statistics, sanitized plans and synthetic bindings. They exclude source paths, private repository names, session identifiers/content, prompts, raw row samples, STAT4 samples, selected real bindings, tokens and result-content hashes. The explicitly requested artifact SHA-256 is included in provenance; it is not a row or session identifier. Privacy review covers the staged diff and the documentation/tool files, not merely the ignored status of scratch data.

No native app, UI viewport, bundled-SQLite benchmark or product fault-injection regression was run for this documentation/tooling PR. Python SQLite 3.42.0 supplied query diagnostics; Node SQLite 3.50.4 supplied dbstat; the app's dependency sources identify SQLite 3.46.0 with STAT4. The observed historical-day query exclusion is concrete; the rollback/savepoint exercise establishes an SQLite mechanism, not an observed Rust failure. Pending optimization PRs remain separate from audited production main.
