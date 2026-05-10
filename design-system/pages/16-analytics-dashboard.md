# 16 · Analytics Dashboard — Grafana-style overview

> **Scope:** The cross-session analytics surface at `/analytics`. Aggregate KPIs, time-series charts, and top-N tables across all sessions, scoped by date range / repo / model / agent type. Closes the **Analytics Dashboard (High)** finding in `design-system/audit/UI-AUDIT.md` (lines 99–105).
> **Inherits:** `00-globals.md` (all hygiene rules), `01-chrome.md` (PageHeader contract), `02-primitives.md` (KPI, DataGrid, ToolbarRow, SplitPane, EmptyState).
> **Sources:** `apps/desktop/src/views/AnalyticsDashboardView.vue`, `apps/desktop/src/components/AnalyticsPageHeader.vue`, plus the `Analytics*Row.vue` family under `apps/desktop/src/components/analytics/`.

This view is the **dashboard**. It does not own raw data — every drill-through routes to `SessionSearchView` with a pre-applied filter (see §6). The redesign is a one-for-one swap from "stack of bespoke chart panels with a fixed-width SVG layout" to a **Grafana-style row layout** built from the primitives in `02-primitives.md`, plus one new `<ChartCard>` primitive proposed below.

### First migration step — delete the duplicate header

Before any layout change, **remove `apps/desktop/src/components/AnalyticsPageHeader.vue`** and import `PageHeader` directly from `@tracepilot/ui` (see `01-chrome.md §1.4`, audit finding **CC-6**). The repo-filter `<select>` and `<TimeRangeFilter>` it currently houses move into the `#toolbar` slot of the canonical PageHeader (see §3). The lint rule `tracepilot/single-page-header` must pass after this PR.

---

## 1. Information architecture

A single-page dashboard composed of four IA blocks, top-down. Every block consumes the same `{ dateRange, repo, model, agentType }` filter state.

| Block | Purpose | Primitive |
|---|---|---|
| **PageHeader + toolbar** | "Analytics" title + active filter summary; primary refresh action | `<PageHeader>` (`01-chrome §1.4`) |
| **KPI strip** | Headline totals: sessions, tokens, cost, avg duration, error rate | `<KPI>` inside `.kpi-row` (`02-primitives §KPI`) |
| **Trend row** | Sessions over time, token usage over time, cost over time | `<ChartCard>` (`§5`) wrapping line/area charts |
| **Top-N row** | Top tools (by invocations), top errors (by frequency), top models (by cost) | `<ChartCard>` wrapping `<DataGrid>` (`02-primitives §DataGrid`) |
| **Filter rail** | Date range, repo, model, agent type — collapsible left rail | `<SplitPane>` (`02-primitives §SplitPane`) + `<ToolbarRow>` |

The KPIs **always render**, even with empty datasets (zero-state values). Trend and Top-N blocks each own their own loading/error state — one chart's failure must not blank the page (§7).

### KPI strip — exactly six tiles

In display order. Tones in `delta` are independent of direction (cost going down is `good`; latency going up is `bad`):

1. **Sessions** — total sessions in range; delta vs. prior period; sparkline = sessions/day.
2. **Tokens** — input + output combined; sparkline = tokens/day.
3. **Cost (USD)** — Copilot premium cost; sparkline = cost/day.
4. **Avg duration** — mean session duration; format `duration`; sparkline = mean duration/day.
5. **Error rate** — failed turns / total turns × 100; format `percent`; tone `bad` on increase.
6. **Cache hit %** — cache reads / total reads × 100; format `percent`; tone `good` on increase.

> Six is the cap. Anything beyond moves into the trend row as a chart, not a KPI.

### Filter rail — what lives there

- **Date range** — `24h | 7d | 30d | 90d | custom` (segmented). `custom` reveals two spinbutton date pickers (§9). Persisted as `tracepilot:analytics:dateRange`.
- **Repository** — combobox; `null` = all repos.
- **Model** — multiselect; `[]` = all models.
- **Agent type** — multiselect (`main | explore | general-purpose | code-review | task | rubber-duck`).
- **Compare to prior period** — checkbox. When on, every chart paints a dashed `--text-tertiary` overlay of the prior equal-length window.

