# TracePilot performance results — 20 September 2026

The Windows application is materially faster on large conversation responses and
long conversation rendering. Three small product changes were retained: restore
Tauri's intended IPC transport, remove duplicate Markdown DOM replacement, and
reuse timestamp formatters within one synchronous rendering batch. No content,
freshness, parsing, ordering, or virtualization policy was changed.

Investigation and final acceptance: Astra. Bounded implementation: GPT-5.6 Sol.
Starting revision: `524c34d300729af03e77fcc05b254032742c85dc`.
Branch: `codex/performance-optimization`. Desktop evidence comes from the **actual
release-profile Windows Tauri/WebView2 app**, with built frontend assets. The
experimental TracePilot CLI integration was not benchmarked.

## Accepted improvements

Times are medians in milliseconds. Brackets show the full observed range, not a
confidence interval or p95. Negative changes mean less time. IPC and rendering
are separate measurements; their improvements must not be added together.

| Change / affected flow | Before | After | Absolute / relative change | Evidence and risk |
| --- | ---: | ---: | ---: | --- |
| Production IPC transport; 21.79 MiB / 2,822-turn response | 1,607 [1,589–1,633] | 377 [358–396] | −1,230 ms / −76.6% | 7 warm calls each; identical payload; disjoint ranges; narrow CSP change |
| Same transport fix; 13.78 MiB / 3,095 turns | 858 [852–880] | 283 [267–309] | −575 ms / −67.0% | 7 calls each; identical payload; disjoint ranges |
| Same transport fix; 13.55 MiB / 1,058 turns | 891 [837–942] | 289 [269–329] | −602 ms / −67.5% | 7 calls each; identical payload; disjoint ranges |
| Markdown + timestamp changes; warm 2,822-turn conversation usable | 3,562 [3,407–4,396] | 2,931 [2,714–3,264] | −631 ms / −17.7% | 8 warm visits each across two runs; CSP-only control; reverse-order check also improves |

The 640-turn rendering comparison is **effectively unchanged within the 10%
screening band**: 1,168 [1,108–1,305] to 1,083 [1,031–1,232] ms (−85 ms / −7.3%,
eight warm visits each). The 200-turn synthetic comparison is **inconclusive**:
one unprofiled pair was 392 [378–442] to 344 [336–385] ms (−48 ms / −12.2%, four
warm visits each), with overlapping ranges. These are not established improvements.
Session-list, analytics and search results were unchanged or inconclusive; no
general speedup is claimed for them.

### IPC: production CSP selected a slower fallback

The production `connect-src` policy blocked requests to `http://ipc.localhost`.
The bundled Tauri runtime then permanently selected its postMessage fallback for
that page. This added large-response serialization/evaluation work in the renderer.
Console violations, the bundled IPC source, native CPU profiles, and a same-binary
diagnostic CSP bypass identified the cause.

Commit `bc7adc44` adds only `ipc:` and `http://ipc.localhost` to the exact existing
allowlist. The CSP guard pins that complete allowlist; no wildcard or general
network relaxation was introduced. The diagnostic bypass is not a product change.
A CSP-only executable independently reduced the largest response from 1,607 to
388 ms, confirming attribution before frontend changes. Custom-protocol requests
were observed in the fixed executable; the original executable had none. Final
responses matched baseline SHA-256, byte length and turn count for all three sessions.

For seven largest-response calls, CDP renderer TaskDuration fell from **4,280 to
870 ms (−79.7%)**. This is renderer busy time, not whole-app CPU usage. All content
is still returned. Parsing, reconstruction and backend caches are unchanged.
Windows is verified; other platform transports need native release checks.

### Rendering: eliminate work repeated for each message

Commit `5bc82273` contains two related changes implemented by Sol and reviewed
and accepted by Astra as a pair:

- `MarkdownContent.vue` let Vue write sanitized HTML, then replaced that same
  HTML again in a post-flush watcher. A 640-turn native diagnostic observed
  **1,002 writes, including 501 exact duplicates**. Final-head instrumentation
  observed **501 writes and zero duplicates**. Vue now owns ordinary updates;
  the watcher restores HTML only when removing its own search marks from unchanged
  renderer output. Cancellation prevents stale async watcher continuations.
  Sanitization and search behavior remain intact.
