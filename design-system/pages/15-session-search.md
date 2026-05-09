# 15 · Session Search — results page

> **Scope:** The full-page search results view at route `/search` (formerly `SessionSearchView`). This is the **analytical** companion to the `Cmd/Ctrl+K` Search Palette defined in `01-chrome §1.5`. The palette = quick jump; **this view = serious investigation** (deep filtering, grouped results, deep-linkable URL state, keyboard-first scrubbing through hundreds of hits).
> **Inherits:** all of `00-globals.md` (no glass, no hex, Lucide-only, motion budget) + `01-chrome.md` (sidebar / tab strip / `<PageHeader>` / **`§1.5 SearchPalette`** — the canonical palette → results contract).
> **Composes:** primitives from `02-primitives.md` — `<ToolbarRow>`, `<SplitPane>`, `<DataGrid>`, `<EntityCard>`, `<EmptyState>`, `<StatusPill>`, `<Heading>`.
> **Closes audit findings:** Session Search (High, `UI-AUDIT.md` lines 91–97), Search Sub-Components (`UI-AUDIT.md` lines 335–339), and the cross-cutting **CC-5** ("where do I search?") and **CC-9** (12-component sprawl).
> **Sources read:** `apps/desktop/src/views/SessionSearchView.vue`, `apps/desktop/src/components/search/{SearchFilterSidebar,SearchGroupedResults,SessionSearchHero,SearchResultCard,SearchActiveFilters,SessionSearchPagination,SessionSearchResultsHeader,SearchBrowsePresets,SearchResultExpandedDetails,SearchResultActions,SearchResultMeta,SearchSyntaxHelpModal,SearchPaletteResults,SessionSearchIndexingBanner}.vue`, `composables/useSessionSearch.ts`, `stores/search.ts`.

---

## 1. Palette → Results page contract

The audit's headline complaint is **"where do I search?"**. The answer is now contractual:

| Surface | Job | Reach |
|---|---|---|
| **`SearchPalette`** (`Cmd/Ctrl+K`, `01-chrome §1.5`) | Jump to a known thing fast. Top 10–15 hits, grouped, no filtering UI. | From anywhere. |
| **`/search` results page** (this spec) | Investigate. Full filter rail, all hits, grouped or flat, deep-linkable. | From the palette via `Enter` on "View all results" footer, `Ctrl+F` inside the palette, sidebar **Workspace › Search** (`Alt+2`), or `/` from anywhere outside an input. |

### Handoff rules
1. **The palette never owns the query.** It writes its query to the search store, then `Ctrl+F` / "View all results" routes to `/search?q=<encoded>` — the URL is the source of truth from that moment.
2. **The results page never opens its own modal palette** for the primary input. Its toolbar input is the editor for `?q=`. Pressing `Cmd/Ctrl+K` from this view re-opens the palette as expected (chrome behaviour wins).
3. **Round-trip preserves selection.** Opening a result and pressing `Esc` (or `Alt+←`) returns to `/search` with the same query, filters, scroll offset, and focused row. The store keeps `focusedResultIndex` per query-hash.
4. **Recent-query memory is shared.** The palette's 30-second recent-query cache (per `01-chrome §1.5`) is the same store this view reads, so typing in either surface reflects in the other.

> **No second palette in this view.** Earlier code shipped a `SearchPaletteResults.vue` inside the page — that file is folded into the palette itself (`packages/ui/src/components/SearchPalette/`). The results page renders results as a **list**, not a popover.

---

## 2. Information architecture

### 2.1 Query and filters — all URL-bound

The view is **fully deep-linkable**. Every filter is a query-string parameter so a URL alone reproduces the result set.

