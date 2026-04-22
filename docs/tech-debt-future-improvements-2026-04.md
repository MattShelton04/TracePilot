# Future Improvements — Identified During Tech-Debt Waves (2026-04)

This document collects **candidate improvements** spotted by sub-agents while
executing the `tech-debt-master-plan-2026-04.md` waves. Items here are
intentionally **not** applied in the current wave — they may be breaking,
out-of-scope, require product input, or warrant dedicated design work.

## How to add an entry

Append a new `###` section under the relevant wave. Keep entries short and
actionable so a future engineer can pick them up.

### Template

```
### w<NN> — <short title>

- **Area**: <file / module / layer>
- **Observation**: <what's suboptimal today>
- **Proposed change**: <what to do>
- **Risk / why deferred**: <breaking? scope? product decision? design?>
- **Effort**: S / M / L
```

---

## Entries

<!-- Sub-agents append below this line, newest wave last. -->

### w75 — SearchPalette Tab focus-trap selector is stale

- **Area**: `apps/desktop/src/components/SearchPalette.vue` (`handlePaletteKeydown`, `case "Tab"`)
- **Observation**: The focus-trap uses `(e.target as HTMLElement).closest(".palette-dialog")` to find the dialog, but the template's root modal element has class `.palette-modal`, not `.palette-dialog`. The closest call therefore always returns `null`, so the `Tab` handler short-circuits and relies on native browser tabbing with no trap — inputs inside the palette can hand focus back to elements behind the backdrop.
- **Proposed change**: Replace the literal with `.palette-modal` (or use the existing `modalRef` directly), and add a small Vitest to assert Tab cycles focus between the input and clear button when a query is present.
- **Risk / why deferred**: Wave 75 is strict zero-behaviour-change decomposition; fixing the trap changes keyboard behaviour. Also the current broken state has existed for many waves without a reported a11y bug, so scope it properly.
- **Effort**: S

### w75 — `useSearchPaletteSearch` leaks raw `results`

- **Area**: `apps/desktop/src/composables/useSearchPaletteSearch.ts`
- **Observation**: The composable returns both `results` (raw ref) and derived `groupedResults` / `flatResults`. Only the derived forms are read by the palette today, but `results` is still exported and `uniqueSessionCount()` reaches into it. This makes the public surface ambiguous — future callers might mutate `results` directly and bypass the generation-id guard in `executeSearch`.
- **Proposed change**: Drop `results` from the returned object; reroute `uniqueSessionCount()` through `flatResults`; mark the internal ref `private` by keeping it inside the closure.
- **Risk / why deferred**: Tiny API change but feels like follow-up polish rather than wave 75 scope; no behaviour change without it.
- **Effort**: S

### w75 — Wizard step shared styles rely on sibling-file convention

- **Area**: `apps/desktop/src/components/wizard/wizard-shared.css`, `wizard-form.css`
- **Observation**: Shared wizard step styles (`.slide`, `.slide-content`, `.btn-accent`, `.spinner`, form fields) were pulled into sibling `.css` files imported via `<style scoped src="...">` so scoping is applied per-child. This works but is the first use of that pattern in `apps/desktop` — future contributors may not recognise why the rules live outside the SFC.
- **Proposed change**: Either convert the shared styles into a proper CSS Module (`*.module.css` + typed import) so class bindings are explicit, OR promote the wizard step buttons/inputs into a small `WizardButton.vue` / `WizardPathInput.vue` reusable pair.
- **Risk / why deferred**: Cosmetic / organisational; neither option avoids duplication better than the current setup and both would touch all five `WizardStep*.vue` components.
- **Effort**: M

### w75 — `SearchPaletteResults` prop surface is bloated

- **Area**: `apps/desktop/src/components/search/SearchPaletteResults.vue`
- **Observation**: The child takes 8 props (`groupedResults`, `flatResults`, `selectedIndex`, `loading`, `hasQuery`, `hasResults`, `searchError`, `query`). Five of those are trivially derivable from the other three inside the child. The wide surface exists only because the composable's computed refs are passed individually rather than as a single object.
- **Proposed change**: Either (a) pass the composable's return value as a single reactive prop, or (b) inject the composable via `provide`/`inject` at the palette root so the results child can consume it directly and the parent keeps only presentation glue.
- **Risk / why deferred**: Refactor worth doing but adds a new provide/inject key or prop-object convention; better tackled alongside the `useSearchPaletteSearch` API cleanup above.
- **Effort**: S


### w76 — Analytics dashboard tooltip context is prop-drilled

- **Area**: `apps/desktop/src/views/AnalyticsDashboardView.vue` and every `components/analytics/Analytics*Row.vue` child
- **Observation**: The parent creates `useChartTooltip` once and forwards `tooltip`, `onChartMouseMove`, `onChartClick`, `dismissTooltip` to four separate row components. Each chart row declares the same four props plus `chartLayout` / `gridLines` / `timeRangeLabel`. The prop surface is wide and repetitive, and adding a new chart means threading another six-prop passthrough.
- **Proposed change**: Expose the tooltip + chart-layout context via `provide`/`inject` from the dashboard root (e.g. an `analyticsChartContext` symbol with typed accessor), so each row only consumes `:data` and calls `useAnalyticsChartContext()` internally.
- **Risk / why deferred**: Introduces a new injection key / composable contract across an otherwise-plain component tree. Out of scope for the strict decomposition pass; should be paired with similar plumbing in `ToolAnalysisView` / `CodeImpactView` for consistency.
- **Effort**: M