- `formatTime` called `Date.toLocaleTimeString` separately for every timestamp.
  Native profiles attributed about 72–84 ms on warm 640-turn visits and 270 ms
  on a first large-session visit to this work. One `Intl.DateTimeFormat` is now
  reused within a synchronous batch and discarded in the next microtask. This
  holds at most one formatter, stores no strings, and resolves locale/time zone
  again in later batches. Invalid and missing date behavior is preserved.

The combined 2,822-turn rendering improvement is repeatable; individual speedup
percentages for these two changes are **not** established. Renderer busy time for
that flow fell from a median **3,569 to 2,939 ms (−17.7%)** across the same eight
warm visits per variant. Long main-thread tasks remain. No sustained RAM reduction
is claimed: recorded JS heaps vary with natural GC and are not app working set.

The initial hypothesis that duplicate writes explained all of a second forced
layout was too strong. Diagnostic removal reduced work, but GC and layout varied;
the whole rendering gain cannot be attributed to layout elimination.

## System model and remaining opportunities

Session list reads indexed SQLite summaries and starts indexing/prefetch work.
Detail uses cached typed events and reconstructed turns. Refresh checks file
metadata before loading changed content. Conversation renders the complete turn
sequence. Search uses FTS5 with separate results/count/facet queries. Analytics
uses indexed SQL with a disk-scan fallback. Indexing processes metadata/analytics
and then search content.

| Opportunity | Diagnosis / decision |
| --- | --- |
| Large response bridge overhead | Dominant, measured, fixed by restoring intended transport |
| Per-message DOM and date work | Measured in native profiles, reduced with bounded changes |
| Full conversation DOM, layout and scroll reads | Still dominant at thousands of turns; further work needs selection/find/scroll validation, not speculative virtualization |
| Reconstruction, cloning and full parse after append | Source confirms work, but net benefit of a rewrite is unproven; no incremental parser or new data cache added |
| Search/index scaling | Corrected empty fixtures; service/native checks now meaningful; no backend algorithm rewrite justified here |
| Large session-list rendering | About 0.56 s warm for 1,000 sessions; remains a profiling target |

Typical synthetic service-only diagnostics (three repetitions): 100-session full
reindex 137 ms, no-op incremental index 33 ms, search rebuild 475 ms, no-op search
index 21 ms, indexed list 0.4 ms, analytics 1.3 ms, FTS search 3.1 ms. A 5,000-event
stress session parsed in 17.5 ms, reconstructed in 3.5 ms and serialized in 2.4 ms.
These are Rust service timings, not native UI/IPC or before/after product claims.

## Evidence and methodology

[Sanitized numeric samples](performance-evidence.json) preserve reported IPC and
native warm samples, renderer metrics and binary identities. Raw local results,
private data, profiles and screenshots remain ignored under `.tracepilot/perf/`.

- Windows 10.0.22621 x64; Ryzen 5 3600, 6 cores / 12 logical processors;
  15.95 GiB RAM; Node 22.19.0; WebView2 Edge 153.0.4234.32.
- Built assets and shipping release profile: opt-level 2, thin LTO, one codegen
  unit, stripping. `automation-devtools` enables CDP and is the deliberate
  difference from shipping. Compilation is outside measured operations.
- Exact preserved binary SHA-256 starts: base `8b7a1fea`, CSP-only `cbfca891`,
  final `cc82ebca`; full hashes are in the evidence JSON. `-SkipBuild` records
  launch-time source revision/dirty state, not a guarantee of embedded source
  identity. Binary hashes identify these variants.
- Warm UI comparisons exclude iteration zero. First visits are retained
  separately, can include profiling, and are not a cold-start study. Indexes
  were populated and warm. OS filesystem cache was not controlled.
- Two original synthetic A/A runs had warm median differences of 0.2–3.7% across
  four routes with overlapping ranges. The comparator uses a conservative 10%
  descriptive band. Outside it, only disjoint observed ranges are improvement
  or regression; overlap is inconclusive. This is not a significance test.
