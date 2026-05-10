# 10 · Session List — Dense Sortable Index of Copilot CLI Sessions

> **Scope:** The default landing surface of TracePilot. Lets a developer find and open a Copilot CLI session by repo, branch, model, recency, or free-text query. This spec defines the **DataGrid-first** redesign of `apps/desktop/src/views/SessionListView.vue` and its supporting toolbar, empty/error states, and indexing affordance.
> **Inherits:** all of `00-globals.md` (hygiene), `01-chrome.md` (chrome contract — sidebar, tab strip, page header, palette), `02-primitives.md` (DataGrid, EntityCard, ToolbarRow, EmptyState, StatusPill, KPI). Anything covered there is **not** restated here.
> **Audit refs:** `design-system/audit/UI-AUDIT.md` Session List section (lines 19–25) and Cross-Cutting Findings CC-1, CC-2, CC-3, CC-4, CC-9, CC-10, CC-11, CC-12, CC-13.
> **Source files in scope:**
> - `apps/desktop/src/views/SessionListView.vue` — view shell (replace its toolbar + grid)
> - `apps/desktop/src/components/RefreshToolbar.vue` — composes into the new toolbar slot
> - `packages/ui/src/components/FilterSelect.vue` — kept; rendered as filter chips inside `<ToolbarRow #left>`
> - `packages/ui/src/components/SessionCard.vue` — **deleted** after this lands; replaced by `<EntityCard>` in the alternate Cards view
> - `packages/ui/src/components/SearchInput.vue` — kept; moves into `<ToolbarRow #center>`

---

## Information architecture

A single, dense index. One surface, two presentations of the same row set.

| Concern | Resolution |
|---|---|
| Default presentation | **`<DataGrid>`** — sortable columns, virtualized, keyboard-first |
| Alternate presentation | **Cards** (`<EntityCard>` grid) — for visual browsing |
| Toggle | Segmented control in the toolbar (`Grid` / `Cards`); persisted per-user |
| Density | Comfortable (32px) default · Compact (28px) toggle; persisted (see 00-globals §G8) |
| Pinning | Starred sessions float to top of both presentations; persisted in `tracepilot:sessions:pinned` |
| Sort | Default `updated desc`; persisted in `tracepilot:sessions:sort` |
| Filters | Repo · Branch · Model · Status (`running` / `ended`); compose with search |
| Search | `<SearchInput>` — substring match against summary, repo, branch, session id |
| Refresh | `<RefreshToolbar>` (manual + auto); indexing state surfaces inline (see §States) |
| Open | `Enter` / click → route navigation. `Cmd/Ctrl+Enter`, `o`, `Cmd/Ctrl+click`, middle-click → open as a `SessionTabStrip` tab |

Page is rendered inside the chrome contract: `AppSidebar` (left) → `SessionTabStrip` (top) → `<PageHeader title="Sessions">` → `<ToolbarRow>` → grid body. See `01-chrome.md §Cross-component contract`.

---

## Layout

### Default — DataGrid view (Comfortable density)

```
┌─ AppSidebar ┬───────────────────────────────────────────────────────────────────────────────────────────┐
│             │ ⌂  Sessions · main  ✕   feat/auth  ✕   [+]                                                │  ← SessionTabStrip
│             ├───────────────────────────────────────────────────────────────────────────────────────────┤
│  Workspace  │ Sessions                                                          [Active 3]              │  ← <PageHeader> (h1, 20/28)
│  ▦ Sessions │ 1 284 sessions · indexed 32s ago                                                          │     subtitle (text.small)
│  ✦ Search   ├───────────────────────────────────────────────────────────────────────────────────────────┤
│  ▤ Analytics│ [ Repo: all ▾ ] [ Branch: all ▾ ] [ Model: all ▾ ] [ Status: any ▾ ] [+ filter]           │  ← <ToolbarRow #left>
│  ⛁ Tools    │      [ 🔎 Search sessions…                ]   [ Grid │ Cards ]  [ ≡ density ]  [ ↻ ]     │  ← #center / #right
│  …          ├───────────────────────────────────────────────────────────────────────────────────────────┤
│             │ ★  Summary                            Repo · Branch       Model        Turns  Events Updated │  ← header (sticky)
│             │ ─────────────────────────────────────────────────────────────────────────────────────────── │
│             │ ★  feat: refactor auth flow           tracepilot · main   gpt-4o          12     481  2m   │  ← pinned, 32px row
│             │ ★  fix: crash on session resume       tracepilot · develop opus-4.7        8     312  1h   │
│             │ ─────────────────────────────────────────────────────────────────────────────────────────── │  ← hairline divider
│             │    feat: indexer perf · ● running    tracepilot · perf/idx gpt-4o          3      78  12s  │  ← status dot before summary
│             │    chore: bump deps                  tracepilot · main    gpt-4o-mini      2      40  3h   │
│             │    spike: tool call replay           copilot   · main    sonnet-3.7        7     220  1d   │
│             │    …                                                                                       │  ← virtualized scroll
│             ├───────────────────────────────────────────────────────────────────────────────────────────┤
│             │ ↑↓ navigate · ⏎ open · ⌘⏎ open in tab · / search · * star · d density · ? shortcuts       │  ← footer kbd hints
└─────────────┴───────────────────────────────────────────────────────────────────────────────────────────┘
```