| Param | Type | Meaning |
|---|---|---|
| `q`        | string | Free-text query (FTS syntax allowed: quotes for phrase, `*` prefix). |
| `types`    | csv of `conversation \| tool_call \| file_edit \| todo \| reasoning \| system` | Content types to **include**. |
| `not`      | csv  | Content types to **exclude** (tri-state filter). |
| `repo`     | string | Repository slug (`owner/name`). |
| `branch`   | string | Branch name. |
| `model`    | string | Model id (`gpt-4o`, `claude-sonnet-4.5`, …). |
| `agent`    | string | Sub-agent identity (`main`, `explore`, `code-review`, …). |
| `session`  | string | Lock results to a single session id. |
| `from` / `to` | ISO date | Date range. Preset names (`24h`, `7d`, `30d`, `all`) round-trip via `range=`. |
| `sort`     | `relevance \| newest \| oldest` | Default `relevance`. |
| `view`     | `grouped \| flat` | Default `grouped`. |
| `page`     | int  | 1-based page. Cleared whenever any other param changes. |

### 2.2 Result groups (ranked)

Hits arrive in four canonical groups, displayed in this order. Each group declares its own count and may be collapsed independently.

1. **Sessions** — a session whose summary, repo, or branch matches the query. `<EntityCard>` rows.
2. **Conversation hits** — turns (user, assistant, reasoning, tool I/O) inside a session. `<DataGrid>` rows with snippet column.
3. **File hits** — file edits / patches / paths from `tool_call` content. `<DataGrid>` rows with mono path + diff snippet.
4. **Todo hits** — Copilot todo items mentioning the query. `<DataGrid>` rows.

Inside each group, ranking is **relevance score → recency** (default), or pure recency under `sort=newest|oldest`. Groups stream in independently (see §7 *partial*).

---

## 3. Layout

A two-pane `<SplitPane>`: left filter rail (canvas-inset, persisted width), right main column. The page itself sits **inside the canonical chrome**:

```
┌─ AppSidebar ─┬─ SessionTabStrip ─────────────────────────────────────────────────────┐
│              │                                                                        │
│   Workspace  │  ┌─ PageHeader ─────────────────────────────────────────────────────┐  │
│   ▦ Sessions │  │ Search › "jwt signing key"                                        │  │
│ ▶ ✦ Search   │  │ Search                                              [⌘K palette] │  │
│   ▤ Analytics│  └────────────────────────────────────────────────────────────────────┘  │
│   …          │  ┌─ ToolbarRow (sticky) ─────────────────────────────────────────────┐  │
│              │  │ [🔍 jwt signing key……………………] [grouped|flat] [relevance ▾] [⓵filters] [?syntax] │
│              │  └────────────────────────────────────────────────────────────────────┘  │
│              │  ┌─ ToolbarRow (active filters, only when ≥1) ──────────────────────┐  │
│              │  │ [type:conversation ✕] [repo:tracepilot ✕] [7d ✕]   Clear all (x) │  │
│              │  └────────────────────────────────────────────────────────────────────┘  │
│              │  ┌─ SplitPane horizontal ────────────────────────────────────────────┐  │
│              │  │ ┌─ left rail (canvas-inset) ─┐  ┌─ main (canvas-default) ───────┐ │  │
│              │  │ │ Type                       │  │ ▾ Sessions  · 12               │ │  │
│              │  │ │  ☑ Conversation     412    │  │   ▦ feat: refactor auth        │ │  │
│              │  │ │  ☐ Tool calls       104    │  │     tracepilot/main · 2h       │ │  │
│              │  │ │  ☐ File edits        58    │  │   ▦ fix: crash on resume       │ │  │
│              │  │ │  ☐ Todos              7    │  │     copilot/develop · 1d       │ │  │
│              │  │ │ Date                       │  │ ▾ Conversation hits  · 412     │ │  │
│              │  │ │  ◯ Last 24h                │  │   ▌ "JWT signing key" matched  │ │  │
│              │  │ │  ● Last 7 days             │  │     in feat: refactor auth ·   │ │  │
│              │  │ │  ◯ Last 30 days            │  │     turn 12 · 2h               │ │  │
│              │  │ │  ◯ All time                │  │     › snippet line preview…    │ │  │
│              │  │ │ Repo  ▾ tracepilot         │  │ ▾ File hits  · 58              │ │  │
│              │  │ │ Branch ▾ main              │  │   📄 packages/ui/PageHeader.vue│ │  │
│              │  │ │ Model ▾ —                  │  │ ▾ Todo hits  · 7               │ │  │
│              │  │ │ Agent ▾ —                  │  │                                  │ │  │
│              │  │ │ Session ▾ —                │  │                                  │ │  │
│              │  │ │ ─── Clear all ───          │  │ [«  page 1 / 14  »]             │ │  │
│              │  │ └────────────────────────────┘  └──────────────────────────────────┘ │  │
│              │  └────────────────────────────────────────────────────────────────────┘  │
└──────────────┴────────────────────────────────────────────────────────────────────────┘
```

