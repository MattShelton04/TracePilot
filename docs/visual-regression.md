# Desktop frontend visual comparisons

The **Desktop Visual Capture** workflow renders the actual Vue application with
synthetic backend fixtures at **1440×960 CSS pixels**, dark theme and 100% UI
scale. Its 33 cases capture every named route, all eight session detail tabs,
populated search, a selected Explorer file, a completed session comparison,
a populated Markdown export preview, and a second Settings position.
The [case manifest](../scripts/visual/manifest.mjs)
is the inventory; its state labels identify experimental views, pickers, and
disconnected integrations. Core views keep Replay, SDK and Alerts off. Other
experimental features are also off except when a case explicitly lists its
required `features`; those cases are labelled **Experimental: explicitly
enabled**. Both revisions receive the same policy from
[`feature-policy.mjs`](../scripts/visual/feature-policy.mjs). A route inventory
test fails when a named route is added without a case.

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
- Changed views are detected by exact decoded RGBA pixels. PNG hashes are retained
  for provenance; different encodings of identical pixels count as unchanged. Both sides use matching
  Ubuntu 24.04 runners and the same browser. Changes are for human review; the
  suite does not fail merely because an intentional screenshot changed.

Four independent capture jobs run concurrently: two route shards for base and
two for head. They restore the existing pnpm download cache, install frozen
dependencies, and upload captures even when a view fails. This reduces capture
wall time at the cost of four dependency/browser installations; no Rust build
is needed. The publisher installs only its isolated, lockfile-pinned PNG decoder with
lifecycle scripts disabled and consumes no PR cache.
Concurrency cancels superseded capture runs; publication is serialized.
Publication queues pending reports so an unrelated PR cannot replace a waiting report.
On the development Windows/Edge host, repeated warmed single-shard 33-view captures
took 39–41 seconds, excluding dependency/browser installation. The first hosted
Ubuntu run completed in approximately 74 seconds including setup and uploads;
its four capture shards took 18.301–23.960 seconds each. These are one-run
observations, not a performance guarantee; retain both shard and job timings
when reassessing the four-runner tradeoff.

Each capture waits for fixture requests to settle, the route's visible ready
element, optional command results, fonts, and Vue/browser rendering. Date and
random seeds, locale, time zone, theme, viewport, and scale are fixed. CSS
animations/transitions and carets are suppressed. External network requests are
blocked. Console errors, uncaught page errors, and visible Vue error boundaries
mark a capture incomplete. These controls remove nondeterministic clocks and animation frames
without masking product regions.

## Gallery and comments

The separate **Desktop Visual Report** workflow runs trusted default-branch code
after capture completion. It generates a standalone gallery with searchable view
navigation and a changes/limitations filter. New case IDs introduced by the PR
are included before their manifest reaches `main`. Captured route/state labels
are preserved, so an older report does not silently acquire newer fixture labels.

The viewer has five comparison modes:

- **Side by side** fits both complete desktop screenshots.
- **Before / after** switches images in the same position.
- **Wipe** uses a draggable divider, a range control, or divider keyboard keys:
  Left/Right move 1%, Shift moves 10%, and Home/End select either edge.
- **Overlay** adjusts the after image's opacity.
- **Difference** highlights changed pixels in pink and outlines changed regions.
  Its exact pixel count, percentage and bounding box are calculated from decoded
  RGBA values. Optional thresholds ignore channel differences up to 8, 16 or 32
  out of 255. Region buttons show their coordinates and zoom into the area.

Fit and 100% controls, incremental zoom, scrollbars and drag-to-pan keep the
viewport inspectable. View/mode/100% links can be shared, and browser Back/Forward
restores the chosen view. Comparison controls have accessible names, selected
states and visible keyboard focus.