Column shape, left → right (Comfortable):

| Column | Width | Align | Type | Sort | Notes |
|---|---|---|---|---|---|
| `pinned` | 24px | start | icon | n | `Star` / `StarOff` Lucide; click toggles pin |
| `summary` | `1fr` | start | text + leading status dot | y (alpha) | truncate; full title in `title=`. Status dot = 6px circle, tone = `success` (running), `neutral` (ended), `danger` (errored) |
| `repo · branch` | `220px` | start | mono | y (alpha) | rendered as `repo` (sans) ` · ` `branch` (mono) so the branch reads as data |
| `model` | `140px` | start | mono | y (alpha) | |
| `turns` | `72px` | end | numeric (tnum) | y | |
| `events` | `80px` | end | numeric (tnum) | y | |
| `updated` | `96px` | end | relative time | y (default desc) | mono · `formatRelativeTime`; full ISO in `title=` |
| `row-actions` | `48px` | end | hover-only | n | `Open in tab`, `Copy id`, `Reveal in finder` |

### Alternate — Cards view (toggle in toolbar)

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ [ Repo ▾ ] [ Branch ▾ ] [ Model ▾ ]  [ 🔎 Search… ]      [ Grid │ Cards ] [ ≡ ] [ ↻ ]      │  ← <ToolbarRow>
├────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─ EntityCard ──────────────┐  ┌─ EntityCard ──────────────┐  ┌─ EntityCard ──────────┐  │
│  │ ★ ▦ feat: refactor auth   │  │   ▦ fix: crash on resume  │  │   ▦ chore: bump deps  │  │
│  │ tracepilot · main · gpt-4o│  │ tracepilot · develop      │  │ tracepilot · main     │  │
│  │ 12 turns · 481 ev · 2m    │  │ 8 turns · 312 ev · 1h     │  │ 2 turns · 40 ev · 3h  │  │
│  │                  [running]│  │                    [ended]│  │                 [ended]│  │
│  └───────────────────────────┘  └───────────────────────────┘  └───────────────────────┘  │
│  ┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────┐  │
│  │ …                         │  │ …                         │  │ …                     │  │
│  └───────────────────────────┘  └───────────────────────────┘  └───────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────────┘
   minmax(280px, 1fr) auto-fill grid · gap 12px · virtualized as a windowed grid