- Deliberate 4× renderer throttling increased synthetic warm conversation time
  from about 395 to 2,221 ms. The harness detected the slowdown; the comparator
  rejects it as incompatible with an unthrottled product comparison.
- CSP-only measurements preceded the original binary IPC countercheck. Rendering
  used control, candidate, candidate repeat, then control repeat. The later control
  again had disjoint slower ranges for the 2,822-turn conversation.
- Completion requires actual fixture content, all expected turns, and two animation
  frames; no fixed multi-second sleeps are timed. Prefetch completions can appear
  in route IPC logs and are not all attributed to foreground work. One failed
  executable switch was detected by the recorded hash; those runs were correctly
  relabelled as candidate repeats before comparison.

The private snapshot used 20 sessions / 328 MiB, sampled from 389 local sessions /
about 2.4 GiB using largest, recent and size quantiles. Only copies of `events.jsonl`
and `workspace.yaml` were used; originals were not modified. No private title,
identifier, message, source path or screenshot is committed. This is diagnostic
coverage, not a claim to represent every user's history.

Deterministic public fixtures cover 10 / 100 / 1,000 sessions, 7,320 / 17,292 /
136,930 events, varied tools/Markdown, large sessions and a 1 MiB output. Final-head
warm medians below are **scaling observations only**, four visits per cell:

| Sessions | Session list | Same 200-turn conversation | Analytics | Search |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 41 ms | 382 ms | 51 ms | 61 ms |
| 100 | 82 ms | 344 ms | 53 ms | 59 ms |
| 1,000 | 558 ms | 399 ms | 61 ms | 75 ms |

Final release binary: 37,541,376 bytes versus 37,570,560 for the instrumented
baseline (−29,184 bytes), including all mission source changes. Final JS+CSS:
2,492.94 KiB against the 2,500 KiB advisory threshold. Largest
chunk 293.57 KiB exceeds the 250 KiB advisory threshold; initial HTML assets are
3 / 3. No bundle-size reduction is claimed without a matching baseline asset total.

## Correctness and native validation

- Shared UI suite: **1,061 tests / 92 files pass**, including 15 Markdown tests
  for search replacement/clearing, changed content, raw/rendered mode, selection,
  external links and sanitization. Formatter suite: **9 pass**, including native
  date-output equivalence, boundary timestamps, invalid/missing inputs and batch
  lifetime. Types/desktop typechecks and production build pass.
- Isolation/path: **8 pass**, including real Windows junction rejection;
  bindings config/service/persistence: **37 pass** after splitting oversized test
  modules; launcher: **9 pass**; populated fixture tests: **2 pass**. Rust bench
  targets/example compile. Comparator: **3 pass**; budget contract: **7 pass**.
  Relevant formatting, CSP, file-size, diff and doc-link checks pass. Lefthook
  was unavailable in PATH; relevant guards were run manually.
- Native refresh preserves selected Markdown text. Partial JSONL append produces
  no phantom turn; completing it displays the ordered, rendered, browser-findable
  new turn. One diagnostic append-to-usable observation was 261 ms. The original
  synthetic file is restored and the UI returns to 200 turns.
- A 120-frame scroll sweep retains all turns and stable conversation height.
  Screenshots were opened and reviewed at 1440×960, 960×640 and 2560×1440.
  The minimum layout uses its existing scrolling sidebar and horizontal tab strip.
- The 800-turn / 20,000-event synthetic stress conversation loads. Its 1 MiB tool
  result expands, and Copy receives all **1,048,617 characters**. The existing
  20,000-character display cap for a single code line remains; this was explicitly
  distinguished from complete loaded/copyable content.
- Twenty rapid route changes during native full reindex end on the correct complete
  conversation. Reindex reports 1,000 / 1,000 and no uncaught page errors. Existing
  notification-plugin registration and slow-IPC diagnostics were observed.

## Measurement and CI repairs

The older desktop diagnostic included fixed 2–3.5 second waits plus a navigation
wait inside action measurements; those wall times are not used here. `ipc_hot_path`
measures Rust services, not the Tauri bridge; documentation now makes this clear.