The rail is **collapsible**. Collapsed state shows a 40px rail of icon-only filter chips with current values as tooltips. Persisted as `tracepilot:analytics:railCollapsed`.

---

## 2. Layout

Built on `<SplitPane orientation="vertical" persistKey="analytics:rail">`: filter rail left, dashboard right. The right pane is a 12-column responsive grid; rows are explicit, columns shrink with the viewport.

### 1440px wireframe

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ AppSidebar │ Analytics                                            [↻ Refresh] [Compact ▾] │ ← PageHeader (01-chrome §1.4)
│            │ Aggregate metrics across 248 sessions · main · 7 days                          │
│            │ ────────────────────────────────────────────────────────────────────────────── │
│            │ [24h] [7d] [30d] [90d] [Custom…]   Repo ▾   Model ▾   Agent ▾   ☐ Compare prior │ ← #toolbar slot (ToolbarRow)
│            ├────────┬────────────────────────────────────────────────────────────────────────┤
│            │ Filter │ ┌────────┬────────┬────────┬────────┬────────┬────────┐               │
│            │ rail   │ │Sessions│ Tokens │ Cost   │ Avg dur│ Errors │ Cache% │  KPI strip    │ ← .kpi-row, 6 KPIs
│            │  240px │ │ 248    │ 4.2M   │$12.40  │ 03:42  │ 1.8%   │ 88.4%  │               │
│            │        │ │▲12% ╱╲ │▲ 8% ╱╴ │▼ 3% ╲╱ │▼14% ╲╴ │▼0.4 ╱╲ │▲ 2% ╱╴ │               │
│            │        │ └────────┴────────┴────────┴────────┴────────┴────────┘               │
│            │        │                                                                        │
│            │        │ ┌────────────────────┬────────────────────┬────────────────────┐      │
│            │        │ │ Sessions over time │ Token usage        │ Cost over time     │      │ ← Trend row (3× col-4)
│            │        │ │  ╱╲    ╱╲╱         │  ▁▂▄█▆▄▂▃▅▇█▆▄    │  ╱╲ ╱╲╱╲ ╱╲       │      │
│            │        │ │ [view as table]    │ [view as table]    │ [view as table]    │      │
│            │        │ └────────────────────┴────────────────────┴────────────────────┘      │
│            │        │                                                                        │
│            │        │ ┌────────────────────┬────────────────────┬────────────────────┐      │
│            │        │ │ Top tools          │ Top errors         │ Top models         │      │ ← Top-N row (3× col-4)
│            │        │ │ DataGrid (10 rows) │ DataGrid (10 rows) │ DataGrid (10 rows) │      │
│            │        │ └────────────────────┴────────────────────┴────────────────────┘      │
└────────────┴────────┴────────────────────────────────────────────────────────────────────────┘
```

### 1024px wireframe (current implementation is non-responsive — audit)

At ≤ 1280px the rail auto-collapses to icon-only (40px), the KPI strip wraps to two rows of three, and trend / top-N rows reflow to two columns. Charts use `ResizeObserver` instead of fixed `createChartLayout(55, 490, 20, 175)` (audit:103).

```
┌──────────────────────────────────────────────────────────────────┐
│ Analytics                                  [↻] [Compact ▾]       │
│ 248 sessions · main · 7 days                                     │
│ ──────────────────────────────────────────────────────────────── │
│ [7d] [30d] [90d] [Custom…]   Repo ▾   Model ▾   Agent ▾          │
├──┬───────────────────────────────────────────────────────────────┤
│▤ │ ┌────────┬────────┬────────┐                                  │
│⌕ │ │Sessions│ Tokens │ Cost   │                                  │
│☰ │ ├────────┼────────┼────────┤   ← KPI strip wraps 3+3          │
│✦ │ │Avg dur │ Errors │ Cache% │                                  │
│  │ └────────┴────────┴────────┘                                  │
│  │                                                                │
│  │ ┌─────────────────────┬─────────────────────┐                 │
│  │ │ Sessions over time  │ Token usage         │                 │
│  │ ├─────────────────────┼─────────────────────┤  ← 2 columns    │
│  │ │ Cost over time      │ Top tools           │                 │
│  │ ├─────────────────────┼─────────────────────┤                 │
│  │ │ Top errors          │ Top models          │                 │
│  │ └─────────────────────┴─────────────────────┘                 │
└──┴───────────────────────────────────────────────────────────────┘
```

Grid spec:

```css
.analytics-grid          { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; padding: 16px 24px; }
.analytics-grid > .span-4{ grid-column: span 4; }
.analytics-grid > .span-6{ grid-column: span 6; }
.analytics-grid > .span-12{ grid-column: span 12; }
@media (max-width: 1280px) { .analytics-grid > .span-4 { grid-column: span 6; } }
@media (max-width: 768px)  { .analytics-grid > .span-4,
                              .analytics-grid > .span-6 { grid-column: span 12; } }
