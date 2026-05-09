# 18 · Orchestration Home

> **Scope:** The landing surface of the orchestration sub-app — `apps/desktop/src/views/orchestration/OrchestrationHomeView.vue` and the `home/*` partials. Closes the audit's highest-severity per-view findings (UI-AUDIT.md lines 163–176): marketing gradients on data tiles, hero typography, layout-shifting hover, emoji-as-icon at large size, decorative entrance animation, and emoji severity mapping in the activity feed.
> **Inherits:** `00-globals.md` (G1 icons, G2 glass, G3 gradients, G4 hover, G5 motion, G6 color tokens, G7 type discipline) · `01-chrome.md §1.4` (`<PageHeader>`) · `02-primitives.md` (`<KPI>` / `.kpi-row`, `<EntityCard>`, `<DataGrid>`, `<EmptyState>`, `<StatusPill>`).
> **Replaces:** the entirety of `OrchestrationHomeView.vue`, `OrchestrationHeroStats.vue`, `OrchestrationQuickActions.vue`, `OrchestrationActivityFeed.vue`, and `OrchestrationHomeHeader.vue`. `OrchestrationSystemHealth.vue` is folded into the KPI row.

The current view is the most "AI-vibe-coded" surface in TracePilot. The redesign rebuilds it as a **Grafana-style home dashboard**: a flat KPI strip, a quiet quick-actions grid using canonical `<EntityCard>`, and a virtualized log-stream activity feed. No gradients. No translateY. No emoji. No entrance animation.

---

## 1 · Purpose

Give the orchestration operator, on first paint, a one-screen answer to four questions:

1. **What is running right now?** — Active sessions, queue depth.
2. **What did I finish today?** — Completed sessions, error count.
3. **What can I start next?** — Launcher, Worktrees, Config Injector, MCP servers.
4. **What just happened?** — The last 50 orchestration events as a scannable log stream.

This view is **navigational and observational, not transactional**. There are no inline mutations on this page; all CTAs route into another surface.

---

## 2 · Page composition

Top-down, left-aligned, single column at all widths ≥ 960px. No two-column split.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ <PageHeader title="Orchestration" subtitle="…" iconName="layout-grid">  │  chrome (01-chrome §1.4)
│   #actions: [Launch session ⌘L] [Refresh ↻]                              │
├──────────────────────────────────────────────────────────────────────────┤
│ <KPIRow>                                                                 │  primitive (02 §3)
│   active sessions │ queued │ completed today │ errors (24h)              │
├──────────────────────────────────────────────────────────────────────────┤
│ Quick actions                                              ── §6 ──      │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                      │
│ │ Worktrees│ │ Launcher │ │  Config  │ │   MCP    │  4 × <EntityCard>    │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘                      │
├──────────────────────────────────────────────────────────────────────────┤
│ Recent activity (last 50)                                  ── §7 ──      │
│ <DataGrid> rows: time · severity · type · message · session              │
└──────────────────────────────────────────────────────────────────────────┘
```

Vertical rhythm: 24px between regions. Region titles (Quick actions / Recent activity) use `<Heading level="2">` per `00-globals §G7`. No `text.micro` uppercase eyebrow labels.

---

## 3 · PageHeader (chrome contract)

Use `<PageHeader>` from `01-chrome.md §1.4`. No bespoke header component — `OrchestrationHomeHeader.vue` is **deleted**.

| Prop | Value |
|---|---|
| `title` | `"Orchestration"` |
| `subtitle` | `"Sessions, worktrees, and agent configuration"` |
| `iconName` | `layout-grid` (Lucide, 20px, `--accent-fg`) |
| `crumbs` | none — this is the orchestration root |
| `density` | `comfortable` |

`#actions` slot:

1. **Launch session** — primary button, Lucide `rocket` 16px, kbd hint `⌘L`. Routes to `ROUTE_NAMES.sessionLauncher`.
2. **Refresh** — icon-only ghost button, Lucide `refresh-cw` 16px, `aria-label="Refresh dashboard"`. Calls `store.initialize()`.

`#toolbar` slot is **not used**.

Title size is capped at `text.h1` (20/28 600). The current `<h1>Welcome to Orchestration 👋</h1>` style hero is forbidden by `00-globals §G3` and removed.

---

## 4 · KPI row

Replaces `OrchestrationHeroStats.vue` in full. Use `<KPI>` composed inside `.kpi-row` per `02-primitives.md §3`.