Old multi-session fixture names were not UUIDs and production discovery rejected
them: a focused test found zero sessions when three were expected. Correct UUIDs,
exact indexing counts, nonempty search assertions and deterministic corpora replace
those invalid workloads. Historical empty-database numbers are marked invalid;
new results use `v2-nonempty-fixtures` identity.

The launcher supports built assets/release Rust and explicit isolation of config,
sessions, database, logs and WebView profile. The harness verifies the resolved root
and indexed IDs before measuring. An opt-in private snapshot helper copies selected
session files into this boundary.

| Lane | Actual trigger / enforcement | Retained evidence |
| --- | --- | --- |
| Frontend bundle | Relevant PRs/manual; all size thresholds advisory; missing/invalid inputs fail | JSON, Markdown, bundle analysis artifact and reporter log; 90 days |
| Rust Criterion | Nightly/manual Ubuntu; execution and missing/invalid results/budgets fail; timing thresholds advisory | Criterion tree, samples/estimates, metadata, summary, contract log; 90 days |
| Windows native | Local/manual committed harness; no automatic hosted Windows UX gate | Validated samples, binary/environment/build/fixture metadata, screenshots, optional profile |

Every declared Rust budget maps to required results, including FTS content search.
The extractor reports the mean estimate and Criterion's actual confidence level,
never a confidence bound as p95. Missing budgets/results, unknown keys and invalid
numbers fail. Integration validation ran the three exact groups with 10 samples,
1-second warmup/measurement, then verified extracted estimates against raw files:
parse 1,000 events **2.676 ms mean**, analytics 100 sessions **98.508 µs mean**,
FTS common-term search 100 sessions **2.692 ms mean**. These are current-head service
diagnostics only. All are within advisory budgets. The exact bundle extractor also
ran against built assets and produced its JSON/Markdown summaries successfully.

Workflows use read-only permissions and nonpersistent checkout credentials. The
measurement job no longer attempts Pages pushes or PR comments. Unrelated existing
Pages content is untouched; no publishing pipeline was added. These measurements
were validated locally; hosted Actions results are separate PR evidence.

The follow-up removes the hard JS+CSS ceiling at the user's request. All bundle
thresholds now warn, while missing/invalid measurement inputs still fail. A tested
Node reporter replaces workflow-inline extraction, produces reusable JSON/Markdown,
and retains its log with the bundle analysis. This makes the same reporting contract
available locally and in CI; it does not add the multi-GiB workload to routine PR jobs.
The standard required CI now runs the lightweight reporting/comparison contracts
on every PR and the generator's small contract tests on Linux and Windows. These
protect the measurement tools and massive fixture plan without timing shared runners.

`scripts/perf/compare.mjs` produces offline Markdown/JSON with improvement,
regression, effectively unchanged, inconclusive, execution failure, missing result
and incompatible states. It rejects mismatched harness/fixture identity, viewport,
throttle, platform/Node/WebView, build mode or selected session. Same-machine and
cache-policy equivalence still require operator verification.

## Reproduction

Run from the repository root in PowerShell. Use a new dedicated fixture directory;
generation refuses to overwrite unrelated contents. Substitute `small` or `large`
for `typical` to test the other sizes.

```powershell
$corpus = 'C:\git\TracePilot\.tracepilot\perf\repro-typical'
cargo run --release -p tracepilot-bench --example performance_probe -- generate --root $corpus --scale typical --probe --repeats 3 --output "$corpus\service.json"
pnpm app:start -Runtime production -DataRoot $corpus
node scripts/perf/desktop.mjs --manifest="$corpus/fixture-manifest.json" --out=.tracepilot/perf/repro-head --samples=5 --profile=true
node scripts/perf/ipc.mjs --manifest="$corpus/fixture-manifest.json" --out=.tracepilot/perf/repro-ipc.json --samples=7
node scripts/perf/verify-desktop.mjs "$corpus/fixture-manifest.json" .tracepilot/perf/repro-validation
pnpm app:stop
```

Production `app:start` runs the frontend build and
`cargo build --release -p tracepilot-desktop --features automation-devtools,tauri/custom-protocol`.
Use `-SkipBuild` only for an explicitly preserved executable and check its hash.
Stop the tracked process and wait for exit before replacing it. Use the same corpus,
machine, WebView and workload for the other variant. Do not measure apps concurrently.