```

---

## 3. Tokens used

All from `packages/ui/src/styles/tokens.css` per `00-globals §G6`. No hex literals.

### Surfaces

| Element | Token |
|---|---|
| Page canvas | `--canvas-default` |
| Filter rail | `--canvas-inset` (signals "filter UI", not chrome — `01-chrome §Hierarchy contract`) |
| KPI row + ChartCard | `--canvas-raised`, `1px solid var(--border-subtle)` |
| Hover row in DataGrid | `--surface-tertiary` |
| Selected filter chip | `--accent-subtle` + `border: 1px solid var(--border-accent)` |

### Chart palette

- **Categorical series** (agent type, model, tool) → `--agent-color-main`, `--agent-color-explore`, `--agent-color-general-purpose`, `--agent-color-code-review`, `--agent-color-rubber-duck`, `--agent-color-task`, then `--chart-info`, `--chart-lime`. Order is stable across views per MASTER §2.4.
- **Sequential ramp** (magnitude — token volume, latency heatmap) → `--chart-primary` → `--chart-secondary` (indigo → violet).
- **Outcome** (pass/warn/fail) → `--success-emphasis` / `--warning-emphasis` / `--danger-emphasis`. Never categorical for outcome.
- **Prior-period overlay** → `--text-tertiary` at 0.6 alpha, `stroke-dasharray: 4 4`.
- **Grid lines** → `--border-subtle` at 50% opacity; **axis labels** → `--text-tertiary`, 11px `var(--font-mono)`.

---

## 4. Component contracts

| Slot | Component | Source |
|---|---|---|
| Page frame | `<PageHeader>` | `01-chrome §1.4` |
| Toolbar (filter chips) | `<ToolbarRow>` | `02-primitives §ToolbarRow` |
| KPI strip | `<KPIRow>` wrapping six `<KPI>` | `02-primitives §KPI` |
| Chart wrapper | `<ChartCard>` **[NEW PRIMITIVE]** | proposed below |
| Top-N tables | `<DataGrid>` inside a `<ChartCard>` | `02-primitives §DataGrid` |
| Empty / error / no-results | `<EmptyState>` | `02-primitives §EmptyState` |
| Layout split | `<SplitPane>` | `02-primitives §SplitPane` |

### `<KPIRow>`

Thin wrapper around the `.kpi-row` composition pattern in `02-primitives §KPI` — single hairline frame, vertical dividers between tiles, no per-tile borders. No new props beyond `density`. The audit called out `StatCard` "frame soup" (CC-4); `<KPIRow>` is the replacement.

### `<ChartCard>` — [NEW PRIMITIVE]

The dashboard renders ~9 chart-like blocks (3 trend + 3 top-N + 3 incident/distribution variants over time). Each needs identical chrome — title, subtitle, footer slot, per-card state — but `02-primitives.md` does not currently provide one. Propose adding `<ChartCard>` to `packages/ui/src/components/ChartCard.vue` and indexing it in `02-primitives.md §Index`.

```ts
interface ChartCardProps {
  title: string;
  subtitle?: string;                         // e.g. "last 7 days · 248 sessions"
  state?: 'idle' | 'loading' | 'empty' | 'error';
  errorMessage?: string;                     // shown when state === 'error'
  span?: 4 | 6 | 12;                         // grid span (1440px)
  density?: 'comfortable' | 'compact';
}
// Slots:
//   default — chart body (SVG / canvas / DataGrid)
//   #footer — legend, "View as table" toggle, drill-through link
//   #actions — header-right action buttons (e.g. download CSV)
```

Anatomy:

```
┌───────────────────────────────────────────────┐
│ Sessions over time              [⤓] [⋯]       │  title row + #actions
│ last 7 days · 248 sessions                    │  subtitle (text.small)
├───────────────────────────────────────────────┤
│                                               │
│           (chart body — default slot)         │
│                                               │
├───────────────────────────────────────────────┤
│ ● Sessions  ┄ Prior period   [View as table] │  #footer slot
└───────────────────────────────────────────────┘
```

Tokens:

```css
.chart-card           { background: var(--canvas-raised); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); display: flex; flex-direction: column; min-height: 240px; }
.chart-card__header   { display: flex; align-items: baseline; gap: 12px; padding: 12px 16px; }
.chart-card__title    { font: var(--text-h3); color: var(--text-primary); }
.chart-card__sub      { font: var(--text-small); color: var(--text-secondary); }
.chart-card__body     { flex: 1; padding: 8px 16px; min-height: 0; }
.chart-card__footer   { display: flex; align-items: center; gap: 12px; padding: 8px 16px; border-top: 1px solid var(--border-subtle); font: var(--text-small); color: var(--text-secondary); }
```

Per-card state isolation: a failure in `state="error"` renders `<EmptyState tone="error">` inside the body slot, preserving the row's grid columns so siblings don't reflow.

### `<KPI>` usage in this view

Every KPI in the strip **must** populate `delta` and `spark`. Sparkline data is the same series as the corresponding trend chart (downsampled to 24 points). Tone mapping:

| Metric | Direction = good when |
|---|---|
| Sessions, Tokens, Cache hit % | `up` |
| Cost, Avg duration, Error rate | `down` |

### `<ToolbarRow>` usage

The PageHeader's `#toolbar` slot renders one `<ToolbarRow>`:

