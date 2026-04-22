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