```powershell
node scripts/perf/compare.mjs .tracepilot/perf/repro-base/desktop.json .tracepilot/perf/repro-head/desktop.json .tracepilot/perf/repro-comparison.md
node scripts/perf/compare.test.mjs
node scripts/perf/check-budgets.test.mjs
cargo bench -p tracepilot-bench
node scripts/perf/check-budgets.mjs --criterion=target/criterion --budget=perf-budget.json --output=.tracepilot/perf/criterion.json --summary=.tracepilot/perf/criterion.md
```

Open this file and `performance-evidence.json` in the editor. Comparison Markdown,
JSON and Criterion HTML work offline. For live inspection, use the Playwright
attach command printed by startup. With this machine's older global shim, use:

```powershell
node node_modules/@playwright/cli/playwright-cli.js -s=tracepilot-desktop attach --cdp=http://127.0.0.1:9222
node node_modules/@playwright/cli/playwright-cli.js -s=tracepilot-desktop snapshot --filename=.playwright-cli/current.yml
```

Local raw evidence includes `typical-base-a/b`, `typical-head-a/b`,
`private-native-ipc-base/csp/head.json`, `private-ui-csp/head-2822` and repeats,
`verification-head`, `final-interactions.json`, viewport captures and `ci-validation`
under `.tracepilot/perf/`. Private profiles/screenshots must stay local. A public
corpus cannot reproduce a particular private session's timings.

## Follow-up: everyday impact and SQLite review

The largest benefit is opening or refreshing very large histories that must cross
the native bridge. The 76.6% result applies to one large IPC response, while the
measured complete warm conversation improvement is 17.7%. Routine session lists,
search and analytics had no established improvement from this change. There is no
measured population-wide "average user" percentage.

Further rendering work remains plausible. Final-head 640-turn CPU profiles still
attribute about 303–411 ms to `getBoundingClientRect`, with other scroll/layout
reads also costly. This is browser layout charged to a synchronous read, not proof
that removing that read would save its full sampled duration. The next experiment
should coordinate panel-offset and scroll measurements/writes, then validate full
render, scrolling, deep links, text selection and live updates. The chat panel
offset helper currently reads geometry and writes breakout styles on scroll.

Tool groups also mount collapsed rows using `v-show`, and their visibility helper
repeatedly counts/prefix-scans the same group. Precomputing visibility is a bounded
candidate; reducing hidden row mounting requires checking expansion latency and
deep-link behavior. Neither is a proven additional speedup yet. Whole-conversation
virtualization remains higher risk for find, copy, selection and scroll stability.

SQLite has substantial existing optimization: WAL/NORMAL writer configuration,
foreign keys, a busy timeout, transactions, FTS5, composite indexes, a partial
nonempty-session index, and throttled ANALYZE/FTS/vacuum/checkpoint maintenance.
Read-only query-plan inspection confirmed the intended indexes for chronological
session lists, repository filters, per-session content browsing and neighboring
events. The inspected databases had planner statistics populated. No database
migration or new index was added in this follow-up.

Read-only diagnostics, five warm samples, on the existing isolated databases:

| Operation | 100 synthetic sessions / 13,268 search rows | 1,000 / 105,046 rows | 20 copied sessions / 65,385 rows |
| --- | ---: | ---: | ---: |
| Fetch complete session list | 0.28 ms | 2.81 ms | 0.07 ms |
| Common-term relevance results, first 50 | 3.25 ms | 33.94 ms | 12.99 ms |
| Separate matching-result count | 1.12 ms | 18.66 ms | 6.19 ms |
| Four facet/totals queries, sum of individual medians | 4.43 ms | 77.24 ms | 26.77 ms |
| Per-session content browse, first 50 | 0.06 ms | 0.04 ms | 0.04 ms |

These diagnostics used Python SQLite **3.42.0**, while the native release links
**3.46.0**. They identify query shapes and approximate costs; they are not new
native app timings or directly comparable benchmark results. Queries returned
complete rows but no private result text/identifiers were recorded. Local script
and numeric plans: `.tracepilot/perf/sqlite-followup.py` and `sqlite-followup.json`.

