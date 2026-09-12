# Desktop frontend visual comparisons

The **Desktop Visual Capture** workflow renders the actual Vue application with
synthetic backend fixtures at **1440×960 CSS pixels**, dark theme and 100% UI
scale. Its 33 cases capture every named route, all eight session detail tabs,
populated search, a selected Explorer file, a completed session comparison,
a populated Markdown export preview, and a second Settings position.
The [case manifest](../scripts/visual/manifest.mjs)
is the inventory; its state labels identify experimental views, pickers, and
disconnected integrations. A route inventory test fails when a named route is
added without a case.

This supplements [native app automation](app-automation.md). It does not run
Rust, launch agents, make network requests, access user data, test native
dialogs, or prove integration behavior. It does not cover every dialog or
interaction state. Native verification at 1440×960, 960×640 and 2560×1440 remains
required for applicable product fixes.

## PR and main comparisons

- PRs targeting `main` compare the PR's **merge base against its exact head**.
  Updates made independently on `main` therefore do not appear as PR changes.
- Pushes to `main` compare the previous tip against the new tip. This produces
  a screenshot history after merges.
- Both revisions use the same head manifest, fixture overrides, imported client
  mock datasets (`mock/**` and `internal/mockData.ts`), and lockfile-pinned
  Playwright/Chromium. Components, client adapters, types/defaults and application
  dependencies still come from their respective target revision.
- Missing routes, incompatible old client fixture contracts, failed checkouts,
  runtime errors and missing fixture commands are recorded as **base unavailable**
  or **incomplete**, never as unchanged. Head capture jobs fail for both failed
  and incomplete cases, including console errors and missing fixtures. Base
  cases may be unavailable when a PR introduces a view; those limitations stay
  in the report without failing an otherwise completed base capture. Checkout,
  dependency installation and browser/server startup failures still fail the
  affected job. A first push with no prior commit can have no usable base.
- Changed views are detected by exact PNG hashes. Both sides use matching
  Ubuntu 24.04 runners and the same browser. Changes are for human review; the
  suite does not fail merely because an intentional screenshot changed.

Four independent capture jobs run concurrently: two route shards for base and
two for head. They restore the existing pnpm download cache, install frozen
dependencies, and upload captures even when a view fails. This reduces capture
wall time at the cost of four dependency/browser installations; no Rust build
is needed. The publisher installs no dependencies and consumes no PR cache.
Concurrency cancels superseded capture runs; publication is serialized.
Publication queues pending reports so an unrelated PR cannot replace a waiting report.
On the development Windows/Edge host, repeated warmed single-shard 33-view captures
took 39–41 seconds, excluding dependency/browser installation. Two shards are
an initial wall-time tradeoff; use uploaded capture `durationMs` values and
Actions job timings to reassess runner overhead after the first Linux runs.

Each capture waits for fixture requests to settle, the route's visible ready
element, optional command results, fonts, and Vue/browser rendering. Date and
random seeds, locale, time zone, theme, viewport, and scale are fixed. CSS
animations/transitions and carets are suppressed. External network requests are
blocked. Console errors, uncaught page errors, and visible Vue error boundaries
mark a capture incomplete. These controls remove nondeterministic clocks and animation frames
without masking product regions.

## Gallery and comments

The separate **Desktop Visual Report** workflow runs trusted default-branch code
after capture completion. It generates a standalone, searchable gallery with
side-by-side images and a changes/limitations filter. New case IDs introduced by
the PR are included before their manifest reaches `main`.

