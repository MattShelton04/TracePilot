# 11 · Session Detail Shell — Header & Tab Chrome

> **Scope:** The shared chrome that frames every per-session view: the two-row hairline header (breadcrumb · summary · status · ID / action toolbar) and the inner tab strip that hosts Overview, Conversation, Events, Todos, Metrics, Explorer, Timeline. This file is the contract for `SessionDetailView`, `SessionDetailTabView`, and the shared `SessionDetailPanel` that they delegate to.
> **Inherits:** all of `00-globals.md` (no glass, no gradient, no transform-hover, motion budget, color-from-token). All of `01-chrome.md` (PageHeader §1.4, BreadcrumbNav §1.2, SessionTabStrip §1.3, `?` overlay §1.7). All of `02-primitives.md` (`<StatusPill>`, `<ToolbarRow>`, `<EmptyState>`, `<Heading>`).
> **Audit refs:** Session Detail Shell (High) — `design-system/audit/UI-AUDIT.md` lines 27–33; cross-cutting CC-1 (mixed icon sources), CC-2 (glass on data chrome), CC-9 (component duplication).
> **Source files (current implementation):**
> - `apps/desktop/src/views/SessionDetailView.vue` (route-driven entry)
> - `apps/desktop/src/views/SessionDetailTabView.vue` (tab/child-window entry)
> - `apps/desktop/src/components/session/SessionDetailPanel.vue` (the actual chrome — both entries delegate here)
>
> **Sibling spec:** `12-conversation-tab.md` covers the Conversation tab body (the flagship inner surface). Inner tabs that are non-trivial get their own pages later (Overview, Events, Todos, Metrics, Explorer, Timeline). **This file owns only the shell** — header, action bar, tab strip, kbd model.

---

## 11.1 · Information architecture — the chrome contract

The Session Detail Shell is the single contract that **6 inner tabs share**. It is rendered by exactly one component (`SessionDetailPanel.vue`), which is mounted by two thin entries (route-driven `SessionDetailView`, tab-driven `SessionDetailTabView`). Anything inside the shell — title, IDs, badges, actions, tab nav — belongs here. Anything inside an inner tab body belongs to that tab's spec.

The shell exposes three horizontal bands, top to bottom:

| Band | Component | Job |
|---|---|---|
| 1. Identity row | `<PageHeader>` (§01-chrome 1.4) → header row | Breadcrumb · session summary (`<Heading level="1">`) · status pill · session-ID mono with copy |
| 2. Action toolbar | `<PageHeader>` `#actions` slot, plus the optional sub-row | Refresh, Resume in Terminal, Open Folder, Pop out, density toggle, overflow `⋯` |
| 3. Inner tab strip | `<PageHeader>` `#toolbar` slot, hosting a `<SegmentedControl>` (proposed §11.5) | The 7 inner tabs, with badge counts |

**Hard rules:**

- The shell is **not sticky** at the page level. The inner-tab band (band 3) **may** be sticky **inside the scroll region** when an inner tab opts in. Per-tab specs declare this explicitly. (See `02-primitives §<ToolbarRow>` for `:sticky="true"` semantics.)
- Bands 1 and 2 share the same outer `<PageHeader>` instance — they are the canonical title row and the canonical actions row, **not** two stacked headers. There is one `border-bottom` hairline below band 2 and one below band 3.
- The shell never renders chrome that belongs to a tab body (no per-tab filter chips, no per-tab search inputs). Inner tabs render their own `<ToolbarRow>` below the shell when they need one.

> Ad-hoc local headers inside `SessionDetailPanel.vue` are forbidden once this lands. The component composes `<PageHeader>` + a `<SegmentedControl>` and stops emitting its own `<h1>` / `<h2>` elements. Lint `tracepilot/single-page-header` (already proposed in 01-chrome) covers this.

---

## 11.2 · Layout — ASCII wireframe