The strongest SQL follow-ups are:

- A search performs results plus COUNT; a facet-cache miss adds three grouped
  dimensions and totals, repeating COUNT. Facets are requested after results, and
  each dimension intentionally excludes its own filter. Share work only while
  preserving those semantics, exact counts and fresh index state.
- Weighted FTS relevance uses a temporary sort over matches. Common terms have
  measurable cost; a replacement must preserve the current ranking, not simply
  remove weights to benchmark faster.
- Analytics wraps timestamps in `date(COALESCE(...))`; the tested date filter
  scans sessions. It cost only 0.37 ms at 1,000 sessions, so adding an expression
  index is lower priority than rendering/search work and must preserve NULL and
  date/time semantics.
- Opening a read connection plus COUNT averaged about 0.7–0.9 ms in these
  diagnostics. Connection pooling is lower priority and could add lifecycle and
  concurrency complexity. Index availability alone does not mean every query is
  optimal, but the evidence does not justify a general SQLite rewrite.

## Fresh-install indexing and a multi-GiB workload

The previous 1,000-session synthetic corpus contains only **48.45 MiB** of event
logs. The authorized local inventory contains 389 sessions / **2.42 GiB**. Session
count alone was therefore inadequate coverage for fresh-install performance.
The new opt-in `massive` scale contains **500 sessions, 3.13 GiB of event logs,
1,477,800 events, 155,800 turns and 426,800 tool calls**. Its skew is 300 small,
130 medium, 50 large and 20 monster sessions; monster sessions have 2,500–4,000
turns. The largest generated log is 66.4 MiB. Tool outputs vary in length and
contain deterministic source/test/diff text, rather than one giant padding blob.
Generation streams events, records exact source bytes, and leaves the massive
database absent so the real app performs schema creation and indexing.

Native release measurements below use the same accepted executable as above.
First setup uses an absent database and a fresh WebView profile, completes the
actual setup wizard, and measures from its final button click. Index durations
use native lifecycle events observed in the renderer; they include event delivery
latency. Search indexing continues after the session-index command returns.
There is one first-setup sample per corpus and three full rebuilds from Settings:

| Corpus | Session indexing | Search indexing | Both phases | Click to usable list | Full rebuild median [range] |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 synthetic / 6.98 MiB | 0.70 s | 0.39 s | 1.09 s | 2.41 s | 0.76 [0.73, 0.93] s |
| 1,000 synthetic / 48.45 MiB | 3.17 s | 3.34 s | 6.51 s | 5.43 s | 4.98 [4.61, 5.07] s |
| 20 copied local / 328.31 MiB | 1.48 s | 3.83 s | 5.31 s | 2.99 s | 4.57 [4.51, 5.10] s |
| 500 synthetic / 3.13 GiB | 10.86 s | 44.89 s | 55.76 s | 12.86 s | 56.71 [54.77, 60.32] s |

These are current-head baselines, **not indexing speedups**, process-launch times
or controlled cold-disk results. OS cache is uncontrolled. Full rebuild deletes
and recreates the owned database; no original local histories were modified.
Every sample checks session totals and FTS row health. Massive samples additionally
verify all **1,165,200 content rows**, **155,800 expected search matches**, zero
pending sessions, and native FTS integrity. Verification runs after timing.
The resulting massive database is approximately 714 MiB.

The list becomes usable before search finishes on larger datasets. The loading
screen also deliberately adds a completion sequence after session indexing:
an 800 ms minimum display, then 400 ms deceleration, 350 ms hold and 400 ms fade.
Observed session-index completion to usable list was 1.46–2.02 s, which also
includes list loading/rendering. Mounting the list starts another incremental
index pass; the lifecycle traces preserve that overlapping work. Neither delay
was removed in this follow-up.

Initial scripted rebuild calls immediately after entering Settings encountered
a Windows sharing violation on the 100/1,000-session corpora. Settings opens
database readers on mount. The harness now waits for storage statistics before
measuring an idle rebuild; failed attempts are excluded from successful timings.
This is a remaining concurrent-read/rebuild concern, not a shipped fix.