```

Cards are the **same row set** as the DataGrid — same sort, same filters, same pin order, same selection. Toggle is a presentational concern only.

---

## Tokens used

All values come from `packages/ui/src/styles/tokens.css`. **No inline hex.** (See `00-globals §G6`.)

| Surface / role | Token |
|---|---|
| Page background | `var(--canvas-default)` |
| Toolbar background | `var(--canvas-subtle)` |
| Header row background | `var(--canvas-subtle)` |
| Row background (idle) | `var(--canvas-default)` |
| Row hover | `var(--surface-tertiary)` |
| Row selected / focused | `var(--accent-subtle)` + inset rail `var(--accent-emphasis)` |
| Row pinned indicator | `var(--warning-fg)` (filled `Star`) |
| Hairline divider | `1px solid var(--border-subtle)` |
| Toolbar bottom hairline | `1px solid var(--border-subtle)` |
| Card border | `1px solid var(--border-subtle)`; hover `var(--border-emphasis)` |
| Title text | `var(--text-primary)` (`text.body-strong`) |
| Meta text | `var(--text-secondary)` (`text.small`) |
| Mono columns (branch, model, updated, ids) | `var(--font-mono)`, feature `'tnum' 1` |
| Status dot — running | `var(--success-emphasis)` |
| Status dot — ended | `var(--neutral-emphasis)` |
| Status dot — error | `var(--danger-emphasis)` |
| Status pill — running | `<StatusPill tone="success" iconName="circle-dot">` |
| Status pill — ended | `<StatusPill tone="neutral" iconName="circle-check">` |
| Focus ring | `2px solid var(--accent-emphasis)` + 2px offset (G4) |
| Indexing progress fill | `var(--accent-emphasis)` on `var(--surface-tertiary)` track |
| Indexing banner bg | `var(--canvas-inset)` + `1px solid var(--border-subtle)` |
| Empty-state icon color | `var(--text-tertiary)` |
| KPI strip values | `var(--text-primary)` mono tnum |
| Z-index — sticky toolbar | `var(--z-header)` minus 1 (toolbar sits below `<PageHeader>`) |

---

## Component contracts

| Primitive | Source | Used for |
|---|---|---|
| `<PageHeader>` | `01-chrome §1.4` | Page title (`Sessions`), subtitle (`N sessions · indexed Xs ago`), running-count `<StatusPill>` reserved at right. |
| `<ToolbarRow sticky variant="header">` | `02-primitives §ToolbarRow` | Replaces `.enhanced-toolbar`. Holds filters (#left), search (#center), view-toggle / density / refresh (#right). |
| `<FilterSelect>` (existing) | `packages/ui` | Repo, Branch, Model, Status filter chips inside `<ToolbarRow #left>`. Native `<select>` for sort is **deleted** — sort happens via DataGrid header click. |
| `<SearchInput>` | `packages/ui` | Free-text query bound to `store.searchQuery`. Lives in `<ToolbarRow #center>`. |
| `<SegmentedControl value="grid|cards">` | `packages/ui` | View toggle in `<ToolbarRow #right>`. |
| `<RefreshToolbar>` | `apps/desktop/src/components` | Manual refresh + auto-refresh interval. Lives in `<ToolbarRow #right>`. |
| `<DataGrid>` | `02-primitives §DataGrid` | Default body. See column map above. |
| `<EntityCard>` | `02-primitives §EntityCard` | Cards view body — one per session. |
| `<StatusPill>` | `02-primitives §StatusPill` | Running / ended state inside row + on cards. |
| `<EmptyState>` | `02-primitives §EmptyState` | Empty / no-results / error states. |
| `<KPI>` (optional, comfortable density only) | `02-primitives §KPI` | Three small KPIs above the grid: `Active · Today · Total`. Hidden in compact density. |
| `<ProgressBar>` | `packages/ui` | Indexing progress (see §States · indexing). |
| `<Icon>` | `packages/ui` (G1) | All glyphs: `star`, `star-off`, `search`, `refresh-cw`, `chevron-up`, `chevron-down`, `circle-dot`, `circle-check`, `octagon-x`. |

### Data → DataGrid prop mapping

`<DataGrid>` is parametrized as `DataGrid<SessionRow>`. The session row from `useSessionsStore().filteredSessions` maps as follows:

| DataGrid concern | Source field |
|---|---|
| `rowKey` | `session.id` |
| `pinnedRowIds` | `prefs.pinnedSessionIds` (new pref, see §Interaction) |
| Column `summary`.render | `session.summary || 'Untitled Session'` + leading status dot derived from `session.isRunning`/`session.lastError` |
| Column `repo · branch`.render | `${session.repository} · ${session.branch}` |
| Column `model`.render | `session.model` |
| Column `turns`.render | `session.turnCount` |
| Column `events`.render | `session.eventCount` |
| Column `updated`.render | `formatRelativeTime(session.updatedAt)`; `title={session.updatedAt}` |
| `state` | `loading` ↔ `store.loading`; `empty` ↔ `filteredSessions.length === 0`; `error` ↔ `store.error`; `idle` otherwise |
| `sortBy` | `prefs.sessionsSort` (`{ columnId, dir }`) — replaces `store.sortBy: SortOption` enum |
| `density` | `prefs.sessionsDensity` |
| `persistDensityKey` | `'tracepilot:density:session-list'` |
| `onSortChange` | `prefs.setSessionsSort(sort)` |
| `onRowActivate` | `openSession(event, row.id, row.summary)` |