The shell is two-row. Long summaries truncate via `BreadcrumbNav` (§01-chrome 1.2 — middle-truncate at 32 chars, full text in `title`). The status pill area is **always reserved** so the row height does not change when a session transitions to running.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Sessions  ›  feat: refactor auth flow                                                 │  band 1a — crumbs row
│                                                                                        │  text.small / --text-tertiary
│ ── Identity row ─────────────────────────────────────────────────────────────────────│
│                                                                                        │
│  feat: refactor auth flow              [● Active 12s ago]   4eaa…b91c  ⎘             │  band 1b — title row
│  ^^^^^^^^^^^^^^^^^^^^^^^^^^            ^^^^^^^^^^^^^^^^^^   ^^^^^^^^^  ^               │
│  <Heading level="1"> (dbl-clk          <StatusPill         mono ID    Copy
│   to rename inline; truncates)          tone=success        14ch       (Cmd+Shift+C)
│                                         iconName=activity)  truncate
│                                         space RESERVED when idle
│                                                                                        │
│  Last updated 3 min ago · main · gpt-4o · 412 events · 28 turns                       │  band 1c — subtitle row
│                                                                                        │  text.small / --text-secondary
├── Action toolbar ────────────────────────────────────────────────────────────────────┤  hairline
│                                                                                        │
│  [↻ Refresh]  [▶ Resume in Terminal ⌘.]  [📁 Open Folder]  [↗ Pop out ⌘P]    [⋯]    │  band 2 — actions
│                                                                                        │
├── Inner tab strip ───────────────────────────────────────────────────────────────────┤  hairline
│                                                                                        │
│  [Overview ¹] [Conversation ²] [Events 412 ³] [Todos 7 ⁴] [Metrics ⁵] [Explorer ⁶]   │  band 3 — <SegmentedControl>
│  [Timeline ⁷]                                                                          │
│                                                                                        │
└── hairline ──────────────────────────────────────────────────────────────────────────┘
                              (active tab body renders below)