### Fields (left to right)

| # | label | value | unit | format | delta | spark | tone rule |
|---|---|---|---|---|---|---|---|
| 1 | `Active sessions` | `store.activeSessions` | — | `number` | none in v1 | none | n/a |
| 2 | `Queued` | `store.queuedSessions` | — | `number` | none | none | if `value > 0` show neutral; no semantic color |
| 3 | `Completed today` | `store.completedToday` | — | `number` | `vs prior 24h`, tone `good` when up | optional 12-bin sparkline, `--chart-primary` | n/a |
| 4 | `Errors (24h)` | `store.errors24h` | — | `number` | `vs prior 24h`, tone `bad` when up | optional sparkline, `--danger-fg` | n/a |

System health (previously `OrchestrationSystemHealth.vue`) is folded in as a **fifth KPI only when degraded** — its tile is rendered conditionally with `state="error"` if `store.systemHealth !== 'ok'`, otherwise omitted. The KPI row never renders a tile that simply says "All systems operational"; absence is the signal.

### Composition

```html
<div class="kpi-row">
  <KPI label="Active sessions"   :value="store.activeSessions" />
  <KPI label="Queued"            :value="store.queuedSessions" />
  <KPI label="Completed today"   :value="store.completedToday"
       :delta="store.completedDelta" :spark="store.completedSpark" />
  <KPI label="Errors (24h)"      :value="store.errors24h"
       :delta="store.errorDelta" />
</div>
```

### Visual rules (re-stated for emphasis only — not new)

- **No `linear-gradient`** on tiles. The shared `.kpi-row` hairline is the only frame (`02 §3` Composition pattern). This explicitly removes lines 97–115 of the old `OrchestrationHeroStats.vue`.
- **Value typography:** `--font-mono`, `tnum`, **18px / 24px line-height** per `<KPI>` token spec. The old `font-size: 2.5rem` (line 127) is forbidden by `00-globals §G3`.
- **No hover transform.** No `translateY`, no `box-shadow` swap. The old `.hero-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-lg); }` (lines 92–95) is forbidden by `00-globals §G4`. KPIs are not interactive on this view; they have no `:hover` rule at all.
- **Icons:** Lucide only, rendered inside `<KPI>` per primitive, **not** absolute-positioned at 32px with `opacity: 0.3` (the old hero-icon decoration is dropped).

### Drill-through

Out of scope for v1. KPI tiles are read-only. When drill-through is wired in a follow-up, it MUST be implemented as a wrapping `<router-link>` around the entire `<KPI>`, not as a hover-lift affordance.

---

## 5 · Loading / empty / error

The KPI row mirrors the page-level state of the orchestration home store; tiles do not each load independently.

- **Loading:** every `<KPI>` renders `state="loading"` — a hairline skeleton inside the same `.kpi-row` frame. No spinner, no shimmer animation longer than the 180ms standard from `00-globals §G5`.
- **Empty (first run, no sessions ever):** the KPI row renders zeros (`0` for each numeric field) and the activity feed (§7) shows the `<EmptyState>` from `02 §9` with `iconName="inbox"`, title `"No orchestration activity yet"`, hint `"Launch a session to see live updates here."`, action `"Launch session"` → `sessionLauncher`.
- **Error:** the existing `<ErrorState>` wrapper around `<PageShell>` is preserved. KPIs themselves do not render their own error tone — error is a page-level concern.

---

## 6 · Quick actions grid

Replaces `OrchestrationQuickActions.vue` in full. Four `<EntityCard>` instances in a 4-column grid (collapsing to 2 columns at < 1100px, 1 at < 720px). 16px gap. No section panel border or padding — the grid sits directly on canvas under a `<Heading level="2">Quick actions</Heading>` and a 24px gap.

### Mapping (audit lines 18–44 → `<EntityCard>` props)

| # | EntityCard `iconName` | `iconTone` | `title` | `meta[0].label` | `to` | kbd hint (in `#actions` slot) |
|---|---|---|---|---|---|---|
| 1 | `git-branch` (was 🌳, line 39) | `accent` | Worktrees | `Create, list, and prune worktrees` | `ROUTE_NAMES.worktreeManager` | `W` |
| 2 | `rocket` (was 🚀, line 18) | `accent` | Launcher | `Start a new Copilot CLI session` | `ROUTE_NAMES.sessionLauncher` | `L` |
| 3 | `settings` (was 🔧, line 32) | `accent` | Config | `Edit agent definitions and configs` | `ROUTE_NAMES.configInjector` | `C` |
| 4 | `plug` (was 📊 placeholder, line 25 — repurposed) | `accent` | MCP | `Manage MCP servers and skills` | `ROUTE_NAMES.mcpServers` | `M` |