### Data → EntityCard prop mapping (Cards view)

| EntityCard prop | Source |
|---|---|
| `iconName` | `'folder-git-2'` (Lucide) — replaces no-icon SessionCard |
| `iconTone` | `'accent'` |
| `title` | `session.summary || 'Untitled Session'` |
| `meta[0]` | `{ label: session.repository }` |
| `meta[1]` | `{ label: session.branch, mono: true }` |
| `meta[2]` | `{ label: session.model, mono: true }` |
| `meta[3]` | `{ label: \`${turns} turns · ${events} ev · ${rel}\`, mono: true }` |
| `status` | `{ tone: 'success', label: 'running', iconName: 'circle-dot' }` when running, else `{ tone: 'neutral', label: 'ended', iconName: 'circle-check' }` |
| `selected` | `prefs.pinnedSessionIds.has(session.id)` |

The existing `SessionCard.vue` (Badge soup, `card-title-new`, etc.) is **deleted** as part of this PR.

---

## Interaction model

### Mouse

| Gesture | Action |
|---|---|
| Click row / card | Activate → route to session |
| `Cmd/Ctrl+click` row / card | Open session in a new `SessionTabStrip` tab |
| Middle-click row / card | Open session in a new tab |
| Click `★` / `☆` | Toggle pin (optimistic; persisted) |
| Click column header | Cycle sort `asc → desc → none` (none falls back to default `updated desc`) |
| Hover row | `--surface-tertiary` background; hover-only `#row-actions` reveal |
| Hover toolbar buttons | Color/border only — **never** transform (G4) |
| Right-click row | Native context menu: Open · Open in tab · Pin/Unpin · Copy ID · Reveal in finder |

### Keyboard

| Key | Scope | Action |
|---|---|---|
| `↑` / `↓` | grid focus | Move row selection (skips toolbar) |
| `j` / `k` | grid focus | Vim alias for `↓` / `↑` |
| `Home` / `End` | grid focus | First / last row |
| `PgUp` / `PgDn` | grid focus | Page nav |
| `Enter` | grid focus | Open selected row (route) |
| `Cmd/Ctrl+Enter` | grid focus | Open selected row in tab |
| `o` | grid focus | Alias for `Cmd+Enter` (open in tab) |
| `*` | grid focus | Toggle pin on selected row |
| `/` | view-wide | Focus the `<SearchInput>` |
| `f` | view-wide | Focus the first filter chip in `<ToolbarRow #left>` |
| `d` | view-wide | Toggle Comfortable / Compact density |
| `g` then `g` | view-wide | Scroll to top of list |
| `Shift+G` | view-wide | Scroll to bottom |
| `Esc` | search/filter focus | Clear current input then restore focus to grid |
| `Cmd/Ctrl+K` | global | Open Search Palette (chrome §1.5) — **not** redefined here |
| `?` | global | Open shortcuts overlay (chrome §1.7); this view registers its bindings via `useShortcut(...)` |

Bindings live in `useSessionListShortcuts.ts` and register through the chrome `provide/inject` API. When the grid loses focus (e.g. focus is in search), `j/k/o/*` are inert.

### Persistence

| Pref | Key |
|---|---|
| Density | `tracepilot:density:session-list` (`'comfortable' | 'compact'`) |
| View mode | `tracepilot:sessions:view` (`'grid' | 'cards'`) |
| Sort | `tracepilot:sessions:sort` (`{ columnId, dir }`) |
| Pinned IDs | `tracepilot:sessions:pinned` (`string[]`) |
| Filters | session-scoped; not persisted across cold start |

---

## States