- Left group: date-range segmented control + custom-range date pickers.
- Centre group: repo combobox, model multiselect, agent-type multiselect.
- Right group: "Compare to prior period" toggle, "Reset filters" link button.

---

## 5. Interaction model

### Date range

- Segmented control: `24h | 7d | 30d | 90d | Custom`. Arrow-left/right cycles. Keyboard: `t` cycles forward through the four canned scopes (skipping `Custom`).
- `Custom` reveals two date pickers; both are **spinbuttons** (`role="spinbutton"`) with `↑/↓` to step ±1 day, `PageUp/PageDown` ±1 month, typed input parsed on blur. Format: locale short date, mono.
- Selection persists in `tracepilot:analytics:dateRange` (`{ scope: '24h'|'7d'|'30d'|'90d'|'custom', from?: ISO, to?: ISO }`). Persists across refresh and route changes.

### Filter chips

- Each filter renders as a chip on the `<ToolbarRow>`. Active filter chips use `--accent-subtle` background + `--border-accent`.
- `Backspace` on a focused chip clears that single filter. `Esc` closes any open combobox.
- "Reset filters" returns to the default (`7d`, all repos, all models, all agents) but does not clear the rail-collapsed preference.

### Drill-through

Clicking any chart segment, KPI value, or top-N row routes to `SessionSearchView` with the matching filter applied via query string (`?from=…&to=…&repo=…&tool=…`). The destination view reads the same `dateRange` key so context survives the jump. KPIs are clickable; pressing `Enter` on a focused KPI triggers the same drill-through.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `r` | Refresh all queries (re-fetches without clearing data; respects `300ms` debounce) |
| `t` | Toggle date scope: `24h → 7d → 30d → all` |
| `c` | Toggle "Compare to prior period" |
| `[` | Collapse/expand the filter rail (proxies `<SplitPane>` keyboard model) |
| `/` | Focus the global search palette (`01-chrome §1.5`) |