```

Notes on the wireframe:

- All icons in the diagram (`▶`, `📁`, `↗`, `↻`, `⎘`, `●`) are **placeholders**. Real icons come from Lucide via `<Icon>` — see §11.4 for the binding.
- Band 1c (subtitle) is optional and renders only when there is at least one piece of metadata. When the session is loading, band 1c renders 1 skeleton line so band 1's height does not change between loading → loaded.
- The kbd hints (`⌘.`, `⌘P`, `¹..⁷`) are **rendered only on hover/focus** of the affordance — they do not appear in the resting state. The full list is always discoverable via `?` (§01-chrome 1.7).
- The tab strip wraps to a second line at < 720px content width. Counts truncate to `99+` once they exceed three digits.

---

## 11.3 · Tokens used

All from `packages/ui/src/styles/tokens.css`. **No hex literals anywhere in this surface** (G6).

| Concern | Token |
|---|---|
| Outer header surface | `--canvas-default` |
| Header hairlines | `--border-subtle` (between bands and below tab strip) |
| Title text | `--text-primary` via `<Heading level="1">` (text.h1 — 20/28 600) |
| Subtitle text | `--text-secondary`, `text.small` |
| Breadcrumb separators | `--text-tertiary` |
| Session-ID monospace | `--font-mono`, `font-feature-settings: 'tnum' 1` |
| Status pill — running | `--success-subtle` bg + `--success-fg` text + Lucide `activity` |
| Status pill — idle | not rendered (placeholder space reserved) |
| Status pill — error | `--danger-subtle` bg + `--danger-fg` text + Lucide `octagon-x` |
| Action button base | `--canvas-subtle` bg + 1px `--border-subtle` |
| Action button hover | `--surface-tertiary` bg, `--border-emphasis` border (color/border only — G4) |
| Action button danger (Resume w/ warning) | adds `--warning-fg` icon tint, never bg |
| Tab strip — inactive | `--text-secondary`, transparent bg |
| Tab strip — hover | `--surface-tertiary` |
| Tab strip — active | `--text-primary`, 2px bottom rail `--accent-emphasis` |
| Tab badge (count) | `--surface-tertiary` bg + `--text-secondary` text (text.micro) |
| Focus ring | `--accent-emphasis`, 2px solid, 2px offset (G4) |
| Motion | 120ms color/border, 180ms tab-switch slide; ease-out `cubic-bezier(0.2, 0.6, 0.2, 1)` (G5) |

> Z-index: bands 1–3 collectively sit at `--z-header` (50). The shell does **not** raise itself above the chrome's `SessionTabStrip` (§01-chrome 1.3); they share the same z-layer and the tab strip is above it in the DOM order.

---

## 11.4 · Component contracts

### Composes (existing canonical primitives)

- **`<PageHeader>` — §01-chrome 1.4.** This is the canonical owner of bands 1a–1c and band 2. The shell passes:
  - `crumbs` — `[{ label: "Sessions", to: { name: "sessions" } }, { label: <session.summary>, id: <session.id> }]`. The leaf segment is the session summary, not the ID. The ID renders separately in band 1b's right-hand region (below) so it is **always selectable** without opening the breadcrumb.
  - `title` — the session summary, capped at `text.h1` (PageHeader enforces this; no 36/40/48px hero).
  - `subtitle` — assembled from `lastUpdated · branch · model · eventCount · turnCount` (pipe-joined per `<PageHeader>` convention).
  - `status` — `{ tone: 'success', label: 'Active <relative>', iconName: 'activity' }` when the session is running; `undefined` otherwise. PageHeader **always reserves 28px** of horizontal space for the pill so the row never resizes when the running probe transitions (closes the audit's "header height changes on session-running state" finding).
  - `#actions` slot — the action toolbar (§11.4 below).
  - `#toolbar` slot — the inner-tab `<SegmentedControl>`.

  **Cite:** `01-chrome.md §1.4` is the contract — this spec does not redefine props, layout tokens, or sticky semantics. It only declares which slots/props the Session Detail Shell binds.

- **`<BreadcrumbNav>` — §01-chrome 1.2.** Long summaries are delegated to BreadcrumbNav's middle-truncate-at-32-chars behaviour. The leaf segment exposes the full summary in `title`; the breadcrumb is **never** the place to copy the ID (that's the dedicated mono token in band 1b).

- **`<StatusPill>` — §02-primitives.** Tone mapping:
  | Session state | Tone | Icon |
  |---|---|---|
  | running, fresh (< 2m since last event) | `success` | `activity` |
  | running, idle (≥ 2m, no terminal event) | `attention` | `clock` |
  | terminated cleanly | not rendered (no pill) | — |
  | error / aborted | `danger` | `octagon-x` |
  | refreshing in progress | overlaid `loader-2` (see §11.7) — **does not replace** the pill |

- **`<ToolbarRow>` — §02-primitives.** The action band (band 2) is a `<ToolbarRow variant="inline">` placed inside `<PageHeader>`'s `#actions` slot (or rendered as the second `#toolbar` slot row when the `#actions` slot would overflow at narrow widths). All buttons are Lucide-only — this is where the audit's "mixed icon sources in action bar" (CC-1/CC-9) is closed.

  Action buttons (left → right):

  | Action | Icon (Lucide) | Kbd | Notes |
  |---|---|---|---|
  | Refresh | `refresh-cw` | (none global; uses `RefreshToolbar` semantics) | Spins on active refresh, respects reduced-motion |
  | Resume in Terminal | `play` | `Cmd/Ctrl+.` | Opens local terminal; warning sub-label if session is currently running elsewhere |
  | Open Folder | `folder-open` | (none) | Opens the session state directory |
  | Pop out | `external-link` | `Cmd/Ctrl+P` | Hidden in viewer windows; opens this session in a child window |
  | Overflow | `more-horizontal` | (none) | Houses density toggle, "Copy session JSON", "Copy permalink", future actions |

  Order is fixed. Density toggle lives **inside** the overflow menu, not in band 2 — the audit found density toggles cluttering toolbars and the global rule is "primary verbs only in the visible toolbar".