| State | Trigger | Treatment |
|---|---|---|
| **Empty (first run)** | `store.sessions.length === 0` after `fetchSessions` and `reindex` resolve, no error | `<EmptyState iconName="folder-search" title="No Copilot sessions yet" description="Start a Copilot CLI session in any repo and it will appear here." primaryAction={{ label: 'How to start a session', iconName: 'book-open' }}>`. Centered in the grid body region (header + toolbar still visible). |
| **Loading (initial)** | `store.loading && sessions.length === 0` | DataGrid renders header row + 8 skeleton rows of `--surface-tertiary` 50% opacity (no spinner). Cards view renders 6 skeleton cards. |
| **Refreshing (warm)** | `refreshing === true` and rows already cached | Inline 1.5px-stroke `loader-2` icon spins inside the `↻` button (respects reduced-motion). Rows do **not** unmount. |
| **Error** | `store.error` is set | `<EmptyState iconName="alert-triangle" title="Couldn't load sessions" description={store.error} primaryAction={{ label: 'Retry', iconName: 'refresh-cw', onClick: refresh }} size="sm">` rendered inside the grid body so the toolbar remains usable. Replaces the old `<ErrorAlert>` banner above the grid. |
| **Partial (some events missing)** | `session.indexHealth === 'partial'` | Tiny `<StatusPill tone="attention" size="xs" iconName="alert-circle" label="partial">` in the `summary` cell after the title. |
| **Running (active sessions)** | `session.isRunning === true` | Leading `--success-emphasis` 6px dot + trailing `<StatusPill tone="success" iconName="circle-dot" label="running">`. Subtitle in `<PageHeader>` reflects `[Active N]` count; space is **always reserved** so layout doesn't shift when N transitions 0↔1. |
| **No-results-after-filter** | `filteredSessions.length === 0 && sessions.length > 0` | `<EmptyState iconName="search-x" title="No sessions match your filters" description="Try clearing a filter or relaxing the search." primaryAction={{ label: 'Clear filters', iconName: 'x', onClick: clearFilters }} size="sm">`. **Filters/search remain visible and editable.** This is the state the audit called out for using emoji `🔍`. |
| **Indexing (initial)** | `store.indexing === true` | Replaces the grid body (toolbar still rendered, but disabled). Inline indexing panel: `<EmptyState size="md" iconName="database">` with title `Indexing sessions…`, description `Building search index. This only happens once.`, and a `<ProgressBar :percent>` bound to `indexingProgress.current / .total`. Counter line: `{current} / {total} sessions` in mono tnum. |
| **Indexing (background)** | `store.indexing === false` and a fresh `ensureIndex()` is in flight while the grid is populated | Slim 2px `<ProgressBar variant="indeterminate">` pinned **below** the toolbar's hairline (full-width, no panel). Disappears when `onFinished` fires. Continuous animation per G5 (linear easing exempt). |

All empty-state icons use **Lucide** via `<Icon>` (G1). The current `icon="🔍"` literal on `EmptyState` is removed.

---

## Motion

All durations and easings come from `00-globals §G5`. This view does not introduce new motion primitives.

| Element | Property | Duration | Easing |
|---|---|---|---|
| Row hover (bg, border, color) | `background-color`, `border-color`, `color` | `120ms` | `cubic-bezier(0.2, 0.6, 0.2, 1)` |
| Row selection rail | `opacity` | `120ms` | ease-out |
| View-toggle (Grid ↔ Cards) | `opacity` cross-fade | `180ms` | ease-out |
| Density toggle | none — re-layout is instant; row content is identical, only `height/padding` tokens swap (no animation on dimensional properties per G5) |
| Sort cycle | none for cells; sort indicator (`chevron-up`/`chevron-down`) cross-fades `120ms` |
| Indexing progress (determinate) | `width` of inner fill is exempt — it encodes data, not chrome motion |
| Indexing progress (indeterminate) | linear infinite loop; allowed exemption per G5 |
| `?67` easter egg | see §Anti-patterns |

`prefers-reduced-motion: reduce` collapses every transition to `1ms` per the global rule (`00-globals §G5`). The indeterminate progress bar falls back to a static accent stripe.

---

## Accessibility