The old "Mission Control" placeholder (line 25 of the original, `disabled: true`, emoji 📊) is **deleted**, not migrated. A disabled card teaches the user nothing on first paint; when Mission Control ships, it joins the grid as a fifth real entry.

Emoji-to-Lucide names follow the `00-globals §G1` migration table verbatim. Card icon size is **16px** (in-row size for `<EntityCard>` heads); the old 48px emoji wrapper square (`.action-emoji-wrap`, lines 139–149) is forbidden by `00-globals §G1` (no oversized icons, no emoji rendered at 1.4rem).

### EntityCard composition

```html
<EntityCard
  iconName="git-branch"
  iconTone="accent"
  title="Worktrees"
  :meta="[{ label: 'Create, list, and prune worktrees' }]"
  :to="{ name: ROUTE_NAMES.worktreeManager }"
>
  <template #actions>
    <kbd class="kbd">W</kbd>
  </template>
</EntityCard>
```

`#default` body slot is empty. Cards are **summary-only**; bodies and inline stats are out of scope here — the KPI row already carries the numbers.

### Hover and focus

Per `<EntityCard>` tokens in `02 §6`: hover changes `background-color` and `border-color` only. **No `transform: translateY(-2px)`** (the old `.action-card:hover` lines 122–127 are forbidden by `00-globals §G4`). Focus uses the global 2px `--accent-emphasis` ring with 2px offset (`00-globals §G4`).

### Keyboard

The single-letter shortcuts (`W` / `L` / `C` / `M`) are registered through the global shortcut system, not local `@keydown`. They route via `pushRoute` exactly as the click handler does. Shortcut chips render as `<kbd class="kbd">…</kbd>` in the card's `#actions` slot — they are visual hints, not interactive.

---

## 7 · Recent activity feed

Replaces `OrchestrationActivityFeed.vue` in full. The old emoji-mapped feed is rebuilt as a **flat log stream** rendered through `<DataGrid>`, density `compact` (28px rows), virtualized when > 100 rows.

### Source

`store.activityFeed` — last 50 events, newest first. The mock data block (lines 30–55 of the original) is removed; an empty store renders the empty state from §5 instead of fabricating four mock rows.

### Columns

| id | header | width | align | font | content |
|---|---|---|---|---|---|
| `time` | Time | 96px | right | mono / tnum | `formatRelativeTime(event.timestamp)` |
| `severity` | — | 12px | center | n/a | 8px solid circle, semantic color (see mapping) |
| `type` | Event | 160px | left | sans | `eventTypeLabel(event.type)` (no icon) |
| `message` | Detail | flex | left | sans | `event.message`, single-line ellipsis |
| `session` | Session | 120px | left | mono / tnum | short SHA of `event.sessionId`, click → `sessionDetail` |

Header row uses `<DataGrid>` defaults from `02 §2`. Rows are not sortable (the feed is inherently chronological); `<DataGrid>` is configured with `sortable: false` per column.

### Severity dot mapping (replaces emoji at line 21 of the old)

The old `feedIconLabel` map (`session_launched: "🚀"`, `session_error: "❌"`, etc.) is **deleted**. Severity is encoded as a **single 8px dot** with semantic color, paired with the `type` column text label (color-blind safe per `MASTER §5`):

| `event.type` | dot color | type label |
|---|---|---|
| `session_launched` | `--accent-fg` | `Session started` |
| `session_completed` | `--success-fg` | `Session completed` |
| `session_error` | `--danger-fg` | `Session error` |
| `batch_completed` | `--success-fg` | `Batch completed` |
| `budget_alert` | `--warning-fg` | `Budget alert` |
| `config_changed` | `--neutral-fg` | `Config changed` |
| _unknown_ | `--neutral-fg` | `event.type` (raw) |

The dot is implemented as a span with `width: 8px; height: 8px; border-radius: var(--radius-full); background: <token>;`. No Lucide icon — at 28px row height, a colored dot reads faster and respects density.

### Row interaction

