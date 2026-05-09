# 01 · Chrome — Navigational Hierarchy

> **Scope:** Application chrome that frames every view: AppSidebar, BreadcrumbNav, SessionTabStrip, the canonical PageHeader, the Search Palette (`Cmd/Ctrl+K`), and the Alert Center drawer. Closes audit findings: **Sidebar (High)**, **Search Palette (High)**, **Alert Center (High)**, plus cross-cutting CC-5 and CC-6.
> **Inherits:** all of `00-globals.md`. Anything covered there is not restated here.
> **Reads from:** `design-system/MASTER.md`.

This spec defines the **contract for "where am I / where can I go"**. Per-view specs assume this contract holds.

---

## Hierarchy contract

Three signals, each with a single purpose. **No view may invent its own.**

| Layer | Component | Job |
|---|---|---|
| 1. Where can I go | `AppSidebar` | Static, app-level destinations |
| 2. Where am I (open work) | `SessionTabStrip` | Active session tabs (canonical "current location") |
| 3. Where am I (within this work) | `BreadcrumbNav` (in `PageHeader`) | Hierarchy inside the current view |

In-page filter rails (e.g. `WorktreeRepoSidebar`, `ReplaySidebar`, `SearchFilterSidebar`) are **not** chrome — they are filter UIs and live inside the view, with `--canvas-inset` background to signal "this is data filtering, not navigation".