- **Landmark:** view body wrapped in `<main aria-labelledby="page-title-sessions">`; `<PageHeader>` title carries that id.
- **Grid semantics:** `<DataGrid>` renders `<table role="grid">` with real `<thead>`/`<tbody>`. Each row is `<tr role="row" aria-rowindex>`. Selection state uses `aria-selected`, never color alone.
- **Sortable headers:** `aria-sort="ascending|descending|none"`; click cycles, `Enter`/`Space` activates from keyboard.
- **Live region:** `<div aria-live="polite">` near the toolbar announces `"N sessions"` after filter/search debounce settles, and `"Loaded N more"` after auto-refresh.
- **Status is never color-alone:** running/ended/error are signaled by *icon + dot + tone*; pinned is *icon + alt-text* ("Pinned").
- **Focus order:** `SessionTabStrip` → `<PageHeader>` actions → `<ToolbarRow>` (filters → search → view toggle → density → refresh) → DataGrid header (sortable cells are tab stops) → first row → footer kbd hints (non-interactive, `aria-hidden`).
- **Focus ring:** 2px `var(--accent-emphasis)` with 2px offset on every interactive element (G4). Never removed.
- **Icon-only buttons:** every star, refresh, density, view-toggle, and row-action icon button carries `aria-label`. Lucide via `<Icon>` (G1).
- **Truncated cells:** the full value lives in `title` and is reachable by keyboard via `Cmd+C` from the cell's selectable text.

---

## Anti-patterns to remove

Each item cites the audit finding and the rule it violates. All edits target `apps/desktop/src/views/SessionListView.vue` unless noted.

- **Glassmorphism toolbar.** Remove `background: rgba(24,24,27,0.7); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: 0 4px 24px rgba(0,0,0,0.2)` on `.enhanced-toolbar` (lines **249–256**) plus the light-mode variant on lines **259–262**. Replace the entire `.enhanced-toolbar` with `<ToolbarRow sticky variant="header">`. Violates UI-AUDIT line 23 (1) and `00-globals §G2 / CC-2`.
- **Inline hex / rgba in component CSS.** `rgba(24,24,27,0.7)`, `rgba(255,255,255,0.75)`, `rgba(0,0,0,0.2)`, `rgba(0,0,0,0.05)` — all forbidden by `00-globals §G6 / CC-11`. Tokens cover every replacement (see §Tokens used).
- **Emoji empty-state icon.** `<EmptyState icon="🔍" …>` (line **228**). Replace with `<EmptyState iconName="search-x" …>` (Lucide). Violates UI-AUDIT line 23 (2) and `00-globals §G1 / CC-1`. Note that the `EmptyState` primitive in `02-primitives §EmptyState` only exposes `iconName`; the legacy `icon` prop is removed alongside this change.
- **Native `<select class="filter-select">` for sort.** Lines **156–163**. The third "select" sits visually next to two `<FilterSelect>` chips — chrome inconsistency. Remove entirely; sort is performed via DataGrid header clicks, persisted to `prefs.sessionsSort`. The `SortOption` enum in `useSessionsStore` is replaced by a `{ columnId, dir }` shape. Violates UI-AUDIT line 23 (4) and `02-primitives §DataGrid`.
- **Card-only grid with no virtualization.** `.grid-cards` (line **215**) renders every card unconditionally. Replace with `<DataGrid virtualize>` for the default view and a virtualized windowed-grid for the Cards view (`@tanstack/vue-virtual` per `02-primitives §DataGrid`). Closes UI-AUDIT line 23 (5) and CC-4.
- **Decorative shadow on chrome.** `box-shadow: 0 4px 24px rgba(0,0,0,0.2)` on the toolbar — `MASTER §4.1` reserves shadow for `elev.3+` overlays. Hairline only (`1px solid var(--border-subtle)`).
- **Mismatched border radius for chrome.** `border-radius: var(--radius-lg)` on the toolbar reads consumer-app on a sticky element. Toolbar is full-bleed under the page header — no radius.
- **Layout-shifting hover.** Verify no `transform: translateY` on row/card hover after migration to `<EntityCard>` and `<DataGrid>` (G4 / CC-12).
- **Page-title hero typography.** No subtitle/heading in this view exceeds `text.h1` (20px). Closes CC-3.

### `?67` easter egg — keep, but compliant

The audit (line 23 (3)) flagged the `drift-motion` keyframes (lines **325–339**) as ad-hoc and reduced-motion-hostile. **The user has confirmed it stays.** Re-house it per `00-globals §G5` so it survives this hygiene pass:

