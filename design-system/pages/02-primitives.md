# 02 · Primitives — Shared Components

> **Scope:** The reusable primitives that compose every per-view spec. Closes audit cross-cutting findings: **CC-4** (frame soup), **CC-7** (token-budget bar reinvented), **CC-8** (hand-rolled split panes), **CC-9** (component duplication), and provides the `<RendererShell>` contract used by all conversation tool-call renderers.
> **Inherits:** `00-globals.md` (all hygiene rules) + `01-chrome.md` (chrome layout contract).
> **Lives in:** `packages/ui/src/components/` — exported from `@tracepilot/ui`.

These primitives are the **vocabulary** of every redesigned view. A per-view spec composes them; it does not re-implement them.

---

## Index

1. [`<Heading>`](#heading) — semantic, scale-bound titles
2. [`<DataGrid>`](#datagrid) — dense sortable virtualized table
3. [`<KPI>`](#kpi) — single metric tile (label + value + delta + sparkline)
4. [`<SplitPane>`](#splitpane) — keyboard-resizable, persisted split layout
5. [`<TokenBudgetBar>`](#tokenbudgetbar) — context-window / token-budget indicator
6. [`<EntityCard>`](#entitycard) — single canonical card archetype (replaces SessionCard, McpServerCard, SkillCard)
7. [`<RendererShell>`](#renderershell) — frame contract for every tool-call renderer
8. [`<StatusPill>`](#statuspill) — semantic state pill
9. [`<EmptyState>`](#emptystate) — empty/loading/error pattern
10. [`<ToolbarRow>`](#toolbarrow) — flat hairline toolbar (replaces glass)

---

## Common contract

Every primitive in this document MUST:

- Be exported from `@tracepilot/ui` (re-exported from `packages/ui/src/components/index.ts`).
- Use only tokens defined in `packages/ui/src/styles/tokens.css` (no inline hex).
- Render Lucide icons via the `<Icon>` wrapper from `00-globals §G1` — never inline SVGs.
- Provide a TypeScript `Props` interface, exported from the component file.
- Document its slots in a `<!-- @slots -->` block at the top of the SFC.
- Have a `data-tp-component="<name>"` attribute on its root for E2E selectors.
- Respect `prefers-reduced-motion` per `00-globals §G5`.
- Pass dark + light parity (`<html data-theme="dark|light">`).

Lint rule `tracepilot/no-local-reimplementation`:
- Any `*.vue` outside `packages/ui` that defines `.modal-overlay`, `.search-input`, `.scope-seg-btn`, `.split-handle`, `.token-bar`, or a `<table class="data-grid">` fails the build.

---

## `<Heading>`  <a id="heading"></a>

### Purpose
Single source of truth for page/section titles. Caps title sizes at `text.h1` (no 36/48px hero in chrome) and enforces consistent hierarchy.

### Props
```ts
interface HeadingProps {
  level: 1 | 2 | 3;          // maps to text.h1 / h2 / h3
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';  // semantic tag override (defaults to `h${level}`)
  weight?: 500 | 600 | 700;  // default 600
  truncate?: boolean;        // single-line ellipsis
  mono?: boolean;            // use --font-mono (e.g. for IDs as titles — rare)
}
// Slot: default = title content
```

### Tokens
```css
.heading-1 { font: var(--text-h1);  color: var(--text-primary); }   /* 20/28 */
.heading-2 { font: var(--text-h2);  color: var(--text-primary); }   /* 16/22 */
.heading-3 { font: var(--text-h3);  color: var(--text-primary); }   /* 14/20 */
.heading--truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.heading--mono { font-family: var(--font-mono); font-feature-settings: 'tnum' 1; }
```

### Lint enforcement
After this lands, raw `<h1>..<h6>` in `apps/desktop/src/**/*.vue` fails lint (`tracepilot/use-heading-component`). Markdown-rendered headings (e.g. agent reasoning content) are exempt via a path allow-list.

### Acceptance
- [ ] `level` and `as` may differ (e.g. `<Heading level="2" as="h1">` for a page where the H2 is technically the H1 of the page region)
- [ ] Truncation does not break tooltips or copy-to-clipboard
- [ ] `text.display` (28/34) is **not** reachable via this component — empty-state titles use a separate `<EmptyState>` (see §9)

---

## `<DataGrid>`  <a id="datagrid"></a>

### Purpose
The dense, sortable, virtualized table that replaces hand-rolled `<table>` markup and the card grid in `SessionListView`. Closes CC-4.

### Anatomy
```
┌──────────────────────────────────────────────────────────────────────┐
│ [filter chip][filter chip][+]            [≡ density] [⚙ columns]    │  toolbar (slot)
├──────────────────────────────────────────────────────────────────────┤
│ Summary               Repo · Branch        Model      Turns Updated │  header row, sticky
│ ──────────────────────────────────────────────────────────────────── │  hairline
│ ★ feat: refactor auth tracepilot/main      gpt-4o     12     2m     │  row, 32px
│   fix: crash on resume copilot/develop     opus-4.7    8     1h     │
└──────────────────────────────────────────────────────────────────────┘
```

### Props
```ts
interface DataGridProps<TRow extends { id: string }> {
  rows: TRow[];
  columns: Column<TRow>[];
  rowKey?: (row: TRow) => string;            // defaults to row.id
  // density
  density?: 'comfortable' | 'compact';        // default 'comfortable' (32px)
  persistDensityKey?: string;                 // localStorage namespace
  // sort
  sortBy?: { columnId: string; dir: 'asc' | 'desc' };
  onSortChange?: (sort: SortState) => void;
  // selection
  selectionMode?: 'none' | 'single' | 'multi';
  selected?: Set<string>;
  onSelectionChange?: (sel: Set<string>) => void;
  // virtualization
  virtualize?: boolean;                       // default true when rows.length > 100
  estimatedRowHeight?: number;                // default 32 / 28 by density
  // empty / loading / error
  state?: 'idle' | 'loading' | 'empty' | 'error';
  emptyTitle?: string; emptyHint?: string;
  errorMessage?: string; onRetry?: () => void;
  // pinning
  pinnedRowIds?: Set<string>;                 // float to top, "★" affordance
}

interface Column<TRow> {
  id: string;
  label: string;
  width?: number | 'auto' | `${number}fr`;
  align?: 'start' | 'end';                   // 'end' implies tabular-numerals
  numeric?: boolean;                          // applies tnum + right-align
  sortable?: boolean;
  render: (row: TRow) => VNode | string;
  // optional micro-template for header tooltip
  description?: string;
}
```

### Slots
- `#toolbar` — left side: filter chips. The right side (density toggle, column picker) is rendered by the component.
- `#row-actions(row)` — right-edge action button group, visible on row hover/focus.
- `#empty`, `#error` — override the default empty/error templates.

### Keyboard model
| Key | Action |
|---|---|
| `↑/↓` | move selection between rows |
| `Home/End` | jump to first/last |
| `PgUp/PgDn` | page nav |
| `Enter` | open row (emits `row-activate`) |
| `Cmd/Ctrl+Click` | open in new tab |
| `Space` | toggle selection in `multi` mode |
| `j/k` | vim-style row nav (alias for ↑/↓) |
| `f` | focus the toolbar's first filter chip |
| `?` | (already global) — overlay shows DataGrid bindings under "Active View" |

### Tokens
```css
.dg                 { background: var(--canvas-default); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
.dg__toolbar        { padding: 8px 12px; border-bottom: 1px solid var(--border-subtle); display: flex; gap: 8px; align-items: center; min-height: 40px; }
.dg__head           { background: var(--canvas-subtle); border-bottom: 1px solid var(--border-subtle); position: sticky; top: 0; z-index: 1; }
.dg__head-cell      { padding: 0 12px; font: var(--text-small); font-weight: 600; color: var(--text-secondary); height: 32px; }
.dg__row            { height: 32px; padding: 0 12px; border-bottom: 1px solid var(--border-subtle); cursor: pointer; }
.dg__row:hover      { background: var(--surface-tertiary); }
.dg__row[aria-selected="true"] { background: var(--accent-subtle); box-shadow: inset 2px 0 0 0 var(--accent-emphasis); }
.dg--compact .dg__row, .dg--compact .dg__head-cell { height: 28px; padding-inline: 8px; }
.dg__cell--num      { font-family: var(--font-mono); font-feature-settings: 'tnum' 1; text-align: end; }
.dg__star           { color: var(--warning-fg); }
```

### Virtualization
Use [`@tanstack/vue-virtual`](https://tanstack.com/virtual). Toolbar/header are outside the virtual area.

### States
- **Loading** — render header + 8 skeleton rows of `--surface-tertiary` 50% opacity.
- **Empty** — render `<EmptyState>` filling the body region (header still visible so column shape is preserved).
- **Error** — render error banner inside body with retry CTA.

### Accessibility
- `<table role="grid">` semantics; `<thead>` / `<tbody>` real elements (not divs) so screen readers get the table model.
- Each row `role="row" aria-rowindex` (1-based, including header).
- Sortable headers: `aria-sort="ascending|descending|none"`, click to cycle.
- Live region announces "row N of M selected" on selection change.

### Acceptance
- [ ] Renders 10k rows at 60fps with `virtualize: true`
- [ ] Density toggle persists per `persistDensityKey`
- [ ] Pinned rows always render above unpinned regardless of sort
- [ ] No glass, no gradient, no transform-hover

---

## `<KPI>`  <a id="kpi"></a>

### Purpose
A single metric tile. Replaces `StatCard` and the bespoke metric tiles in `OrchestrationHeroStats`, `MetricsStatCards`, `AnalyticsDashboardView`. Closes CC-4 frame-soup.

### Anatomy
```
┌─────────────────────────────┐
│ Total tokens          ⓘ      │  label row (small + optional info icon)
│ 4 281 532                    │  value row (mono, tnum, 24px line-height)
│ ▲ 12.3% vs prior  ╱╲╱─╲      │  delta row + inline sparkline
└─────────────────────────────┘
```

### Props
```ts
interface KPIProps {
  label: string;
  value: string | number;
  unit?: string;             // 'tokens', 'ms', '%' — rendered after value, smaller
  format?: 'number' | 'duration' | 'bytes' | 'percent' | 'currency';
  delta?: { value: number; direction: 'up' | 'down' | 'flat'; tone?: 'good' | 'bad' | 'neutral' };
  spark?: number[];          // last N data points; renders inline 64×16 sparkline
  description?: string;      // tooltip on the (i) icon
  state?: 'idle' | 'loading' | 'empty' | 'error';
  density?: 'comfortable' | 'compact';
}
```

### Tokens
```css
.kpi                 { padding: 12px 16px; min-width: 160px; }   /* NO border; multiple KPIs share a single .kpi-row hairline */
.kpi__label          { font: var(--text-small); color: var(--text-secondary); display: flex; gap: 4px; align-items: center; }
.kpi__value          { font-family: var(--font-mono); font-feature-settings: 'tnum' 1; font-size: 18px; line-height: 24px; color: var(--text-primary); margin-top: 4px; }
.kpi__unit           { font-size: 12px; color: var(--text-tertiary); margin-left: 4px; }
.kpi__delta          { font: var(--text-small); display: inline-flex; gap: 4px; align-items: center; margin-top: 4px; }
.kpi__delta--good    { color: var(--success-fg); }
.kpi__delta--bad     { color: var(--danger-fg); }
.kpi__delta--neutral { color: var(--text-tertiary); }
.kpi__spark          { width: 64px; height: 16px; }
.kpi-row             { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); divide-x: 1px solid var(--border-subtle); }
```

### Composition pattern
KPIs **must** be composed inside a `.kpi-row` container. The shared border + vertical hairline dividers replace the per-card frames that produced the audit's "frame soup" anti-pattern.

```html
<div class="kpi-row">
  <KPI label="Total tokens" :value="…" />
  <KPI label="Cost (USD)"   :value="…" />
  <KPI label="Cache hit %"  :value="…" />
  <KPI label="Errors"       :value="…" />
</div>
```

### Acceptance
- [ ] Single hairline frame around the entire row, not per-tile
- [ ] Value uses mono + tnum
- [ ] Delta tone is independent of direction (cost going down is `good`; latency going up is `bad`)
- [ ] Sparkline reuses `--chart-primary` for line, `--chart-primary` 0.20 alpha fill (or no fill — design choice per consumer)

---

## `<SplitPane>`  <a id="splitpane"></a>

### Purpose
Single primitive for resizable two-pane layouts. Replaces the four hand-rolled splitters identified in CC-8 (`ExplorerTab`, `SkillEditorView`, `SessionLauncherView`, `McpServerDetailView`).

### Props
```ts
interface SplitPaneProps {
  paneId: string;                              // namespace for persistence
  orientation?: 'horizontal' | 'vertical';     // default 'horizontal' (left|right)
  initialSize?: number | string;               // px or '40%' — first pane
  min?: number;                                // px, default 160
  max?: number;                                // px, default 800
  collapsible?: 'first' | 'second' | 'none';   // double-click handle to collapse/restore
  persist?: boolean;                           // persist to localStorage at `tracepilot:splitpane:${paneId}`
}
// Slots: #first, #second, optional #handle (custom handle content)
```

### Keyboard model
- Focus the handle with `Tab`. While focused:
  - `Alt+←/→` (or `Alt+↑/↓` vertical) — resize 16px per press.
  - `Alt+Shift+←/→` — resize 64px per press.
  - `Alt+Home` — reset to `initialSize`.
  - `Alt+0` — toggle collapse (if `collapsible !== 'none'`).

### Tokens
```css
.split { display: flex; width: 100%; height: 100%; min-height: 0; min-width: 0; }
.split--vertical { flex-direction: column; }
.split__pane     { overflow: auto; min-width: 0; min-height: 0; }
.split__handle   { background: transparent; flex-shrink: 0; cursor: col-resize; position: relative; width: 4px; }
.split--vertical .split__handle { cursor: row-resize; height: 4px; width: auto; }
.split__handle::after {
  content: ''; position: absolute; inset: 0;
  background: var(--border-subtle);
  transition: background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}
.split__handle:hover::after,
.split__handle:focus-visible::after { background: var(--accent-emphasis); }
.split__handle:focus-visible { outline: 0; }
```

### Accessibility
- Handle: `role="separator" aria-orientation aria-valuenow aria-valuemin aria-valuemax aria-controls="<first-pane-id>"`.
- Resize announcements via live region: "Pane resized to 40 percent" debounced 500ms.

### Acceptance
- [ ] Width persisted under namespaced key; survives reload
- [ ] Keyboard-only resize works
- [ ] `prefers-reduced-motion` does not animate the handle background — instant swap
- [ ] No mouse-only resize handlers; pointer events used so pen/touch work

---

## `<TokenBudgetBar>`  <a id="tokenbudgetbar"></a>

### Purpose
Single canonical "% of context / budget used" indicator. Replaces `MetricsTokenBudget`, `McpTokenSummary`, the inline `token-info` block in `SkillsManagerView`, and the ghosted hero-stats version. Closes CC-7.

### Anatomy
```
Context window                                      82 351 / 200 000 tokens (41 %)
████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ← thin 6px bar with thresholds
```

### Props
```ts
interface TokenBudgetBarProps {
  used: number;
  total: number;
  thresholds?: { warn: number; danger: number };  // 0..1, default { warn: 0.75, danger: 0.90 }
  label?: string;                                  // default "Context window"
  sublabel?: string;                               // optional right-side sublabel
  showRatio?: boolean;                             // default true: "X / Y"
  showPercent?: boolean;                           // default true: " (Z %)"
  size?: 'sm' | 'md';                              // sm = 4px bar, md = 6px (default)
  state?: 'idle' | 'loading' | 'error';
}
```

### Tone derivation
- `used / total < warn`  → `--success-fg` bar fill, `--success-subtle` track.
- `>= warn && < danger`  → `--warning-fg` fill, `--warning-subtle` track.
- `>= danger`             → `--danger-fg` fill, `--danger-subtle` track.
- The percentage in the label takes the same tone color (so colorblind users still see the ratio numerically; G2 compliant).

### Tokens
```css
.tbb            { display: flex; flex-direction: column; gap: 6px; }
.tbb__hdr       { display: flex; justify-content: space-between; font: var(--text-small); color: var(--text-secondary); }
.tbb__hdr--num  { font-family: var(--font-mono); font-feature-settings: 'tnum' 1; }
.tbb__track     { height: 6px; border-radius: var(--radius-full); background: var(--surface-tertiary); overflow: hidden; }
.tbb--sm .tbb__track { height: 4px; }
.tbb__fill      { height: 100%; transition: width 180ms cubic-bezier(0.2, 0.6, 0.2, 1); }
.tbb--ok    .tbb__fill { background: var(--success-fg); }
.tbb--warn  .tbb__fill { background: var(--warning-fg); }
.tbb--danger .tbb__fill{ background: var(--danger-fg); }
```

### Acceptance
- [ ] One implementation; lint forbids new `*.vue` defining `.token-bar` outside this component
- [ ] Numbers use mono + tnum; percentage tone matches bar tone
- [ ] Thresholds are configurable but default sane (.75 / .90)

---

## `<EntityCard>`  <a id="entitycard"></a>

### Purpose
Single canonical card archetype. Replaces `SessionCard`, `McpServerCard`, `SkillCard`. Closes CC-9.

### Anatomy
```
┌─────────────────────────────────────────────────┐
│ [icon]  Title (truncate)            [status]    │  header row
│ subtitle · subtitle · subtitle                  │  meta row (mono allowed for IDs)
│                                                 │
│  Optional body slot                             │
│                                                 │
│ [primary]  [secondary]              [more ⋯]    │  actions row (optional)
└─────────────────────────────────────────────────┘
```

### Props
```ts
interface EntityCardProps {
  iconName?: LucideName;
  iconTone?: 'accent' | 'success' | 'warning' | 'danger' | 'neutral' | 'done';
  title: string;
  meta?: Array<{ label: string; mono?: boolean }>;  // pipe-separated metadata
  status?: { tone: SemanticTone; label: string; iconName?: LucideName };
  to?: RouteLocation;             // makes whole card clickable
  selected?: boolean;
  density?: 'comfortable' | 'compact';
}
// Slots: #default (body), #actions (actions row)
```

### Tokens
```css
.ec               { background: var(--canvas-raised); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 16px; display: grid; gap: 8px; cursor: pointer; }
.ec--compact      { padding: 12px; }
.ec:hover         { background: var(--surface-tertiary); border-color: var(--border-emphasis); }
.ec[aria-selected="true"] { border-color: var(--border-accent); background: var(--accent-subtle); }
.ec__head         { display: flex; align-items: center; gap: 8px; }
.ec__title        { font: var(--text-h3); color: var(--text-primary); flex: 1; min-width: 0; }
.ec__meta         { font: var(--text-small); color: var(--text-secondary); display: flex; gap: 4px 8px; flex-wrap: wrap; }
.ec__meta--mono   { font-family: var(--font-mono); font-feature-settings: 'tnum' 1; }
.ec__actions      { display: flex; gap: 8px; }
```

### When NOT to use EntityCard
If the surface is a list of homogenous data (sessions, MCP servers, skills) and the user benefits from sortable columns or scanning by alignment — **use `<DataGrid>`**, not a card grid. Cards are for browsing summaries when shape varies (e.g. heterogeneous objects with different metadata sets), or when each item has rich body content.

### Acceptance
- [ ] No `transform: translateY` hover (G4)
- [ ] No glass background (G2)
- [ ] Single bordered surface — no nested bordered children for "stat tiles"
- [ ] Whole-card click works, but action buttons stop propagation

---

## `<RendererShell>`  <a id="renderershell"></a>

### Purpose
The mandatory frame for every conversation tool-call renderer (`ApplyPatchRenderer`, `EditDiffRenderer`, `ShellOutputRenderer`, `GrepResultRenderer`, `BashRenderer`, etc.). Closes CC-4 (frame soup) and CC-9 (per-renderer hand-rolled frames). The per-renderer body is rendered into `#default`.

### Anatomy
```
┌─────────────────────────────────────────────────────────────┐
│ [tool-icon]  edit_file  ✓ 124ms          packages/ui/Btn.vue│  header
│  ── hairline ────────────────────────────────────────────── │
│   ┌─ args ─┐  ┌─ result ─┐  ┌─ raw ─┐                       │  segmented control (slot #tabs)
│                                                              │
│   <renderer body — diff, table, terminal, list…>            │
│                                                              │
│  ── hairline ────────────────────────────────────────────── │
│  ⏱ 124ms   ✱ 312 in / 88 out tokens   ⎘ Copy   ↻ Retry      │  footer (slot #footer optional)
└─────────────────────────────────────────────────────────────┘
```

### Props
```ts
interface RendererShellProps {
  toolName: string;                        // 'edit_file', 'apply_patch'…
  iconName: LucideName;                    // tool-specific icon
  status: 'pending' | 'success' | 'warning' | 'error' | 'cancelled';
  durationMs?: number;
  tokenUsage?: { in: number; out: number };
  primaryHint?: string;                    // e.g. file path, search query — header right
  collapsible?: boolean;                    // can collapse to header only
  defaultCollapsed?: boolean;
  copyText?: string;                       // text written to clipboard by the Copy button
  onRetry?: () => void;                    // shows Retry button when defined
}
// Slots: #default (body, required), #tabs (optional segmented control), #footer (optional override)
```

### Tokens
```css
.rs              { background: var(--canvas-subtle); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
.rs__head        { display: flex; align-items: center; gap: 8px; padding: 8px 12px; min-height: 36px; }
.rs__name        { font: var(--text-body-strong); color: var(--text-primary); }
.rs__hint        { font-family: var(--font-mono); color: var(--text-tertiary); margin-left: auto; }
.rs__body        { padding: 12px; border-top: 1px solid var(--border-subtle); }
.rs__foot        { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-top: 1px solid var(--border-subtle); font: var(--text-small); color: var(--text-tertiary); }
.rs--success .rs__head { border-left: 2px solid var(--success-emphasis); }
.rs--warning .rs__head { border-left: 2px solid var(--warning-emphasis); }
.rs--error   .rs__head { border-left: 2px solid var(--danger-emphasis);  }
.rs--cancelled .rs__head{ border-left: 2px solid var(--neutral-emphasis); }
.rs--pending .rs__head { border-left: 2px solid var(--accent-emphasis); }  /* spinner in icon position */
```

### Status iconography (Lucide)
| Status | Icon | Tone token |
|---|---|---|
| pending | `loader-2` (spinning, respects reduced-motion) | `--accent-fg` |
| success | `check-circle-2` | `--success-fg` |
| warning | `alert-triangle` | `--warning-fg` |
| error | `octagon-x` | `--danger-fg` |
| cancelled | `circle-slash-2` | `--neutral-fg` |

### Per-renderer addenda
Each individual renderer (ApplyPatch, EditDiff, ShellOutput…) has its own spec in `13-tool-renderers.md`. That spec is short — it only describes the renderer **body** (e.g. how a diff is rendered) and lists the exact `iconName` and any `#tabs` it uses. The shell behaviour is shared.

### Acceptance
- [ ] Every existing tool-call renderer is migrated to compose `<RendererShell>`; none renders its own outer frame
- [ ] Collapse state persists per turn-id (not globally) so users can re-expand on revisit
- [ ] Copy button writes `copyText` to clipboard and shows inline "Copied" pill (1.5s)
- [ ] Retry only renders when `onRetry` is provided

---

## `<StatusPill>`  <a id="statuspill"></a>

### Purpose
Compact, semantically toned pill. Used for tool statuses, alert severities, session running indicator, sub-agent badges.

### Props
```ts
interface StatusPillProps {
  tone: 'accent' | 'success' | 'warning' | 'danger' | 'done' | 'neutral' | 'attention';
  label: string;
  iconName?: LucideName;        // optional, 14px
  size?: 'xs' | 'sm';            // xs=18px height, sm=22px
  variant?: 'subtle' | 'solid';  // subtle = bg subtle + fg color (default); solid = bg emphasis + on-emphasis text
}
```

### Tokens (subtle variant)
```css
.pill        { display: inline-flex; align-items: center; gap: 4px; padding: 0 8px; height: 22px; border-radius: var(--radius-full); font: var(--text-micro); }
.pill--xs    { height: 18px; padding: 0 6px; font-size: 10px; }
.pill--success { background: var(--success-subtle); color: var(--success-fg); }
.pill--warning { background: var(--warning-subtle); color: var(--warning-fg); }
.pill--danger  { background: var(--danger-subtle);  color: var(--danger-fg);  }
.pill--accent  { background: var(--accent-subtle);  color: var(--accent-fg);  }
.pill--done    { background: var(--done-subtle);    color: var(--done-fg);    }
.pill--neutral { background: var(--surface-tertiary); color: var(--text-secondary); }
.pill--attention { background: var(--attention-subtle); color: var(--attention-fg); }
```

### Acceptance
- [ ] Color is **always** paired with text — never icon-only without `aria-label`
- [ ] `text.micro` (the only legal use of uppercase per `00-globals §G7`) applies here

---

## `<EmptyState>`  <a id="emptystate"></a>

### Purpose
Reusable empty / "no results" / first-run pattern. Also serves as the only legal place to use `text.display` (28/34 600).

### Props
```ts
interface EmptyStateProps {
  iconName?: LucideName;            // 32px Lucide
  title: string;                    // text.display allowed here
  description?: string;             // text.body
  primaryAction?: { label: string; iconName?: LucideName; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  size?: 'sm' | 'md' | 'lg';
}
```

### Tokens
```css
.es { padding: 48px 24px; display: grid; place-items: center; text-align: center; gap: 8px; }
.es__icon  { color: var(--text-tertiary); }
.es__title { font: var(--text-display); color: var(--text-primary); }   /* only legal display use */
.es__desc  { font: var(--text-body); color: var(--text-secondary); max-width: 48ch; }
.es__cta   { margin-top: 12px; display: flex; gap: 8px; }
```

### Acceptance
- [ ] No emoji; icon is Lucide
- [ ] `<EmptyState size="sm">` clamps title to `text.h2` for inline contexts (e.g. inside DataGrid body)

---

## `<ToolbarRow>`  <a id="toolbarrow"></a>

### Purpose
The flat hairline replacement for every glass `enhanced-toolbar` / sticky filter bar / refresh row.

### Anatomy
```
┌─────────────────────────────────────────────────────────────────┐
│ [filter chip] [filter chip] [+]   [search input]    [↻] [⚙]    │
└─────────────────────────────────────────────────────────────────┘
   border-bottom: 1px hairline · background: var(--canvas-subtle)
```

### Props
```ts
interface ToolbarRowProps {
  density?: 'comfortable' | 'compact';      // 40px / 32px
  sticky?: boolean;
  variant?: 'header' | 'inline';           // header = canvas-subtle bg; inline = transparent
}
// Slots: #left, #center, #right
```

### Tokens
```css
.tbr           { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 12px; border-bottom: 1px solid var(--border-subtle); background: var(--canvas-subtle); }
.tbr--compact  { min-height: 32px; padding: 0 8px; }
.tbr--inline   { background: transparent; border-bottom: 0; }
.tbr__left     { display: flex; gap: 8px; align-items: center; }
.tbr__right    { margin-left: auto; display: flex; gap: 8px; align-items: center; }
.tbr--sticky   { position: sticky; top: 0; z-index: 1; }
```

### Acceptance
- [ ] No glass, no shadow, no gradient — only the hairline carries elevation
- [ ] All `enhanced-toolbar` / `sticky-toolbar` instances in `apps/desktop` migrate to `<ToolbarRow>`

---

## Library structure

```
packages/ui/src/components/
  Heading.vue
  DataGrid/
    DataGrid.vue
    DataGridHeader.vue
    DataGridRow.vue
    DataGridSkeleton.vue
    types.ts
  KPI.vue
  KPIRow.vue
  SplitPane.vue
  TokenBudgetBar.vue
  EntityCard.vue
  RendererShell.vue
  StatusPill.vue
  EmptyState.vue
  ToolbarRow.vue
  index.ts            # re-export all
```

### Storybook / preview
Add a stories file per primitive in `packages/ui/src/stories/` (Histoire or Storybook — whichever already exists; if neither, scaffold a minimal `.html` preview à la `design-system/previews/`). Stories must include: idle, loading, empty, error, dark+light, comfortable+compact (where relevant).

---

## Migration checklist (referenced by per-view specs)

When a per-view spec says "migrate the cards to `<EntityCard>`", these are the rules:
- The per-view spec **must not** restate the `<EntityCard>` styles or props.
- It **must** map the view's per-card data fields to `<EntityCard>` props (title, meta, status, etc.) explicitly.
- It **must** call out any field that doesn't map cleanly — those go in the body slot.

Same shape applies to the other primitives.

---

## Acceptance for the primitives PR

- [ ] All 10 primitives implemented in `packages/ui/src/components/` and exported
- [ ] Lint rules pass: `tracepilot/no-local-reimplementation`, `tracepilot/use-heading-component`
- [ ] Stories/previews exist for each primitive covering the documented states
- [ ] Bundle size delta acceptable (track via `pnpm --filter @tracepilot/ui build` before/after)
- [ ] No primitive uses `transform`, `backdrop-filter`, `linear-gradient`, or hex literals (all caught by 00-globals lint)
