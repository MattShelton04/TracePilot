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

### w81 — atomic_dir_install promotion to core::utils::atomic
- **Area**: `crates/tracepilot-orchestrator/src/skills/import/atomic.rs` and a hypothetical new `tracepilot_core::utils::atomic` module.
- **Observation**: Wave 81 audit confirmed `atomic_dir_install` still has a single-module scope (`skills/import/{local,github,file,tests}.rs`). The master plan entry (w81) proposed folding `atomic_json_write` + `atomic_dir_install` behind `core::utils::atomic::{write_file, install_dir}`, but `atomic_dir_install` surfaces the skills-domain `SkillsError::DuplicateSkill` variant, which cannot be hoisted into core without either genericising the error type or leaking `SkillsError` across crate boundaries.
- **Proposed change**: If a second caller ever needs atomic directory install, extract to `tracepilot_core::utils::atomic::install_dir` generic over the error type (with a duplicate-detection closure / sentinel). In parallel, promote `atomic_json_write` (8 callers) to `core::utils::atomic::write_file` — it is already error-type agnostic via `std::io::Error`.
- **Risk / why deferred**: Still single-use for `atomic_dir_install`; `atomic_json_write` move would fan out across 8 callers and 3 modules. Better as a dedicated wave.
- **Effort**: M

