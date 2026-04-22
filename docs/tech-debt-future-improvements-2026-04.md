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

### w77 — PresetDetailSlideover teleport styles live in an unscoped sibling .css

- **Area**: `apps/desktop/src/components/tasks/presetDetail/preset-detail.css` (imported via `<style src>` from `PresetDetailSlideover.vue`)
- **Observation**: The decomposed slideover re-teleports to `<body>`, so styles were extracted to a sibling `.css` imported unscoped (preserving the original selectors like `.preset-slideover .badge--type`). The per-child `<style scoped>` convention is therefore deliberately skipped for this tree. Class names are unique to the slideover today, but that's only enforced by convention — a future contributor adding `.badge` or `.tag-pill` elsewhere in `apps/desktop` could get accidental style bleed.
- **Proposed change**: Either (a) migrate the slideover markup out of `Teleport` and into a normal stacking context so scoped styles work per-child, or (b) prefix every selector in `preset-detail.css` with `.preset-slideover` (currently only the badge/btn/tag-pill rules are qualified) so the unscoped file can't leak if class names are reused.
- **Risk / why deferred**: (a) changes z-index / click-outside / a11y semantics; (b) is mechanical but still a non-trivial CSS rewrite and unrelated to the decomposition itself.
- **Effort**: S (option b) / M (option a)

### w77 — PresetDetailSection generic wrapper has no default slot typing

- **Area**: `apps/desktop/src/components/tasks/presetDetail/PresetDetailSection.vue`
- **Observation**: The shared collapsible wrapper exposes a `title: string` prop plus `expanded: boolean` and a `toggle` event, but the default slot is untyped. Four siblings (`PresetPromptSection`, `PresetContextSection`, `PresetOutputSection`, `PresetExecutionSection`) all pass literal emoji-prefixed titles and render their own body content inside — none share markup across sections. A weakly-typed slot means future section additions won't get compiler help when section contracts evolve.
- **Proposed change**: Add a `<slots>` JSDoc block or `defineSlots<{ default: () => VNode[] }>()`; consider turning the icon prefix into a dedicated `icon` prop/slot so the four sibling components stop hard-coding emoji in their titles (design-system consistency).
- **Risk / why deferred**: Pure polish; no behaviour change in the wave.
- **Effort**: S

### w77 — PresetDetailSlideover props still allow a `null` preset

- **Area**: `apps/desktop/src/components/tasks/PresetDetailSlideover.vue` (public prop surface)
- **Observation**: The parent keeps the original `preset: TaskPreset | null` + `visible: boolean` prop shape for zero-behaviour-change, but the children (`PresetDetailHeader`, `Preset*Section`, `PresetDetailFooter`) require a non-null `preset`. The parent narrows via `v-if="visible && preset"`, but the double-gated state is awkward and `visible=true, preset=null` is representable but meaningless.
- **Proposed change**: Collapse the two props into a single `preset: TaskPreset | null` where `null` means "hidden"; update `PresetManagerView.vue` to stop passing `visible` separately and rely on presence of the preset.
- **Risk / why deferred**: Touches `PresetManagerView.vue` and the `usePresetManager` composable (which drives `showDetail`/`detailPreset`). Out of scope for a pure decomposition wave.
- **Effort**: S

### w79 — `BridgeConnectConfig::cli_url` still stringly-typed