### w76 — `AnalyticsDistributionRow` mixes donut state with cost-trend chart

- **Area**: `apps/desktop/src/components/analytics/AnalyticsDistributionRow.vue`
- **Observation**: This 231-line child bundles the model-distribution donut (`donutSegments`, `hoveredDonut`, `activeDonutSegment` and watcher) *and* the cost-trend `LineAreaChart`. They are only grouped because the original template placed them in a `grid-2` row — there is no shared state. The mixed concerns keep the file near the child budget and hide the donut state machine inside a presentation component.
- **Proposed change**: Split into `AnalyticsModelDonut.vue` (owns hover state via a `useDonutHover` composable) and `AnalyticsCostTrendChart.vue`; let the parent lay out the row with plain CSS grid.
- **Risk / why deferred**: Zero-behaviour-change wave — the donut hover watch-clear interacts with the currently-in-flight `modelDistribution` reference, and extracting it risks subtly changing when `hoveredDonut` is reset. Warrants a follow-up pass with a small unit test for the composable.
- **Effort**: S

### w76 — Sankey layout constants are not reactively typed

- **Area**: `apps/desktop/src/composables/useSankeyLayout.ts` (`SANKEY_LAYOUT`, `SANKEY_COLORS`) and `components/tokenFlow/TokenFlowSankey.vue`
- **Observation**: `SANKEY_LAYOUT` is a module-scoped `const` that is re-exported and consumed by both the composable and the child SVG. `SANKEY_COLORS` is built from `getChartColors()` at import time, which means theme changes (if the app ever adds runtime theme switching that rebuilds tokens) won't propagate into the sankey legend colours until a full reload. Also the child currently destructures from the constant instead of receiving it as a prop / inject, tightly coupling the two files.
- **Proposed change**: Introduce a `useSankeyTheme()` composable that reads `getChartColors()` reactively (or via the existing design-token provider) and have both the layout composable and the SVG child consume it. Pass layout constants into the child as a prop so the SVG does not import from a composables file.
- **Risk / why deferred**: Desktop theme currently doesn't re-emit tokens at runtime, so no observable bug today; change is pure decoupling and belongs in a theming pass.
- **Effort**: M

### w76 — `MetricsSessionActivity` still holds 350+ LOC including heavy segment helpers

- **Area**: `apps/desktop/src/components/metrics/MetricsSessionActivity.vue` (`segmentCopilotCost`, `segmentWholesaleCost`, `sortedSegmentModels`, `segmentDurationMs` + 200 LOC of scoped CSS)
- **Observation**: The session-activity tile is the largest child at 360 LOC and bundles four pure helper functions, a large style block, and the activity card template. The helpers are not reused but will be if we ever add a vertical/compact activity view.
- **Proposed change**: Extract `composables/useSessionSegmentStats.ts` for the four segment-level helpers (pure functions taking `SessionSegment` + `prefs`) and split the card into an `ActivityTile.vue` child, leaving `MetricsSessionActivity.vue` as a thin list renderer.
- **Risk / why deferred**: Straight extraction but expands the wave scope; the component already fits under the 400-LOC child budget.
- **Effort**: S

### w76 — `MetricsModelTable` column definitions could be exported as a constant

- **Area**: `apps/desktop/src/components/metrics/MetricsModelTable.vue`
- **Observation**: The `modelColumns` computed rebuilds an array of column specs based on `hasReasoningData`. The `class: "hidden lg:table-cell"` strings and the responsive rules are duplicated across multiple DataTable consumers (model comparison view, metrics, session compare). The `as (typeof cols)[number]` casts are also a code smell hinting the column type is not properly modelled.
- **Proposed change**: Promote a `MetricsTableColumn` type / factory in `packages/ui` (or `apps/desktop/src/utils`), with a builder like `modelColumns({ reasoning: boolean })`, and share it with `ModelComparisonView`.
- **Risk / why deferred**: Cross-view refactor; DataTable's column typing may need widening in `packages/ui`.
- **Effort**: M

### w76 — `SANKEY_COLORS` palette duplicates `DONUT_PALETTE` / `CHART_COLORS` semantics

- **Area**: `apps/desktop/src/composables/useSankeyLayout.ts` (`SANKEY_COLORS`) vs `apps/desktop/src/utils/chartColors.ts` (`CHART_COLORS`, `DONUT_PALETTE`) and `apps/desktop/src/utils/designTokens.ts`
- **Observation**: The sankey palette is a bespoke `{ emerald, amber, violet, neutral, indigo, rose }` mapping built from `getChartColors()` + `getSemanticColors()`. The analytics donut uses `DONUT_PALETTE`; other charts use `CHART_COLORS`. Three separate palette shapes exist over the same underlying design tokens, which makes it hard to keep model colour-coding consistent between the sankey's `sankeyModelColor` heuristic and the donut legend.
- **Proposed change**: Introduce a single `chartPalettes.ts` that exports named semantic palettes (`semantic`, `donut`, `sankey`) derived from one source of truth; rewrite `sankeyModelColor` to consume the semantic palette by role rather than by colour name.
- **Risk / why deferred**: Visual-regression risk — model colours are load-bearing in the sankey hover state. Needs a snapshot test pass before consolidating.
- **Effort**: M
