# Consistent visual comparisons and precise change regions

Scope: screenshot capture/reporting, its trusted CI publisher, and README discoverability.
No desktop components or capture fixtures changed in this follow-up.

Investigated [main capture 34691740224](https://mattshelton04.github.io/TracePilot/visual/runs/34691740224/),
including all 33 paired views (66 original PNGs). The reported example is
`session-conversation`, at 1440×960, dark theme, 100% app scale, populated synthetic
sessions. Comparisons below use those exact source PNGs and matching viewer state.

## Findings and resolutions

| ID | Severity and impact | Root cause | Resolution and verification |
| --- | --- | --- | --- |
| VIS-001 | Medium: browser-dependent speckles inflate metrics and distract reviewers across unrelated areas. | The old viewer extracted both screenshots with `getImageData` and exported its heatmap with `toDataURL`. Browser fingerprinting protections can perturb these APIs. | Compute exact RGBA metrics and four threshold heatmaps in trusted CI; display plain PNG assets with no canvas readback. All five modes work with extraction APIs disabled, including offline. |
| VIS-002 | Medium: region boxes imply broad changes where only small details changed. | Every changed pixel expanded to an occupied 32×32 tile; sparse adjacent cells joined into large rectangles. | Group nearby pixels in 8px cells, union actual pixel bounds, and retain all changed pixels. Tests preserve isolated one-pixel changes, a 400×1 line, and separated sparse pixels. The real conversation comparison retains its 451×1 border and 125×2 underline. |
| VIS-003 | Low: encoding-only PNG changes are incorrectly marked as visual changes. | Summary and comment classification used PNG byte hashes. | Classify paired views by exact decoded RGBA equality; retain source hashes. A regression encodes identical pixels as RGB versus RGBA and confirms an unchanged classification with an explanatory message. |
| VIS-004 | Low: screenshot history is difficult to discover from the repository landing page. | README had no link. | Add Visual history to README navigation and explain the gallery beside Screenshots, with a link to the workflow documentation. |
| VIS-005 | Medium: tiny raster variations get the same prominent PR treatment as meaningful UI changes. | Identical app source can yield a few different edge pixels in fresh browser contexts. Exact matching alone has no triage category. | Separately count sparse low-contrast differences as **subtle**, never identical. Retain all exact metrics/heatmaps and link them from the comment. At most 128 pixels may differ, with no channel delta above 8/255. High-contrast single pixels and extended low-contrast changes remain normal review changes. |

### Reproduction and evidence

1. Open the linked run, select `session-conversation`, choose Difference and Exact (0).
2. Clean Edge and independent Pillow decoding agree: **3,039 changed pixels**,
   bounds **20,22 · 1392×246**. The source PNGs do not contain the scattered changes
   across the conversation background shown in the reported screenshot.
3. For a controlled reproduction, perturb 650 deterministic scattered red-channel
   samples by one bit per `getImageData` call. The old viewer reports **4,335 pixels**
   and bounds **2,0 · 1438×959**, creating broad false regions. This simulates the
   failure mechanism, not a particular browser's algorithm. The user's browser and
   exact privacy setting were not established.
4. Under the same perturbation, the corrected viewer reads no canvas pixels and
   reports the original **3,039 pixels**, with ten tight regions. No detection
   threshold was raised and no application area was masked.

[Brave documents canvas output randomization](https://brave.com/privacy-updates/4-fingerprinting-defenses-2.0/),
including the two APIs used by the original viewer. This supports the inferred
cause of the user's extra speckles; the controlled failure and fix were reproduced
independently of the user's browser configuration.

**Before: old viewer with simulated canvas noise.**

![Old viewer with reproduced false regions](visual-diff-evidence/before-simulated-noise.png)

**After: same source PNGs and perturbation, precomputed comparison.**

![Corrected viewer preserves actual changes](visual-diff-evidence/after-simulated-noise.png)

Both screenshots were opened and inspected before committing. They contain only
public synthetic CI fixtures. The user-supplied screenshot, downloaded run artifacts,
local scripts and raw evidence remain in ignored local storage.

## Validation and limits

- All 66 original PNGs safely decode. Their pixels produce **23 changed views,
  10 identical views, zero incomplete views and zero missing bases**. These 23
  comparisons contain real differences; this fix removes spurious regions rather
  than suppressing the previous usability changes.
- 24 Node regression tests and two Python extractor tests pass. PNG tests reject
  truncated/corrupt input, duplicate headers, unsupported color metadata, interlace,
  invalid dimensions and unsupported depth before accepting a comparison.
- Browser regression passes against both a generated one-pixel case and the
  actual reported conversation pair: side-by-side, toggle, wipe with pointer and
  keyboard, opacity, all four thresholds, region navigation and zoom, 1440×960,
  960×640 and 2560×1440, offline file loading, and explicit missing-overlay feedback.
  Canvas extraction is disabled throughout; successful workflows have no page errors.
- Independent read-only review found no blocking implementation issues and
  independently reproduced the 3,039-pixel count from the downloaded PNGs.
- Regenerating the complete 33-view report locally took **11.34 seconds**, versus
  0.14 seconds for the old HTML-only report. Each pair is decoded once; thresholds
  run sequentially, and unchanged pairs need no heatmap assets. The browser regression
  took about **2.5 seconds**. These measurements exclude installation and upload;
  hosted timings may differ. Four capture runners remain parallel; the browser check
  runs only once. No Rust build or additional browser installation is added.
- The publisher installs only one pinned decoder from its own trusted-main lockfile,
  with lifecycle scripts disabled. It never installs PR dependencies or consumes PR
  caches. PNGs are bounded before decoding; invalid inputs are explicit limitations.
- This is report/CI verification, not native app verification. No app behavior changed.
  New publisher code becomes active after merge. Historical reports keep their
  original viewer. The linked main report can be regenerated by rerunning its
  original capture workflow after merge; closed or superseded PR reports cannot
  be republished by rerunning because the publisher rejects stale PR heads.

## Hosted follow-up: persistent tiny raster differences

The automatic comment was created by `github-actions[bot]` on
[PR #814](https://github.com/MattShelton04/TracePilot/pull/814#issuecomment-5645820725)
and updated in place for later commits. The linked viewer was published to Pages.
Its code comes from the current `main`, so this PR's new classification becomes
active after merge; the checks below rebuilt actual hosted artifacts locally.

| Hosted experiment | Paired views | Tiny differing views | Result |
| --- | --- | --- | --- |
| [Initial PR run 34693099275](https://github.com/MattShelton04/TracePilot/actions/runs/34693099275) | 33 | 7 | No app-source changes; 3–24 pixels per affected view, all channel deltas ≤1/255. |
| [Consecutive frames 34693422653](https://github.com/MattShelton04/TracePilot/actions/runs/34693422653) | 33 | 5 | Every view accepted two matching frames, but fresh contexts still differed; settling alone did not solve it. |
| [Software rasterization 34693572374](https://github.com/MattShelton04/TracePilot/actions/runs/34693572374) | 33 | 7 | Disabling GPU/Skia CPU optimizations did not solve it. Those ineffective flags were removed. |

The exact low-level rendering cause is not established. Both logo raster variants
occur within one runner, so it cannot be attributed solely to differing hosts.
Persistent small edge variations are handled transparently rather than promising
cross-context bit-identical rendering or weakening exact comparison.

Rebuilding the initial PR's 66 PNGs with the corrected reporter produces
**0 review changes, 7 subtle views, 26 identical, zero limitations** in 3.49 seconds.
The original user's main report still produces **23 review changes, zero subtle,
10 identical**. The new category therefore separates the reproduced small
variations without suppressing those usability changes. The original PR's
Conversation retains its 11 exact changed pixels and one tight 19×3 region.

![Subtle differences retain exact evidence](visual-diff-evidence/subtle-differences.png)

The browser check exercises subtle filtering, initial selection of a subtle view
when no larger differences exist, and exact inspection. Screenshot settling remains
as a bounded guard against unstable frames, not as a claimed fix for persistent
raster variation. Hosted shard capture times in these runs ranged from 19.12 to
28.80 seconds; the four runners remain parallel.