Shortcuts surface as `<kbd>` chips in the rail header per `00-globals §G1`.

---

## 6. States

A failure in any single ChartCard **must not** blank the dashboard. Every block owns its own state independently.

| State | Behaviour |
|---|---|
| **Empty (no data in range)** | KPI tiles render `0` + neutral delta + flat sparkline; ChartCards render `<EmptyState tone="empty" iconName="bar-chart-3" title="No sessions in this range" cta="Expand to 30 days">`. |
| **Loading (initial)** | Skeleton layout that **reserves the final dimensions** (no content jump per `00-globals §G5`). KPI value rows show a 1×24px shimmer; ChartCards show 8 skeleton bars at the chart body's resolved height. |
| **Loading (refresh)** | Existing data stays painted; a 1px indeterminate `--accent-emphasis` bar animates along the top edge of each ChartCard for the in-flight queries. Never blank rendered content during refresh. |
| **Partial** | Resolved cards render their data; in-flight cards keep their skeleton. Page is interactive. |
| **Per-card error** | The card swaps body for `<EmptyState tone="error" title="Couldn't load top tools" :description="errorMessage">` with a `[Retry]` button that re-issues only that query. KPI strip and other cards remain visible. |
| **No results after filter** | Same shape as "empty" but copy is "No data matches the current filters" + `[Clear filters]` CTA. |

---

## 7. Motion

All within the `00-globals §G5` budget (120 / 180 / 220ms, `transform`/`opacity` only).

| Transition | Duration | Property |
|---|---|---|
| ChartCard enter (initial mount) | **180ms** cross-fade | `opacity` |
| Chart bar / line update on filter change | **220ms** | `d` attribute interpolation on `<path>` (transform-equivalent — no layout) |
| KPI value flip | **120ms** opacity swap on the value cell |
| Skeleton → data swap | **120ms** opacity cross-fade |
| Filter rail collapse | **180ms** | `transform: translateX(...)` on the rail; grid columns recompute via `ResizeObserver`, not animated width |

Reduced motion (`prefers-reduced-motion: reduce`) collapses all of the above to ≤ 80ms instant cross-fade. No bar/line tween — values snap.

---

## 8. Accessibility

### Per-chart contract

Every ChartCard **must** ship two parallel representations of the same data:

1. A short text summary on the chart's container element via `aria-describedby="<id>-summary"`. The summary is rendered visually-hidden (`sr-only`) and reads e.g. *"Line chart showing sessions per day from 2024-10-01 to 2024-10-07. Range 12 to 41. Average 24."*
2. A **"View as table"** toggle in the `#footer` slot. When active, the chart body is replaced by a `<DataGrid>` with the underlying rows (date, value, prior-period value when compare is on). The toggle is a real `<button aria-pressed>` and persists per-card via `tracepilot:analytics:tableView:<cardId>`.

### Date pickers

- `role="spinbutton"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow` reflect the current day.
- Live region announces changes: *"From: October 3, 2024."*

### KPI tiles

- Each `<KPI>` is a `<button>` (drill-through target) with `aria-label="Sessions: 248. Up 12 percent versus prior 7 days."` synthesised from `label`, `value`, `delta`.
- Sparklines carry `aria-hidden="true"` — the delta text is the accessible signal.

### Colour

State (error rate up, cost down) is paired with an icon + arrow + sign per `00-globals` ("never colour-only"). Categorical chart series are paired with legend swatches **and** labels; legend rows are keyboard-focusable to highlight the matching series.

---

## 9. Anti-patterns to remove

