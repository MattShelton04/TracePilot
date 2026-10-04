# TracePilot landing page

The [website](https://mattshelton04.github.io/TracePilot/) lives in the top-level
[`site/`](../site/package.json) workspace package (`@tracepilot/site`). It is a
Vite multi-page build using vanilla ES modules: the landing page and the
full-screen interactive replica at `demo/`. It follows the approved prototype D.
The replicas use showcase data and run entirely in the browser.

## Run and verify

From the repository root, with Node 22 and pnpm 10 installed:

```powershell
pnpm install
pnpm site:dev
```

Development uses port 5180. Both dev and build generate the showcase and release
data first. To check the production build:

```powershell
pnpm site:build
pnpm --filter @tracepilot/site exec playwright install chromium
pnpm site:check
pnpm --filter @tracepilot/site test
node --test scripts/site/*.test.mjs
```

`site:check` starts and stops its own Vite preview on port 4187. It checks
1440×960 first, then 960×640, 2560×1440, 390×844 and 1440×960 with reduced
motion. It covers both pages for console/page errors, failed or cross-origin
requests (other than the analytics beacon), HTTP errors and overflow; checks
the beacon is present exactly when `CF_BEACON_TOKEN` is set; verifies five desktop pins and no mobile or
reduced-motion pins; exercises dialog focus/Escape, the Search demo step and
wheel cancellation of the tour. Reduced motion keeps the hero visible and
disables the tour. It saves 50 section screenshots in ignored `site/.check/`.
Review these images when changing layout or choreography.

The `site` thresholds in [`perf-budget.json`](../perf-budget.json) enforce
gzipped JS, CSS and generated data sizes. They were set from the first build
with about 10% headroom: 142, 37 and 14 KiB respectively. Keep budget changes
supported by measured output.

For a manual production preview, run `pnpm --filter @tracepilot/site preview`
(port 4180). Regenerate the committed 1200×630 social image after hero changes:

```powershell
pnpm site:build
pnpm --filter @tracepilot/site og
pnpm site:build
```

The generator uses port 4188 and hides navigation and the version label so the
image can survive release updates. Inspect `site/public/og.png` before committing.
The browser scripts fail if their preview port is occupied.

## Architecture and view ownership

| Source | Responsibility |
| --- | --- |
| `index.html` boot script, `src/main.js`, `src/demo.js` | Page entry points. The inline boot script sets the layout-mode classes before first paint; the landing page wires after fonts are ready and reloads when the pinning breakpoint changes. |
| `src/data.js`, `src/lib/` | Generated showcase/release imports, illustrative agent usage, formatting, asset URLs and shared GSAP plugins. |
| `src/motion/` | Environment, stage sizing, one module per pinned scene, branch geometry, mobile frames, lazy demo, tour and ancillary motion. |
| `src/traces/` | Hero canvas, fixed signal rail, SVG branch layer and final eye convergence. |
| `src/app-views/` | Window renderers tailored to the five scrubbed scroll scenes. |
| `src/bento/` | Ten analytics tiles, entrance/replay choreography, explanations and accessible dialogs. |
| `src/replica/` | `TPReplica` core, view renderers and transition/intro/demo/step mixins; shared by the inline demo, full-screen demo and mobile frames. |
| `src/styles/` | Canonical app tokens plus site, mock, bento, replica and demo styling. |
| `scripts/` | Data export/validation, release selection, HTML facts/CSP, tests, browser checks, preview lifecycle and OG generation. |

The replicas are maintained separately from the Vue app. Substantial changes to
these app views should update the matching site renderers and check screenshots:

| Site modules (under `site/src/`) | App source (under `apps/desktop/src/`) |
| --- | --- |
| `app-views/open.js`, `shell.js`; `replica/views-session.js` | `views/SessionListView.vue`, `SessionDetailView.vue`, `views/tabs/OverviewTab.vue` |
| `app-views/convo.js`; `replica/views-session.js` | `views/tabs/ConversationTab.vue`, `components/conversation/` |
| `app-views/agents.js`; `replica/views-timeline.js`, `views-sequence.js` | `views/SessionTimelineView.vue`, `components/timeline/AgentTreeView.vue`, `AgentMessagesView.vue` |
| `app-views/context.js`; `replica/views-context.js`, `views-todos.js` | `views/tabs/ContextTab.vue`, `MetricsTab.vue`, `components/context/ContextWindowChart.vue` |
| `app-views/launch.js`; `replica/views-pages.js` | `views/orchestration/SessionLauncherView.vue` |
| `replica/views-todos.js` | `views/tabs/TodosTab.vue`, `components/TodoDependencyGraph.vue` |
| `replica/views-pages.js`, `views-context.js`; `bento/build.js` | `views/SessionSearchView.vue`, `views/tabs/ExplorerTab.vue`, `views/ExportView.vue` |
| `replica/views-misc.js` | `views/orchestration/WorktreeManagerView.vue`, `views/agents/AgentsManagerView.vue` |
| `replica/views-analytics.js`, `views-misc.js`; `bento/build.js` | `views/AnalyticsDashboardView.vue`, `ToolAnalysisView.vue`, `CodeImpactView.vue`, `ModelComparisonView.vue`, `SessionComparisonView.vue`, `views/skills/SkillsManagerView.vue`, `views/agents/AgentsManagerView.vue` |

### Rail and branch geometry

The six agent-coloured signal lines live in `traces/rail.js`. The rail appears
at widths of at least 1180px when there is room beside the content. Scrubbed
scenes use a 1280px app layout scaled by the window's `__s` factor.

`motion/branches.js` computes geometry from live layout rather than hardcoded
screen positions. `appPoint(app, scene, element, fx, fy)` finds an element in
app layout space, applies `__s`, then converts it into scene coordinates using
the window and scene rectangles. This keeps endpoints stable while the app
contents animate. `layoutBranches()` rebuilds conversation-card, agent-tree
and context-chart connections when layout changes. `elbow()` creates a rounded
SVG path from a rail line to its target; `branchLayer()` stores path lengths
and controls draw progress and travelling dots. Scene timelines update
`branchState`, and `applyBranches()` applies progress/fades. Branches clear
when pinning or the rail is disabled and fade out when their scene ends.

## Data and assets

[`export-data.mjs`](../site/scripts/export-data.mjs) imports the README showcase
fixtures in `scripts/visual/showcase/` and the app's pricing functions from
`@tracepilot/types`. It writes ignored `site/src/data/showcase.json`, including
derived AI Credits/USD, compaction values, todo counts and agent-turn data.
[`validate-data.mjs`](../site/scripts/validate-data.mjs) fails with field names
when the fixtures no longer match the renderers. The unit-test command exports
fresh fixtures so validation tests also run on a clean checkout.

[`release-data.mjs`](../site/scripts/release-data.mjs) reads GitHub's latest
published release at build time, using `GITHUB_TOKEN` in CI. It prefers the
`*_x64-setup.exe` NSIS installer and falls back to MSI, excluding the standalone
binary. API failure falls back to the root package version and the releases
page with a warning. Local release data is cached for six hours; use
`pnpm --filter @tracepilot/site exec node scripts/release-data.mjs --refresh`
to refresh it. CI always refreshes. The page makes no runtime API calls; its
only runtime request is the analytics beacon below.

The Vite HTML plugin fills `__placeholders__` from those files and rejects
unknown keys. `src/data.js` imports the same data for interactive views. Agent
definition usage in `AGENT_RUNS` is illustrative because the showcase fixtures
do not model cross-session agent statistics; those values require manual upkeep.

Inter and JetBrains Mono are self-hosted via Fontsource; logos come from
`assets/`; tokens are imported from `@tracepilot/ui/tokens.css`. Fonts stay
external files because the build CSP allows only `font-src 'self'`. The CSP
also limits scripts to self, blocks connections and allows inline styles for
GSAP. The development CSP allows the HMR websocket. Both pages include SEO and
social tags. Relative asset URLs (`base: './'`) work under `/TracePilot/`.
`robots.txt` at the project path does not control the host's root crawler rules.
See the [dependency inventory](dependencies/javascript.md#sitepackagejson)
for the GSAP licence and the site's direct dependencies.

### Analytics

Visits are counted with [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/)
(cookieless; page views, referrers, countries, devices and Core Web Vitals) using
its manual snippet, registered for the `mattshelton04.github.io` host. The
`analyticsBeacon()` Vite plugin adds the beacon to both pages only when a build
runs with `CF_BEACON_TOKEN`, which the Site workflow sets for every CI build;
local builds, previews and the dev server never load it. The same flag adds
`https://static.cloudflareinsights.com` to `script-src` and replaces
`connect-src 'none'` with `https://cloudflareinsights.com`. The token is public
(it ships in the page) and must be 32 hex characters. `site:check` serves an
empty stub in place of the beacon, so CI never reports visits. Ad-blockers block
the beacon, so treat counts as trends. View the data in the Cloudflare dashboard
under Analytics & Logs → Web Analytics.

## Publishing and updates

[`Site`](../.github/workflows/site.yml) builds/checks matching PRs and pushes to
main, successful `Release` workflow completions, and manual dispatches. Release
publication uses `GITHUB_TOKEN`, so a `release: published` trigger would not
start this workflow. The read-only build job installs dependencies and Chromium,
runs both test suites and browser checks, then uploads `site-dist` (7 days) and
check screenshots (14 days, including failed checks).

Only non-PR main runs can deploy. The write-permission job checks out the default
branch, runs the publisher tests, downloads this run's build and publishes it.
It records the actual build revision in the publish commit. PR code never runs
in that job. Actions are pinned to full SHAs.

[`scripts/site/publish.mjs`](../scripts/site/publish.mjs) verifies Pages still
uses the **`gh-pages` branch root**, then fetches it into a temporary detached
worktree. `.site-manifest.json` records owned files. The publisher removes
stale owned files, copies new files, stages only owned paths and the manifest,
and commits as `github-actions[bot]`. It refuses reserved paths (`visual/`,
`dev/`, `.nojekyll`, `README.md`, `.git` and the manifest itself), unsafe paths,
symlinks, unowned-file overwrites and file/directory collisions. An unchanged
build creates no commit. A rejected push gets up to three retries, each fetching
and reapplying on the new branch tip; successful pushes request a Pages build.

The deploy job shares `visual-gallery-publish`, `queue: max`, and
`cancel-in-progress: false` with the visual publisher. PR builds have separate
concurrency. Preserve the Pages branch source; switching to `actions/deploy-pages`
would replace the shared content. Existing `visual/`, `dev/bench/`, `.nojekyll`
and `README.md` remain owned by their current publishers. No root `404.html`
is supplied because it would affect gallery misses too.

| Change | How the site updates |
| --- | --- |
| Published release | Successful `Release` completion triggers a rebuild with the latest version and installer. |
| Showcase fixtures or shared pricing/types | Matching main push rebuilds figures/charts; incompatible fixture shapes fail validation. |
| App tokens or assets | Matching main push rebuilds the directly imported assets. |
| Site source, build configuration or budgets | PR build/check artifacts support review; merging to main deploys. |
| App view layout | Manual renderer updates using the view map above, reviewed through screenshots. |
| Illustrative agent-definition usage | Manual update to `AGENT_RUNS` in `src/data.js`. |
| Concurrent visual publication | Shared deploy concurrency and fetch/reapply retries preserve both publishers' changes. |
| Manual refresh | Dispatch the Site workflow on main. |

After merge, the first live verification requires checking the root, `demo/`,
`visual/`, `dev/bench/` and `.site-manifest.json`, then publishing the same build
again to confirm no extra commit. Perform the initial manual dispatch with the
maintainer's approval.

### Load path

The first viewport must not wait for the script bundle:

1. The inline boot script at the top of `<body>` adds `motion`/`pin` (the same
   media queries as `motion/env.js`) and adds `fonts` once Inter and JetBrains
   Mono load, capped at 1.2s. Its SHA-256 is added to `script-src` by the Vite
   plugin (`inlineScriptHashes` in `scripts/html-facts.mjs`), so editing it
   needs no CSP change. Builds preload the first-paint fonts.
2. The hero copy enters in CSS keyed off `.fonts` ("Hero entrance" in
   `site.css`), so it runs on the compositor while the page wires.
3. `wire()` runs one frame later and yields between steps: one app window and
   scene timeline per task (`.ready` after the first lets the window rise in),
   then all pins together, bento, and the rest. Nothing builds at import time.

`#open` sits in a static `.scene-spacer` passed to ScrollTrigger as
`pinSpacer`. A generated spacer re-inserts the scene on creation and every
refresh, which would restart the CSS hero entrance. The other scenes keep
generated spacers: native ones there made Chrome report a phantom
full-viewport layout shift (CLS 1.0). Pinned scenes keep an explicit
`width: 100%` because a spacer copies the scene's `display: flex`.
Measure load changes with a throttled profile (4x CPU, ~1.6 Mbps) as well as
unthrottled: check when the hero becomes visible, long tasks, and that nothing
flashes or blanks.

### Navigation and tour

Once scrolled past, a pinned scene sits at the end of its spacer, so a native
anchor jump would land a whole scene late. In-page links to pinned scenes use
`anchorY()` (`motion/anchors.js`), which returns the pin start or a scene's
`anchor` label (the hero marks where the library is in view); deep links are
re-resolved after pinning. `#top` relies on the browser's document-top
behaviour, so no element may use that id.

The tour starts wherever the page is. Its bar shows progress through the whole
page with a tick per chapter; previous/next jump between chapter starts
(previous restarts the current chapter once it has shown for 3 s, otherwise
goes back one) and speed cycles 1×, 1.5×, 2×, 0.5×. Wheel, touch, keys and
clicks outside the pill stop it. It ends on the demo section with the "Now take
the controls" heading in view (`demoIntroTop()`), not on the demo toolbar.

Phone frames play when the whole frame is in view. A run cut short by
scrolling away resets and replays on return. Timed animations register in
`motion/holds.js` while they run; the tour centres a held frame and waits for
it (plus a beat) before scrolling on, since only the desktop scenes are
scrubbed by scroll. Replica steps whose panel is
taller than the window (`SCROLLED` in `replica/steps.js`) scroll the tabs to
the top, both when played and in reduced-motion end states.

## Design and motion rules

- Keep the approved dark, precise instrument aesthetic and the narrative from
  session library through parallel agents, context, analytics, launch and privacy.
  Copy names concrete product behaviour; colour encodes agent identity or state.
- Reuse app tokens and DOM replicas so views remain sharp across viewport sizes.
  Preserve namespaced `.sig-rail` and `.sig-branch` classes to avoid app collisions.
- Scroll controls the five desktop scenes and can reverse them. Each scene has
  one focal motion: expansion for drill-in, fan-out for parallel agents, line
  drawing for messages and chart filling for accumulation.
- Keep supporting movement quiet. Prefer transforms/opacity; entrances are
  roughly 400–700ms and UI feedback 120–200ms. Springs belong to small completion
  indicators. Trace canvases pause offscreen and cap DPR at 1.5.
- Below 900px, remove pins and show collapsed replica frames. Reduced motion
  disables the tour/pinning and renders final states while keeping the hero visible.
- Preserve the skip link, keyboard controls, dialog focus trap, Escape and focus
  return. Keep the GitHub affiliation disclaimer and avoid adding claims or
  disclaimers beyond the approved copy.

## Troubleshooting

| Symptom | Check/fix |
| --- | --- |
| Fixture validation fails | Follow the listed field names; update fixtures or the corresponding view and HTML facts. |
| Release version looks stale | Refresh the six-hour cache; check API warnings and installer selection. |
| Missing generated JSON | Use `site:build` or `site:dev`, which run data generation before Vite. |
| CSP font errors | Keep font files uninlined and local; check `assetsInlineLimit` in Vite configuration. |
| Browser executable missing | Install Chromium with the site Playwright command above. CI uses `--with-deps`. |
| Preview exits or port is busy | Stop the known preview owner or free port 4187/4188; the scripts will not attach to another server. |
| Pins/branches misplaced after resize | Check breakpoint reload, stage scale, font readiness and `layoutBranches()`. |
| Hero flashes, blanks or replays on load | Check the boot script classes, the CSS entrance selectors and that pinned scenes still pins inside its `.scene-spacer`; measure CLS after pinning changes. |
| CSP blocks an inline script | Keep inline scripts classic and without `src`; the build hashes them. Rebuild after editing. |
| A nav link lands mid-scene | Route it through `anchorY()`; pinned scenes need the pin start, not their live position. |
| Publisher refuses ownership/source | Inspect the manifest or collision; keep foreign content intact and restore the expected Pages source only through a maintainer decision. |
| Push rejected repeatedly | Check competing publishers and shared concurrency, then rerun; the publisher never force-pushes. |
| Beacon check fails or no visits recorded | Rebuild with the same `CF_BEACON_TOKEN` you check with; confirm the token matches the dashboard site and the built CSP lists both Cloudflare hosts. |
| Site size budget exceeded | Inspect built assets and measured gzip totals; raise thresholds only with an explained measurement. |