- **Move keyframes** out of `SessionListView.vue` into `apps/desktop/src/styles/easter-eggs.css` (the single, named, opt-in file). Delete the `<style scoped>` block's `drift-active` + `@keyframes drift-motion` rules from this view.
- **Trigger via attribute, not class.** Replace `pageRef.classList.add('drift-active')` (lines **117–124**) with `document.documentElement.setAttribute('data-easter-egg', '67')`, removed after `1800ms`. No `<body>`/page transform; the selector in `easter-eggs.css` is `:root[data-easter-egg="67"] [data-tp-component="data-grid"], :root[data-easter-egg="67"] [data-tp-component="entity-card"]`.
- **Wrap in reduced-motion guard.** The `@keyframes` block lives inside `@media (prefers-reduced-motion: no-preference) { … }` so it self-disables.
- **Reduce skew amplitude to ±2°.** The original `±10°` reads as a layout bug; `±2°` is a perceptible whisper.
- **Comment.** Two-line comment at the top of `easter-eggs.css` flagging it as intentional, with a pointer to this section: `/* ?67 — intentional easter egg, see design-system/pages/10-session-list.md §Anti-patterns. */`.

The `watch(() => store.searchQuery, …)` block remains; only its effect changes (attribute toggle instead of class toggle).

---

## Acceptance checklist

- [ ] `apps/desktop/src/views/SessionListView.vue` no longer contains `backdrop-filter`, `box-shadow`, `linear-gradient`, raw `rgba(...)`, or raw hex literals (greppable).
- [ ] `<ToolbarRow sticky variant="header">` replaces `.enhanced-toolbar`; no `.enhanced-toolbar` selector remains in the file.
- [ ] Default body is `<DataGrid>` with the seven columns defined in §Layout, in the order shown.
- [ ] Cards view is reachable via the `Grid │ Cards` segmented control and persists in `tracepilot:sessions:view`.
- [ ] Density toggle (Comfortable 32px / Compact 28px) persists in `tracepilot:density:session-list`.
- [ ] Pinned rows always render above unpinned rows in **both** Grid and Cards presentations regardless of sort.
- [ ] `j/k`, `↑/↓`, `Enter`, `Cmd/Ctrl+Enter`, `o`, `*`, `/`, `f`, `d`, `g g`, `Shift+G`, `Esc` all behave per §Interaction model and appear in the `?` overlay's "Active View" group.
- [ ] `Cmd/Ctrl+click` and middle-click open in a `SessionTabStrip` tab (existing `openSession` ctrl/meta path is preserved).
- [ ] Empty state, no-results-after-filter, error, and indexing variants all render Lucide icons via `<Icon>`; **zero emoji** in `<template>` (matches `rg "[\u{1F300}-\u{1FAFF}]" apps/desktop/src/views/SessionListView.vue` returning 0 hits).
- [ ] `<EmptyState>` consumers in this view use `iconName`, not `icon`.
- [ ] The native sort `<select>` (lines 156–163) is removed; sort happens on column header click and is announced via `aria-sort`.
- [ ] `<SessionCard>` is deleted from `packages/ui` and removed from its barrel export.
- [ ] `useSessionsStore` exposes `pinnedSessionIds` (Set<string>) plus `togglePin(id)`; preference persists in `tracepilot:sessions:pinned`.
- [ ] `useSessionsStore.sortBy: SortOption` is replaced by `{ columnId, dir }`; downstream consumers updated.
- [ ] Indexing progress is shown inline as defined in §States (initial = full panel + determinate `<ProgressBar>`; background = 2px indeterminate strip below the toolbar).
- [ ] Status is signaled by **icon + dot + tone**, never color alone — verified against a color-blind simulator.
- [ ] DataGrid is virtualized via `@tanstack/vue-virtual`; rendering 5 000 synthetic sessions sustains 60fps on the perf-budget rig.
- [ ] `prefers-reduced-motion: reduce` toggled in OS settings: the indeterminate indexing strip becomes static; the `?67` egg is silent; row hover/selection still color-changes (≤ 1ms per G5).
- [ ] `?67` keyframes live in `apps/desktop/src/styles/easter-eggs.css`, are gated by `@media (prefers-reduced-motion: no-preference)`, use `data-easter-egg="67"` on `<html>`, and clamp skew at `±2°`.
- [ ] Stylelint passes (`color-no-hex`, `tracepilot/no-backdrop-filter`, `tracepilot/no-emoji-in-templates`, `tracepilot/spacing-grid`, `tracepilot/z-index-token-only`) on this file.
- [ ] Light + dark parity verified on: empty, loading, error, partial, running, no-results, indexing.
- [ ] `pnpm --filter @tracepilot/desktop typecheck` and `pnpm --filter @tracepilot/ui typecheck` pass.