### Layout rules
- **Filter rail** uses `background: var(--canvas-inset)` so it reads as "data filtering, not navigation" (per `01-chrome §11` — in-page filter rails are not chrome).
- **Width** is persisted via `<SplitPane paneId="search-filters">`. Default `260px`, min `220px`, max `360px`. `Alt+←/→` resizes.
- **Top toolbar** is sticky (`<ToolbarRow sticky variant="header">`). It carries the canonical query input, view-mode segmented control, sort, filter-rail toggle, and syntax help.
- **Active filters row** appears only when ≥1 filter is set. It's a second `<ToolbarRow variant="inline">` directly below the header toolbar — no gap, single hairline divider between.
- **Many-results scrubber.** When `totalCount > 200`, a vertical mini-scrollbar appears on the right edge of the main column showing **density bands per group** (sessions/conversation/file/todo each get their own colour from `--agent-color-*` index 0–3). Clicking jumps to the corresponding offset; this replaces the existing pagination dance for power users (pagination remains as a fallback at the bottom).
- The hero is **gone**. No 36px display title, no decorative copy, no centered prose. The page title lives in `<PageHeader>` and reads: `Search` (subtitle: the active query in `--font-mono`, or "Type to search" when empty).

---

## 4. Tokens used

Inherited unchanged from `00-globals` and `02-primitives`. No new tokens.

| Where | Token |
|---|---|
| Page background | `--canvas-default` |
| Filter rail background | `--canvas-inset` |
| Toolbar background | `--canvas-subtle` |
| Group header background | `--canvas-subtle` |
| Result row hover | `--surface-tertiary` |
| Result row selected | `--accent-subtle` + inset `--accent-emphasis` rail |
| Hairlines | `--border-subtle` |
| Filter rail divider | `--border-muted` |
| Snippet match highlight | `background: var(--accent-subtle); color: var(--accent-fg)` |
| Group counts, meta, timestamps | `--text-tertiary`, `--font-mono`, `tnum` |
| Session badges | `<StatusPill tone="accent\|done\|neutral" />` per repo/branch/model |
| Filter-mode tri-state | `--success-fg` (include), `--danger-fg` (exclude), `--text-tertiary` (off) |
| Group expansion motion | `transition: transform 180ms cubic-bezier(0.2,0.6,0.2,1)` |

No hex literals anywhere. No `linear-gradient`. No `backdrop-filter`. No `text.micro` outside the StatusPill chips.

---

## 5. Component contracts — collapse 12 → 5

### 5.1 The five components

| # | Component | Role | Source |
|---|---|---|---|
| 1 | `<ToolbarRow>` (×2 instances) | Top query+controls bar; below it the active-filters bar. | `02-primitives §10` |
| 2 | `<SplitPane>` | Filter rail ↔ main column. | `02-primitives §4` |
| 3 | `<DataGrid>` | Conversation / file / todo result rows (dense, sortable, virtualized, group-able). | `02-primitives §2` |
| 4 | `<EntityCard>` | Session-result rows in the **Sessions** group only (richer card mode). | `02-primitives §6` |
| 5 | `<EmptyState>` | First-run, no-query, no-results, error. | `02-primitives §9` |

`<StatusPill>` and `<Heading>` are referenced freely as type primitives (per `02-primitives` they are vocabulary, not "search components").