| # | Smell | Action |
|---|---|---|
| 1 | `AnalyticsPageHeader.vue` duplicating the canonical `PageHeader` | **Delete.** Move repo `<select>` and `<TimeRangeFilter>` into `<PageHeader #toolbar>`. Closes audit **CC-6**. |
| 2 | Fixed-width charts via `createChartLayout(55, 490, 20, 175)` | Replace with `ResizeObserver`-driven layout inside `<ChartCard>`. Closes audit (Analytics:103) — non-responsive grid. |
| 3 | `StatCard` per-tile frames in `AnalyticsStatsGrids` | Replace with single `<KPIRow>` (one outer hairline + vertical dividers). Closes **CC-4**. |
| 4 | Mixed icon sets (Heroicons / inline SVG / emoji `📊`) | All icons via `<Icon>` from `@tracepilot/ui`, Lucide only. Closes `00-globals §G1`. |
| 5 | `font-size: 36px` "hero" subtitles | Cap at `text.h1` (20px) per `01-chrome §1.4`. |
| 6 | `LoadingOverlay` blanking the whole page during refresh | Remove. Per-card refresh bar (§6) and skeletons; never wipe rendered data on refetch. |
| 7 | Hand-rolled `useChartTooltip` re-implemented per view | Promote to a single shared `useChartTooltip` from `@tracepilot/ui` (also called out for `ToolAnalysisView` in audit:111). |
| 8 | Inline hex fallbacks (e.g. `var(--canvas-raised, #161b22)`) | Token-only per `00-globals §G6`. |

---

## 10. Acceptance checklist

### Migration
- [ ] `apps/desktop/src/components/AnalyticsPageHeader.vue` deleted; `tracepilot/single-page-header` lint passes
- [ ] `AnalyticsDashboardView.vue` imports `PageHeader` directly from `@tracepilot/ui`
- [ ] Repo combobox + `TimeRangeFilter` live in `<PageHeader #toolbar>`, not in a custom header
- [ ] `<ChartCard>` exists at `packages/ui/src/components/ChartCard.vue`, exported from `@tracepilot/ui`, indexed in `02-primitives.md`
- [ ] `AnalyticsStatsGrids`, `AnalyticsMetricPanels` collapsed into a single `<KPIRow>` of six `<KPI>` tiles

### Layout & responsiveness
- [ ] Renders cleanly at 1024 / 1280 / 1440 / 1920 / 2560px without horizontal scroll
- [ ] Charts resize via `ResizeObserver`; no fixed pixel widths in chart layout calls
- [ ] Filter rail collapses below 1280px and remembers state (`tracepilot:analytics:railCollapsed`)
- [ ] Grid spans follow §2 breakpoints (col-4 → col-6 → col-12)

### Data & state
- [ ] All six KPIs populate `delta` + `spark`; tones match the table in §4
- [ ] Each ChartCard owns its own state; one card's error does not blank the page
- [ ] Refresh keeps existing data painted; only the per-card refresh bar animates
- [ ] Skeletons reserve final layout dimensions (no content jump)
- [ ] Empty / no-results / error copy matches §6 wording

### Filters & persistence
- [ ] Date range, repo, model, agent type, compare-to-prior, rail-collapsed all persist across reloads
- [ ] Drill-through routes to `SessionSearchView` with all filters preserved in the query string
- [ ] Keyboard shortcuts `r`, `t`, `c`, `[`, `/` are wired and surface as `<kbd>` chips

### Accessibility
- [ ] Every ChartCard has both `aria-describedby` summary **and** a working "View as table" toggle
- [ ] Date pickers expose `role="spinbutton"` with valid `aria-valuemin/max/now`
- [ ] KPI tiles are real `<button>` elements with synthesised `aria-label`
- [ ] Charts are not colour-only — every series labelled in legend; state always paired with icon
- [ ] Light mode parity — no `bg-white/10` ghosts, all borders visible

### Hygiene
- [ ] No `backdrop-filter` on any chart or header surface (`00-globals §G2`)
- [ ] No `linear-gradient` fills outside the chart sequential ramp (`00-globals §G3`)
- [ ] No emoji in templates; all icons via `<Icon>` (`00-globals §G1`)
- [ ] No hex literals in `AnalyticsDashboardView.vue` or its child components (`00-globals §G6`)
- [ ] All transitions are `120 | 180 | 220ms`; reduced-motion path verified
- [ ] Tabular numerals on every numeric column / KPI value / axis label (`00-globals §G9`)
