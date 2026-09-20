# GitHub Actions review — 20 September 2026

The priorities are reliable evidence and shorter feedback time. This is a public
repository, so reducing total runner minutes is not the objective. Existing
cross-platform Rust coverage, independent frontend jobs, read-only PR execution,
full action commit pins, main-only cache writers, serialized Pages publication,
and draft-first releases are useful foundations to retain.

## Findings and changes

### Bundle reporting

The 9,188-character comment on [PR #831](https://github.com/MattShelton04/TracePilot/pull/831)
was a flat asset table. Current main had since replaced that commenting workflow
with artifact-only reporting. The new implementation provides a compact comment
again: total JS/CSS and summed per-file gzip, absolute/percentage changes against
the PR merge base, and a closed `<details>` containing thresholds and the asset
table. The same compact format is used in job summaries. Rows are size-sorted,
escaped, and bounded below GitHub's comment limit; complete JSON and treemaps
remain available as artifacts.

Base and exact head builds run concurrently with their own lockfiles, the same
measurement script, and the head's advisory thresholds. The bundle job invokes
Vite directly, avoiding a typecheck already covered by CI. A separate trusted
default-branch `workflow_run` publisher validates JSON rather than executing PR
scripts or posting artifact Markdown. PR association and current head come from
GitHub, not artifact claims. This also supports fork PRs without granting their
builds write access. Each capture/build attempt can post once; duplicate reporter
deliveries and stale heads/attempts are skipped.

### Visual baseline failure

The [reported comment](https://github.com/MattShelton04/TracePilot/pull/831#issuecomment-5746729336)
was last updated by [capture 35483778770](https://github.com/MattShelton04/TracePilot/actions/runs/35483778770).
Its logs show **different** checkouts: base `3d7f1f0f` and head `2fe45fff`.
All 36 baseline cases failed because the head mock index imported
`./agentFixtures.js`, which did not exist in the base checkout. The old transform
replaced existing mock files' contents but could not supply new mock modules.
The comment then misleadingly said no larger changes were detected.

The fixture plugin now resolves and loads the shared mock corpus, including new
files, while retaining target-checkout module IDs so application/client/default
imports continue to resolve against the historical revision. No frontend component
is substituted from head. Failed capture screenshots are retained as diagnostics
but excluded from before/after comparisons. A completely failed baseline shard
fails capture; new routes can still be individually unavailable. Incomplete
comparisons are explicit in comments.

Capture metadata now records checkout/harness SHAs. Reports reject equal base
and head commits, mismatched head provenance, swapped sides, mixed revision shards,
and duplicate views. SHA labels appear in galleries/comments when available;
older artifacts without provenance remain supported. Manual diagnostics now use
the first parent instead of comparing a commit against itself.

Visual comments are appended, preserving previous revision comments and discussion.
The reporter's Pages fetch is shallow so every publication need not download the
entire accumulated screenshot Git history.

### Frontend latency and maintenance

The desktop test suite now has three independent Vitest shards. Workspace/CLI
tests run separately, removing pnpm's dependency-order delay before the desktop
suite. Isolation and test coverage remain enabled; all shards feed the existing
`required` aggregator. Frontend build no longer repeats `vue-tsc` after the
workspace typecheck. New reporting tests run in the policy job, relevant workflow
path filters include the shared helpers/runtime version, and Dependabot now covers
the isolated visual reporter's npm lockfile.

## Measured runs before these changes

Durations below come from job/step timestamps returned by the Actions API, not
workflow file estimates. The sample is small and hosted runners vary. Workflow
elapsed time includes scheduling and finalization, so it can exceed job duration.

| Work | Observed duration | Dominant work / implication |
| --- | --- | --- |
| CI across [35489272799](https://github.com/MattShelton04/TracePilot/actions/runs/35489272799), [35490794428](https://github.com/MattShelton04/TracePilot/actions/runs/35490794428), [35491039412](https://github.com/MattShelton04/TracePilot/actions/runs/35491039412) | 4m08s–5m33s elapsed | Windows Rust and frontend tests determine completion. |
| Frontend tests in those runs | 3m48s–3m58s per job | Test step 211–218s. In the middle run, UI took 48.46s, then desktop's 291 files / 2,362 tests took 166.33s. |
| Frontend build | 67–97s per job | Typecheck 22–38s, followed by a build script that repeats desktop typechecking. |
| Windows Rust | 3m49s–5m22s per job | Tests/compilation 177–209s; performance example recompilation up to 38s; main cache save 41s. |
| Linux Rust | 2m39s–3m31s per job | Native package install 21–51s; tests/compilation 81–84s; cache/setup and clippy add time. |
| Security | 3m14s–3m23s per job | Audit step 177–190s. Middle run compiled `cargo-audit 0.22.2` for 180s before the actual audit. |
| [Bundle Analysis 35490794427](https://github.com/MattShelton04/TracePilot/actions/runs/35490794427) | 55s job / 58s elapsed | Setup 12s, build/typecheck/analyze 37s. |
| [Visual Capture 35490794439](https://github.com/MattShelton04/TracePilot/actions/runs/35490794439) | 63–85s per shard / 90s elapsed | Chromium setup 18–22s, captures 19–30s. This is not the main bottleneck. |
| [Visual Report 35491105076](https://github.com/MattShelton04/TracePilot/actions/runs/35491105076) | 35s job / 39s elapsed | Gallery generation/publication 18s. |
| [Default CodeQL 35490793560](https://github.com/MattShelton04/TracePilot/actions/runs/35490793560) | Rust 9m33s; other languages 44–83s | Rust analysis itself took 552s. This separate GitHub-managed workflow outlasts CI. |
| [Release 34738307424](https://github.com/MattShelton04/TracePilot/actions/runs/34738307424) | Installer job 15m30s | Tauri build/package/upload step took 14m24s with caching disabled. |
| [Scheduled benchmarks 35426651470](https://github.com/MattShelton04/TracePilot/actions/runs/35426651470) | 27m32s elapsed | Benchmark step 27m. This predates the latest performance-contract changes; use a new completed run before tuning current workloads. |

At inspection, Actions cache usage was 19 entries / 4.49 GB. There is no measured
reason to remove useful caches or reduce OS coverage to save minutes.

## Recommended follow-ups

1. **Require the `required` check in the repository ruleset.** Neither active
   ruleset (`No Merge Main`, `Protect Main`) returned a required-status-check rule.
   The workflow's aggregator alone does not enforce passing CI before merge.
   Review bypass actors too. Repository settings were inspected but not changed.
2. **Stop recompiling the audit executable on every run.** Install a pinned,
   checksum-verified prebuilt `cargo-audit`, or cache the pinned executable
   separately from application build caches. Continue refreshing the advisory
   database each run. The current audit also logs a Checks API permission failure
   despite this being a same-repository PR; it only has read permissions. Prefer
   CLI output/summary instead of widening PR token permissions just for that API.
3. **Make audit and lint outcomes meaningful gates after addressing the backlog.**
   Both audits and lint/format checks are advisory today. The sampled Rust audit
   reported 13 vulnerabilities and 16 warnings while the overall security job was
   green. Triage those findings, then block new failures with explicit, reviewed
   exceptions where needed. This review did not update application dependencies.
4. **Compile the shipping Windows desktop target before release.** Current Rust CI
   excludes `tracepilot-desktop`; frontend captures use synthetic IPC. Add a
   Windows desktop compile/smoke check and run the existing Windows automation
   lifecycle/readiness tests in a dedicated job. Keep it parallel to existing
   tests; do not mistake the visual workflow for native integration coverage.
5. **Experiment with Rust build acceleration based on measurements.** A separate
   release-profile dependency cache could improve the 14m24s Tauri step. Do not
   restore the old debug cache into release builds. For PR Rust, benchmark a
   compiler cache or a narrower target graph while retaining OS coverage. Record
   restore/build/save timings before choosing a policy; required CI is still
   likely to be bounded by Windows Rust after frontend sharding.
6. **Investigate Rust CodeQL separately.** Its 9m33s is longer than CI and it is
   configured through GitHub's default setup, not a checked-in workflow. Keep
   security coverage; evaluate an advanced setup only if it enables measurable
   improvements without weakening analysis. Do not promise a faster overall
   checks panel from frontend sharding alone.
7. **Make screenshot storage immutable per attempt and bound stored history.**
   Comments now preserve revision history, but rerunning a capture replaces that
   run's Pages directory, and retention keeps only 20 PR / 20 main runs. A future
   storage layout should use run/attempt paths and define how old comment images
   expire. Shallow fetch bounds transfer, not repository object growth.
8. **Clarify Pages readiness and duplicate deployments.** Each recent publication
   produced two Pages runs, one immediately canceled, and deployment took about
   70s after the report. Comments can therefore precede a live gallery. Trace the
   branch-build/API-trigger interaction before removing either trigger; wait for
   the correct deployment or clearly communicate that publication is pending.
9. **Pin the Rust toolchain and restore macOS coverage after fixing known flakes.**
   The setup action installs moving stable, despite immutable action pins. A
   checked-in toolchain version makes rebuilds reproducible. macOS coverage is
   currently disabled; isolate and repair timing-sensitive tests rather than
   allowing that coverage gap to become permanent.

## Validation

- Reporting/CI helper suite: 23 tests passed. Visual/CI helper suite: 31 tests
  passed. Python extraction tests: 2 passed. Action pins verified remotely.
- First hosted [PR #833 CI run](https://github.com/MattShelton04/TracePilot/actions/runs/35492591428):
  desktop shard jobs passed in 77–81s (test steps 56–59s), compared with the prior
  228–238s combined frontend job. Its workspace job revealed that pnpm's explicit
  exclusion filter also selects the root package; the final command explicitly
  excludes root to prevent its recursive test script rerunning the full suite.
- Hosted [bundle builds](https://github.com/MattShelton04/TracePilot/actions/runs/35492591318)
  passed in 40–43s per revision; the new publisher was executed locally against
  both downloaded measurement artifacts with all API requests intercepted. It
  generated the expected collapsed comparison and 0.0% delta without posting.
- All four [hosted visual shards](https://github.com/MattShelton04/TracePilot/actions/runs/35492591336)
  passed in 69–73s.
- Real production Vite analysis build passed (208 JS/CSS assets, 2,492.9 KiB raw,
  751.3 KiB summed gzip). The largest-chunk threshold remains advisory.
- Historical `3d7f1f0f` checkout with the current working-tree harness: **33
  captured, 3 unavailable** (the Agents routes introduced afterward). Current
  working-tree frontend: **36 captured**, no incomplete views. These are local
  Windows/Edge fixture captures, not a reconstruction of the exact PR head and
  not native backend evidence.
- The assembled historical/current gallery passed all five comparison modes,
  three viewports (1440×960, 960×640, 2560×1440), missing-overlay behavior, and
  zero canvas reads/browser errors. Representative before/after Sessions images
  were inspected; the historical sidebar correctly lacks Agents.
- Actionlint 1.7.12 has a known false positive for the existing `queue: max`
  concurrency property. Validate with only that diagnostic excluded; it is valid
  [GitHub syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency)
  and preserves queued visual reports.
- Trusted `workflow_run` reporter changes become active only after this PR is
  merged into the default branch. This follows GitHub's
  [workflow-run execution model](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).
  This PR can validate capture/build jobs immediately; posting with the new
  trusted publishers requires a subsequent capture/build completion after merge.