- Whole row click → navigate to the related session via `event.sessionId`. Rows where `sessionId` is null (e.g. `config_changed`) are not clickable; cursor is `default`.
- Hover: `background: var(--surface-tertiary)` only. No transform.
- Right-click → context menu: `Copy event ID`, `Open session`, `Filter by type`. (v1 may ship without the context menu; the row click is the floor.)

### Performance

- The activity feed is the only region that polls. Use the existing store subscription; do not add a `setInterval` here.
- `<DataGrid>` `virtualize: true` is mandatory — the feed grows unbounded server-side and we render the latest 50, but the column itself must be virtualized for parity with other DataGrid consumers (CC-4).

---

## 8 · Motion budget

This view is the audit's named offender for `00-globals §G5` (CC-13). The redesign is therefore **explicitly motion-free** at the layout level:

- The wrapper `<div class="fade-section" style="--stagger: N">` and the `@keyframes fadeInUp` from `OrchestrationHomeView.vue` lines 53–67 are **deleted**. There is no entrance animation, no stagger, no opacity fade-up. Regions render instantly.
- The only motion permitted on this surface:
  - 120ms color/border transitions on `<EntityCard>` and `<DataGrid>` row hover (inherited from primitives).
  - 180ms tone transition on a KPI sparkline when its value changes.
  - The standard `prefers-reduced-motion` reduce-to-1ms wrapper from `00-globals §G5`.
- **No `animation: ... infinite`** anywhere on this view. No pulse, no glow, no shimmer beyond the standard skeleton.

---

## 9 · Anti-patterns this spec deletes

Each item below cites the exact line numbers in `design-system/audit/UI-AUDIT.md` (the "Orchestration Home" section, lines 163–176) and the source-of-truth file the violation lives in today.

1. **Marketing gradient on data tiles** — `linear-gradient(135deg, var(--accent-muted), var(--canvas-subtle))` and three sibling rules at `OrchestrationHeroStats.vue:97–115`. Cited in audit line 168. Forbidden by `00-globals §G3`. Replaced by the flat single-frame `.kpi-row` from `02 §3`.
2. **Hero typography in chrome** — `font-size: 2.5rem` at `OrchestrationHeroStats.vue:127`. Cited in audit line 169. Forbidden by `00-globals §G3` (cap at `text.h1` 20px). Replaced by `<KPI>`'s 18/24 mono value.
3. **Layout-shifting hover (translateY + shadow lift) on hero tiles** — `OrchestrationHeroStats.vue:92–95`. Cited in audit line 170. Forbidden by `00-globals §G4`. KPIs have no hover rule on this view.
4. **Emoji-as-icon at 48px on quick actions** — `emoji: "🚀" / "📊" / "🔧" / "🌳"` at `OrchestrationQuickActions.vue:18, 25, 32, 39`, rendered inside a 48px wrapper at `font-size: 1.4rem` (lines 139–149). Cited in audit line 171. Forbidden by `00-globals §G1`. Replaced by 16px Lucide icons in `<EntityCard>` per the §6 mapping.
5. **Layout-shifting hover on action cards** — `transform: translateY(-2px); box-shadow: var(--shadow-md);` at `OrchestrationQuickActions.vue:122–127`. Cited in audit line 172. Forbidden by `00-globals §G4`.
6. **`fadeInUp` decorative entrance animation** — `OrchestrationHomeView.vue:53–67`, 0.4s with 0.08s stagger across four sections. Cited in audit line 173. Exceeds the 240ms ceiling and is decorative — both forbidden by `00-globals §G5` (CC-13). Deleted entirely.
7. **Emoji-as-severity-icon in activity feed** — `feedIconLabel` map at `OrchestrationActivityFeed.vue:19–28` (`session_launched: "🚀"` line 21, `session_error: "❌"` line 22, `batch_completed: "✅"` line 23, `budget_alert: "💰"` line 24, `config_changed: "🔧"` line 25, fallback `"📋"` line 27). Cited in audit line 174. Forbidden by `00-globals §G1`. Replaced by an 8px semantic-color dot paired with a text label (§7).

In addition, this spec implicitly deletes:

- `OrchestrationHomeHeader.vue` (the welcome row) — replaced by `<PageHeader>` per §3.
- The `Mission Control` disabled-card placeholder at `OrchestrationQuickActions.vue:25–30` — deleted, not migrated.
- The mock activity feed array at `OrchestrationActivityFeed.vue:30–55` — deleted; empty store renders `<EmptyState>` per §5.

