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
2,492.94 KiB within the 2,500 KiB required budget, with little headroom. Largest
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
| Frontend bundle | Relevant PRs/manual; total JS+CSS required; largest chunk and initial assets advisory | JSON, Markdown, bundle analysis artifact; 90 days |
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
Pages content is untouched; no publishing pipeline was added. Hosted Actions were
not run from this task.

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

## Commits, delegation and limits

Reviewable commits in order:

1. `2750c2bd` — isolate production desktop performance runs.
2. `bc7adc44` — restore intended Tauri IPC transport through production CSP.
3. `99224c96` — populated deterministic benchmark corpora and service probes.
4. `d48990e4` — validated native desktop/IPC measurements and comparisons.
5. `5bc82273` — eliminate repeated formatting/DOM work; native correctness check.
6. `030bc56c` — validate CI evidence and report budget enforcement honestly.
7. The reporting commit containing this document and sanitized numeric evidence.

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
improvement claim, or hosted Actions run. Huge sessions still take seconds of DOM
work; OS cache, GC and prefetch add variance. The app was stopped after validation,
and the accepted executable was restored under `target/release`.