### 5.2 Migration table — what to delete or merge

| Existing file | Disposition |
|---|---|
| `SessionSearchHero.vue` | **Delete.** Hero pattern violates `00-globals §G3` (no marketing hero, no 36px display). The query input becomes a normal input inside `<ToolbarRow>`. |
| `SearchActiveFilters.vue` | **Merge into `<ToolbarRow>`** (second instance, slot `#left` renders chip strip; `#right` renders "Clear all"). Each chip is `<StatusPill tone="neutral" iconName="x" />`. |
| `SessionSearchResultsHeader.vue` | **Merge into `<ToolbarRow>`.** Result count + view-mode segmented + copy-all live in the header toolbar's `#right` slot. |
| `SessionSearchPagination.vue` | **Delete.** `<DataGrid>` already owns paging; the page-level pager is rendered inline at the bottom of the main column using the grid's exposed pager slot. |
| `SearchBrowsePresets.vue` | **Merge into `<EmptyState>` "no query" body.** Presets become `<EmptyState>` `secondaryAction` chips. |
| `SessionSearchIndexingBanner.vue` | **Move out of this spec** into the chrome's status-row affordance (sidebar bell-adjacent indexing pip). The view does not own a banner. |
| `SearchResultCard.vue` | **Replace** with `<EntityCard>` for the **Sessions** group, and with a `<DataGrid>` row template for every other group. |
| `SearchResultMeta.vue` | **Inline** into the `<DataGrid>` row render function (it's three spans of text — not a component). |
| `SearchResultActions.vue` | **Inline** into `<DataGrid>`'s `#row-actions(row)` slot (copy / open / open-in-tab). Per `02-primitives §2`, that slot is the canonical place. |
| `SearchResultExpandedDetails.vue` | **Keep** as an internal sub-component of the `<DataGrid>` row template (`expanded` state renders an inline detail panel underneath the row). Not exported. |
| `SearchGroupedResults.vue` | **Delete.** Grouping is a `<DataGrid>` feature: the grid accepts a `groupBy` config (id + label + count) and emits one virtualized list with sticky group headers. Add this to `<DataGrid>` if missing — it's a primitive concern, not a search concern. |
| `SearchFilterSidebar.vue` | **Keep** (it's the only remaining view-specific component) but rename to `SearchFilterRail.vue` and reduce it to a thin Vue file that emits filter changes to the URL. No bespoke styling — uses `<StatusPill>` and standard checkbox/radio primitives. |
| `SearchPaletteResults.vue` | **Delete.** Folded into `SearchPalette` itself per `01-chrome §1.5`. |
| `SearchSyntaxHelpModal.vue` | **Keep** as a pure modal accessed via the toolbar's `?` button. No restyling beyond `00-globals` modal recipe. |

**Net:** 14 source files → 5 primitive references + 1 view-specific filter rail + 1 syntax help modal. The `components/search/` directory shrinks to two files.

### 5.3 Per-instance prop sketches

```ts
// Top toolbar
<ToolbarRow sticky variant="header" :density="density">
  <template #left>
    <SearchInput v-model="q" placeholder="Search sessions, conversations, files, todos…" />
  </template>
  <template #right>
    <SegmentedControl v-model="view" :options="['grouped','flat']" />
    <Select v-model="sort" :options="['relevance','newest','oldest']" />
    <Button icon="sliders" @click="filtersOpen = !filtersOpen">{{ activeFilterCount || 'Filters' }}</Button>
    <Button icon="help-circle" @click="showSyntaxHelp = true" aria-label="Search syntax" />
  </template>
</ToolbarRow>

// Sessions group → EntityCard rows
<EntityCard
  v-for="s in sessionsGroup"
  :title="s.summary"
  :iconName="agentIconFor(s.agent)"
  :status="{ tone: s.outcome, label: s.outcomeLabel }"
  :meta="[s.repo, s.branch, s.model, relativeTime(s.updatedAt)]"
  :interactive="true"
  @activate="open(s.id)"
/>

// Conversation / File / Todo groups → one DataGrid each
<DataGrid
  :rows="conversationHits"
  :columns="conversationColumns"
  :groupBy="null"
  density="comfortable"
  :sortBy="sort === 'relevance' ? null : { columnId: 'updatedAt', dir: sort === 'newest' ? 'desc' : 'asc' }"
  @row-activate="openHit"
>
  <template #row-actions="{ row }">
    <Button icon="copy" @click="copy(row)" aria-label="Copy snippet" />
    <Button icon="external-link" @click="openInTab(row)" aria-label="Open in new tab" />
  </template>
</DataGrid>
```

---

## 6. Interaction model

### 6.1 Keyboard

All shortcuts register through `useShortcut(...)` so the `?` overlay (`01-chrome §1.7`) shows them under "Active View".

| Key | Action |
|---|---|
| `/`            | Focus the query input. Works from anywhere outside another input. |
| `j` / `↓`      | Move focus to next result row (within group, then crosses groups). |
| `k` / `↑`      | Move focus to previous result row. |
| `Enter`        | Open the focused result in the **current tab**. |
| `Cmd/Ctrl+Enter` | Open the focused result in a **new session tab** (per `01-chrome §1.3`). |
| `Space`        | Expand / collapse the focused row's inline detail panel. |
| `g f`          | Jump to the next group's first row. |
| `g p`          | Jump to the previous group's first row. |
| `g g` / `G`    | Jump to first / last result. |
| `f`            | Move focus to the first filter control in the rail. |
| `x`            | Clear all active filters (with a 2-second `Undo` inline pill). |
| `s`            | **[FUTURE]** Save current query+filters as a named saved search. The shortcut is reserved; the affordance ships disabled with a tooltip "Saved searches coming soon". |
| `?`            | Opens the global shortcut overlay (chrome). |
| `Esc`          | If detail panel is open → close it. Else → return focus to query input. Else (input focused, empty) → blur. |

`Cmd/Ctrl+K` always opens the palette — never intercepted by this view.

### 6.2 URL state contract

- Every filter change writes to `history.replaceState` (no scroll-jacking, no new history entries) **debounced 250ms**. Page-mode changes write `pushState` so the back button is meaningful.
- Mounting the view reads `?q=` and all filter params and rehydrates the store. If the URL contains a query the store didn't have, the URL wins.
- Copying the URL from the address bar and pasting it elsewhere reproduces the exact result set.
- The palette's "View all results" footer constructs the URL from its own current state — the page is purely a consumer of `?q=`.

---

## 7. States

| State | Trigger | Treatment |
|---|---|---|
| **Empty (no query, no filters)** | First mount, no `?q=`. | `<EmptyState iconName="search" title="Search across every session" description="Type a query, or pick a preset to browse by type, repo, or recency." />` with preset chips as `secondaryAction` (replaces `SearchBrowsePresets`). |
| **Querying** | Query changed, debounce 150ms in flight. | Header toolbar shows inline `loader-2` spinner at the right edge of the input (14px Lucide, `--accent-fg`, respects reduced-motion). Result list freezes the previous result set at 0.6 opacity until the next batch arrives — no layout jump. |
| **No results** | Query finished, `totalCount === 0`. | `<EmptyState iconName="search-x" title="No matches for "<query>"" description="Try a broader query, drop a filter, or check syntax." />`. Below it, **lower-confidence broader matches**: rerun the query with all type/exclude filters dropped and surface up to 5 hits as `Did you mean…` rows. |
| **Partial / streaming** | Multi-source query: each group resolves independently. | Each group header shows a per-group spinner until that group settles. Other groups remain interactive. Live region announces "Sessions: 12 results · Conversation: searching…". |
| **Error** | Backend returned a non-200, or store flagged `error`. | Inline `<ToolbarRow variant="inline">` banner using `--danger-subtle` background + `--danger-fg` text + `octagon-x` icon + `Retry` button. Below it, the previous successful result set remains visible (do not destroy on error). |
| **Indexing** | `store.isIndexing` true. | A 1-line passive note in the header toolbar's `#right` slot: `Indexing 412 / 1 832`. Searches still run — the existing partial index serves them. **No page-wide banner.** |

---

## 8. Motion

Everything within the `00-globals §G5` envelope. Properties: `transform`, `opacity`, color/border. Never width/height/top/left.

| Where | Duration | Notes |
|---|---|---|
| Group expand/collapse | **180ms** ease-out (cubic-bezier 0.2 0.6 0.2 1). Animates `max-height: 0 → auto` via the height-trick (animate `transform: scaleY` of the inner panel and snap on completion) — never animates intrinsic height. | |
| Row hover | 120ms color/border. | |
| Detail-panel inline expand | 180ms opacity + 4px y-translate. Reduced-motion: instant. | |
| Filter-rail toggle | `<SplitPane>` handles its own slide. | |
| Spinner | continuous (indeterminate progress is exempt). Reduced-motion: hidden, replaced with the literal text "Searching…". | |
| Result list "previous results dimming" during query | 120ms opacity to 0.6. | |

`prefers-reduced-motion`: all transforms collapse to instant cross-fades capped at 80ms (per `00-globals §G5`).

---

## 9. Accessibility

- The view is wrapped in `<main role="main" aria-labelledby="search-page-title">`; the `<PageHeader>` title is the `<h1>`.
- The filter rail is `<aside aria-label="Filters">`. Each filter group is a `<fieldset><legend>`; tri-state content-type toggles use `aria-pressed` on their button form (off → false; include → true; exclude → "mixed" plus a Lucide `minus` icon — never colour alone, per `00-globals §G6`).
- The main column is a sequence of `<section role="region" aria-labelledby="group-{id}">`, one per result group, **in landmark navigation order** so screen-reader users can `D`/`R`-jump between them.
- Within each group, the `<DataGrid>` exposes proper `role="grid"` semantics (per `02-primitives §2`), with `aria-rowindex` continuous within the group. The Sessions group exposes a `role="listbox"` + `role="option"` shape because it uses `<EntityCard>` rather than a grid.
- Result count changes announce via `aria-live="polite"` on a single hidden region: `"412 results across 4 groups"` — debounced to the post-settle moment, never per-keystroke.
- Focus-visible ring is the canonical 2px `--accent-emphasis` with 2px offset (`00-globals §G4`). Group headers are tab-stops; pressing `Enter` on a header collapses/expands.
- Match-highlight `<mark>` elements are real `<mark>` tags so SR users hear the match emphasis. Background contrast is verified at AA against `--canvas-default` and `--surface-tertiary`.
- Every icon-only button (`copy`, `external-link`, `x` chip, `?` syntax help, the filter-rail toggle) has an explicit `aria-label`.

---

## 10. Anti-patterns to remove

| Anti-pattern (from audit) | Resolution |
|---|---|
| **CC-5: "where do I search?"** — both `Cmd+K` palette and a full search page exist with overlapping affordances. | Single contract in §1: palette = jumps, page = investigation. The palette no longer renders any "results page within a popover", and the page no longer renders its own modal palette. `Ctrl+F` inside the palette is the canonical handoff. |
| **CC-9: 12-component sprawl** for one feature. | Migration table in §5.2 reduces it to 5 primitives + 2 view-specific files. |
| **Hero pattern** in `SessionSearchHero.vue` (large input, decorative copy). | Deleted. Query input lives in `<ToolbarRow>`. Title capped at `text.h1` per `00-globals §G3`. |
| **Glassmorphism on the toolbar / sidebar** (per `00-globals §G2` ban). | `<ToolbarRow>` and the filter rail are flat `--canvas-subtle` / `--canvas-inset` with hairline only. |
| **Hex literals in `search-palette-results.css`** (audit CC-3 / CC-11). | File deleted along with `SearchPaletteResults.vue`. |
| **Emoji in placeholders, group icons, syntax help.** | All replaced with Lucide via `<Icon>`. The migration table from `00-globals §G1` covers the `🔍 / ⚡ / 📄 / 📊` glyphs that appeared in source. |
| **Inline SVGs** in `SessionSearchView.vue` (lines 104, 149, 159, 187). | Replaced with `<Icon name="…">`. |
| **Decorative `animationDelay: idx * 40ms`** cascade on group entrance (`SearchGroupedResults.vue:31`). | Removed. Group entrance is instant; only the first paint is animated, capped at 180ms per `§8`. |
| **British/American split** ("matches" / "match") rendered ad-hoc. | Use `Intl.PluralRules`. |
| **Custom pagination component** when the `<DataGrid>` already exposes one. | Deleted; grid pager used. |

---

## 11. Acceptance checklist

### Contract
- [ ] `Cmd/Ctrl+K` opens the palette from this view; the palette's "View all results" / `Ctrl+F` routes here with `?q=` populated
- [ ] Pasting the page URL into a fresh tab reproduces the exact same query + filters + sort + view-mode + page
- [ ] `Esc` from a result returns to the same focused row at the same scroll offset
- [ ] `/`, `j`, `k`, `Enter`, `Cmd/Ctrl+Enter`, `Space`, `g f`, `g p`, `f`, `x`, `?` all work; `s` is reserved and shows the "[FUTURE]" tooltip

### Layout & primitives
- [ ] No `SessionSearchHero.vue`, `SearchPaletteResults.vue`, `SearchActiveFilters.vue`, `SessionSearchResultsHeader.vue`, `SessionSearchPagination.vue`, `SearchBrowsePresets.vue`, `SearchGroupedResults.vue`, `SearchResultCard.vue`, `SearchResultMeta.vue`, `SearchResultActions.vue` in `apps/desktop/src/components/search/`
- [ ] Remaining files in that directory: `SearchFilterRail.vue`, `SearchSyntaxHelpModal.vue` — and nothing else
- [ ] The view composes `<ToolbarRow>` ×2, `<SplitPane>`, `<DataGrid>` ×3, `<EntityCard>`, `<EmptyState>` — and the canonical chrome
- [ ] Filter-rail width persists under `tracepilot:splitpane:search-filters`
- [ ] `<DataGrid>` exposes `groupBy` + sticky group headers; if missing, primitive PR ships first

### Hygiene (inherited from `00-globals`)
- [ ] No `backdrop-filter` anywhere in the view
- [ ] No `linear-gradient` on any surface in the view
- [ ] No hex / rgb / hsl literals in the view's CSS — `color-no-hex` lint passes
- [ ] No emoji in templates or in icon/label/title/placeholder strings
- [ ] No `transform: scale|translateY` on `:hover`
- [ ] All durations ∈ {120ms, 180ms, 220ms}; no `animation: ... infinite` outside the inline indeterminate spinner
- [ ] `prefers-reduced-motion`: group expand is instant, dim transition is ≤80ms cross-fade

### States
- [ ] Empty (no query) renders `<EmptyState>` with preset chips
- [ ] No-results renders the "Did you mean…" lower-confidence broader-match section under the EmptyState
- [ ] Partial/streaming: each group spinner resolves independently; the live region announces post-settle
- [ ] Error banner does not destroy the previously-rendered result set

### Accessibility
- [ ] Each group is a real `<section role="region">` with `aria-labelledby` — landmark nav between groups works
- [ ] Sessions group is `role="listbox"`; conversation/file/todo groups are `role="grid"` (via `<DataGrid>`)
- [ ] `aria-live="polite"` total-count announcement fires once per settled query, not per keystroke
- [ ] Tri-state content-type toggle uses `aria-pressed="false|true|mixed"` plus an icon — never colour alone
- [ ] All icon-only buttons have `aria-label`
- [ ] AA contrast verified for `<mark>` highlights against `--canvas-default` and `--surface-tertiary`

---

*See also: `00-globals.md` (hygiene), `01-chrome.md §1.5` (palette → results contract), `02-primitives.md §2/§4/§6/§9/§10` (the five components composed here).*