---

## 10 · Acceptance

Run from the repo root after the redesign lands. Each command must produce the stated result.

### Zero emoji on this view
```
rg "[\u{1F300}-\u{1FAFF}]" apps/desktop/src/views/orchestration/OrchestrationHomeView.vue apps/desktop/src/views/orchestration/home → 0 hits
```

### Zero gradient on this view
```
rg "linear-gradient" apps/desktop/src/views/orchestration/OrchestrationHomeView.vue apps/desktop/src/views/orchestration/home → 0 hits
```

### Zero `translateY` hover on this view
```
rg "translateY" apps/desktop/src/views/orchestration/OrchestrationHomeView.vue apps/desktop/src/views/orchestration/home → 0 hits
```

### Zero infinite or > 240ms animations on this view
```
rg "animation:.*infinite" apps/desktop/src/views/orchestration/OrchestrationHomeView.vue apps/desktop/src/views/orchestration/home → 0 hits
rg "@keyframes (fadeInUp|pulse-glow|drift-motion)" apps/desktop/src/views/orchestration → 0 hits
rg "(0\.[3-9]|[1-9])s\b"  apps/desktop/src/views/orchestration/home → 0 hits   # only ms units, all ≤ 220ms
```

### Hero typography removed
```
rg "font-size:\s*(2\.5rem|36px|40px|48px|32px|28px)" apps/desktop/src/views/orchestration/home → 0 hits
```

### Primitives are used (lint via `tracepilot/no-local-reimplementation`)
- [ ] `OrchestrationHomeView.vue` imports `<PageHeader>` from `@tracepilot/ui` (no bespoke header)
- [ ] The KPI region renders **one** `.kpi-row` element wrapping four `<KPI>` components — no per-tile borders
- [ ] The four quick actions are **`<EntityCard>` instances** from `@tracepilot/ui`; no local `.action-card` class is defined in the file
- [ ] The activity feed is rendered through **`<DataGrid>`** with `virtualize: true`; no local `.feed-list` / `.feed-item` / `.feed-icon` classes remain

### Files deleted
- [ ] `apps/desktop/src/views/orchestration/home/OrchestrationHomeHeader.vue` — removed
- [ ] `apps/desktop/src/views/orchestration/home/OrchestrationHeroStats.vue` — removed
- [ ] `apps/desktop/src/views/orchestration/home/OrchestrationQuickActions.vue` — removed
- [ ] `apps/desktop/src/views/orchestration/home/OrchestrationActivityFeed.vue` — removed
- [ ] `apps/desktop/src/views/orchestration/home/OrchestrationSystemHealth.vue` — removed (folded into KPI row per §4)

### Behavioural
- [ ] First paint shows KPI row, quick actions, and activity feed at **the same time** — no staggered fade-in
- [ ] `prefers-reduced-motion: reduce` does not change layout (verifiable via OS toggle)
- [ ] Keyboard: `L` launches, `W` opens worktrees, `C` opens config, `M` opens MCP — all surfaced as `<kbd>` hints in the card `#actions` slot
- [ ] Tab order: PageHeader actions → KPI row (skipped, non-interactive) → Worktrees card → Launcher card → Config card → MCP card → Activity DataGrid header → first activity row
- [ ] Dark + light parity: borders visible, no `bg-white/10` ghosts, no token regressions

---

## 11 · Out of scope (named, deferred)

These belong to follow-up specs — not this one:

- **KPI drill-through** — clicking `Active sessions` filtering Session List by `state=active`. Tracked separately; UI here is read-only.
- **Mission Control** — full real-time dashboard. When it ships, it joins the §6 grid as a fifth `<EntityCard>`; do not pre-render a disabled placeholder.
- **Custom date range on `Completed today` / `Errors (24h)`** — the v1 windows are fixed. A `<TimeRangePicker>` will be added once the analytics view defines that primitive.
- **Per-event filtering inside the activity feed** — filter chips above `<DataGrid>` (by `event.type`, by `sessionId`) ship in a v1.1 once `<DataGrid>` filter slot patterns are settled in the Sessions and Worktrees specs.
- **System health detail** — when `store.systemHealth !== 'ok'`, the conditional fifth KPI links to a dedicated `OrchestrationHealthView`; that view has its own per-page spec.