### `<SegmentedControl>` — **[NEW PRIMITIVE — proposal]**

`02-primitives.md` does not yet define a segmented control. The inner tab strip is the first surface that needs one. This spec proposes the contract; the primitive is added to `02-primitives` in the same PR that lands this shell.

```ts
// packages/ui/src/components/SegmentedControl.vue
interface SegmentedControlProps<TValue extends string = string> {
  modelValue: TValue;
  options: Array<{
    value: TValue;
    label: string;
    iconName?: LucideName;        // optional 14px Lucide
    badge?: string | number;       // count chip; '' / 0 hides
    disabled?: boolean;
    description?: string;          // tooltip
    kbd?: string;                  // visible on hover/focus only (e.g. '1', '2')
  }>;
  ariaLabel: string;               // required — used as the tablist label
  density?: 'comfortable' | 'compact';   // 32px / 28px row
  fullWidth?: boolean;             // stretch options to fill container
  variant?: 'tabs' | 'segmented';  // 'tabs' = bottom-rail active; 'segmented' = filled active pill
}
// Emits: 'update:modelValue', 'option-activate'
// Slots: #option(option) — fully custom rendering for one option (rare)
```

- **Default variant for the Session Detail Shell:** `variant="tabs"` (bottom-rail active state, transparent inactive — matches `01-chrome §1.3`'s SessionTabStrip language). The `'segmented'` variant exists for future surfaces (e.g. Conversation view-mode toggle in `12-conversation-tab.md`).
- **Token recipe (tabs variant):**
  ```css
  .sc           { display: inline-flex; gap: 4px; min-height: 32px; }
  .sc--full     { display: flex; width: 100%; }
  .sc__opt      { height: 32px; padding: 0 12px; display: inline-flex; gap: 6px; align-items: center; color: var(--text-secondary); border-radius: var(--radius-sm); cursor: pointer; }
  .sc__opt:hover { background: var(--surface-tertiary); color: var(--text-primary); }
  .sc__opt[aria-selected="true"] { color: var(--text-primary); box-shadow: inset 0 -2px 0 0 var(--accent-emphasis); }
  .sc__opt:focus-visible { outline: 2px solid var(--accent-emphasis); outline-offset: 2px; }
  .sc__badge    { font: var(--text-micro); padding: 0 6px; height: 16px; line-height: 16px; border-radius: var(--radius-sm); background: var(--surface-tertiary); color: var(--text-secondary); }
  .sc__opt[aria-selected="true"] .sc__badge { background: var(--accent-subtle); color: var(--accent-fg); }
  .sc__kbd      { opacity: 0; }
  .sc__opt:hover .sc__kbd, .sc__opt:focus-visible .sc__kbd { opacity: 1; }
  ```
- **Accessibility** — root is `role="tablist"`, options are `role="tab" aria-selected aria-controls="<panel-id>"`. Keyboard model is the standard tablist pattern: `←/→` move between tabs, `Home/End` jump to first/last, `Enter`/`Space` activate. See §11.9.

> Once `<SegmentedControl>` lands, audit any other "scope-segmented", "view-toggle", "tabs"-named bespoke component in `apps/desktop` and migrate. Target list is captured in `02-primitives.md` lint-rule `tracepilot/no-local-reimplementation` (extend the deny-list with `.scope-seg-btn`, `.tab-pill`).

---

## 11.5 · Inline rename of session title — design choice

The audit notes "no inline rename of session title" as a missing affordance (line 30). Since the summary is the headline of the page, we add it here rather than burying it in Settings.

### Behaviour

- **Trigger:** double-click on the title (or focus + `Enter`). The title swaps in place to a borderless input that inherits `text.h1` and the surrounding container width.
- **Commit:** `Enter` writes the new label and emits `session:rename`. Loss of focus (blur) also commits.
- **Cancel:** `Esc` reverts to the previous value and emits nothing.
- **Empty:** an empty input on commit reverts to the previous value (no destructive write).
- **Length:** soft cap at 120 chars; over-cap renders `--warning-fg` outline and disables commit.
- **Persistence:** the rename is local-first (writes to the session sidecar), and synchronises through the existing session detail store.

### Trade-offs

- **Pro:** discoverable for power users (inline edit is a Linear/Notion idiom they already know), keeps the rename close to the artefact, no extra modal.
- **Con:** double-click on a title is also "select word" in many platforms, so we accept a 200ms double-click window and **suppress** entering rename mode while a text selection exists in the title. The fallback is the overflow menu's "Rename session…" item, which opens the same input.
- **Con:** screen-reader users do not get a visual double-click cue. Mitigation: when the title element is focused, a `<kbd>F2</kbd>` chip appears on hover/focus and `F2` also enters rename mode (matches Explorer/Finder behaviour). `F2` is published via `useShortcut` at view scope.

### Tokens

```css
.sd__title-edit {
  font: var(--text-h1);
  color: var(--text-primary);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  width: 100%;
  outline: 0;
}
.sd__title-edit:focus-visible { outline: 2px solid var(--accent-emphasis); outline-offset: 2px; }
.sd__title-edit[aria-invalid="true"] { border-color: var(--warning-fg); }
```

---

## 11.6 · Interaction model & kbd table

All shortcuts are registered through the `useShortcut(key, description, handler)` API introduced in `01-chrome §1.7`. The `?` overlay automatically lists them under the **Active View** group when this shell is mounted.

| Scope | Key | Action |
|---|---|---|
| Active view | `1` | Jump to **Overview** tab |
| Active view | `2` | Jump to **Conversation** tab |
| Active view | `3` | Jump to **Events** tab |
| Active view | `4` | Jump to **Todos** tab |
| Active view | `5` | Jump to **Metrics** tab |
| Active view | `6` | Jump to **Explorer** tab |
| Active view | `7` | Jump to **Timeline** tab |
| Active view | `Cmd/Ctrl+.` | Resume session in terminal |
| Active view | `Cmd/Ctrl+P` | Pop out current session into a child window |
| Active view | `Cmd/Ctrl+Shift+C` | Copy session ID to clipboard (inline "Copied" pill, 1.5s) |
| Active view | `R` | Trigger one-shot refresh (delegates to `RefreshToolbar`'s semantics) |
| Active view | `F2` | Enter rename mode on the title |
| Inner tab strip | `←` / `→` | Move tab focus left/right (does not activate; `Enter`/`Space` activates — see §11.9) |
| Inner tab strip | `Home` / `End` | Jump tab focus to first / last |
| Global (already in 01-chrome) | `Alt+←` | History back |
| Global | `?` | Open shortcuts overlay |

**Suppression rules:**
- All single-letter shortcuts (`1..7`, `R`, `F2`) are suppressed when focus is inside an `<input>`, `<textarea>`, or `[contenteditable]` element. The `useShortcut` API enforces this by default; this spec relies on it.
- `1..7` is **suppressed** while the title-rename input is open.

---

## 11.7 · States

The shell renders deterministic chrome in every state — the inner tab body owns its own loading/error views.

| State | Band 1a (crumbs) | Band 1b (title / status / ID) | Band 1c (subtitle) | Band 2 (actions) | Band 3 (tabs) |
|---|---|---|---|---|---|
| **Loading (initial)** | `Sessions › <skeleton 24ch>` | `<skeleton 32ch>` title; **status placeholder reserved** (28px); ID skeleton 14ch mono | 1-line skeleton (matches final shape) | All buttons disabled, Refresh shows spinner | Tab strip rendered, all counts replaced with skeleton dots; current tab `aria-busy="true"` |
| **Idle (loaded, not running)** | full crumbs | title; **no pill**, but space reserved | full subtitle | all buttons enabled | tab strip with counts |
| **Running (Active)** | full crumbs | title; `success` pill `Active <rel>` with `activity` icon | subtitle; "Last updated" auto-ticks every 30s using `tnum` | Resume in Terminal shows warning sub-label "Session running elsewhere" | tab strip live; counts may animate-in via `opacity` only (G5) |
| **Loading-tab-counts** (tab badge fetch in flight after main load) | unchanged | unchanged | unchanged | unchanged | each unresolved badge renders a 12×12 skeleton dot in `--surface-tertiary`; resolved badges render normally |
| **Refresh-in-progress** | unchanged | overlay 14px `loader-2` icon adjacent to status pill (does not replace it) | "Last updated" gains `(refreshing…)` suffix in `--text-tertiary` | Refresh button shows spinning icon, kept enabled (allows cancel-by-reclick) | tab strip unchanged |
| **Error (session failed to load)** | `Sessions › <id>` | `<Heading>` shows ID instead of summary; `danger` pill `Failed`; ID still present and copyable | replaced by `<EmptyState size="sm">` with retry CTA — **inline above** band 2 | Refresh + Pop out remain; Resume / Open Folder hidden | tab strip hidden until retry succeeds |
| **Not found / 404** | `Sessions › —` | "Session not found" placeholder; no pill; no ID | `<EmptyState>` with "Browse sessions" CTA | only Refresh enabled | hidden |

**No layout shift between states.** All transitions between rows above are achieved by swapping content within reserved boxes; band 1's `min-height` is fixed to its loaded height. This is the audit's hard requirement (line 31: "header height changes on session-running state").

---

## 11.8 · Motion (cite §G5)

All motion in this surface lives inside the §G5 budget: **120ms** for color/border (hover, focus, status-pill enter), **180ms** for tab switch (opacity cross-fade of the tab body, see `12-conversation-tab.md` for body-side details), **220ms** reserved for child-window pop-out flourish (the new window's own enter, not anything in the shell). Easing `cubic-bezier(0.2, 0.6, 0.2, 1)`. Properties `transform` and `opacity` only.

**The header height MUST NOT change** when the running pill appears, when the refresh spinner overlays, when band 1c's metadata is appended, or when the tab badges resolve. Reserved-space rules in §11.7 enforce this. Any motion that would alter band 1's height (e.g. animating in the pill from 0×0 to 28×28) is forbidden — fade in `opacity` on the already-reserved 28px box.

`prefers-reduced-motion`: the rotating `refresh-cw` and `loader-2` icons swap to a static state with the same color tone (no infinite animation, per G5). Tab-switch cross-fade caps at 80ms.

---

## 11.9 · Accessibility

- The inner tab strip is the canonical tablist for the session.
  - Root: `role="tablist" aria-label="Session tabs"` — provided by `<SegmentedControl>` via its required `ariaLabel` prop.
  - Each option: `role="tab"`, `aria-selected="true|false"`, `aria-controls="<inner-tab-panel-id>"`, `tabindex="0"` for the active tab and `tabindex="-1"` for the rest (roving tabindex).
  - The active tab body is the `role="tabpanel"` mount point and carries `aria-labelledby="<active-tab-id>"`. This is rendered by the tab-routing layer, not by `<SegmentedControl>` itself.
- **Arrow-key nav between tabs** moves *focus* but does not activate; `Enter` / `Space` activates. This matches WAI-ARIA's "manual activation" tablist pattern and avoids loading every tab on each arrow press. The `1..7` shortcuts **do** activate (they are explicit user intent, not roving focus).
- Status pill exposes its full label (`Active 12 seconds ago`) — never icon-only. Tone color is paired with text + icon (G2 / "color is never the only signal").
- Session ID is in a `<button aria-label="Copy session ID 4eaa…b91c">` wrapping the mono span; the copy result is announced via the existing `useClipboard` live region (1.5s "Copied" inline pill).
- Title rename: when entering rename mode, focus moves into the input and a polite live region announces "Editing session title". On commit, "Title updated" is announced. On cancel, "Edit cancelled".
- All keyboard shortcuts in §11.6 are **published via `useShortcut`** so they appear in the `?` overlay's *Active View* group. None of them is hidden; if a future contributor adds a binding, registering it through `useShortcut` is the only approved path.
- Focus order at mount: breadcrumb leaf → rename-eligible title → status pill (if rendered, focusable to get full timestamp tooltip) → ID copy button → action toolbar buttons (left to right) → overflow menu → active tab in the strip → tab body.

---

## 11.10 · Anti-patterns to remove

These are the audit-tagged regressions this spec retires. Each one cites the §G rule it violates so the lint configuration in `00-globals` catches future re-introductions.

1. **`backdrop-filter: blur(12px)` on the sticky session header** — `apps/desktop/src/components/session/SessionDetailPanel.vue:370–371` (`.detail-actions { background: rgba(24,24,27,.7); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); ... }`). Violates **G2** (no glassmorphism on chrome) and **CC-2** (glass-on-data-chrome). Replacement: the canonical `<PageHeader>` recipe — `background: var(--canvas-default); border-bottom: 1px solid var(--border-subtle);`. The light-mode override on line 378–381 is removed in the same change.
2. **Hand-rolled box-shadow on the action bar** — same block, `box-shadow: 0 4px 24px rgba(0,0,0,.2)` and the light-mode mirror. Violates **MASTER §4.1** (hairlines + tonal elevation, no shadow on inline surfaces). Replacement: nothing — the hairline alone is the elevation.
3. **Mixed icon sources in the action bar** — inline SVG paths next to plain text buttons next to `RefreshToolbar`'s separate visual language. Violates **CC-1** / **CC-9**. Replacement: every button in band 2 renders Lucide via `<Icon>` with the bindings in §11.4; `RefreshToolbar` is migrated to expose its surface as Lucide-only or absorbed into the `<ToolbarRow>` recipe in this spec.
4. **Unreserved status-pill space** — the running pill currently appears/disappears, changing band 1's height. Violates **§01-chrome 1.4** (PageHeader reserves 28px) and the audit line 31 finding. Replacement: `min-height` reservation per §11.7.
5. **Ad-hoc `<h1>` / heading markup inside `SessionDetailPanel`** — replaced with `<Heading level="1">` (G7 / `02-primitives <Heading>`).
6. **`text.micro` uppercase used for tab badges or section labels in the surrounding code** (if any are found during migration) — replaced with `text.small` per **G7**. `text.micro` is allowed only inside `<StatusPill>` and the tab-badge count chip defined in §11.4.
7. **Density toggle living in the visible toolbar** — moved to the overflow menu (§11.4) so band 2 only carries primary verbs.
8. **Local breadcrumb HTML** anywhere in the shell — banned by `tracepilot/single-breadcrumb` (already proposed in 01-chrome). The shell uses `<BreadcrumbNav>` exclusively.

---

## 11.11 · Acceptance checklist

A change to the Session Detail Shell is "done" when **all** of the following pass.

### Structure
- [ ] `SessionDetailPanel.vue` renders **one** `<PageHeader>` (no nested local headers)
- [ ] Bands 1a, 1b, 1c, 2, 3 are each rendered exactly once and only by the components named in §11.4
- [ ] Inner tab strip is `<SegmentedControl variant="tabs">` — bespoke `.tab-pill` / `.scope-seg-btn` markup is removed
- [ ] `<BreadcrumbNav>` is the only breadcrumb implementation reachable from this view (lint `tracepilot/single-breadcrumb` passes)

### Visual hygiene (cites §G rules)
- [ ] No `backdrop-filter` anywhere in `SessionDetailPanel.vue` (G2 — closes audit lines 31, 370–371)
- [ ] No `box-shadow` outside `--shadow-md` / `--shadow-lg` overlay tokens (MASTER §4.1)
- [ ] No `linear-gradient(...)` on header/action surfaces (G3)
- [ ] No emoji in template, in `iconName` props, or in the action bar (G1 / CC-1)
- [ ] All icons resolve through `<Icon name="…">`, sizes 16 or 20 only (G1)
- [ ] All colors are token references; lint `color-no-hex` passes for this file (G6)
- [ ] All spacing values come from the 4px grid (G8)

### Layout invariants
- [ ] Band 1 height is identical between idle and running states (status pill space reserved)
- [ ] Band 1 height is identical between loading skeleton and loaded state
- [ ] Long summaries (> 32 chars) middle-truncate via `<BreadcrumbNav>`; full text in `title` attribute
- [ ] Session ID renders in `--font-mono` with `tnum`, middle-truncated to 14ch, full text in `title`
- [ ] Tab strip wraps cleanly at < 720px content width; no horizontal scroll on the shell

### Interaction
- [ ] `1..7` jump to inner tabs (suppressed inside inputs / rename mode)
- [ ] `Cmd/Ctrl+.` resumes session in terminal
- [ ] `Cmd/Ctrl+P` pops session into child window (hidden in viewer windows)
- [ ] `Cmd/Ctrl+Shift+C` copies the session ID, with inline "Copied" pill (1.5s)
- [ ] `R` triggers a one-shot refresh
- [ ] `F2` enters rename mode; `Enter` commits; `Esc` cancels; blur commits; empty reverts
- [ ] All shortcuts above are registered via `useShortcut` and appear in the `?` overlay's *Active View* group

### Motion (G5)
- [ ] All transitions are 120ms / 180ms / 220ms with `cubic-bezier(0.2, 0.6, 0.2, 1)`
- [ ] Only `transform` / `opacity` animated; never `width` / `height` / `top` / `left`
- [ ] No `animation: ... infinite` outside indeterminate spinners
- [ ] `prefers-reduced-motion: reduce` swaps spinners to static state and caps cross-fades at 80ms

### Accessibility
- [ ] Tab strip has `role="tablist"` with arrow-key roving focus and `Enter` / `Space` activation
- [ ] Active tab has `aria-selected="true"`, `tabindex="0"`; siblings `tabindex="-1"`
- [ ] Active tab body is `role="tabpanel"` labelled by the active tab
- [ ] Status pill always pairs color + icon + text (G2 — never color alone)
- [ ] ID copy button has `aria-label="Copy session ID <id>"`; clipboard write announced via live region
- [ ] Rename mode announces "Editing session title" / "Title updated" / "Edit cancelled" via `aria-live="polite"`
- [ ] All icon-only action buttons have `aria-label`
- [ ] Focus ring is visible (`:focus-visible`) on every interactive element in the shell

### Lint / parity
- [ ] `tracepilot/single-page-header` passes (no local header re-implementation)
- [ ] `tracepilot/single-breadcrumb` passes
- [ ] `tracepilot/no-backdrop-filter` passes for this file
- [ ] `tracepilot/no-emoji-in-templates` passes for this file
- [ ] Dark + light parity verified at 1×, 2× DPI
- [ ] Visual smoke pass: Overview, Conversation, Events, Todos, Metrics, Explorer, Timeline all mount under the new shell with no regressions

---

*Once this shell lands, the six "non-Conversation" inner tabs (Overview, Events, Todos, Metrics, Explorer, Timeline) inherit the entire navigation contract for free — their per-tab specs only describe their body. The Conversation tab body is specified in `12-conversation-tab.md`, which assumes everything in this file already holds.*