### w82 — Residual `let _` sites and Mutex migration
- **Area**: `crates/tracepilot-export/src/render/markdown/{header,turns,footer}.rs` (~55 `let _ = writeln!(md, ...)` / `write!(md, ...)` sites, one macro suppression in `crates/tracepilot-core/src/utils/sqlite.rs`, two test-only `lock().unwrap()` sites, and the broader `std::sync::Mutex` → `parking_lot::Mutex` migration proposed in the master plan (w82).
- **Observation**: The Markdown renderer writes `fmt::Result` values that are infallible when the sink is `String`; the current `let _ =` pattern is idiomatic but noisy. The `parking_lot::Mutex` migration was scoped out because `parking_lot` is not yet a workspace dependency and adding it touches `SharedTaskDb` / `SharedOrchestratorState` / `ManifestLock` call sites across the `tauri-bindings` and `orchestrator` crates (≈ 30 sites), each of which currently surfaces `mutex_poisoned()` via `BindingsError`. Both items need a coordinated design decision.
- **Proposed change**: (a) Replace the renderer sites with `md.write_fmt(format_args!(...))?` inside a helper that returns `fmt::Result`, or bulk-accept the style via an `#[allow(clippy::let_underscore_must_use)]` on the module; (b) land `parking_lot` as an explicit follow-up wave that also deletes the `mutex_poisoned()` helper and simplifies the surrounding `.map_err(|_| mutex_poisoned())?` sites.
- **Risk / why deferred**: (a) is pure cosmetics (zero-behaviour, ~55 sites). (b) changes the error surface of every command that currently reports `BindingsError::InternalMutexPoisoned` — safer as a dedicated wave with its own review.
- **Effort**: S (renderer) + M (parking_lot migration)

### w83 — Remaining string-payload error variants (pragmatic catch-alls)
- **Area**:
  - OrchestratorError::Launch(String) — 27 construction sites across launcher.rs (8), process/hidden.rs (4), process/timeout.rs (6), process/terminal.rs (2), 	ask_orchestrator/launcher.rs (2), github.rs (5).
  - OrchestratorError::Task(String) — 15 construction sites in 	ask_db/operations.rs (8), 	ask_ipc/protocol.rs (2), 	ask_context/{sources,assembler}.rs (2), 	ask_orchestrator/manifest.rs (2).
  - OrchestratorError::Config(String) — 2 direct sites plus `config_ctx` helper.
  - SkillsError::{Io, Yaml, Import, Asset, GitHub, FrontmatterParse, FrontmatterValidation}(String) — 41 construction sites across `crates/tracepilot-orchestrator/src/skills/*`.
  - McpError::{Config, Json, HealthCheck, Network, Import}(String) — 25 construction sites across `crates/tracepilot-orchestrator/src/mcp/*`.
  - BindingsError::Internal(String) — 2 sites (both mutex-poison paths in `helpers/{mod,db}.rs`) which are intentional infrastructure buckets, not domain errors.
- **Observation**: These variants carry `String` payloads that flatten two distinct concerns — (a) a human-readable message and (b) the underlying typed source (`std::io::Error`, `rusqlite::Error`, `reqwest::Error`, `serde_json::Error`, etc.). Today the source chain is flattened at construction via `format!("{context}: {e}")`, which loses `Error::source()` introspection for server-side logging and prevents downstream `match` on typed roots. The `Launch` / `Task` / `Config` / MCP / Skills catch-alls also fan in semantically distinct failures (e.g. `Launch` mixes process-spawn, stdout/stderr pipe, and mutex-poison; `Task` mixes CRUD invariant violations, JSON parse, and manifest-file-missing). All presently serialise to the same wire `code` (`ORCHESTRATOR`), so splitting is pure server-side hygiene — no FE contract change.
- **Proposed change**: (a) Add struct-shaped variants that carry typed `#[source]` fields (e.g. `Launch { context: &'static str, #[source] source: std::io::Error }`, `TaskInvalid { field: &'static str, reason: String }`); (b) deprecate the bare `String` constructors one variant at a time via `#[deprecated]` so migration stays incremental; (c) confirm `BindingsError::code()` mapping still returns `ORCHESTRATOR` for every new variant so the FE `e.code === "ORCHESTRATOR"` check at `apps/desktop/src/utils/backendErrors.ts` is unaffected.
- **Risk / why deferred**: ~110 construction sites across 30+ files; each site must re-thread the typed source it currently `to_string`'s. Needs its own wave with per-variant migration + test updates. This wave (w83) landed the highest-leverage split (`TaskDb` → `TaskDb` / `TaskDbMigration` / `TaskDbBackup`), which was the only catch-all whose misattribution crossed distinct subsystems (CRUD vs migrator framework vs pre-migration backup pipeline).
- **Effort**: L (bite off one variant family per wave: Orchestrator, Skills, MCP).

### w83 — `OrchestratorError::Task` overload across task-DB CRUD vs IPC protocol
- **Area**: `crates/tracepilot-orchestrator/src/task_db/operations.rs` (8 sites), `task_ipc/protocol.rs` (2), `task_orchestrator/manifest.rs` (2), `task_context/{sources,assembler}.rs` (2).
- **Observation**: The `Task(String)` variant is currently used both for (a) CRUD invariant violations in SQLite rows (`"Invalid status: ..."`, `"Task is already claimed by ..."`) and (b) IPC / manifest protocol violations (`"Cannot shutdown: manifest file does not exist"`, `"Invalid JSON in input_params"`). These are separate fault domains: (a) is caller-surfaceable validation, (b) is an infrastructure/protocol invariant, but both share the single code `ORCHESTRATOR` today.
- **Proposed change**: Introduce `TaskInvariant { field: String, reason: String }` for CRUD validation (retain `code = ORCHESTRATOR`) and keep `Task(String)` for protocol/manifest plumbing (rename to `TaskProtocol` in a follow-up rename wave). Update `task_db::operations` tests that currently `matches!(err, OrchestratorError::Task(msg) if msg.contains(...))`.
- **Risk / why deferred**: 12 tests in `task_db::operations::tests` pattern-match on `OrchestratorError::Task` directly; the split needs coordinated test + call-site updates.
- **Effort**: M
### w84 — Real-subprocess abort-propagation E2E under Tauri
- **Area**: `crates/tracepilot-orchestrator/src/bridge/manager/{lifecycle,session_tasks}.rs` + `copilot-sdk` process layer.
- **Observation**: The w84 tests verify our manager-side contract by stubbing `copilot_sdk::Session` with a user-supplied `invoke_fn`. They do **not** exercise the real stdio subprocess the SDK spawns — specifically, there is no in-process test that (a) a user-initiated `abort_session` actually delivers `SIGKILL` / `TerminateProcess` to the spawned `copilot` CLI, nor (b) that the SDK's own stdout/stderr reader tasks terminate once the child exits. The upstream SDK's `CopilotProcess::kill` uses `Child::start_kill` without a wait-for-exit join, so orphaning is possible on Windows under job-object edge cases.
- **Proposed change**: Add a Tauri-launched integration test (guarded behind an `ignored` attribute + feature flag) that spawns a real `copilot --ui-server`, sends a long-running prompt, calls `abort_session`, then polls `is_alive(pid)` and the SDK transport-close event. Pair with a PID-leak smoke test that runs N create/destroy cycles and asserts no stray `copilot.exe` survives. Gate on CI only where the CLI binary is available.
- **Risk / why deferred**: Requires a pinned `copilot` CLI binary in CI + a real auth token or mocked login provider; would otherwise block merges when the upstream CLI is unavailable. Belongs in the E2E tier, not the unit-test tier landed this wave.
- **Effort**: L

### w84 — Hidden-window invariant — compile-time / runtime assertion
- **Area**: `crates/tracepilot-orchestrator/src/process/hidden.rs` + `crates/tracepilot-orchestrator/src/process/terminal.rs`.
- **Observation**: `hidden_command` and `hidden_std_command` apply `CREATE_NO_WINDOW` via `CommandExt::creation_flags`. There is no getter for creation flags on stable Rust, so no unit test can verify the flag is set without either (a) unsafe `TEB` / `PEB` probing after spawn, (b) a Win32 console-hook integration test observing the absence of a transient conhost window, or (c) wrapping every hidden spawn in a newtype whose constructor is the only flag-setting path. The current regression safety is "grep the module and trust the callsite", which drifts as Windows-only code paths are added.
- **Proposed change**: Introduce a `HiddenCommand` newtype in `process/hidden.rs` that wraps `tokio::process::Command` / `std::process::Command` and is the **only** type accepted by `run_hidden*` helpers. The newtype's `new()` stamps the flag; there is no public `from_inner`. A compile-time unit test can then assert that any module-external construction is forced through this path. Complements with a Windows-only integration test using `GetConsoleWindow` via the `winapi` dev-dep (none today) to observe console attachment.
- **Risk / why deferred**: Introducing a newtype touches every `run_hidden*` call site and requires wiring `.arg()` / `.args()` / `.current_dir()` / `.env()` re-exports. Non-trivial surface API change; belongs in its own wave with migration notes.
- **Effort**: M

### w84 — Fuzz / property coverage for `execute_with_timeout` drain ordering
- **Area**: `crates/tracepilot-orchestrator/src/process/timeout.rs`.
- **Observation**: The drain logic uses two `std::thread` readers plus an `mpsc::Receiver` with `recv_timeout`. The three failure branches (`child.wait` error, `stdout_rx.recv` disconnect, `stderr_rx.recv` disconnect, mutex-poison) are individually tested only for the happy path. Under adversarial scheduling (reader thread panics, child writes >pipe-buffer then exits, child yields no output at all), the order of `wait` vs pipe-drain matters: draining before `wait` on POSIX can deadlock when the child fills the 64 KiB pipe buffer, but `wait` before drain risks losing the final buffered bytes on Windows (where pipes are not closed until handle release).
- **Proposed change**: Port the pipe-drain to a `tokio::process` based implementation (`AsyncReadExt::read_to_end` on `ChildStdout` / `ChildStderr` concurrently with `child.wait()` under `tokio::try_join!`). Add property tests that spawn helper binaries writing 0 / 1 / 128 KiB / 4 MiB to stdout+stderr in arbitrary ordering and assert all bytes are recovered.
- **Risk / why deferred**: The tokio rewrite touches `run_hidden` / `run_hidden_stdout_timeout` semantics (sync vs async) and cannot ship without migrating every caller. Also needs a helper test binary which the workspace does not currently build.
- **Effort**: L

### w86 — `launch_ui_server` still composes PowerShell with string interpolation

- **Area**: `crates/tracepilot-orchestrator/src/bridge/manager/ui_server.rs` (Windows arm of `launch_ui_server`).
- **Observation**: The Windows arm builds a PowerShell script by `format!`-interpolating `work_dir` (from caller-supplied `working_dir: Option<&str>`) and `copilot_path` (from `find_executable`) into a PS string with `.replace(''\'''', '''''''')` escaping, then base64-encodes via `encode_powershell_command`. The escape is correct for single-quoted PS literals today, but the interpolation pattern is brittle: any future addition of an embedded PS metacharacter in the template, or a caller that bypasses validation of `working_dir`, would re-open the injection vector. This is a **visible-terminal** launcher so it can't use the hidden-probe helpers landed in w86; it is also the last composed PS string in the orchestrator crate.
- **Proposed change**: Replace the interpolated template with a script-file approach: write the PS preamble (title / colour prints / `& $Path --ui-server`) to a temp .ps1 and invoke via `powershell -NoProfile -NonInteractive -File <path>`, passing `working_dir` and `copilot_path` through `-ArgumentList` (`param($wd, $path)` at script top). This eliminates all interpolation and lets the PS parser handle argument quoting natively. Alternatively, stop using PowerShell entirely and `cmd /c` a tiny batch file with `%1`/`%2` substitution.
- **Risk / why deferred**: Touches the visible-terminal UX (title string, colour prints); needs a manual smoke test on Windows 10 + 11 to confirm the `-NoExit` shell still shows the Cyan banner and preserves the window-title behaviour. Also the macOS / Linux arms still build `format!("{copilot_path} --ui-server")` — a parallel migration to argv would need to cross the `spawn_detached_terminal` boundary, which today only accepts a single `program` + `args` slice (the POSIX callers wedge the full command into `program`).
- **Effort**: M

### w86 — `mcp/health/stdio.rs` spawn-time lifetime bound

- **Area**: `crates/tracepilot-orchestrator/src/mcp/health/stdio.rs` (`spawn_and_initialize`).
- **Observation**: The stdio MCP probe already (a) uses `hidden_std_command` so `CREATE_NO_WINDOW` is applied, (b) enforces a 10s read deadline between each JSON-RPC phase, (c) guarantees kill+reap via an RAII `ChildGuard`, and (d) pipes stderr to `Stdio::null` (no capture needed). What it does *not* have is an outer **wall-clock lifetime** around the whole `spawn_and_initialize`: a pathological server that answers `initialize` inside 10s then hangs forever before `tools/list` responds is bounded by the per-phase 10s — total bound is therefore 20s which is still finite, but the two phases are implicit and not enforced at the function boundary. Stdout is also captured into a `String` line-by-line without a byte cap, so a server that streams multi-MiB newline-free tokens could balloon `line` before the parser fails.
- **Proposed change**: (a) Wrap `spawn_and_initialize` in `tokio::time::timeout` (or its `spawn_blocking` equivalent) with an explicit overall budget (e.g. 15s) that supersedes the per-phase deadlines; on timeout, drop the `ChildGuard` so the kill+reap path runs. (b) Replace the raw `read_line` with a bounded reader (`BufReader::read_line` into a `Vec<u8>` with an `AsyncReadExt::take(MAX_LINE)` or a manual cap), discarding excess bytes with a structured error rather than OOMing.
- **Risk / why deferred**: The module is sync and runs inside `tokio::task::spawn_blocking`; converting to fully async would either require a duplicate async path or a broader migration to `tokio::process` for stdio MCP. The per-phase 10s deadlines already give a 20s practical ceiling, so this is a defence-in-depth hardening rather than an open bug.
- **Effort**: M

### w86 — Extend `run_async_with_limits` to remaining sync `run_hidden*` helpers

- **Area**: `crates/tracepilot-orchestrator/src/process/hidden.rs` (`run_hidden`, `run_hidden_via_cmd`, `run_hidden_stdout`, `run_hidden_stdout_timeout`) and `process/timeout.rs` (`execute_with_timeout`).
- **Observation**: The sync `run_hidden*` family still uses `std::thread` readers + `mpsc::recv_timeout` and has *no* stdout/stderr size cap — a hostile child that floods stdout past the kernel pipe buffer can still cause the reader thread to grow a `Vec<u8>` unbounded while the timeout thread waits. The w86 `run_async_with_limits` helper applies a `take(max_bytes)` cap + `kill_on_drop(true)`, but only for the async path (`bridge::discovery`). Sync callers (launcher, github, task_orchestrator, `process::find_executable`) still rely on raw `cmd.output()` or the thread-based reader.
- **Proposed change**: Add a `max_bytes` parameter to `execute_with_timeout` (and plumb through `run_with_timeout` / `run_hidden_stdout_timeout`) that wraps the pipe reader in a `std::io::Read::take` limit. For the no-timeout path (`run_hidden`), either migrate it onto a shared implementation or leave a documented caveat that unbounded callers must trust their child.
- **Risk / why deferred**: ~27 call sites of `run_hidden*` each already chose their own (untyped) trust level; adding a required cap breaks the ergonomic signature. Better as a dedicated wave that lands a `HiddenSpawnOptions` builder once and sweeps callers. Composable with the w84 `HiddenCommand` newtype FI.
- **Effort**: M

### w90 — Back-compat re-export in `@tracepilot/types` deferred (dep-cycle)

- **Area**: `packages/types/src/index.ts`, `packages/client/src/events.ts`.
- **Observation**: The plan entry for w90 proposed a back-compat re-export of `IPC_EVENTS` from `@tracepilot/types` after the move to `@tracepilot/client`. Implementing that would require `@tracepilot/types` to import from `@tracepilot/client`, but `@tracepilot/client` already depends on `@tracepilot/types` (see `packages/client/package.json`). Re-exporting would create a dependency cycle between the two workspace packages.
- **Proposed change**: No back-compat shim. All current consumers (`apps/desktop` ×3) were migrated in this wave; `apps/cli` and `packages/*` have no references. If an external consumer ever needs `IPC_EVENTS` from `@tracepilot/types` again, split the constant into a third leaf package (e.g. `@tracepilot/ipc-protocol`) that both `types` and `client` can depend on without cycle.
- **Risk / why deferred**: Creating a new package for a single 8-entry const would trade one clean move for three package.json / tsconfig touch-points. Revisit only if a non-desktop consumer appears.
- **Effort**: S

### w90 — Raw `emit("popup-session-closed", …)` in `ChildApp.vue`

- **Area**: `apps/desktop/src/ChildApp.vue:60-64`.
- **Observation**: After moving `IPC_EVENTS` into `@tracepilot/client` the remaining stringly-typed event in the TS tree is the `"popup-session-closed"` emit on popup unmount. It is not a Rust-emitted event (TS → TS only, between the popup webview and the main window listener) so it is not listed in `crates/tracepilot-tauri-bindings/src/events.rs`.
- **Proposed change**: Add a `WINDOW_POPUP_SESSION_CLOSED` entry to `IPC_EVENTS` (or a sibling `UI_EVENTS` registry if we want to keep the Rust-side wire-events pure) and migrate both the emit site and the listener. This is already earmarked for w94 (see plan §w94, final bullet).
- **Risk / why deferred**: Non-trivial — the listener lives in the main window's window-lifecycle composable and the registry split (Rust-emitted vs UI-internal) is a design choice worth deciding once rather than by accident.
- **Effort**: S

### w90 — Rust-side `events.rs` parity pin test

- **Area**: `crates/tracepilot-tauri-bindings/src/events.rs` ↔ `packages/client/src/events.ts`.
- **Observation**: `IPC_EVENTS` now lives alongside `IPC_COMMANDS` in `@tracepilot/client`, and the latter has a Vitest contract pin (`packages/client/src/__tests__/commandContract.test.ts`) that parses `build.rs` / `lib.rs` to keep the TS and Rust command lists in lockstep. `IPC_EVENTS` has no equivalent pin — the comment header in both files is the only drift guard.
- **Proposed change**: Extend `commandContract.test.ts` (or add a sibling `eventContract.test.ts`) that parses `crates/tracepilot-tauri-bindings/src/events.rs` for `pub const <NAME>: &str = "..."` items and asserts every Rust event has a matching `IPC_EVENTS[<NAME>]` value, and vice versa.
- **Risk / why deferred**: Mechanical but needs a stable regex against the Rust file's current hand-formatted layout (the file has irregular whitespace/block comments as of w90 — visible in the existing multi-line run-together `pub const` lines). Worth a small cleanup pass on the Rust file first.
- **Effort**: S

### w90 — Desktop test double duplicates `IPC_EVENTS` literals

- **Area**: `apps/desktop/src/__tests__/mocks/client.ts`.
- **Observation**: The central `createClientMock` helper now inlines a byte-for-byte copy of `IPC_EVENTS` because it is imported from inside the `vi.mock("@tracepilot/client", …)` factory — importing `IPC_EVENTS` from the real module at that point would re-enter the in-flight mock and resolve to `undefined`. This duplicates the 8-string registry in test code.
- **Proposed change**: Either (a) extract `IPC_EVENTS` into its own terminal module with zero transitive `@tracepilot/client` imports (e.g. `packages/client/src/events.ts` today — consumers could `vi.importActual` from the file subpath if the package exports map is expanded), or (b) add the proposed `eventContract` test above so drift is loud. Option (b) is cheaper.
- **Risk / why deferred**: Low — inline constants are 8 lines and colocated with a sync-comment. Promote only once we have a second test-side duplication of a client constant.
- **Effort**: S

### w92 — Launcher/configInjector `initialize()` settled-aggregation pattern
- **Area**: `apps/desktop/src/stores/launcher.ts`, `configInjector.ts`, `orchestrationHome.ts`.
- **Observation**: These stores' `initialize()` / `doFetch()` use `allSettledRecord` + `aggregateSettledErrors` to compose partial-success error strings, and set individual ref values from each settled slot. `runMutation` / `runAction` can't express this: a rejected slot does not throw, and the error ref is set from an aggregator, not from a caught exception.
- **Proposed change**: Introduce a `runSettled` helper in `@tracepilot/ui` that takes a settled-record schema `{ key: () => Promise<T> }`, applies per-key `onFulfilled` setters, and collapses rejections via a pluggable aggregator into `error`. Only worth doing once a fourth caller appears (threshold heuristic).
- **Risk / why deferred**: Over-abstraction risk — the current three call-sites each have slightly different sequencing (fast/slow path split in `orchestrationHome`), so a single helper would need a staged/phased option.
- **Effort**: M

### w92 — `sessions.ts` reindex: `isAlreadyIndexingError` filter
- **Area**: `apps/desktop/src/stores/sessions.ts` (`reindex`).
- **Observation**: The reindex path swallows `isAlreadyIndexingError` (treating it as benign) and only surfaces other exceptions via `error.value`. `runMutation` writes every caught error unconditionally, so the benign class would become user-visible.
- **Proposed change**: Extend `runMutation` with an `onError` callback that can return `"swallow"` / `"surface"` (or accept a predicate `isBenign?: (e) => boolean`). That also subsumes the `RunMutationOptions` overload already referenced in stored project memory.
- **Risk / why deferred**: API design — needs a second benign-filter caller to justify; alternative is a per-store `suppressBenign` helper.
- **Effort**: S

### w92 — `tasks.ts::fetchTasks` — dual-spinner coordination with `refreshTasks`
- **Area**: `apps/desktop/src/stores/tasks.ts`.
- **Observation**: `fetchTasks` intentionally defers clearing `loading` when a silent `refreshTasks` is still in flight (avoids spinner flashing). `runAction` clears loading unconditionally in its `finally`, which would regress the UX.
- **Proposed change**: Add a `shouldClearLoading?: () => boolean` option to `runAction`, or expose the guard-token so the caller can skip the finally clear.
- **Risk / why deferred**: Low — change touches the shared helper, needs tests.
- **Effort**: S

### w92 — `worktrees.ts` loadWorktrees/loadAllWorktrees token forwarding
- **Area**: `apps/desktop/src/stores/worktrees.ts`.
- **Observation**: These actions pass the `loadGuard` token to an async `hydrateDiskUsageBatch(..., token)` so the hydration step can abort on staleness. `runAction` creates and owns its own token internally, so a migrated `onSuccess` has no way to forward it.
- **Proposed change**: Expose the validated token (or a `stillValid()` closure) to the `onSuccess` callback — e.g. `onSuccess(result, ctx)` with `ctx.isValid()`.
- **Risk / why deferred**: Touches helper public shape; best done alongside the `onError` extension above.
- **Effort**: S

### w92 — `search.ts::executeSearch` date-parse early-return path
- **Area**: `apps/desktop/src/stores/search.ts`.
- **Observation**: Inside the `try` block, a date-parse failure sets `q.error.value` from a returned string (not a thrown exception) and early-returns after clearing results + facets. `runAction` can't express a success-path early-exit that writes to `error`.
- **Proposed change**: Throw a typed `DateRangeError` from `parseDateRange` and let `runAction` catch it; side-effects (`clearSearchResults` + facets reset) move to a try/finally wrapper or an `onError` callback on the helper.
- **Risk / why deferred**: Needs `parseDateRange` contract change + `onError` support in helpers.
- **Effort**: S

### w92 — Silent-log-only actions stay manual
- **Area**: `orchestrator.ts` (`loadModels`, `refreshAttribution`, `refreshActivity`, `ingestResults`), `worktrees.ts::loadBranches/fetchWorktreeDetails`, `launcher.ts::incrementUsage`, `sessions.ts::refreshSessions/ensureIndex`, `configInjector.ts::initialize` inner config read.
- **Observation**: These intentionally log-and-swallow (`logWarn`) without touching `error.value` — they are background/optional operations whose failure must not surface in the UI. `runMutation` always writes to the supplied error ref, so migrating would regress UX.
- **Proposed change**: Add `runSilent(action, logLabel)` to `@tracepilot/ui` that wraps try/catch + `logWarn` with zero error-ref dependency. Low priority — each site is 3 lines.
- **Risk / why deferred**: Trivial helper, minimal payoff versus reading the inlined version.
- **Effort**: S

### w93 — Feature-flag registry relocation to `@tracepilot/types`

- **Area**: `apps/desktop/src/config/featureFlags.ts`, `packages/types/src/defaults.ts`, `packages/types/src/index.ts`.
- **Observation**: The typed `FeatureFlag` union + `FEATURE_FLAGS` registry live in `apps/desktop/src/config/featureFlags.ts` and derive from `DEFAULT_FEATURES` in `@tracepilot/types`. The master plan (w93) proposed moving the registry itself into `packages/types/src/featureFlags.ts` so non-desktop consumers (CLI, future packages) can import the same union without a desktop-app dependency. Deferring: the `@tracepilot/desktop`-only consumers today mean the relocation is pure plumbing with zero behaviour change but touches every FE call-site import path.
- **Proposed change**: Add `packages/types/src/featureFlags.ts` exporting `FEATURE_FLAGS`/`FeatureFlag`/`isFeatureFlag` derived from `DEFAULT_FEATURES`, re-export from `packages/types/src/index.ts`, then re-point `apps/desktop/src/config/featureFlags.ts` to a thin re-export (or delete and migrate imports). Migrate any remaining `Record<string, boolean>` typings in `stores/preferences.ts:featureFlags` and `stores/preferences/featureFlags.ts` to `Record<FeatureFlag, boolean>`.
- **Risk / why deferred**: Pure plumbing, import-churn PR — held because the current registry is already type-safe at every call site audited in w93 (no ad-hoc boolean env / localStorage flags found outside it).
- **Effort**: S

### w93 — `stores/preferences/featureFlags.ts` slice typed as `Record<string, boolean>`

- **Area**: `apps/desktop/src/stores/preferences/featureFlags.ts:14`, `apps/desktop/src/stores/preferences.ts:91,134`.
- **Observation**: The internal `featureFlags` ref is typed `Record<string, boolean>` to tolerate config migrations seeding unknown keys. `isFeatureEnabled(flag: FeatureFlag)` narrows readers, but the store still permits writes to arbitrary string keys — a soft escape hatch that lets new flags skip the `DEFAULT_FEATURES` / `FeaturesConfig` registry.
- **Proposed change**: After the relocation above, tighten the ref to `Record<FeatureFlag, boolean>` (or `Partial<Record<FeatureFlag, boolean>>`) and funnel migration-time writes through a single `setFlag(flag: FeatureFlag, value)` helper that drops unknown keys with `logWarn`. Add a vitest invariant asserting the store rejects `"__synthetic_test_flag"` writes in non-test builds.
- **Risk / why deferred**: Changes the test shape (`featureFlags.test.ts:14` currently asserts a synthetic key survives) and may mask real-world migration paths from older configs. Needs a paired migration audit.
- **Effort**: S
### w94 — plugin-updater / plugin-process scattered imports
- **Area**: `apps/desktop/src/composables/useAutoUpdate.ts:55,84`.
- **Observation**: Single-file consumers of `@tauri-apps/plugin-updater` (`check`) and `@tauri-apps/plugin-process` (`relaunch`). Each is called exactly once, gated by `installType === 'installed'` rather than `isTauri()`. Not migrated in w94 because a gateway for a single call-site is pure indirection.
- **Proposed change**: Fold into `@/lib/tauri/updater.ts` (`tauriCheckForUpdate`) and `@/lib/tauri/process.ts` (`tauriRelaunch`) if/when a second consumer appears. Alternatively inline `isTauri()` check + `maybeMock`.
- **Risk / why deferred**: Low — cosmetic, single call-site. Would add modules for no dedup win until the plugins grow a second consumer.
- **Effort**: S

### w94 — plugin-opener scattered import
- **Area**: `apps/desktop/src/utils/openExternal.ts:36`.
- **Observation**: Single-use dynamic `@tauri-apps/plugin-opener` (`openUrl`) inside `openExternal`. Already well-scoped — `isTauri()` guard + try/catch + `window.open` fallback all live in one 45-line module.
- **Proposed change**: If a second caller emerges (e.g. in-app `file://` handler), lift to `@/lib/tauri/opener.ts`. Otherwise leave as-is.
- **Risk / why deferred**: Zero value in moving a single-use import behind a gateway.
- **Effort**: S

### w94 — plugin-log scattered import
- **Area**: `apps/desktop/src/utils/logger.ts:5,9`.
- **Observation**: `logger.ts` caches `typeof import('@tauri-apps/plugin-log')` in a module-level `tauriLog` ref and lazily loads it via `ensureLog()`. The cache + the `debug`/`info`/`warn`/`error`/`trace` facade are all tightly coupled to this single import. Not migrated in w94 because the logger is a hot-path foundational module — any indirection risks re-adding the first-import cost on every synchronous `logInfo` call.
- **Proposed change**: If centralisation is desired, expose `@/lib/tauri/log.ts` returning the already-cached handle (`loadTauriLog()`) and have `logger.ts` delegate. Benefit is marginal; cost is an extra indirection per log call.
- **Risk / why deferred**: Foundational module, hot path, already correctly guarded. Logged for completeness only.
- **Effort**: S

### w94 — plugin-notification scattered imports
- **Area**: `apps/desktop/src/composables/useAlertDispatcher.ts:72,151`.
- **Observation**: Two dynamic `@tauri-apps/plugin-notification` imports — one for `isPermissionGranted`/`requestPermission`/`sendNotification` in `sendNativeNotification`, one for `onAction`/`registerActionTypes` in `registerNotificationClickHandler`. Both are guarded by try/catch rather than `isTauri()`. Not folded into the w94 gateway because the notification surface is larger (permission flow, action registration) and warrants its own module.
- **Proposed change**: Add `@/lib/tauri/notification.ts` exposing `ensureNotificationPermission`, `sendTauriNotification(title, body, opts)`, `registerTauriNotificationAction({ id, title, onAction })`. Collapses the two call-sites + wraps the permission-grant dance once.
- **Risk / why deferred**: Requires a small API design pass so we don't just re-export the plugin 1:1. Safe to defer until a second caller appears.
- **Effort**: S

### w94 — SettingsLogging.vue bypasses @tracepilot/client
- **Area**: `apps/desktop/src/components/settings/SettingsLogging.vue:32`.
- **Observation**: `openLogDirectory()` calls `tauriInvoke('plugin:tracepilot|open_in_explorer', …)` via a dynamic `@tauri-apps/api/core` import rather than going through a typed wrapper in `@tracepilot/client`. Two issues: (a) it bypasses the `createInvoke` / mock fallback machinery, (b) it's the last remaining desktop-app dynamic import of `@tauri-apps/api/core` (the only legitimate one lives in `packages/client/src/invoke.ts`). Not migrated in w94 because it also carries a command-name string that should graduate to an `IPC_COMMANDS` entry first.
- **Proposed change**: Add `openInExplorer(path)` to `@tracepilot/client` (`packages/client/src/os.ts` or similar) backed by `createInvoke('plugin:tracepilot|open_in_explorer')` + a registry entry. Migrate the call-site.
- **Risk / why deferred**: Needs a small backend-command registry touch; separate concern from the Tauri-gateway sweep.
- **Effort**: S

### w94 — ChildApp.vue static emit import retained for teardown reliability
- **Area**: `apps/desktop/src/ChildApp.vue:1` (top-level `import { emit } from '@tauri-apps/api/event'`).
- **Observation**: Unlike every other call-site touched in w94, this one remains a **static** import (not routed through `tauriEmit` in `@/lib/tauri/event.ts`). The original comment — `async imports may not complete before the webview tears down during native window close` — explains why: during `onUnmounted` on the viewer window, a dynamic `await import('@tauri-apps/api/event')` can race the native window close and drop the `popup-session-closed` event, leaving the main window's monitored-set stale.
- **Proposed change**: Either (a) pre-warm the event module at `onMounted` time via `void tauriListen('__noop__', () => {}).then(un => un?.())`, then switch to `tauriEmit` in the teardown path; or (b) expose a `preloadTauriEvent()` helper from `@/lib/tauri/event.ts` that call-sites can fire-and-forget during mount.
- **Risk / why deferred**: Behaviour-preserving — the static import guarantees the plugin code is resident before teardown. Moving to dynamic without a pre-warm would be a regression on a reliability-critical path.
- **Effort**: S

### w98 — `tauri_specta::collect_events!` for IPC event payloads
- **Area**: `crates/tracepilot-tauri-bindings/src/events.rs`, `types.rs` (`IndexingProgressPayload`), `packages/client/src/events.ts`.
- **Observation**: Event names + payload shapes are still hand-mirrored between Rust (`events.rs` string constants + `helpers/emit.rs` calling `emit_best_effort` with `&IndexingProgressPayload`) and TS (`IPC_EVENTS` in `packages/client/src/events.ts`). Wave 98 deliberately skipped this because flipping to `#[derive(tauri_specta::Event)]` changes the default event name (derived from the type name) and the emit code path — both are wire-compat sensitive. The `"popup-session-closed"` string-raw event referenced in `App.vue`/`ChildApp.vue` is in the same boat.
- **Proposed change**: Introduce `collect_events!` in `specta_exports.rs`, derive `tauri_specta::Event` on `IndexingProgressPayload` (and a new empty struct for lifecycle events), fix the event name with `#[specta(rename = "indexing-progress")]`, and update `emit_best_effort` → `IndexingProgressPayload.emit(&app)`. Generate TS-side `events.indexingProgress.listen(...)` helpers.
- **Risk / why deferred**: Event-rename is a breaking IPC wire change if `rename` isn't pinned correctly; `emit()` semantics differ subtly from `emit_all()` around targeted windows. Needs a dedicated wave with before/after capture of every `listen()` call-site.
- **Effort**: M

### w98 — Flip `tauri::generate_handler!` to `Builder::invoke_handler()` once coverage is complete
- **Area**: `crates/tracepilot-tauri-bindings/src/lib.rs:100` (the `generate_handler![…]` block), `apps/desktop/src-tauri/build.rs` (command allowlist), `packages/client/src/commands.ts` (hand-written command-name registry).
- **Observation**: Today every newly-annotated command is registered twice — once in the runtime `generate_handler!` block and once in `collect_commands!` inside `specta_exports.rs`. The two must be kept in sync by hand (the `commandContract.test.ts` regex guard protects the desktop-side allowlist ↔ lib.rs pairing but **not** the specta list). The migration guide already calls out the intended end-state (`Builder::invoke_handler(...)`).
- **Proposed change**: Once every `#[tauri::command]` handler also carries `#[specta::specta]`, follow the "Plan: replacing `tauri::generate_handler!`" section of `docs/specta-migration-guide.md` in a single atomic wave — swap the runtime registry to `builder.build()`'s `invoke_handler`, drop the desktop `build.rs` allowlist (or derive it from specta), delete `packages/client/src/commands.ts` + `commandContract.test.ts`.
- **Risk / why deferred**: Requires 100% command coverage first; partial switchover is worse than either end state because it duplicates registration surface. Large fan-out into every IPC call-site.
- **Effort**: L

### w98 — Hand-written IPC wrappers still wrap generated commands
- **Area**: `packages/client/src/config.ts`, `packages/client/src/maint.ts`, `packages/client/src/sessions.ts` (plus every other file under `packages/client/src/*.ts`).
- **Observation**: Wave 98 migrated the **DTO types** to be generated but left the wrapper *functions* (`checkForUpdates()`, `getGitInfo()`, `validateSessionDir()`, `getDbSize()`, `getSessionCount()`, `isSessionRunning()`, `getInstallType()`) hand-written on top of the shared `invoke()` helper. The generated `commands.checkForUpdates()` in `packages/client/src/generated/bindings.ts` returns a `{ status: "ok", data } | { status: "error", error }` discriminated union, whereas the hand-written wrappers throw on error and return `T` directly — two incompatible error-handling contracts.
- **Proposed change**: Pick one contract for the whole client surface. Either (a) have wrappers delegate to `commands.x()` and translate the discriminated union back into throws for backwards compatibility, or (b) expose the `{ status }` union to consumers and migrate every call-site. Option (a) preserves call-sites; option (b) gives stronger typing at the cost of a large fan-out refactor.
- **Risk / why deferred**: Behaviour-preserving refactor touching every domain module + a large number of Vue components. Needs a dedicated wave after the `collect_events!` + `invoke_handler` cutovers so the end-state is coherent.
- **Effort**: L

### w99 — Auto-generate TS IPC_COMMANDS registry from the Rust manifest

- **Area**: `packages/client/src/commands.ts::IPC_COMMANDS` + `crates/tracepilot-tauri-bindings/src/ipc_command_names.rs`.
- **Observation**: w99 established `IPC_COMMAND_NAMES` as the Rust source of truth and emits `packages/client/src/generated/ipc-commands.json`. `IPC_COMMANDS` in TypeScript is still hand-maintained and merely verified-for-equality by the contract test. Two lists mean an engineer touching the surface still has to edit both sides and run `pnpm gen:bindings` — the test catches drift but doesn't prevent it.
- **Proposed change**: Have `gen-bindings` also emit `packages/client/src/generated/ipcCommands.ts` (`export const IPC_COMMANDS = [...] as const`) and re-export it from `packages/client/src/commands.ts`. Then delete the equality test (it becomes a tautology) in favour of the `generated.drift.test.ts` staleness check already in place.
- **Risk / why deferred**: Requires renaming `CommandName` type exports (downstream `apps/desktop` imports) and a workspace-wide import audit; also needs a decision on whether the generated TS file should live in `packages/client/src/generated/` (same directory as `bindings.ts`) or be merged into it. Out of scope for a 'replace regex test' wave.
- **Effort**: S

### w99 — Shared IPC contract check still parses `lib.rs` source text

- **Area**: `crates/tracepilot-tauri-bindings/src/lib.rs` (`ipc_manifest_tests::generate_handler_matches_manifest`).
- **Observation**: The Rust-side unit test added in w99 still `include_str!`'s `lib.rs` and does line-by-line parsing of the `tauri::generate_handler![]` block to extract command names. It's deterministic and dependency-free, but it's effectively the same shape of regex-ish check the TS test used to do — just relocated to Rust. If a future refactor moves the handler list into a macro or multiple files, the parser breaks.
- **Proposed change**: Once specta coverage in `specta_exports.rs` reaches 100% of commands (currently ~7/165), remove the `generate_handler!` invocation entirely and rely on `builder.mount_events(...)` / `builder.invoke_handler(builder.invoke_handler())` from `tauri-specta`. At that point `IPC_COMMAND_NAMES` and the specta builder share a single list and no source parsing is needed.
- **Risk / why deferred**: Blocked on the broader specta migration (master plan Phase 1B.*); w99's scope was the TS-side test only.
- **Effort**: M

### w100 ÔÇö Extend `narrowSessionEvent` coverage to remaining KNOWN event types
- **Area**: `packages/types/src/session-event-payloads.ts`.
- **Observation**: w100 introduced `NarrowedSessionEventPayload` with five tagged variants (`tool.execution_start`, `subagent.{started,completed,failed}`, `assistant.message`) plus a catch-all `unknown`. `TRACEPILOT_KNOWN_EVENTS` lists ~40 event types; the remainder (`session.*` lifecycle, `tool.execution_complete`, `user.message`, `assistant.turn_{start,end}`, `assistant.reasoning`, `hook.{start,end}`, `skill.invoked`, etc.) still flow through the `unknown` branch and require ad-hoc `isRecord`/`readString` narrowing at call sites.
- **Proposed change**: Flesh out the discriminated union with one variant per `TRACEPILOT_KNOWN_EVENT`, each typed to the fields the Rust backend actually emits (see `crates/tracepilot-core/src/models/event_types/`). Drive call-site migration from `SessionEvent.data` -> `narrowSessionEvent(event)` in `toolRenderer`, `turnReducer`, replay transform, etc. Eventually `SessionEvent.data` can be narrowed to `NarrowedSessionEventPayload` itself (current wire shape preserved, just typed tighter).
- **Risk / why deferred**: Requires field-level schema work against Rust sources (keeping the TS union in sync), plus refactoring every `event.data` consumer. Out of scope for w100's 3-subsystem budget.
- **Effort**: L

### w100 ÔÇö Narrow `BridgeEvent.data` via tagged union
- **Area**: `packages/types/src/sdk.ts` (`BridgeEvent`), `apps/desktop/src/stores/sdk/connection.ts` (`recentEvents`).
- **Observation**: `BridgeEvent` still declares `data: unknown`. No UI consumer currently reads `.data` (`recentEvents` is filtered by `sessionId` and rendered as a counter), so the lack of narrowing is latent debt rather than an active bug. The orchestrator bridge on the Rust side (`crates/tracepilot-orchestrator/src/bridge/mod.rs`) emits a fixed set of event kinds with stable payloads.
- **Proposed change**: Mirror the Rust `BridgeEvent` variants as a TS discriminated union keyed on `eventType` (same pattern as `NarrowedSessionEventPayload`). Expose `narrowBridgeEvent(ev)` and migrate any future UI that inspects payloads (e.g. a live SDK activity panel) to the tagged form.
- **Risk / why deferred**: Nothing consumes the payload today, so the refactor is purely anticipatory. Add when the first consumer arrives to avoid premature abstraction.
- **Effort**: M

### w100 ÔÇö Discriminated `TurnSessionEvent` (remove `checkpointNumber!` non-null assertion)
- **Area**: `packages/types/src/conversation.ts` (`TurnSessionEvent`), `apps/desktop/src/components/conversation/SessionEventRow.vue`.
- **Observation**: `TurnSessionEvent` declares `checkpointNumber?: number` as optional on all variants, even though it is only ever populated for `session.compaction_complete` events. `SessionEventRow.vue` uses `event.checkpointNumber!` (non-null assertion) inside the compaction branch because TS cannot narrow the optional field through the `isCompaction(event)` guard.
- **Proposed change**: Split `TurnSessionEvent` into a discriminated union `{ eventType: "session.compaction_complete"; checkpointNumber?: number } | { eventType: string; ...}`; add an `isCompactionTurnEvent(evt): evt is CompactionTurnSessionEvent` narrow helper. Replace the non-null assertion with the narrowed type.
- **Risk / why deferred**: Requires auditing every `TurnSessionEvent` construction site (turn reducer, mock data, tests) to tag each event. Low risk but touches many files; deferred to keep w100 surgical.
- **Effort**: S

### w101 — `#[allow(clippy::needless_question_mark)]` on `blocking_cmd!` macro
- **Area**: `crates/tracepilot-tauri-bindings/src/commands/blocking_helper.rs`.
- **Observation**: The `blocking_cmd!` macro expands to `Ok(spawn_blocking(...).await??)`. Clippy sees a macro-local `Ok(...?)` and suggests dropping the wrap, but the `?` operators are doing `From::from` conversion from `JoinError` and the callsite-specific error type into the command's `CmdResult<T>`. Removing the wrap would force every call site to already return the exact matching `Result<T, E>`.
- **Proposed change**: If `spawn_blocking` gets a dedicated thin wrapper type with a custom `Try` impl (or we land a unified `CmdError` across all commands) this allow can be removed.
- **Risk / why deferred**: Cosmetic; macro is widely used and correct today.
- **Effort**: S

### w101 — `#[allow(clippy::should_implement_trait)]` on `TaskStatus::from_str` / `JobStatus::from_str`
- **Area**: `crates/tracepilot-orchestrator/src/task_db/types.rs`.
- **Observation**: Both enums expose inherent `from_str(&str) -> Option<Self>` helpers. Implementing `std::str::FromStr` would force a `Result<Self, E>` signature, losing the `Option` contract that call sites rely on (`db_row.get(col).ok().and_then(TaskStatus::from_str)`).
- **Proposed change**: Offer `FromStr` *alongside* the inherent method (with an `InvalidStatus` error type) once a call site actually wants `?`-style parsing. Then deprecate the `Option` helper.
- **Risk / why deferred**: Behaviour-preserving but cross-cutting — every consumer of `from_str` needs auditing. Out of scope for the clippy-gate wave.
- **Effort**: S

### w101 — `#[allow(clippy::too_many_arguments)]` on Tauri command signatures
- **Area**: `crates/tracepilot-tauri-bindings/src/commands/tasks/crud.rs` (`task_create`, 9 args), `crates/tracepilot-tauri-bindings/src/commands/search.rs` (`facets_cache_key`, 8 args).
- **Observation**: Tauri commands receive `State<'_, ...>` handles plus user params; the IPC contract (and the TypeScript bindings generated via specta) pin the argument names and ordering. Collapsing into a params struct would be a breaking IPC change.
- **Proposed change**: When the command-generation story allows bundling state handles implicitly (or when we reshape the IPC surface as part of a broader refactor), these allows can come off.
- **Risk / why deferred**: Breaking change to the frontend bindings — not worth it for a lint.
- **Effort**: M

### w101 — `#[allow(clippy::type_complexity)]` on `load_cached_typed_events`
- **Area**: `crates/tracepilot-tauri-bindings/src/commands/session/shared.rs`.
- **Observation**: Return type is a 3-tuple `(Arc<Vec<TypedEvent>>, u64, Option<SystemTime>)`; factoring into a `type` alias would hide locally-meaningful semantics (cached events + file size + mtime) without any reuse.
- **Proposed change**: Introduce a named `struct CachedTypedEvents` if a second caller ever needs the tuple.
- **Risk / why deferred**: Cosmetic; single-call-site.
- **Effort**: S

### w101 — `cargo clippy` not yet gated for `tracepilot-desktop`
- **Area**: `.github/workflows/ci.yml`.
- **Observation**: CI now runs `cargo clippy --workspace --exclude tracepilot-desktop --all-targets -- -D warnings`. The desktop crate still pulls in `tauri::generate_context!` output plus Tauri-specific generated code that has its own lint posture.
- **Proposed change**: Audit `tracepilot-desktop` under `-D warnings`, add targeted allows in `main.rs` around the `generate_context!` site, then drop the `--exclude`.
- **Risk / why deferred**: Not required to make the other ~13 crates hard-fail on warnings. Low urgency.
- **Effort**: S
### w102 — Store non-null assertions in SdkSteering composable

- **Area**: `apps/desktop/src/composables/useSdkSteering.ts`
- **Observation**: `effectiveSessionId.value!` appears 3× on hot steering paths. Each is currently guarded by a preceding `isLinked.value`/`sessionIdRef.value` early-return, but the coupling is implicit and suppressed via `biome-ignore`.
- **Proposed change**: Introduce a `requireSessionId()` helper (or narrow `effectiveSessionId` to `ComputedRef<string>` via a type guard) so callers get compiler-enforced non-null guarantees.
- **Risk / why deferred**: Touches the steering store contract; safer as a follow-up with targeted tests.
- **Effort**: S

### w102 — TabNav dual-mode (v-model vs router) coupling

- **Area**: `packages/ui/src/components/TabNav.vue`
- **Observation**: `router!`/`route!`/`props.modelValue!` rely on `isLocalMode` branches but the compiler cannot see the correlation; three `biome-ignore` comments paper over it.
- **Proposed change**: Split into `<TabNavLocal>` (v-model) and `<TabNavRouter>` (router-driven) with a thin re-export wrapper. Each variant has a single, type-safe contract.
- **Risk / why deferred**: Public component in `@tracepilot/ui`; would change public API and requires sweep across desktop call sites.
- **Effort**: M

### w102 — `useStoreHelpers.runGuarded` optional-guard contract

- **Area**: `packages/ui/src/composables/useStoreHelpers.ts`
- **Observation**: `opts.guard!` is dereferenced 3× inside a `token !== undefined` branch. The invariant ("guard must be provided whenever token is") is implicit.
- **Proposed change**: Encode as a discriminated-union overload: `{ token: Token; guard: Guard } | { token?: undefined; guard?: undefined }`.
- **Risk / why deferred**: Touches a helper used by multiple stores; needs fan-out audit and store signature updates.
- **Effort**: S

### w102 — Connection store `try/catch` helpers inflate line count

- **Area**: `apps/desktop/src/stores/sdk/connection.ts`
- **Observation**: Six `try { x = await y(); } catch (e) { logWarn(...) }` blocks each expand to 5 lines post-biome-format, pushing the file from 292 → 307 and past the `ts.store` 300-line budget. Currently allow-listed.
- **Proposed change**: Extract a local `swallowLog<T>(label, fn)` helper and inline the assignments; trims ~15 lines and restores budget headroom.
- **Risk / why deferred**: Risk of subtly changing error-logging semantics; best paired with a store-wide test pass.
- **Effort**: S

### w102 — Orbital DOM layer forEach → for-of

- **Area**: `apps/desktop/src/composables/orbitalDomLayers.ts`, `orbitalConnections.ts`
- **Observation**: Fixed biome `useIterableCallbackReturn` by wrapping single-expression arrows in block bodies. A `for...of` loop would be equivalent and often more idiomatic for pure side-effect iteration.
- **Proposed change**: Replace `.forEach((el) => { el.remove(); });` blocks with `for (const el of ...) { el.remove(); }`.
- **Risk / why deferred**: Stylistic; no behavioural impact.
- **Effort**: S

### w102 — `search-palette-results.css` excluded from biome

- **Area**: `apps/desktop/src/components/search/search-palette-results.css`
- **Observation**: Uses Vue's `:deep()` pseudo from an external `.css` file imported via `<style scoped src="...">`. Biome cannot parse this outside a `.vue` SFC, so the file is now excluded from biome check.
- **Proposed change**: Inline this CSS into `SearchPaletteResults.vue`'s `<style scoped>` block (or rename/retarget the `:deep()` rule to an unscoped class) so the file can re-enter the biome check.
- **Risk / why deferred**: Minor cross-cutting change; wants a visual-regression check.
- **Effort**: S

### w102 — Test suppressions for `noNonNullAssertion` + `noExplicitAny`

- **Area**: `biome.json` overrides
- **Observation**: Wave 102 added a blanket override disabling `noNonNullAssertion` and `noExplicitAny` under `**/__tests__/**`, `**/*.test.ts`, `**/*.spec.ts` to keep CI hard-fail feasible. ~130 test assertions use `!` and ~10 use `any` for mock shapes.
- **Proposed change**: Replace `!` with `expect(x).toBeDefined()` or type-safe factories; replace `any` with `unknown`/explicit `Mock<...>` types.
- **Risk / why deferred**: Breadth (~140 call sites). Purely quality-of-life; tests are green.
- **Effort**: L

### w102 — `!important` CSS hotspots

- **Area**: `apps/desktop/src/styles/features/{skill-editor,todo-dependency-graph,model-comparison,waterfall}.css`
- **Observation**: 9 `!important` declarations suppressed with reasons. Most exist to override either globally-scoped markdown styles or inline styles set by d3.
- **Proposed change**: Scope the markdown preview under a dedicated class and move d3 inline-style writes behind CSS custom properties so the cascade handles them.
- **Risk / why deferred**: Requires design review; touches the skill editor preview pipeline.
- **Effort**: M

### w103 — Add opt-in pre-push unit-test hook

- **Area**: `lefthook.yml` (`pre-push`)
- **Observation**: `pnpm --filter @tracepilot/desktop test` currently runs ~45s end-to-end, which is too slow to wire unconditionally into `pre-push` without annoying developers who push frequently. Wave 103 therefore deliberately left `pre-push` at typecheck + rustfmt-all + filesize only.
- **Proposed change**: Once the vitest suite is sharded / parallelised to <15s (e.g. by splitting stores/composables out of the `apps/desktop` project, or running `--changed` against `origin/main`), add a `test` command to `pre-push` using `vitest related {push_files}` semantics.
- **Risk / why deferred**: Performance — a 45s pre-push hook trains developers to `--no-verify`, defeating the gate. Needs a fast-path first.
- **Effort**: M

### w103 — `commit-msg` conventional-commit check extracted to a script file

- **Area**: `lefthook.yml` (`commit-msg.conventional-commit`) — **done in w103**
- **Observation**: The hook used to be a ~400-char `node -e` one-liner embedded in YAML. Under lefthook ≥2.1 it was passed to node in a way that left only `const` in the eval string (`SyntaxError: Unexpected end of input`) — the commit-msg gate was effectively broken on Windows.
- **Proposed change**: Extracted to `scripts/check-commit-msg.mjs`, invoked via `node scripts/check-commit-msg.mjs {1}`. Follow-up (deferred): add a small vitest covering pass/fail regex cases.
- **Risk / why deferred**: Extraction itself was in-scope for w103 (blocked the gate); only the follow-up test is deferred.
- **Effort**: S

### w103 — Per-file `rustfmt` in pre-commit duplicates workspace `rustfmt.toml`

- **Area**: `lefthook.yml` (`pre-commit.rustfmt`)
- **Observation**: The hook passes `--edition 2024` explicitly because `rustfmt` invoked on a single file path does not always auto-discover the workspace `rustfmt.toml` when run from a subdirectory. Today `rustfmt.toml` sets `edition = "2024"` too, so the two sources of truth agree — but they can drift.
- **Proposed change**: Either drop `--edition` from the hook once rustfmt auto-discovery is reliable on Windows, or teach `rustfmt.toml` to be the sole source and assert equality in a CI sanity check.
- **Risk / why deferred**: Low; cosmetic. Catching drift is better done at the CI level.
- **Effort**: S

### w107 — `pnpm typecheck` is broken on `main` (pre-existing)

- **Area**: `packages/client/src/__tests__/commandContract.test.ts:39`
- **Observation**: `pnpm typecheck` (and therefore `just typecheck`) fails with `TS2345: Argument of type 'string' is not assignable to parameter of type '"list_sessions" | ...'`. The test passes a plain `string` where the new command-name union is expected. This was already broken before w107 (the justfile recipe just surfaces it).
- **Proposed change**: Narrow the test's iteration variable to `CommandName` (or cast via `as CommandName`) so the contract test compiles against the generated bindings.
- **Risk / why deferred**: Out of scope for a scripting-only wave — needs a deliberate decision on whether `commandContract.test.ts` should be re-generated or re-typed. Blocks `just ci` / `just typecheck` being fully green until fixed.
- **Effort**: S

### w107 — `just` is not yet a documented prerequisite

- **Area**: `README.md` (`## Development`), `docs/` onboarding
- **Observation**: w107 introduces a root `justfile`, but the README's Development section still documents the raw `pnpm` / `cargo` commands and makes no mention of `just`. New contributors will not discover it unless they run `ls` at the repo root.
- **Proposed change**: Add a short "Task runner" subsection under `## Development` pointing at `just --list` and linking to https://github.com/casey/just. Optionally call out the Windows install (`winget install Casey.Just`).
- **Risk / why deferred**: The task explicitly says "leave README alone unless there's a Development section — short mention only". Deferred to a dedicated docs pass that can also refresh the surrounding Testing / Benchmarks subsections together.
- **Effort**: S

### w107 — No `just` CI smoke-test

- **Area**: `.github/workflows/ci.yml`
- **Observation**: The `ci` recipe duplicates the exact sequence CI runs, but nothing enforces that the two stay in sync. A future edit to `ci.yml` (e.g. adding a new gate) will silently diverge from `just ci`.
- **Proposed change**: Either (a) have one CI job invoke `just ci` directly (installs `just` via `extractions/setup-just@v2`), or (b) add a lightweight workflow step that greps `justfile` for the same command set used in `ci.yml`.
- **Risk / why deferred**: Option (a) is the cleanest but requires re-shaping the CI matrix and adding a new action dependency — deserves its own wave with a rollback plan. Option (b) is brittle.
- **Effort**: M

### w107 — Recipe comments that start with non-word chars render oddly in `just --list`

- **Area**: `justfile`
- **Observation**: `just 1.50.0` renders doc comments containing em-dashes / colons with no space between the recipe name and the comment for short recipe names (e.g. `ci`, `dev`, `fmt`, `test`). Cosmetic only; the recipes execute correctly.
- **Proposed change**: Either pad short recipe names or rephrase the doc comments to start with a plain ASCII word. Alternatively, upgrade to a newer `just` once the formatting bug is fixed upstream.
- **Risk / why deferred**: Purely cosmetic — not worth churning the comments for.
- **Effort**: S



### w104 — Unified version-policy script for catalog drift detection
- **Area**: `scripts/` (new) + `pnpm-workspace.yaml`.
- **Observation**: After hoisting 12 deps into the default pnpm catalog, nothing prevents a future contributor from re-introducing a per-package pin (e.g. bumping `vitest` in one package.json). A small script could scan every `package.json` for any dep that also appears in the catalog and flag direct version strings as drift.
- **Proposed change**: Add `scripts/check-catalog-drift.mjs` that reads `pnpm-workspace.yaml` plus every `package.json`, failing CI if a catalogued dep is pinned directly anywhere. Wire into `pnpm lint` or a new `check:catalog` script.
- **Risk / why deferred**: Adds a new gate — worth its own wave with team sign-off rather than tacking onto the catalog adoption.
- **Effort**: S

### w104 — Renovate / Dependabot catalog support
- **Area**: `.github/` renovate or dependabot config.
- **Observation**: Renovate added native `pnpm` catalog support relatively recently; Dependabot still does not understand catalog entries and will stop opening PRs for the 12 hoisted deps. This silently freezes upgrade cadence.
- **Proposed change**: Evaluate switching to Renovate (preset `config:recommended` + `pnpm` manager) or confirm Dependabot coverage and document the gap. Either way, the chosen bot should be able to bump `pnpm-workspace.yaml` directly.
- **Risk / why deferred**: Requires choosing between bots and configuring the winner — larger scope than the catalog refactor itself.
- **Effort**: M

### w104 — Further catalog opportunities (peerDependencies, single-user deps)
- **Area**: `packages/test-utils/package.json`, `packages/ui/package.json`.
- **Observation**: `test-utils` declares `vue` / `pinia` as peerDependencies with hard-coded ranges, and `ui` has `vue-router` as both a peer (`^4.0.0`) and a devDep (`^4.6.4`). pnpm catalogs work in peerDependencies too, and unifying these would ensure the peer range always tracks the consumer's pinned version. Additionally, deps currently used by only one workspace (`pinia`, `@tauri-apps/plugin-*`, `@playwright/test`) could still benefit from catalogs if a second consumer arrives.
- **Proposed change**: Migrate peerDeps to `catalog:` references where the exact range is intentional; set up a named catalog (`catalog:tauri`) if more plugins land; revisit single-consumer deps each wave.
- **Risk / why deferred**: Peer-dep semantics differ slightly — touching them risks changing the resolution surface for downstream consumers; deserves explicit validation.
- **Effort**: S

### w105 — Re-evaluate default-on `copilot-sdk` feature
- **Area**: `crates/tracepilot-orchestrator/Cargo.toml`, `crates/tracepilot-tauri-bindings/Cargo.toml`, `apps/desktop/src-tauri/Cargo.toml`.
- **Observation**: The `copilot-sdk` feature is default-on everywhere and pulls a git dependency (`copilot-community-sdk/copilot-sdk-rust` @ `2946ba1`). All shipping builds include it, and CI never exercises the `--no-default-features` path. The `#[cfg(not(feature = "copilot-sdk"))]` stubs in `bridge/manager/*` are therefore an untested alternate reality.
- **Proposed change**: Either (a) add an explicit CI job that builds `tracepilot-orchestrator --no-default-features` so the stubs stay honest, or (b) drop the feature entirely, delete the ~20 stub branches, and hard-require the SDK. Option (b) removes a ~3x multiplier from the feature-matrix of `bridge/manager/`.
- **Risk / why deferred**: Product decision — do we want an SDK-less build path for air-gapped/bisect scenarios? If yes, option (a); if no, option (b). Either way is breaking-ish for out-of-tree consumers.
- **Effort**: S (option a) / M (option b)

### w105 — No workspace lint on unused optional deps
- **Area**: Cargo feature hygiene across `crates/`.
- **Observation**: `tracepilot-tauri-bindings` had `copilot-sdk = { workspace = true, optional = true }` plus `"dep:copilot-sdk"` in its feature list despite the crate never importing `copilot_sdk::*` (the SDK is used transitively via `tracepilot-orchestrator`). This only surfaced by grepping `use copilot_sdk`. Cargo has no built-in warning for optional deps that are declared but unused in the crate's own source.
- **Proposed change**: Add a pre-commit or CI script that, for each crate, intersects `[dependencies.*]` with `use <crate>::` references (normalising `-` → `_`) and flags mismatches. Run in `lefthook` pre-push.
- **Risk / why deferred**: Script-complexity — has to understand re-exports and macro-generated `use`s. Nice-to-have, not urgent.
- **Effort**: M

### w105 — No local `tracepilot-copilot-sdk` crate exists
- **Area**: Workspace layout vs. tech-debt master plan.
- **Observation**: The w105 plan entry targets a `tracepilot-copilot-sdk` crate that doesn't exist in this workspace — the SDK is an external git dependency consumed by `tracepilot-orchestrator` and forwarded through `tracepilot-tauri-bindings` → `tracepilot-desktop`. The wave therefore operated on the `copilot-sdk` *feature chain* rather than an SDK crate.
- **Proposed change**: Update `docs/tech-debt-master-plan-2026-04.md` so future waves reference the actual crate names (`tracepilot-orchestrator` for bridge/SDK concerns). Alternatively, extract the `bridge/manager/` module into its own `tracepilot-copilot-sdk-bridge` crate to match the intent of the plan.
- **Risk / why deferred**: Doc-only fix is cheap; the extraction is a multi-wave refactor touching every `#[cfg(feature = "copilot-sdk")]` site.
- **Effort**: S (doc) / L (extraction)

### w108 — `style-src 'unsafe-inline'` still required
- **Area**: `apps/desktop/src-tauri/tauri.conf.json` (`app.security.csp`) + ~130 `:style=` bindings across `apps/desktop/src/**/*.vue`.
- **Observation**: Vue's reactive `:style="{ ... }"` bindings compile to direct `element.style.*` assignments *and* Vue also serialises the bound values into the element's `style` attribute for SSR/hydration parity. Browsers enforce `style-src` against any inline `style=` attribute, so the CSP must keep `'unsafe-inline'` until every `:style=` binding is gone. w91 reduced the count substantially but dynamic cases remain (Sankey widths, agent-tree transforms, chart fills, timeline offsets).
- **Proposed change**: Convert remaining `:style` bindings to class-plus-CSS-custom-property form: static token → utility class, dynamic numeric → `style="--x: 42"` via a CSS variable the scoped stylesheet consumes. Once `grep -rn ':style=' apps/desktop/src | wc -l` is 0, drop `'unsafe-inline'` from `style-src` and add a Playwright smoke test that fails on any `SecurityPolicyViolation` event.
- **Risk / why deferred**: Behaviour-equivalence refactor across ~50 components; needs its own wave. Also note `'unsafe-inline'` on `style-src` (but not `script-src`) is generally considered low-severity — it enables style injection but not code execution.
- **Effort**: L

### w108 — Nonce-based CSP for even stricter style policy
- **Area**: `apps/desktop/src-tauri/tauri.conf.json` + Tauri runtime CSP injection.
- **Observation**: Tauri supports CSP nonce injection (`__TAURI_CSP_NONCE__`) that allows switching `'unsafe-inline'` to `'nonce-<random>'` for each window load. This would be a stronger mitigation than removing `:style` bindings because any future regression is automatically blocked.
- **Proposed change**: Switch to `style-src 'self' 'nonce-{nonce}'` and configure Tauri's `dangerousDisableAssetCspModification` + `csp` nonce flow. Requires either server-side HTML templating or Vite plugin that injects the nonce into every `<style>` block — not trivial for runtime-generated inline style attributes from Vue, which cannot carry a nonce.
- **Risk / why deferred**: Inline `style=` attributes on arbitrary elements (which is what Vue `:style` produces) cannot be nonced — only `<style>` elements can. So nonces alone don't solve the w91/w108 problem; the refactor above is still the real fix.
- **Effort**: M (nonces on `<style>` tags) / L (combined with w91 refactor)

### w108 — Add Playwright CSP-violation guard
- **Area**: `apps/desktop/tests/` (no e2e harness yet for CSP) + CI.
- **Observation**: Current CI has no regression guard against someone adding an inline `<script>` in `index.html` or re-introducing `'unsafe-inline'` in `script-src`. A single commit could silently weaken the CSP.
- **Proposed change**: (a) add a unit test that reads `dist/index.html` after `pnpm --filter @tracepilot/desktop build` and asserts every `<script>` has a `src=` (no inline bodies); (b) add a snapshot test of the `tauri.conf.json` `csp` string so any change must be deliberate and reviewed; (c) longer-term, a Playwright/Tauri smoke that opens each route and listens for `securitypolicyviolation` events on `window`.
- **Risk / why deferred**: Security-adjacent test infra; wants its own wave alongside w108's deeper refactor so the smoke test can prove the stricter CSP works.
- **Effort**: S (static tests) / M (Playwright)

### w110 — Property-based path-traversal testing with proptest
- **Area**: `crates/tracepilot-tauri-bindings/src/validators/path.rs` and `helpers/path.rs`.
- **Observation**: Current validator tests are example-based (hand-picked `..`, `\\server\share`, `\0`, etc.). A dedicated `proptest` strategy generating arbitrary mixes of path separators, UTF-8 codepoints, control bytes and Windows device-name variants would give far stronger coverage of the `validate_path_segment` / `validate_path_within` seams, especially for subtle Windows edge cases (trailing dots/spaces, NTFS alternate data streams via `:`, 8.3 short names).
- **Proposed change**: add `proptest` as a dev-dependency on `tracepilot-tauri-bindings` and encode two invariants: (1) any input containing `..` / `/` / `\\` / `\0` is rejected; (2) any accepted input joined onto a trusted parent canonicalises back to inside that parent. Gate behind a `proptest` feature so default `cargo test` stays fast.
- **Risk / why deferred**: adds a dev-dep and 1-2s per CI run; non-trivial to write strategies that shrink well. Deferred to a wave that can also add proptest to a few adjacent validators for consistency.
- **Effort**: M

### w110 — Symlink-resolving validator that works before the file exists
- **Area**: `crates/tracepilot-tauri-bindings/src/helpers/path.rs`.
- **Observation**: `validate_write_path_within` canonicalises the *parent* when the target does not yet exist. An attacker who can race-create a symlink as the parent between validation and open would defeat the check (classic TOCTOU). We partially mitigate in the file-browser by re-canonicalising after `exists()`, but the generic helper cannot.
- **Proposed change**: adopt `openat2(RESOLVE_NO_SYMLINKS|RESOLVE_BENEATH)` on Linux and `NtCreateFile` + `OBJ_DONT_REPARSE` on Windows so validation + open is a single, atomic syscall. Fall back to the current two-step canonicalise for platforms without the primitive.
- **Risk / why deferred**: requires unsafe FFI on Windows and kernel ≥5.6 on Linux; significant surface area for a modest hardening over current behaviour (which already blocks the common cases). Deferred because current TOCTOU windows are short and the attacker needs write access to the session dir.
- **Effort**: L

### w110 — Windows UNC / extended-length / verbatim-path hardening
- **Area**: `crates/tracepilot-tauri-bindings/src/helpers/path.rs::normalize_canonicalized`.
- **Observation**: `normalize_canonicalized` strips the `\\?\` prefix only for drive-rooted paths and leaves UNC paths alone. Other Windows extended-length forms (`\\?\UNC\` vs `\\.\` device namespace, forward-slash vs backslash normalisation) are not exhaustively tested. An adversarial path like `\\.\GLOBALROOT\...` would be rejected today (it doesn't canonicalise to anywhere under copilot_home) but we don't have a regression test for that specifically.
- **Proposed change**: add an explicit allow-list of accepted Windows path prefixes and reject `\\.\` device paths, `\\?\GLOBALROOT\`, and NT object-namespace paths up front, before canonicalize. Add tests covering each of these.
- **Risk / why deferred**: low-probability attack surface; would need Windows-only test fixtures. Batch with the broader UNC test matrix when a dedicated Windows QA wave runs.
- **Effort**: S

### w115 — ADR-0007: Skill model (discovery, loading, invocation)
- **Area**: `crates/tracepilot-orchestrator/src/skills`, `apps/desktop/src/stores/skills.ts`.
- **Observation**: The skill model (`UserSkill` vs `ProjectSkill`, discovery precedence, runner lifecycle, sandboxing policy) is substantial and currently only documented by the code itself plus ad-hoc notes. Wave 115 landed 0001-0006 but skills deserved their own ADR.
- **Proposed change**: Write ADR-0007 covering skill discovery (dirs walked + precedence), manifest schema, runner lifecycle (`hidden_command` + timeouts per ADR-0004), and failure isolation guarantees.
- **Risk / why deferred**: Wave 115 scope was the six foundational ADRs; adding a seventh would have pushed the wave past the 200-line-per-ADR budget and delayed the index.
- **Effort**: M

### w115 — ADR-0008: MCP hosting model
- **Area**: `crates/tracepilot-orchestrator/src/mcp`.
- **Observation**: MCP (Model Context Protocol) server hosting — how servers are declared, started, probed for health, crashed-server restart policy, stdio vs SSE transport selection — is a cross-cutting architectural concern without a dedicated ADR. The `mcp::error` sub-enum (ADR-0005) hints at a non-trivial taxonomy that isn't captured in prose.
- **Proposed change**: Write ADR-0008 covering server lifecycle, transport choice, version negotiation, and how MCP tool invocations surface through the IPC contract.
- **Risk / why deferred**: MCP hosting is still evolving upstream; an ADR written today would need revision when the spec moves. Write once the spec stabilises.
- **Effort**: M

### w115 — ADR-0009: Bridge lifecycle + discovery
- **Area**: `crates/tracepilot-orchestrator/src/bridge`.
- **Observation**: The bridge (session discovery, UI server, manager state) has its own lifecycle — startup ordering, reconnection, broadcast-channel fan-out (`sdk_bridge_metrics` in generated bindings), `RecvError::Lagged` handling. All of this is embedded in module docs but not captured as a single architectural decision.
- **Proposed change**: ADR-0009 documenting the bridge state machine, broadcast channel capacity choices, lag-recovery policy, and shutdown ordering guarantees.
- **Risk / why deferred**: Requires a day's archaeology across `bridge/manager/`, `bridge/discovery.rs`, `bridge/manager/ui_server.rs`. Scoped for a dedicated wave.
- **Effort**: M

### w115 — ADR for UI routing / window model
- **Area**: `apps/desktop/src/router`, multi-window plumbing.
- **Observation**: Window-per-session vs single-window-with-tabs was decided implicitly by the multi-window-architecture doc but never lifted into an ADR. Router conventions (route naming, guards, lazy chunks) are similarly informal.
- **Proposed change**: ADR covering the window model (single main + spawned auxiliary windows), router structure, and how stores interact with multiple windows (shared vs per-window state).
- **Risk / why deferred**: Multi-window plumbing is still stabilising; premature ADR would need superseding.
- **Effort**: M

### w115 — ADR for build/release pipeline + signing
- **Area**: `.github/workflows/release.yml`, `tauri.conf.json`, `cliff.toml`.
- **Observation**: Release artefacts, signing/notarisation, auto-updater feed format, SLSA provenance (planned in w112) — these are architectural in the sense that they shape downstream consumers' trust model. No ADR captures them today.
- **Proposed change**: Once w111–w113 land, write an ADR capturing the final release pipeline, artefact formats, and the updater contract.
- **Risk / why deferred**: Blocked on w111 (multi-OS) + w112 (SBOM/SLSA) + w113 (git-cliff). Write after those ship.
- **Effort**: S (mostly documenting what's there)

### w115 — ADR template linter / CI gate
- **Area**: `scripts/`, `docs/adr/`.
- **Observation**: Nothing enforces that new ADRs follow the template, have a status line, or appear in the index. Drift is predictable.
- **Proposed change**: Add a `scripts/check-adr.mjs` that validates each `docs/adr/NNNN-*.md` has the required headings (Context, Decision, Consequences, Alternatives considered), parses `Date:` and `Status:`, and asserts it's listed in `docs/adr/README.md`. Wire into CI.
- **Risk / why deferred**: Minor new tooling + a CI job; out of scope for the docs-only Wave 115.
- **Effort**: S


### w128 — Rustdoc front-page polish for workspace crates

- **Area**: crates/*/src/lib.rs.
- **Observation**: Several crates (`tracepilot-bench`, `tracepilot-test-support`, `tracepilot-indexer`, `tracepilot-orchestrator`) have a one-line crate docstring or none, so `cargo doc` rendering is thin. Only `tracepilot-core` and `tracepilot-export` currently ship a meaningful front page.
- **Proposed change**: Expand each `//!` block with a short architecture overview + a doctested usage snippet, matching the `tracepilot-core` style. Consider a workspace-level `#![deny(rustdoc::broken_intra_doc_links)]` once front pages are in place.
- **Risk / why deferred**: Wave 128 is README-focused; expanding crate-level rustdoc without new tests risks doc-test churn and is a separate editorial pass.
- **Effort**: M

### w128 — Typedoc setup for TypeScript workspace packages

- **Area**: `packages/client`, `packages/types`, `packages/ui`, `packages/test-utils`.
- **Observation**: README files now enumerate the public API, but there is no generated reference. Consumers and new contributors have no hyperlinked docs for the ~150 exported names in `@tracepilot/client` + `@tracepilot/types`.
- **Proposed change**: Add a minimal `typedoc` config at the workspace root that ingests each package's `src/index.ts` and emits markdown under `docs/api/<package>/`. Wire to a `pnpm docs` script; optionally publish via GitHub Pages in a follow-up.
- **Risk / why deferred**: Introduces a new dev-dep and a docs site scope decision (Pages? `docs/`? external?). Out of scope for the docs-only Wave 128.
- **Effort**: M

### w128 — CI doc-lint for broken markdown cross-references

- **Area**: `scripts/`, `.github/workflows/`.
- **Observation**: Package READMEs link heavily into `docs/adr/NNNN-*.md` and sibling package READMEs with relative paths. Nothing verifies those links resolve — a rename of any ADR silently breaks every reference.
- **Proposed change**: Add a `scripts/check-doc-links.mjs` that walks `**/README.md` and `docs/**/*.md`, extracts relative markdown links, and asserts each target exists (and, for anchors, that the heading exists). Run in CI alongside `check-file-sizes.mjs`.
- **Risk / why deferred**: Small new script + CI job; out of scope for the docs-only Wave 128 but the obvious next step.
- **Effort**: S

### w128 — Per-package `docs/` subfolders for long-form notes

- **Area**: `packages/*`, `crates/*`.
- **Observation**: Some packages (`@tracepilot/ui`, `tracepilot-core`) have content in the README that is really reference material (token list, event pipeline). Once READMEs grow past ~150 lines they stop being skimmable.
- **Proposed change**: Introduce a convention: `README.md` stays short; deeper notes go in `packages/<name>/docs/*.md` (or `crates/<name>/docs/*.md`) linked from the README. Rehome the `@tracepilot/ui` token list and the `tracepilot-core` event-pipeline notes as the first move.
- **Risk / why deferred**: Editorial refactor; benefits compound as docs grow but not urgent. Revisit when the next crate README would otherwise exceed the 150-line guideline.
- **Effort**: M

### w121 — Wire `perf-budget.json` IPC budgets into CI
- **Area**: `.github/workflows/`, `scripts/`, `crates/tracepilot-bench/`.
- **Observation**: Wave 121 landed the `ipc_hot_path` Criterion bench and recorded baselines in `crates/tracepilot-bench/BASELINE.md`, but nothing enforces the budgets in `perf-budget.json` (`ipc.*Ms`). A regression would slip through until someone manually re-ran the bench.
- **Proposed change**: Add a `scripts/check-ipc-budget.mjs` (or equivalent) that parses Criterion's JSON output (`target/criterion/**/estimates.json`), maps each benchmark group to an `ipc.*Ms` key, and fails if the P95 exceeds the budget. Wire it into the existing perf CI job so the bench runs on every PR.
- **Risk / why deferred**: Criterion runtimes are noisy on shared CI hardware; needs either a dedicated runner or generous tolerance bands. Budget mapping also needs one-time curation.
- **Effort**: M

### w121 — End-to-end Tauri IPC bench harness
- **Area**: `apps/desktop/`, `crates/tracepilot-bench/`.
- **Observation**: `ipc_hot_path` benches the Rust service layer directly (`IndexDb::list_sessions_filtered` etc.) because wiring the full Tauri runtime + webview + IPC bridge from Criterion is infeasible on headless CI. That means the bench misses bridge serialization framing, permission checks, and `AppState` lock contention.
- **Proposed change**: Build a dedicated `apps/desktop`-level harness (Tauri mock runner or `tauri::test`) that spins up a real `AppHandle` against an in-memory DB and invokes commands via `invoke_handler`. Report the delta vs the pure-Rust baseline so we can quantify bridge overhead.
- **Risk / why deferred**: Needs Tauri 2 test harness + careful teardown; cross-platform (macOS/Windows/Linux) runners required. Significant scope.
- **Effort**: L

### w121 — Flame-graph capture for IPC hot paths
- **Area**: `crates/tracepilot-bench/`, `docs/`.
- **Observation**: Baselines in `BASELINE.md` tell us *what* is slow but not *why*. When a regression does hit, contributors will want a ready-made way to capture flame graphs for the same fixtures the bench uses.
- **Proposed change**: Add a `just bench-flamegraph` (or `scripts/bench-flamegraph.ps1`) wrapper that runs `cargo bench --bench ipc_hot_path` under `cargo-flamegraph` (or `samply` on Windows) and drops SVGs into `target/flamegraphs/`. Document in the README.
- **Risk / why deferred**: Requires an external profiler dependency; not portable to all CI runners. Optional developer tool, not a gate.
- **Effort**: S

### w121 — Bench additional IPC commands not yet covered
- **Area**: `crates/tracepilot-bench/benches/ipc_hot_path.rs`.
- **Observation**: `perf-budget.json` lists `getSessionDetailMs`, `getSessionTurnsMs`, `reindexSessionsMs`, `checkSystemDepsMs`, `getShutdownMetricsMs` and `getWorktreeDiskUsageMs`. Most are already measured transitively (`parsing`, `indexer` benches) or depend on filesystem side effects (`worktree`, `checkSystemDeps`) which are out of scope for a pure Rust bench. Still, a single consolidated bench file mapping each budget key to a named Criterion group would make CI diff-vs-budget trivial.
- **Proposed change**: Extend `ipc_hot_path.rs` with groups whose names match the budget keys verbatim (`ipc_listSessionsMs` etc.) so the CI script from the first FI entry can blindly join on name. The side-effect commands (`checkSystemDeps`, `getWorktreeDiskUsage`) may need a `bench-support` cfg-gated helper to inject fakes rather than hitting the real filesystem.
- **Risk / why deferred**: Requires a small amount of `cfg(any(test, feature = "bench"))` surface on tauri-bindings; deferred to avoid scope creep in w121.
- **Effort**: M