- **Area**: `crates/tracepilot-orchestrator/src/bridge/mod.rs` (`BridgeConnectConfig`)
- **Observation**: Wave 79 introduced `ConnectionMode { Stdio, Tcp }` internally but the *input* config `BridgeConnectConfig` still uses `cli_url: Option<String>` as the implicit mode selector. The master plan (w79) envisaged `ConnectionMode { Stdio, Tcp { url: String } }` carrying the URL in the `Tcp` variant; that was deferred to keep the IPC shape (and FE callsites in `apps/desktop/src/stores/sdk/**`) untouched this wave.
- **Proposed change**: Add a `connection_mode: Option<ConnectionMode>` input field (with URL payload on `Tcp`) and migrate callers; retain `cli_url` as a `#[serde(alias)]`-ed compatibility shim for one release, then drop.
- **Risk / why deferred**: Changes the IPC input DTO — must land alongside coordinated FE changes (`connection.ts`, `SettingsSdk.vue`, `useAddServerForm.ts` doesn't apply but sdk bridge store does). Out of scope for a zero-wire-change wave.
- **Effort**: M

### w79 — `McpTransport` wire value is `"http"` but TS type still lists `"streamable-http"`

- **Area**: `packages/types/src/mcp.ts` (`McpTransport`) vs `crates/tracepilot-orchestrator/src/mcp/types.rs` (`McpTransport`)
- **Observation**: The Rust enum serialises as `"http"` and accepts `"streamable-http"` / `"streamable"` / `"local"` only as deserialisation aliases. The TS union, however, still enumerates every historical spelling as if they were equal first-class values. New TS code can therefore assign `"streamable-http"` to fields that the backend will echo back as `"http"`, causing needless branching (e.g. `McpServerDetailConnection.vue`, `useAddServerForm.ts` both fan out on all three).
- **Proposed change**: Narrow the TS union to `"stdio" | "sse" | "http"`, add a one-shot normaliser at the IPC boundary for the aliases, and drop the legacy branches in the FE. Coordinate with any persisted user config that may still contain the old spelling (migration on read).
- **Risk / why deferred**: Behavioural change at the boundary; needs a config-migration check and touches many Vue files. w79 is strict zero-FE-schema-change.
- **Effort**: M


### w77 — McpAddServerModal form reactive is passed as a prop and mutated in children

- **Area**: `apps/desktop/src/components/mcp/addServer/AddServerBasicFields.vue`, `AddServerEnvPairs.vue`, `AddServerAdvanced.vue`, `useAddServerForm.ts`
- **Observation**: The decomposition passes the `reactive<AddServerForm>()` returned from `useAddServerForm` as a `form` prop into three child components which then write to its fields (`form.transport = opt.value`, `form.scope = 'global'`, `v-model="form.name"`). This works because Vue only shallow-readonly-wraps the props object, not the nested reactive; however it's the first place in `apps/desktop` where a child mutates a prop-borne reactive. Future contributors may not expect writes to propagate, and linters/reviewers may flag it as a prop mutation.
- **Proposed change**: Switch to `provide`/`inject` for the form state (create a `useAddServerFormContext` pair), or split the form into per-field `defineModel()` bindings for each child so mutations look like explicit two-way bindings.
- **Risk / why deferred**: `provide`/`inject` is a structural change; `defineModel` explosion would grow child LOC. Both are out of scope for a zero-behaviour decomposition.
- **Effort**: M

### w77 — `McpAddServerModal` validate() still accepts the legacy `streamable-http` transport

- **Area**: `apps/desktop/src/components/mcp/addServer/useAddServerForm.ts` (`validate`)
- **Observation**: The URL-required branch checks `form.transport === "sse" || form.transport === "http" || form.transport === "streamable-http"`, but `transportOptions` only offers `stdio | sse | http` (per the MCP 2025 spec comment), and `McpTransport` no longer includes `streamable-http` in some code paths. The literal is preserved byte-for-byte from the original but is dead: the UI cannot set this value, so the third `||` branch never fires.
- **Proposed change**: Drop the `streamable-http` literal from the union check, or add it back to `transportOptions` if the legacy transport is still meant to be supported for programmatic imports. Either way, synchronise the check with the option list.
- **Risk / why deferred**: Touches validation semantics; requires product decision on whether `streamable-http` stays a first-class transport. Out of scope for decomposition.
- **Effort**: S

### w77 — `handleSubmit` is marked `async` but never awaits

- **Area**: `apps/desktop/src/components/mcp/addServer/useAddServerForm.ts` (`handleSubmit`)
- **Observation**: The submit handler sets `submitting.value = true`, emits `submit`, and sets `submitting.value = false` synchronously on the same tick. The `async` keyword was preserved byte-for-byte from the original but is misleading — the disabled state toggles on-off within a single microtask so the "Adding…" button label is effectively unreachable. The original behaviour is preserved in this wave (zero-change), but the real intent was presumably "disable the button until the parent finishes persisting".
- **Proposed change**: Have `McpManagerView.vue` pass an async `onSubmit` callback (or a promise) that the modal awaits before clearing `submitting`; alternatively drop `submitting` state entirely and let the parent unmount the modal on success.
- **Risk / why deferred**: Behaviour change — the submit flow would become async and the parent contract would shift. Needs a coordinated edit with `McpManagerView.vue`.
- **Effort**: M

### w78 — OrchestrationHome children re-inject the pinia store individually

- **Area**: `apps/desktop/src/views/orchestration/home/*.vue`
- **Observation**: After decomposition, four of the five children (`OrchestrationHeroStats`, `OrchestrationActivityFeed`, `OrchestrationSystemHealth`, and indirectly the parent) each call `useOrchestrationHomeStore()` directly. This keeps the prop surface minimal but couples every child to the store's concrete identity, making it harder to reuse them (e.g., on a future read-only `MissionControl` page backed by a different store).
- **Proposed change**: Introduce a small `provide`/`inject` key (`OrchestrationHomeContextKey`) exposing just the subset each child actually reads (`activeSessions`, `totalSessions`, `registeredRepos`, `worktreeCount`, `staleWorktreeCount`, `totalDiskUsage`, `activityFeed`, `systemDeps`). Children then become store-agnostic.
- **Risk / why deferred**: Wave 78 is strict zero-behaviour-change decomposition; adding a provide/inject contract would widen the diff and warrants a companion test fixture that doesn't need a real pinia instance.
- **Effort**: S

### w78 — Budget hero tile dead code should be removed or wired up

- **Area**: `apps/desktop/src/views/orchestration/home/OrchestrationHeroStats.vue`
- **Observation**: The wired budget tile is commented out; in its place is an `N/A` placeholder. The commented block still references `budgetPercent` (hard-coded `62`) and `budgetBarClass` that no longer exist in the component, plus `.budget-bar` / `.budget-bar-fill` scoped CSS that is now unused. This was preserved verbatim during decomposition to avoid behaviour change, but it is dead weight.
- **Proposed change**: Either (a) delete the commented markup and the `.budget-bar*` CSS rules, or (b) surface a real `budgetPercent` from `useOrchestrationHomeStore` and replace the `N/A` placeholder tile with the live tile.
- **Risk / why deferred**: (a) is low-risk but product may want the placeholder kept as a visual promise; (b) needs a budget data source that doesn't exist yet.
- **Effort**: S

### w78 — Activity feed mock data is embedded in the presentation child

- **Area**: `apps/desktop/src/views/orchestration/home/OrchestrationActivityFeed.vue`
- **Observation**: The mock feed array (`mock-1` … `mock-4`) and the `feedIconClass` / `feedIconLabel` maps live inside the presentation component. This forces the component to know about both the backend activity-feed shape and the design-system icon mapping, and the mock is evaluated at module load so timestamps are computed once when the view is first imported (not each render). The behaviour matches pre-decomposition exactly.
- **Proposed change**: Extract mock data + icon mapping into `useOrchestrationActivityFeed()` (or into `useOrchestrationHomeStore` itself so real + mock feed go through the same getter). Returns `feedItems` / `iconFor(type)` / `labelFor(type)`.
- **Risk / why deferred**: The stale-timestamp behaviour is pre-existing and probably never observable (timestamps are rendered via `formatRelativeTime` which is already coarse), but any refactor would change *when* the mock dates are instantiated. Out of wave-78 scope.
- **Effort**: S


### w80 — SessionId propagation into tracepilot-core discovery + indexer

- **Area**: `crates/tracepilot-core/src/session/discovery.rs` (`resolve_session_path`, `resolve_session_path_in`), `crates/tracepilot-indexer/src/index_db/{session_reader,session_writer,search_writer}.rs`, `crates/tracepilot-orchestrator/src/task_context/sources.rs`.
- **Observation**: Wave 80 propagated `SessionId` into the `with_session_path` boundary in `tracepilot-tauri-bindings` but stopped there. The core discovery helpers still accept `session_id_prefix: &str` (deliberate: they also accept *prefixes*, not full UUIDs, so a single newtype does not model both shapes). `IndexDb::{get_session_path, get_session_incidents, needs_reindex}`, `search_writer::needs_search_reindex`/`index_session_search`, `session_writer::delete_child_rows`, and the orchestrator `task_context::sources::*_extractor` calls all still take `&str`.
- **Proposed change**: Introduce a `SessionIdRef` or split `SessionId` vs `SessionIdPrefix` newtype, then propagate through the indexer + orchestrator.  Or leave `&str` at the indexer boundary and only convert `.as_str()` at call sites that already hold a `SessionId`.
- **Risk / why deferred**: Large fan-out across 3 crates; prefix vs full-UUID semantics need a design decision.
- **Effort**: L

### w80 — SessionId into cached-events helper

- **Area**: `crates/tracepilot-tauri-bindings/src/commands/session/shared.rs` (`load_cached_typed_events`) and callers in `detail.rs`/`events.rs`/`turns.rs`.
- **Observation**: `load_cached_typed_events(cache, session_id: &str, events_path: &Path)` still takes a raw `&str`. Callers currently keep a `cache_session_id: String` beside the `SessionId` we now obtain from the validator, which is slightly redundant.
- **Proposed change**: Change the helper to `session_id: &SessionId` and replace the duplicated `cache_session_id` clone with a reference to the newtype captured in the outer scope (requires threading the `SessionId` through the `with_session_path` closure, which currently consumes it).
- **Risk / why deferred**: `with_session_path` takes `SessionId` by value and moves it into the blocking closure; to also give callers a `&SessionId` for the event cache they need either a `.clone()` or a small restructure. Tractable but non-trivial.
- **Effort**: S

### w80 — PresetId/SkillName into task DB + task_orchestrator

- **Area**: `crates/tracepilot-orchestrator/src/task_db/{operations,types}.rs`, `crates/tracepilot-orchestrator/src/task_orchestrator/manifest.rs`, `crates/tracepilot-orchestrator/src/skills/{discovery,assets,import}.rs`.
- **Observation**: Task rows carry `preset_id: String`; the bindings wrap via `PresetId::from_validated(&task.preset_id)` at each use site (`tasks/crud.rs`, `tasks/ingest.rs`, `tasks/orchestrator_start.rs`). `presets::io::save_preset` still takes `&TaskPreset` whose `.id` is raw `String`. Skills helpers `assets::{add_asset, read_asset, …}` and `import::*` accept `&str` asset / skill names.
- **Proposed change**: Hydrate `Task` rows with a `PresetId` field (or a `preset_id()` accessor returning `&PresetId`); thread `&PresetId` through `save_preset` via a new `preset.id()` accessor on `TaskPreset`. Mirror for `SkillName` in `assets`/`import`.
- **Risk / why deferred**: Mechanical but wide — touches DB row mapping, manifest serde, and every task-orchestrator call site. Out of scope for a surgical wave-80.
- **Effort**: M

### w80 — RepoId newtype not yet introduced

- **Area**: `crates/tracepilot-core/src/ids.rs` (add), `crates/tracepilot-orchestrator/src/skills/import.rs` (`discover_repo_skills`), `crates/tracepilot-indexer/src/index_db` (`repo`-typed columns), `crates/tracepilot-tauri-bindings/src/commands/skills.rs` (`skills_import_github` / `skills_discover_github`).
- **Observation**: The w80 plan entry mentions `RepoId` but no such newtype exists in `tracepilot-core`. Repo identifiers are still raw `(owner: String, repo: String)` tuples.
- **Proposed change**: Add `RepoId` newtype (with validated `owner/name` invariants matching GitHub's rules) to `tracepilot-core::ids`, a validator helper in `tracepilot-tauri-bindings::validators`, and propagate into the skills/GitHub modules.
- **Risk / why deferred**: Requires deciding the shape (single `owner/name` string vs. two fields) and adding IPC validation, which is larger than a single-commit wave.
- **Effort**: M