With the massive database populated, actual UI measurements were:

| Flow | First measured visit | Median of three warm revisits |
| --- | ---: | ---: |
| Session list | 355 ms | 364 ms |
| 4,000-turn / 12,000-tool conversation | 10.23 s | 9.89 s |
| Analytics | 2.02 s | 597 ms |
| Search | 2.43 s | 84 ms |

Warm search revisits reuse app results/facets and are **not uncached SQL timings**.
A separate 4,000-turn renderer profile attributed about **2.41 s** to synchronous
`getBoundingClientRect`, with substantial additional DOM, scroll and GC work.
This reinforces layout/render coordination as the next conversation experiment;
it does not establish that all sampled layout time is removable. Heap growth
across visits fell after GC in the diagnostic pass, so no leak claim is made.
One separate debug-logging rebuild (excluded from the samples above) attributed
**27.95 s of a 42.90 s search phase to bulk SQLite content writing plus FTS
reconstruction**. Logs confirmed two maintenance passes on full rebuild; their
internal optimize/vacuum/checkpoint timers were 2.20 s and 0.008 s, excluding
ANALYZE. Parsing the logs again is a candidate, but it does not explain the whole
search-index cost. Bulk-write/FTS profiling is the next indexing investigation;
buffer reuse must also account for memory and incremental freshness semantics.

Reproduce the opt-in volume case (allow several GiB of disk space):

```powershell
cargo run --release -p tracepilot-bench --example performance_probe -- generate --root C:\benchmarks\tracepilot-massive --scale massive
```

Then follow the [native indexing measurement instructions](../app-automation.md#native-indexing-measurements).
Numeric samples are in `performance-evidence.json`; private logs and profiles stay
under ignored `.tracepilot/perf/`. Focused generator tests validate a small
representative stream and the massive plan without creating GiB in CI.
Follow-up validation passed all three generator tests, all 15 performance-report
contracts, full workspace typechecks, Rust formatting, Biome, workflow YAML,
file-size, documentation-link and diff checks. The real built bundle reporter
exits successfully while warning about the advisory largest-chunk threshold.

## Commits, delegation and limits

Reviewable commits in order:

1. `2750c2bd` — isolate production desktop performance runs.
2. `bc7adc44` — restore intended Tauri IPC transport through production CSP.
3. `99224c96` — populated deterministic benchmark corpora and service probes.
4. `d48990e4` — validated native desktop/IPC measurements and comparisons.
5. `5bc82273` — eliminate repeated formatting/DOM work; native correctness check.
6. `030bc56c` — validate CI evidence and report budget enforcement honestly.
7. `46c16e6b` — measured results and sanitized numeric evidence.
8. `aeaa8ea3` — SQLite/query-plan assessment and setter-spy test typing
   corrected after full-workspace typechecking.
9. `4604bac4` — multi-GiB deterministic fixture and native indexing harness.
10. `67dc7c3b` — advisory bundle sizes and required reporting/fixture CI contracts.

Astra mapped flows, diagnosed the IPC fallback, interpreted profiles, chose changes,
ran native A/A and base/head acceptance, reviewed source and made retention decisions.
Sol implemented bounded isolation, fixtures/probes, rendering, harness and CI tasks.
Review corrected an ineffective IPC wrapper (Tauri invoke was non-writable), an
initial metadata-search budget mapping instead of FTS content search, and oversized
new Rust modules. These corrections were integrated and checked before acceptance.

No speculative reconstruction cache, incremental parser, compression, worker,
virtualization expansion or PGO change was retained. Formatter lifetime is one
microtask instead of a permanent time-zone-sensitive cache. Small-session speedups
remain inconclusive/unchanged as described above.

Limits: one Windows machine/WebView; macOS/Linux untested; no controlled cold-disk
or startup comparison, long-duration leak study, whole-app CPU/working-set
improvement claim. All hosted PR checks passed on `aeaa8ea3`; later fixture/CI
follow-up commits have their own hosted check results.
Huge sessions still take seconds of DOM
work; OS cache, GC and prefetch add variance. The app was stopped after validation,
and the accepted executable was restored under `target/release`.