When Pages uses the existing `gh-pages` branch root, reports are published under
`visual/runs/<capture-run-id>/` and indexed at
[the visual history](https://mattshelton04.github.io/TracePilot/visual/).
Everything outside `visual/`, including the existing `dev/` workbench, is
preserved. The current site retains the latest 20 main reports and 20 PR reports;
older commits remain in Git history and can be archived separately if storage
growth becomes material. Old gallery URLs expire from the current site when
their retained report is pruned.

One bot comment per PR links the gallery and embeds up to three changed
before/after pairs. It is updated on later runs, with current-head checks to
avoid reporting superseded commits. Pages builds are asynchronous, so new image
URLs become available after the Pages build completes. If Pages publication is
unavailable, the comment links capture artifacts and the downloadable standalone
gallery. Captures are retained for 14 days; standalone report artifacts for 30.

**Bootstrap limitation:** GitHub only dispatches `workflow_run` workflows that
already exist on the default branch. The PR introducing this system can run
captures, but automatic publication/comments begin after the trusted publisher
is merged. A manual `workflow_dispatch` creates diagnostic captures only; it does
not publish a PR/main history entry.

## Security boundary

The capture workflow runs PR code with `contents: read` and without repository
write secrets. Checkout credentials are not persisted. Fork code, dependencies
and Vite configuration remain untrusted. They never run in the publishing job.

The publisher checks out only the default branch, verifies the source workflow,
and downloads artifacts from that run. It never checks out PR code, installs
dependencies, restores PR caches, evaluates artifact scripts or publishes
artifact HTML. The extractor accepts bounded flat PNG/JSON names, rejects
symlinks/path traversal and validates screenshot dimensions. The reporter
revalidates image headers, uses bounded safe case IDs for paths, escapes all
artifact text, and generates its own HTML. PR numbers come from GitHub API
association, constrained to the expected repository/base branch and current
head, rather than artifact metadata. Publication uses a normal fast-forward
push and preserves other Pages content.

The trust separation follows GitHub's
[workflow_run guidance](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).
Artifact screenshots are review material, not trusted assertions that arbitrary
PR code behaved honestly.

## Local use and adding cases

Install normal workspace dependencies and the pinned browser once:

```sh
pnpm install --frozen-lockfile
node node_modules/playwright-core/cli.js install chromium
node scripts/visual/capture.mjs --root=. --out=.tracepilot/visual --shard=1/1
```

On Windows, `--channel=msedge` can use the installed Edge for local diagnosis.
Windows captures must not be compared to Linux as baselines. The harness owns a
separate loopback Vite server/cache and browser, and closes both when finished.
It does not attach to the native app. `--case=search-results` selects one case;
`--shard=1/2` selects one of two shards. `--port=<port>` is optional; the default
uses an available ephemeral port. Output stays under ignored `.tracepilot/`.
Local captures default to `--revision=head`; use `--revision=base` only when
capturing a historical comparison whose unavailable cases should be reported.

Add a manifest entry with a stable lowercase ID, real hash route, explicit
state, and a selector that only becomes visible when the intended content is
ready. Cases that need interaction use `start` for the initial ready element and
a bounded `prepare` action in the harness before waiting for final content.
Use `command` when completion depends on a specific backend fixture and
`scrollText` for a deliberate lower-page position. Extend
`scripts/visual/fixtures.mjs` for commands with no safe existing fallback; do not
return generic success for unknown commands. Fixture contents must remain
synthetic and non-sensitive.

To assemble two local captures into a gallery:

```sh
node --input-type=module -e "import {buildReport} from './scripts/visual/report.mjs'; await buildReport({baseDir:'.tracepilot/before',headDir:'.tracepilot/after',output:'.tracepilot/report'});"
```

Run the harness and artifact policy checks:

```sh
node --test scripts/visual/*.test.mjs
python scripts/visual/extract_test.py
node scripts/check-workflow-actions.mjs
```

Local development validation captured all 33 cases, with zero console,
page or visible error-boundary errors after fixture corrections. Image inspection
identified an invalid Explorer fixture caught by Vue's error boundary; correcting
its file-entry contract and checking console/error-boundary output closed that
false-positive gap. Repeated captures exposed a sidebar opacity transition;
disabling screenshot animation/transition timing made all 33 captures
byte-identical across repeated runs.
GitHub-hosted Linux capture, workflow permissions and Pages/comment delivery
still require their first actual workflow run; local fixtures do not verify
those services.