**Ad-hoc breadcrumbs (e.g. `ConfigInjectorView`'s local breadcrumb HTML) are forbidden.** Lint rule:
- Stylelint `tracepilot/single-breadcrumb`: rejects `.breadcrumb` / `.crumbs` / `nav[aria-label="breadcrumb"]` outside `BreadcrumbNav.vue`.

---

## 1.1 · App Sidebar  (`packages/ui/src/components/AppSidebar.vue`)

### Purpose
Static, app-level navigation. Always visible. Lives at z-`var(--z-sidebar)` (40).

### Layout

```
┌──────────────────────────────────┐  width: 240 (expanded) / 56 (collapsed)
│ ┌────┐  TracePilot               │  56px header. Logo + wordmark.
│ └────┘  v0.6.3                   │   Wordmark hidden when collapsed.
├──────────────────────────────────┤  1px hairline
│                                  │
│ Workspace                        │  text.small / 500 / --text-tertiary, 12px ↕ padding
│   ▦  Sessions          ⌥1        │  28px row · icon 16 · label · kbd right
│   ✦  Search            ⌥2        │
│   ▤  Analytics         ⌥3        │
│   ⛁  Tools                       │
│   </> Code                        │
│                                  │
│ Advanced                         │
│   △  Models                      │
│   ⇆  Compare                     │
│   ▷  Replay                      │
│   ↗  Export                      │
│                                  │
│ Orchestrate                      │
│   ⌂  Home                        │
│   ⌥  Worktrees                   │
│   ⊕  Launcher                    │
│   ⚙  Config                      │
│                                  │
│ Configure                        │
│   🔌 MCP                          │
│   ✦  Skills                      │
│                                  │
├──────────────────────────────────┤  spacer above footer
│ ⚙ Settings                       │  identical row style; pinned to bottom
│ ─────────────────────────────────│
│ ◑ Theme   ◯ SDK ok   🔔 3   v0.6 │  status row, 32px, text.small
└──────────────────────────────────┘
```

> Icons in the diagram are placeholders — actual icons must come from Lucide via `<Icon name="…">` per `00-globals §G1`.

### Sections (in order)
1. **Workspace** — `sessions, search-results, analytics, tool-analysis, code-impact`
2. **Advanced** — `model-comparison, session-comparison, session-replay, export`
3. **Orchestrate** — `orchestration-home, worktree-manager, session-launcher, config-injector`
4. **Configure** — `mcp-manager, skills-manager`
5. **Footer** — `settings`, then status row.

> Rename the British "Command Centre" → use Lucide `home` icon-only button; the "Orchestrate" section header carries the meaning. Ensures a single English variant across the app.

### Tokens (no inline values)
```css
.sidebar              { background: var(--canvas-default); border-right: 1px solid var(--border-subtle); }
.sidebar-section      { padding: 12px 8px 4px; }
.sidebar-section__lbl { font: var(--text-small); color: var(--text-tertiary); padding: 0 8px 4px; text-transform: none; letter-spacing: 0; }
.sidebar-item         { height: 32px; padding: 0 8px; gap: 8px; border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer; }
.sidebar-item:hover   { background: var(--surface-tertiary); color: var(--text-primary); }
.sidebar-item[aria-current="page"] {
  background: var(--accent-subtle);
  color: var(--text-primary);
  box-shadow: inset 2px 0 0 0 var(--accent-emphasis);  /* the rail */
}
.sidebar-item__kbd    { margin-left: auto; }
```

> No `text.micro` uppercase headings (closes CC-10). No `transform` on hover (G4). No glass (G2).

### Interaction model
- Click → route. Active route is `aria-current="page"`.
- **`Alt+1..9`** → jumps to nth Workspace item (sessions=1, search=2, analytics=3, tools=4, code=5, settings=9). Surface as right-aligned `<kbd>` chips on hover/focus.
- **`Cmd/Ctrl+\`** → toggle collapse (persisted: `tracepilot:sidebar:collapsed`).
- Status row buttons:
  - Theme (`Sun`/`Moon`) — toggles dark/light, persisted.
  - SDK status pill — opens Settings → SDK; tooltip on hover.
  - Alerts (`Bell` + count badge) — opens Alert Center drawer (§1.6).
  - Version pill — opens "What's New" modal.

### States
- **Collapsed (56px):** items show icon only; section headers hidden; active rail still visible.
- **Hovering collapsed item** → tooltip with label + kbd.
- **Update available** — small dot on version pill (`--accent-emphasis` 6px).

### Accessibility
- `<nav aria-label="Primary">` wraps the whole.
- Each section is `<ul>` with `<li><a aria-current="page">`.
- Section headers are `<h2 class="sidebar-section__lbl">` (semantic, not just visual).
- Tab order: top-down through items, then status row buttons.
- Status row icons are buttons with `aria-label`.

### Acceptance
- [ ] Collapsing the sidebar persists across sessions
- [ ] `Alt+1..9` shortcuts work; visible `<kbd>` on focus/hover only (not always shown — too noisy)
- [ ] Active item shows the 2px left rail + tinted bg; never a full pill
- [ ] No section header uses uppercase / micro-caps
- [ ] No glass, no gradient, no transform-hover
- [ ] Theme toggle ≠ "Theme" text label collapsed; uses Lucide `sun`/`moon`
- [ ] Renders cleanly at 1× and 2× DPI

---

## 1.2 · Breadcrumb Nav  (`packages/ui/src/components/BreadcrumbNav.vue`)

### Purpose
Render the hierarchical "where am I within this view" path. Lives **inside `PageHeader`**, never standalone.

### Layout
```
Sessions  ›  4eaa7d…b91c  ›  Conversation
^^^^^^^^^    ^^^^^^^^^^^^    ^^^^^^^^^^^^
clickable    leaf, copyable  current (no link)
```

### Rules
- Separator: Lucide `chevron-right` 14px, `--text-tertiary`.
- Leaf segment is **not a link** but **is selectable text** (so users can copy).
- Long labels middle-truncate at 32 chars; full label in `title` attribute.
- IDs (UUID-style) render in `--font-mono` 12px and have a copy-to-clipboard affordance (`Copy` icon 14px, appears on hover).
- `Alt+←` performs history-back (browser default kept).

### Tokens
```css
.crumb           { font: var(--text-small); color: var(--text-tertiary); }
.crumb a         { color: var(--text-secondary); }
.crumb a:hover   { color: var(--text-primary); }
.crumb__current  { color: var(--text-primary); }
.crumb__sep      { margin: 0 6px; }
.crumb__id       { font-family: var(--font-mono); font-feature-settings: 'tnum' 1; }
```

### Acceptance
- [ ] Only **one** breadcrumb implementation in the app (lint passes — see CC-5)
- [ ] Long labels truncate to 32ch with full label in `title`
- [ ] Leaf UUID has copy affordance; clipboard write surfaces a 1.5s inline "Copied" pill (not a toast)

---

## 1.3 · Session Tab Strip  (`apps/desktop/src/components/layout/SessionTabStrip.vue`)

### Purpose
Multi-session tab bar. Canonical "currently open work". Sits **between** sidebar and page content, full-width of the content area.

### Layout
```
┌─[ ⌂ ]─[ Session A · main ✕ ]─[ Session B · feat/abc ✕ ]─[ + ]──────────────────┐
  home   active tab indented      inactive                  new tab (ctrl+t)
        with 2px bottom rail
```

### Rules
- Tab height 36px (Comfortable) / 32px (Compact).
- Active tab: `--canvas-default` background (matches content), 2px bottom rail in `--accent-emphasis`.
- Inactive: `--canvas-subtle`, no rail. Hover → `--surface-tertiary`.
- Home pill: Lucide `home` icon-only, 32×32, **no label** (resolves CC-5 collision with sidebar's "Sessions").
- Drag to reorder; drag out of strip → pops out to its own native window (existing behaviour).
- Middle-click closes; right-click opens context menu (`Close, Close others, Close right, Pop out, Reload`).
- `Cmd/Ctrl+T` → new tab; `Cmd/Ctrl+W` → close; `Cmd/Ctrl+Tab` / `Cmd/Ctrl+Shift+Tab` → next/prev.

### Acceptance
- [ ] Home pill is icon-only Lucide `home`, no text
- [ ] Active tab has the 2px bottom rail; no glass; no gradient
- [ ] Tab order kbd shortcuts surfaced in `?` overlay

---

## 1.4 · PageHeader  (`packages/ui/src/components/PageHeader.vue`) — single canonical

### Closes CC-6
Delete `apps/desktop/src/components/AnalyticsPageHeader.vue`. Migrate Analytics/Tools/Code/Models views to the canonical one. Add a lint rule:
```
tracepilot/single-page-header: forbid imports of AnalyticsPageHeader.
```

### Props
```ts
interface PageHeaderProps {
  // hierarchical context (rendered as BreadcrumbNav above title)
  crumbs?: Array<{ label: string; to?: RouteLocation; id?: string }>;
  // primary
  title: string;
  subtitle?: string;
  iconName?: LucideName; // lucide icon name; rendered 20px
  // status (right of title row, before actions)
  status?: { tone: 'success' | 'warning' | 'danger' | 'done' | 'neutral'; label: string; iconName?: LucideName };
  // actions slot used for buttons; reserve right edge
  density?: 'comfortable' | 'compact';
}
// Slots: #actions (button group), #toolbar (second row, optional)
```

### Layout
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Sessions › 4eaa…b91c › Conversation                                       │  crumbs row
│                                                                            │
│ [ic] Session — feat: foo bar       [Active 12s ago]      [↻] [⌃K] [···]   │  title row
│ Last updated 3 min ago · main · gpt-4o                                     │  subtitle row (optional)
│ ──────────────────────────────────────────────────────────────────────────│  hairline
│ [#toolbar slot — RefreshToolbar / FilterBar / SegmentedControl]           │  optional
└──────────────────────────────────────────────────────────────────────────┘
```

### Rules
- Title is `<Heading level="1">` → `text.h1` 20/28 600. **Cap at 20px.** No 36/40/48px hero.
- Icon (if provided) is 20px Lucide in `--accent-fg`.
- Status pill renders inline; tone maps to semantic tokens (e.g. `success` → `bg: var(--success-subtle); color: var(--success-fg); border: 1px solid var(--success-muted);`).
- Subtitle: `text.small` `--text-secondary`.
- Always reserves space for the status pill so the row never resizes when status appears (e.g. on session start). Use `min-height: 28px` placeholder.
- Header is **not sticky** by default; per-view spec opts in via `:sticky="true"` and the spec must define the scroll-collision strategy.

### Tokens
```css
.page-header     { background: var(--canvas-default); border-bottom: 1px solid var(--border-subtle); padding: 16px 24px; }
.page-header.compact { padding: 12px 16px; }
.page-header__row    { display: flex; align-items: center; gap: 12px; min-height: 28px; }
.page-header__title  { font: var(--text-h1); color: var(--text-primary); }
.page-header__sub    { font: var(--text-small); color: var(--text-secondary); }
.page-header__actions{ margin-left: auto; display: flex; gap: 8px; }
.page-header__toolbar{ margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-subtle); }
```

### Acceptance
- [ ] Only `packages/ui/src/components/PageHeader.vue` exists; `AnalyticsPageHeader.vue` deleted
- [ ] Every view that previously rendered a custom title row now uses `<PageHeader>`
- [ ] Title size never exceeds `text.h1` (20px)
- [ ] Status pill area reserved → no layout shift on running-state change

---

## 1.5 · Search Palette  (`packages/ui/src/components/SearchPalette.vue`)

### Closes Search-Palette High + CC-2 (glass)

### Purpose
The **single keyboard-first entry point** for global search. Opens on `Cmd/Ctrl+K` from anywhere. Becomes the canonical search affordance — `SessionSearchView` is demoted to a results page reachable from the palette via `Enter` or "View all results" footer.

### Layout
```
                     viewport-centered, top-aligned 12vh
┌──────────────────────────────────────────────────────────────────┐
│ 🔍  Search sessions, conversations, files…              [esc]   │  56px input row
├──────────────────────────────────────────────────────────────────┤
│ Sessions                                                          │  group label, text.small/--tertiary
│   ▦  feat: refactor auth flow                          main · 2h │
│   ▦  fix: crash on session resume                     develop · 1d│
│ Conversation hits                                                 │
│   ✎  "JWT signing key" in feat: refactor auth flow                │
│   ✎  "session resume" in fix: crash on session resume             │
│ Files                                                             │
│   📄 packages/ui/src/components/PageHeader.vue                    │
│                                                                   │
├──────────────────────────────────────────────────────────────────┤
│ ⏎ open · ⌘⏎ open in tab · ↑↓ navigate · ⌃F view all results · ?  │  footer kbd hints
└──────────────────────────────────────────────────────────────────┘
   width: 640px · max-height: 60vh · z: var(--z-modal) · scrim blur 4px
```

### Tokens
```css
.palette        { background: var(--canvas-raised); border: 1px solid var(--border-default); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); }
.palette__input { background: transparent; border: 0; border-bottom: 1px solid var(--border-subtle); padding: 0 16px; height: 56px; font: var(--text-h2); color: var(--text-primary); }
.palette__group { font: var(--text-small); color: var(--text-tertiary); padding: 8px 16px 4px; }
.palette__row   { padding: 6px 16px; height: 32px; display: flex; align-items: center; gap: 12px; cursor: pointer; }
.palette__row:hover, .palette__row[aria-selected="true"] { background: var(--surface-tertiary); }
.palette__row[aria-selected="true"] { box-shadow: inset 2px 0 0 0 var(--accent-emphasis); }
.palette__footer { padding: 10px 16px; border-top: 1px solid var(--border-subtle); font: var(--text-small); color: var(--text-tertiary); display: flex; gap: 16px; }
.palette__scrim  { background: rgba(0,0,0,.55); backdrop-filter: blur(4px); }  /* only allowed blur */
```

### Interaction
- `Cmd/Ctrl+K` to open; auto-focus input; preserve last query for 30s after close.
- `↑/↓` navigate; selection wraps within group, then crosses groups.
- `Enter` open result; `Cmd/Ctrl+Enter` open in new tab.
- `Ctrl+F` from inside the palette → "View all results" → routes to `SessionSearchView` with current query.
- `Esc` close; restore prior focus.
- `?` opens kbd-shortcut overlay (see §1.7).
- Type-as-you-go; debounce 150ms; show inline spinner in input right edge during fetch (`--accent-fg` 14px Lucide `loader-2` rotating, respect `prefers-reduced-motion`).

### States
- **Empty query** → recent sessions (last 5) + "Type to search" hint.
- **No results** → `<EmptyState>` icon `search-x` + "No matches for `<query>`" + tip.
- **Error** → inline banner using `--danger-subtle` + retry button.
- **Slow query (> 1s)** → progressive: results stream in by group; spinner persists until done.

### Accessibility
- `role="dialog" aria-modal="true" aria-label="Search"`.
- Listbox semantics: `role="listbox"` for results region, `role="option" aria-selected` per row.
- Live region announces "N results" on debounce settle.
- Focus trap; Esc dismisses.

### Acceptance
- [ ] No `backdrop-filter` on the panel; only on the scrim, ≤ 4px
- [ ] All emoji removed; group icons are Lucide
- [ ] `Cmd+K` works from every view (including modals if reasonable)
- [ ] "View all results" routes to `SessionSearchView` carrying the current query
- [ ] Recent-query memory works for 30s

---

## 1.6 · Alert Center Drawer  (`packages/ui/src/components/AlertCenterDrawer.vue`)

### Closes Alert-Center High, CC-1, CC-2, CC-3

### Purpose
Right-side slide-over for session events: end / ask-user / permission / error / lag / idle. Triggered by the bell button in the sidebar status row.

### Layout
```
                                                        ┌──────────────────────────────┐
                                                        │ Alerts                  ✕    │  56px header
                                                        │ 12 unread · Mark all read    │  meta row
                                                        ├──────────────────────────────┤
                                                        │ Today                         │  group label
                                                        │ ─────────────────────────────│
                                                        │ ◉ ⚠  Tool call failed         │  severity dot · icon · title
                                                        │   feat: refactor auth · 14:32 │  meta line: session, time
                                                        │   permission_required          │  type chip
                                                        ├──────────────────────────────┤
                                                        │ Yesterday                     │
                                                        │ ─────────────────────────────│
                                                        │ ◉ ✓  Session ended            │
                                                        │   fix: crash on resume · 18:09│
                                                        └──────────────────────────────┘
   width: 400px · z: var(--z-overlay) · slide-in 220ms · scrim blur 4px
```

### Severity icon mapping (Lucide-only, closes CC-1)
| Type | Lucide | Tone token |
|---|---|---|
| `session_end` | `check-circle-2` | `--success-fg` |
| `ask_user` / `message` | `message-square` | `--accent-fg` |
| `permission_required` | `lock` | `--warning-fg` |
| `error` | `octagon-x` | `--danger-fg` |
| `lag` / `slow` | `gauge` | `--warning-fg` |
| `idle` | `pause` | `--neutral-fg` |

> Each row pairs **icon + colored severity dot** (6px circle in tone-emphasis) — meets G2 "color is never the only signal".

### Tokens
```css
.drawer        { background: var(--canvas-raised); border-left: 1px solid var(--border-subtle); box-shadow: var(--shadow-lg); }
.drawer__hdr   { padding: 16px 20px 12px; border-bottom: 1px solid var(--border-subtle); }
.drawer__title { font: var(--text-h2); color: var(--text-primary); }      /* ≤ 16px, NOT 32px */
.alert         { padding: 12px 20px; min-height: 64px; cursor: pointer; }
.alert:hover   { background: var(--surface-tertiary); }
.alert__icon   { width: 16px; height: 16px; }
.alert__dot    { width: 6px; height: 6px; border-radius: var(--radius-full); }
.alert__sub    { font: var(--text-small); color: var(--text-secondary); }
.alert__chip   { font: var(--text-micro); padding: 0 6px; height: 18px; border-radius: var(--radius-sm); background: var(--surface-tertiary); color: var(--text-secondary); }
.drawer__scrim { background: rgba(0,0,0,.45); backdrop-filter: blur(4px); }  /* allowed */
```

### Interaction
- Click row → opens the session as a tab and highlights the originating event.
- `Mark all read` button in header → semantic action with `<Heading>`/button styling, not a colored emphasis button.
- `Esc` closes the drawer.
- Drawer height: full viewport. Inner list virtualized at >50 alerts.
- Auto-grouped by day relative ("Today", "Yesterday", "Last 7 days", explicit dates older).

### States
- **Empty** → `bell-off` icon + "No alerts" + "You're caught up" subtitle.
- **Loading** (initial open) → 5 skeleton rows.
- **Filter** (future) — out of scope for this spec.

### Accessibility
- `role="dialog" aria-modal="false" aria-label="Alerts"` (non-modal: doesn't trap focus, but Esc still closes).
- Per-row `role="button"` with `aria-label` describing severity + title + session + time.
- Live region (`aria-live="polite"`) announces new alerts arriving while drawer is open.

### Acceptance
- [ ] All severity glyphs are Lucide (no `✓ 💬 🔐 ⚠`)
- [ ] No `backdrop-filter` on the drawer panel; only on the scrim, ≤ 4px
- [ ] No 32px / 36px header text — capped at `text.h2`
- [ ] Severity is **icon + dot + tone color**, not color alone

---

## 1.7 · `?` shortcuts overlay  (`packages/ui/src/components/KbdHelpOverlay.vue`) — **new**

### Why
The audit calls for `Alt+1..9`, `Cmd+K`, `1..7` (tab jump), `Cmd+T/W/Tab`, `Alt+←`, `?` itself, etc. We need a discoverable surface listing them. This is the contractual surface that per-view specs add their own shortcuts into.

### Behaviour
- Pressing `?` (or `Cmd/Ctrl+/`) anywhere outside an input opens a centered modal listing shortcuts grouped by scope: Global, Sidebar, Tabs, Active View.
- Active-view shortcuts are registered via a Vue provide/inject API — each view publishes its own at mount, so the overlay always shows current bindings.
- Closes on `?`, `Esc`, or click-outside.

### Tokens
- Same modal recipe as Search Palette (z `--z-modal`, `--canvas-raised`, scrim with allowed blur).
- Layout: 2-column key→description grid; `<kbd>` chips sized 18px with 1px hairline border.

### Acceptance
- [ ] `?` opens overlay from any non-input focus
- [ ] Per-view registration API exists (`useShortcut(key, description, handler)`)
- [ ] Active view's shortcuts display in their own group

---

## Cross-component contract

- Layout grid (top-down): **Sidebar (left, fixed) → SessionTabStrip (top of content) → PageHeader → view body**.
- Sticky behaviour: Sidebar sticky; SessionTabStrip sticky; PageHeader optionally sticky per-view.
- Z-order: `sidebar < tabstrip ≤ header < overlay (drawer) < modal (palette, kbd-help)`.
- All chrome respects the `--theme-mode` attribute on `<html>` for light/dark.
- All chrome inherits `00-globals` rules — no glass, no gradient, no transform-hover, no decorative animation.

---

## Acceptance for the chrome PR

- [ ] All 6 chrome components above pass their per-section acceptance
- [ ] Lint passes: `tracepilot/single-breadcrumb`, `tracepilot/single-page-header`, `tracepilot/no-emoji-in-templates`, `tracepilot/no-backdrop-filter`, `color-no-hex`
- [ ] `AnalyticsPageHeader.vue` is deleted; its consumers migrated
- [ ] `?` overlay registers and renders global + per-view shortcuts
- [ ] Visual smoke: Session List, Session Detail (Conversation tab), Orchestration Home, Settings, MCP Manager all render with the new chrome unmodified
- [ ] Light/dark parity verified