Pixel analysis runs once in the trusted reporting job. Each pair is decoded once;
exact RGBA metrics and transparent heatmap PNGs are generated for thresholds
0, 8, 16 and 32. The default remains exact: no small changes are silently filtered.
The viewer displays those precomputed assets without canvas extraction. Browser
fingerprinting protections can perturb `getImageData` and `toDataURL`, which
previously produced browser-dependent speckles and false region outlines.
The viewer now works even when those APIs are unavailable, including downloaded
reports opened offline. Missing analysis or overlays are explicit limitations.

Nearby pixels are grouped using adjacent 8px cells, but each outline is clipped
to the actual changed-pixel bounds, not expanded to cell boundaries. The 12
largest regions get navigation buttons; every changed pixel remains highlighted
and the total number of regions is shown. Thin borders and one-pixel changes
remain detectable. Neither detection nor grouping decides whether a change is
intentional or usable.

When Pages uses the existing `gh-pages` branch root, reports are published under
`visual/runs/<capture-run-id>/` and indexed at
[the visual history](https://mattshelton04.github.io/TracePilot/visual/).
Everything outside `visual/`, including the existing `dev/` workbench, is
preserved. The current site retains the latest 20 main reports and 20 PR reports;
older commits remain in Git history and can be archived separately if storage
growth becomes material. The history explorer shows the selected view's after
screenshot for each retained commit, with main/PR and commit/date filters. Each
card opens that run's before/after viewer. Historical fixture/browser changes can
affect comparisons across runs; each individual run still uses a matched pair.
Old gallery URLs expire from the current site when their retained report is pruned.
An older rerun reserves a slot in its main/PR group during publication, so pruning
cannot immediately delete the gallery being linked by that report.

One canonical bot comment per PR identifies the exact commit, capture run and
attempt. It embeds every changed before/after pair in collapsible sections, with
a link directly to that view's highlighted regions. Large inventories are capped
below GitHub's comment limit; omitted screenshot counts and a full-gallery index
remain explicit. All 33 current cases fit inline. Artifact descriptions are
escaped and displayed as code, so their Markdown and mentions are not interpreted.

Later runs update the same comment. The publisher checks the current PR head
before and after comment pagination, rejects older capture attempts and reports,
and cleans up only duplicate comments owned by `github-actions[bot]` with this
report's marker. Issue comments have no resolved state. Rerun image URLs include
the attempt to avoid stale cached inline screenshots. Pages builds are
asynchronous, so new image URLs become available after the Pages build completes.
If Pages publication is unavailable, the comment links capture artifacts and the
downloadable standalone gallery. Captures are retained for 14 days; standalone
report artifacts for 30.

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
and downloads artifacts from that run. It never checks out PR code, installs PR
dependencies, restores PR caches, evaluates artifact scripts or publishes
artifact HTML. `npm ci --prefix scripts/visual --ignore-scripts` installs only
trusted main's isolated `pngjs` dependency using its own integrity lockfile. The extractor accepts bounded flat PNG/JSON names, rejects
symlinks/path traversal and validates screenshot dimensions. The reporter
validates every PNG chunk before decoding, accepts only bounded 1440×960
8-bit noninterlaced RGB/RGBA screenshots without ancillary metadata, rejects
duplicate headers, verifies PNG checksums, uses bounded safe case IDs for paths, escapes all
artifact text, bounds the combined inventory to 128 views, and generates its own
HTML. Embedded JSON cannot close its script element; the gallery permits only its
trusted, hash-authorized JavaScript under a Content Security Policy. History
entries are also normalized before creating paths or display data. PR numbers come from GitHub API
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
npm ci --prefix scripts/visual --ignore-scripts
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
ready. Use `features: ["sessionReplay"]` (or the required feature key) only for an
explicit experimental case; avoid enabling experimental controls across all views. Cases that need interaction use `start` for the initial ready element and
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

Open the resulting `index.html` to use all image modes, metrics and heatmaps
offline. No browser canvas extraction is needed. A local HTTP server is optional:

```sh
python -m http.server 8765 --bind 127.0.0.1 --directory .tracepilot/report
```

Then open `http://127.0.0.1:8765/index.html`. A standalone downloaded run does
not include the site's history index; the history link is available on Pages.

Run the harness, pixel-analysis, comment, escaping and artifact policy checks:

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

## First hosted validation

[Run 34684266923](https://github.com/MattShelton04/TracePilot/actions/runs/34684266923)
completed successfully on 12 September 2026 for
[PR #813](https://github.com/MattShelton04/TracePilot/pull/813). Checkout logs
confirm merge base `08b4e5e1` and exact PR head `fb2ac5eb`; later local edits are
outside this capture checkpoint.

All four Ubuntu jobs passed. Downloaded manifests contain all 33 cases exactly
once on each side, with zero failed/incomplete cases, missing fixtures or recorded
console/page errors. All 66 PNGs passed dimension and manifest SHA-256 checks.
Each runner also passed five Node harness-policy tests and two Python extraction
tests. The capture timings were:

| Revision | Shard | Cases | Capture duration |
| --- | --- | --- | --- |
| Base | 1/2 | 17 | 20.654 s |
| Base | 2/2 | 16 | 23.960 s |
| Head | 1/2 | 17 | 18.301 s |
| Head | 2/2 | 16 | 22.779 s |

Assembling those artifacts locally produced a complete gallery: **24 changed,
9 unchanged, 0 base unavailable, 0 incomplete**. Before/after Code, populated
Compare, selected Explorer and Export-preview images were inspected, as were
the head Models, Replay, Settings-pricing and Analytics captures. This checks
representative rendered content; it does not turn all manifest assertions into
manual visual review or native backend verification.

At this pre-merge checkpoint, the Linux capture and artifact-upload path were
verified, but automatic publication and PR comments were not: the publisher was
not yet on the default branch. After PR #813 merged, main run 34691740224
successfully published to the visual history linked above.


## Interactive viewer refinement validation

The matched artifacts from hosted run 34684266923 were rebuilt into the new
viewer locally. All five modes, keyboard/pointer wipe, opacity, exact/threshold
metrics, changed-region navigation, 100% zoom and pan, view filtering, browser
Back, and history view/main/PR filters passed in a separate 1440 by 960 Edge browser
with no console/page errors. Screenshots for every mode were inspected. This
reuses the historical matched pair; it does not represent a new GitHub publication.

A separate new 33-case capture using the common-user feature policy completed
in 42.062 seconds on the development Windows/Edge host. Every case was captured
with zero recorded errors or missing fixture commands. Sessions and Settings
showed Replay/SDK disabled, and the explicit Replay case enabled only Replay;
representative screenshots were inspected. These are fixture frontend checks,
not native backend proof. This checkpoint also preceded the publisher merge.


## Viewer changes and regression checks

The publisher always runs the version on `main`. A PR that changes the viewer
receives an automatic comment rendered by the current trusted publisher; its new
viewer takes effect after merge. Retained reports contain their original viewer.
To regenerate a main report (including run 34691740224) with the current
publisher, rerun its original capture workflow after merging. PR reports can
refresh only while the PR is open and its captured head is still current;
closed or superseded PR runs are intentionally skipped. Manual diagnostic
`workflow_dispatch` runs do not publish.

Run `node --test scripts/visual/*.test.mjs` and
`python scripts/visual/extract_test.py` for policy, decoding and comparison tests.
`node scripts/visual/gallery-check.mjs` checks all five comparison modes, thresholds,
region navigation, keyboard/pointer wipe controls, opacity, three desktop sizes,
missing overlays and offline loading with canvas extraction disabled. It runs once
in the unprivileged head capture job, using the installed Chromium; on Windows
use `--channel=msedge`. Pass `--report=<generated-gallery-directory>` to check a real
captured comparison. These checks do not require a Rust build or access user data.

See [the false-region investigation](reports/visual-diff-2026-09-12.md) for the
reported run, before/after evidence and measured reporting overhead.
