# 21 · MCP Manager — Server Index, Token Audit, Health

> **Scope:** The configuration surface for Model Context Protocol (MCP) servers — install, import, search, monitor health, audit token cost. This spec defines the redesign of `apps/desktop/src/views/mcp/McpManagerView.vue`, retires `McpServerCard.vue` and `McpTokenSummary.vue` as bespoke surfaces, and documents the navigation contract to the separate **MCP Server Detail** route.
> **Inherits:** all of `00-globals.md` (hygiene), `01-chrome.md` (sidebar / tab strip / `PageHeader` / breadcrumb contract), `02-primitives.md` (`DataGrid`, `EntityCard`, `TokenBudgetBar`, `ToolbarRow`, `EmptyState`, `StatusPill`, `KPI`, `KPIRow`). Anything covered there is **not** restated here.
> **Audit refs:** `design-system/audit/UI-AUDIT.md` — MCP Manager (lines 202–208) and MCP Server Detail (lines 210–216, treated as a navigation target). Cross-Cutting Findings CC-1, CC-2, CC-3, CC-7, CC-9, CC-10, CC-11, CC-12.
> **Source files in scope:**
> - `apps/desktop/src/views/mcp/McpManagerView.vue` — view shell (replaced)
> - `apps/desktop/src/components/mcp/McpServerCard.vue` — **deleted**; replaced by `<EntityCard>` in the alternate Cards view (emoji at line 117 — see §G1)
> - `apps/desktop/src/components/mcp/McpTokenSummary.vue` — **deleted**; replaced by `<TokenBudgetBar>` (emoji at line 31 — see §G1)
> - `apps/desktop/src/components/mcp/addServer/add-server.css` — modal (line 9 glass — see §G2; banned outside the modal scrim file)
> - `apps/desktop/src/styles/features/mcp-server-detail.css` — detail view stylesheet (line 134 gradient region — see §G3; covered by `21.5` nav contract only, not redesigned here)
> - `apps/desktop/src/views/mcp/McpServerDetailView.vue` — **separate route**, redesigned in its own future spec; only the inbound navigation contract is documented here

---

## Information architecture

A single dense index of MCP servers. One surface, two presentations of the same row set. Per-server deep-dive lives at a separate route.

| Concern | Resolution |
|---|---|
| Default presentation | **`<DataGrid>`** — sortable columns, virtualized, keyboard-first |
| Alternate presentation | **Cards** (`<EntityCard>` grid) — for visual browsing of heterogeneous configs |
| Toggle | Segmented control in the toolbar (`Grid` / `Cards`); persisted under `tracepilot:mcp:view` |
| Density | Comfortable (32px) default · Compact (28px) toggle; persisted per `00-globals §G8` |
| Sort | Default `name asc`; persisted under `tracepilot:mcp:sort` |
| Filters | Tag chips (existing `store.allTags`), transport (`stdio` / `sse` / `http` / any), status (`active` / `error` / `disabled` / any) |
| Search | `<SearchInput>` — substring against server name, description, tags |
| Refresh | Inline `↻` icon button in `<ToolbarRow #right>`; bound to `store.checkHealth()` |
| Top-of-page audit | Single `<TokenBudgetBar>` showing aggregate enabled-server token cost vs. 128k context (see §3) |
| Open detail | Row click / `Enter` → `router.push({ name: 'mcp-server-detail', params: { name } })`. **Detail is a route, not a drawer** (see §6) |

The view is rendered inside the chrome contract: `AppSidebar` (Configure → MCP) → `SessionTabStrip` → `<PageHeader title="MCP" iconName="plug">` → `<KPIRow>` → `<TokenBudgetBar>` → `<ToolbarRow>` → grid body. See `01-chrome.md §1.4 PageHeader` and the cross-component contract.

---

## 1 · Layout — DataGrid view (Comfortable, default)

```
┌─ AppSidebar ┬───────────────────────────────────────────────────────────────────────────────────────────┐
│             │ ⌂  MCP  ✕   …                                                                              │  ← SessionTabStrip
│             ├───────────────────────────────────────────────────────────────────────────────────────────┤
│  Configure  │ MCP                                                       [+ Add server] [↥ Import]       │  ← <PageHeader iconName="plug">
│  ⌁ MCP      │ 6 servers · 5 active · 1 error · indexed 32s ago                                           │     subtitle (text.small)
│  ✦ Skills   ├───────────────────────────────────────────────────────────────────────────────────────────┤
│             │ │ Servers  6 │ Active  5 │ Error  1 │ Tools  42 │                                          │  ← <KPIRow>
│             ├───────────────────────────────────────────────────────────────────────────────────────────┤
│             │ Token budget across enabled servers          12 384 / 128 000 tokens (9.7 %)              │  ← <TokenBudgetBar>
│             │ ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                                         │
│             ├───────────────────────────────────────────────────────────────────────────────────────────┤
│             │ [ Transport: any ▾ ] [ Status: any ▾ ] [github] [filesystem] [+]   [ 🔎 Search servers… ]  │  ← <ToolbarRow #left / #center>
│             │                                                              [ Grid │ Cards ] [ ≡ ] [ ↻ ] │  ← #right
│             ├───────────────────────────────────────────────────────────────────────────────────────────┤
│             │ Name                          Status      Transport   Tools     Tokens                Last seen │ header (sticky)
│             │ ───────────────────────────────────────────────────────────────────────────────────────────────  │
│             │ github                       ● Active     stdio        12       ▮▮▯▯▯▯  3 412         12s        │
│             │ filesystem                   ● Active     stdio         6       ▮▮▮▯▯▯  4 891         12s        │
│             │ postgres                     ● Active     http          4       ▮▯▯▯▯▯  1 022          1m        │
│             │ slack                        ⚠ Connecting sse           —       —                       —        │
│             │ jira                         ✕ Error      http          0       —                      4m  ↻Retry│
│             │ legacy-tool                  ◌ Disabled   stdio         8       —                       —        │
│             ├───────────────────────────────────────────────────────────────────────────────────────────┤
│             │ ↑↓ navigate · ⏎ open detail · / search · g grid · c cards · d density · ? shortcuts       │  ← footer kbd hints
└─────────────┴───────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Column shape

| Column | Width | Align | Type | Sort | Notes |
|---|---|---|---|---|---|
| `name` | `1fr` | start | text | y (default asc, alpha) | Lucide `iconName` of the server (config-supplied or `plug`) at 16px in front of label; truncate; full name in `title=` |
| `status` | `132px` | start | `<StatusPill>` | y (state order) | tone+label per §4; never color-only |
| `transport` | `92px` | start | mono | y (alpha) | one of `stdio` / `sse` / `http`; rendered in `--font-mono` 12px, lower-case |
| `tools` | `64px` | end | numeric (tnum) | y | `server.tools.length`; `—` when status is `error` / `disabled` |
| `tokens` | `200px` | start | inline `<TokenBudgetBar size="sm">` | y (numeric `used`) | per-server bar, `used = server.tokens`, `total = store.summary.contextSize` (default 128 000); `—` track when status is `error` / `disabled`; numeric tone matches bar tone |
| `last-seen` | `92px` | end | mono relative time | y (default desc as secondary key) | `formatRelativeTime(server.health.lastCheckedAt)`; full ISO in `title=` |
| `row-actions` | `48px` | end | hover-only | n | `Open in detail`, `Toggle enabled`, `Copy name` (per §5) |

### 1.2 Rules

- The per-row `<TokenBudgetBar size="sm">` uses the **same** thresholds as the page-level bar (`{ warn: 0.75, danger: 0.90 }`) so tone is comparable across rows. See `02-primitives.md §TokenBudgetBar`.
- Disabled servers render their row at `--text-tertiary` and skip the bar entirely (no ghost track).
- Sort persists to `tracepilot:mcp:sort` per `02-primitives.md §DataGrid`.

---

## 2 · Layout — Cards view (toggle)

Same row set, presented via `<EntityCard>` in a `repeat(auto-fill, minmax(320px, 1fr))` grid with 12px gap. Used when the user wants to scan rich descriptions and tag chips.

### 2.1 `McpServerCard` → `<EntityCard>` field mapping

The legacy `McpServerCard.vue` is **deleted**. Each MCP server (`store.serverList[i]: McpServerSummary`) maps to `<EntityCard>` props as follows. See `02-primitives.md §EntityCard`.

| `<EntityCard>` prop / slot | Source field | Notes |
|---|---|---|
| `iconName` | `server.config.icon ?? 'plug'` | Lucide name only. **Replaces** `McpServerCard.vue`'s `<div class="server-icon-card">{{ iconLetter }}</div>` initial-glyph. The `iconLetter` derivation is removed. |
| `iconTone` | derived from health status (§4) | `success` / `warning` / `danger` / `neutral` |
| `title` | `server.name` | truncate; full name via `title=` |
| `meta[]` | `[{ label: transportLabel }, { label: \`${tools} tools\` }, { label: \`${tokensFormatted} tok\`, mono: true }]` | The token entry **replaces** `<span class="badge-xs badge-tokens">⚡ {{ tokensFormatted }} tok</span>` (`McpServerCard.vue:117`). No Lucide bolt; `meta--mono` already implies a numeric reading. The leading `🔧` on the tools badge is dropped — the column label is sufficient (see `00-globals §G1`). |
| `status` | `{ tone, label, iconName }` from §4 | Always paired with text and icon; never color-only. |
| `to` | `{ name: 'mcp-server-detail', params: { name: server.name } }` | Whole-card click navigates (§6). |
| `selected` | `route.params.name === server.name` | drives the selected outline so the user can keep cards visible in a side pane — but per §6 the detail view is a separate route, so `selected` is rarely live in this view. |
| `density` | inherited from view density toggle | |
| `#default` (body) | `server.description` (1–2 lines, `text.small` `--text-secondary`) | Truncate to 2 lines with `-webkit-line-clamp`. Server tag chips render below as a comma-separated tag row using `<StatusPill tone="neutral" size="xs">`. |
| `#actions` | Configure · Toggle enabled · Remove | identical to the row-actions menu in §5. Action buttons stop click propagation so they don't trigger `to` navigation. |

### 2.2 Removals

- `McpServerCard.vue:117` — `⚡` emoji removed (§G1, lucide-only).
- `McpServerCard.vue` `🔧` badge prefix — removed.
- `server-icon-card` letter-tile background gradient (`McpServerCard` template) — removed; the card uses `<EntityCard>`'s flat `--canvas-raised` surface only. No glass, no marketing gradient (§G2 / §G3).

---

## 3 · Token audit — page-level `<TokenBudgetBar>`

The bespoke `McpTokenSummary.vue` is **deleted**. Its job (one-line audit of total enabled token cost vs. context window) is performed by a single `<TokenBudgetBar>` directly under the `<KPIRow>`. See `02-primitives.md §TokenBudgetBar` (closes CC-7).

### 3.1 Field mapping

| `<TokenBudgetBar>` prop | Source |
|---|---|
| `used` | `store.summary.totalTokens` |
| `total` | `store.summary.contextSize ?? 128_000` |
| `label` | `"Token budget across enabled servers"` |
| `sublabel` | `\`${store.summary.totalTools} tools across ${store.summary.enabledServers} server${s}\`` (the prose previously rendered next to the `📊` glyph) |
| `thresholds` | default `{ warn: 0.75, danger: 0.90 }` |
| `size` | `'md'` (page-level); per-row bars use `'sm'` |
| `state` | `store.loading ? 'loading' : 'idle'` |

### 3.2 Removals

- `McpTokenSummary.vue:31` — `<div class="token-usage-icon">📊</div>` removed (§G1). The `<TokenBudgetBar>` does not render a leading glyph; if a metric icon is desired the per-view spec may add a Lucide `bar-chart-3` 16px to the left of the label, but this view does **not**.
- `.token-usage-bar` / `.token-usage-bar-fill` — local CSS deleted. Lint rule `tracepilot/no-local-reimplementation` rejects new `.token-bar` outside `<TokenBudgetBar>` per `02-primitives.md §Common contract`.

### 3.3 Stats strip → `<KPIRow>`

The legacy `stats-strip` (Installed · Active · Error chips) is replaced by `<KPIRow>` with four tiles, in order: `Servers`, `Active`, `Error`, `Tools`. Color is carried by `delta.tone` only on `Error` (`bad` when `> 0`); the other tiles are toneless counts. See `02-primitives.md §KPI`. No per-tile borders — the row owns the single hairline frame (closes CC-4).

---

## 4 · Status taxonomy

Health status maps **once**, here. Both the row's `<StatusPill>` and the card's `iconTone` read from this table. See `02-primitives.md §StatusPill` and `00-globals §G6` (color from token only).

| `server.health.status` | `<StatusPill>` `tone` | `label` | `iconName` (Lucide, 14px) |
|---|---|---|---|
| `healthy` (enabled, last check ok) | `success` | `Active` | `check-circle-2` |
| `connecting` / `pending` | `accent` | `Connecting` | `loader-2` (spinning; respects reduced-motion) |
| `degraded` | `warning` | `Degraded` | `alert-triangle` |
| `unreachable` / error | `danger` | `Error` | `octagon-x` |
| `disabled` (config off) | `neutral` | `Disabled` | `circle-slash-2` |
| unknown / never-checked | `neutral` | `Unchecked` | `circle-help` |

`statsError` in the existing store currently aggregates `unreachable` + `degraded`; the `Error` KPI keeps that semantics, but the **row pill** distinguishes them per the table above so the user can act on the correct severity.

---

## 5 · Toolbar & actions

`<ToolbarRow variant="header">` (closes the glass / `enhanced-toolbar` pattern — `00-globals §G2`). Ban applies — `add-server.css:9` glass remains illegal outside the modal scrim file (`packages/ui/src/components/Modal/scrim.css` per `00-globals §G2`).

### 5.1 Slots

| Slot | Contents |
|---|---|
| `#left` | Transport `<FilterSelect>` · Status `<FilterSelect>` · existing tag chips (re-used from `store.allTags`, rendered as `<StatusPill tone="neutral" size="xs" variant="subtle">` in unselected state, `tone="accent"` when active). Tag toggle keeps the existing `toggleTag()` handler. |
| `#center` | `<SearchInput>` (kept from existing import) — placeholder `Search servers…`; bound to `store.searchQuery` via the existing `searchInput` `computed`. |
| `#right` | Grid/Cards segmented toggle · density toggle (auto-rendered by `<DataGrid>` when in Grid mode; surfaced as a peer button in Cards mode) · refresh `↻` icon button bound to `handleRefreshHealth()` (Lucide `refresh-cw` 14px; `aria-label="Refresh health"`; spins via `--accent-fg` while `healthChecking`). |

### 5.2 PageHeader actions

The `PageHeader` retains two primary actions on the right:

| Button | Lucide icon | Handler |
|---|---|---|
| `Add server` (primary) | `plus` (14px) | `showAddModal = true` |
| `Import` (secondary) | `upload` (14px) | `handleImport()` |

The hand-rolled inline SVGs at `McpManagerView.vue:107`, `:111`, `:115`, `:213`, `:217` are removed — replaced by `<Icon name="…">` wrapper per `00-globals §G1`. The local `.btn-add-server` styles (`McpManagerView.vue:275–304`) — including `background: var(--gradient-accent)` (line 280), `box-shadow: 0 1px 6px rgba(99,102,241,.35)` (line 287), and `transform: translateY(-1px)` on hover (line 294) — are deleted: this is a `<Button variant="primary">` from the primitives library, which has no gradient, no glow, and no transform-hover (`00-globals §G3`, `§G4`).

### 5.3 Row-level actions

Hover-revealed in DataGrid `#row-actions(row)` slot; mirrored in `<EntityCard #actions>`:

| Action | Icon | Handler | Notes |
|---|---|---|---|
| Open detail | `arrow-right` | `router.push(...)` per §6 | identical to row click; included for keyboard-only users |
| Toggle enabled | `power` / `power-off` | `handleToggle(server.name)` | optimistic; on failure surface the inline retry pill (§7) |
| Configure | `settings` | navigates to detail with `?tab=config` | |
| Copy name | `copy` | clipboard write; 1.5s inline "Copied" pill (per `01-chrome.md §1.2`) | |
| Remove | `trash-2` | `handleRemove(server.name)` | confirms via shared `<ConfirmDialog>`; never an ad-hoc `confirm()` |

---

## 6 · Navigation contract — detail is a separate route

MCP Server Detail (`apps/desktop/src/views/mcp/McpServerDetailView.vue`) is a **separate route**, not an inline drawer. This view's only obligation is correct outbound navigation.

### 6.1 Outbound

- Row click, `Enter`, card click → `router.push({ name: 'mcp-server-detail', params: { name: server.name } })`.
- `Cmd/Ctrl+Click` / middle-click → opens detail in a new `SessionTabStrip` tab per `01-chrome.md §1.3`.
- `Cmd/Ctrl+Enter` → same as `Cmd/Ctrl+Click`.

### 6.2 Inbound (from detail back to manager)

The detail view's `<BreadcrumbNav>` (per `01-chrome.md §1.2`) is the **single** back-affordance:

```
MCP  ›  github
^^^      ^^^^^^
link to  leaf (current server)
this view
```

The hand-rolled "Back to MCP Servers" anchor in `McpServerDetailView.vue` is removed — the lint rule `tracepilot/single-breadcrumb` (`01-chrome.md §Hierarchy contract`) rejects any local `.breadcrumb` outside `BreadcrumbNav.vue`. The detail view's stylesheet `apps/desktop/src/styles/features/mcp-server-detail.css` line 134 (gradient region — see audit) is out of scope here but **must** be cleared by the detail spec under `00-globals §G3`; this view does not depend on it.

### 6.3 Persistence across navigation

- `tracepilot:mcp:view` (Grid / Cards), `tracepilot:mcp:sort`, `tracepilot:density:mcp-manager`, search query, and active filter chips persist across navigation to detail and back.
- Selection state (`route.params.name`) is restored on return so the originating row scrolls into view (`<DataGrid>` `scrollToRowId` API).

---

## 7 · States

### 7.1 Empty (no servers configured)

The bespoke `empty-hero` / `empty-features` block (`McpManagerView.vue:194–235`) is replaced by `<EmptyState>` per `02-primitives.md §EmptyState`. The feature bullets become a `<LinkList>` rendered inside the `description` slot.

| `<EmptyState>` prop | Value |
|---|---|
| `iconName` | `plug` (32px Lucide) |
| `title` | `"No MCP servers configured"` (only legal `text.display` use, per `02-primitives.md §EmptyState`) |
| `description` | `"MCP servers extend your AI assistant with external tools — databases, APIs, file systems, and more. Add a server manually or import an existing configuration."` |
| `primaryAction` | `{ label: 'Add server', iconName: 'plus', onClick: () => (showAddModal = true) }` |
| `secondaryAction` | `{ label: 'Import config', onClick: handleImport }` |

The three feature bullets render below the CTA row as a small `<LinkList>` (text.small, `--text-tertiary`, no decorative dot — Lucide `check` 14px lead glyph instead of the `feature-dot` purple circle). No `border-top` divider — the `<EmptyState>` already owns the surface.

### 7.2 Loading

`<DataGrid state="loading">` renders 8 skeleton rows; the `<KPIRow>` and `<TokenBudgetBar>` show their `loading` states (skeleton numerals / track at `--surface-tertiary`). The bespoke `.loading-spinner` (`McpManagerView.vue:528–535`) is deleted.

### 7.3 Partial / mixed health (some servers connecting)

No global banner. Each row's `<StatusPill tone="accent">` with `loader-2` icon is sufficient. The `Active` KPI shows the resolved count; `Connecting` rows are not counted toward `Active` until they resolve.

### 7.4 Per-server error

Inline pill + retry, **never** a global error banner. The DataGrid row renders `<StatusPill tone="danger" iconName="octagon-x">` plus a hover-revealed `<Button size="sm" variant="ghost" iconName="refresh-cw">Retry</Button>` in the row-actions slot, which calls `store.checkHealth(server.name)`. The `tools` and `tokens` columns render `—` (em-dash, `--text-tertiary`).

A row-error tooltip on the pill surfaces `server.health.lastError` truncated to 200 chars; full text in the detail view (§6).

### 7.5 Store-level error (load / mutation failure)

The legacy red `error-banner` (`McpManagerView.vue:182–185`) becomes a `<Banner tone="danger" iconName="octagon-x">` rendered between `<TokenBudgetBar>` and `<ToolbarRow>`, with a Lucide `x` dismiss button (`store.clearError()`) — replacing the literal `×` glyph at line 184. Reuses the canonical `<Banner>` from primitives; no local CSS.

### 7.6 No-results (search / filter)

`<DataGrid state="empty">` with `<EmptyState size="sm">`:
- `title`: `"No servers match"` (clamped to `text.h2` per `02-primitives.md §EmptyState`)
- `description`: `"Adjust your filters or clear the search."`
- `primaryAction`: `{ label: 'Clear filters', onClick: () => store.clearFilters() }`

---

## 7.7 Add Server modal — out of scope, but constrained

The `<McpAddServerModal>` is launched from this view but is its own component (and will get its own primitive migration when `<Modal>` lands). This spec does **not** redesign the modal. It does, however, refuse to render it inside a glass overlay: the `add-server.css:9` `backdrop-filter: blur(8px)` and `:10` `-webkit-backdrop-filter` are illegal per `00-globals §G2`. When the modal migrates to the primitive `<Modal>` (with `<ModalScrim>` from `packages/ui/src/components/Modal/scrim.css`), the only legal blur site is that single scrim file, capped at 4px on top of `rgba(0,0,0,.55)`. Until then, this view treats the legacy modal as a known violation tracked in the audit; nothing in `McpManagerView.vue` re-introduces a glass layer of its own.

---

## 8 · Keyboard model

Inherits `02-primitives.md §DataGrid` keyboard model. View-specific additions:

| Key | Action |
|---|---|
| `g` | switch to Grid view |
| `c` | switch to Cards view |
| `r` | refresh health (= toolbar `↻`) |
| `n` | open Add Server modal |
| `i` | open Import dialog |
| `/` | focus search |
| `t` | toggle enabled on focused row |

All bindings register in the global `?` overlay under "MCP Manager" (per `01-chrome.md §1.5 Search Palette`, "Active View" section).

---

## 9 · Accessibility

- `PageHeader` `iconName="plug"` renders via `<Icon name="plug" size="20" aria-hidden="true">`. The h1 reads "MCP" — full phrase ("Model Context Protocol") in `aria-describedby` / tooltip.
- Each row's `<StatusPill>` carries `aria-label="${tone} — ${label}"`; color is never the sole signal (closes `00-globals §G6`-adjacent accessibility intent).
- Per-row `<TokenBudgetBar>` exposes `role="progressbar"` with `aria-valuenow / aria-valuemin / aria-valuemax`, plus `aria-label="${server.name} token usage: ${used} of ${total}"`.
- The Refresh button's spin animation is wrapped in `@media (prefers-reduced-motion: no-preference)` per `00-globals §G5`.
- The DataGrid uses real `<table role="grid">` semantics from the primitive — screen readers announce row count, current row, and sort state. The Cards view sets `role="list"` on the grid container and `role="listitem"` on each `<EntityCard>`.
- Tag chips in `<ToolbarRow #left>` are `<button aria-pressed="true|false">`; the active state is read out as "pressed" rather than inferred from color contrast.
- Icon-only toolbar buttons (Refresh, density toggle, view toggle) carry explicit `aria-label`; tooltips on hover/focus repeat the label and add the keyboard shortcut chip.

---

## 10 · Visual references

### 10.1 Per-row token bar — three tones at a glance

```
github          ● Active   stdio  12  ▮▮▯▯▯▯▯▯▯▯  3 412  / 128 000   12s   ← --success-fg
filesystem      ● Active   stdio   6  ▮▮▮▮▮▯▯▯▯▯ 38 901  / 128 000   12s
context-store   ● Active   http    9  ▮▮▮▮▮▮▮▮▯▯ 99 110  / 128 000    1m   ← --warning-fg (≥ 75 %)
mega-corpus     ● Active   stdio   3  ▮▮▮▮▮▮▮▮▮▮ 121 944 / 128 000    2m   ← --danger-fg  (≥ 90 %)
```

Tone is also reflected in the numeric ratio (per `02-primitives.md §TokenBudgetBar` "Tone derivation"), so colorblind users still see the 90% threshold cross.

### 10.2 Cards view — single card

```
┌────────────────────────────────────────┐
│ [plug]  github                ● Active │  ← <EntityCard #head>: iconName + title + StatusPill
│ stdio · 12 tools · 3 412 tok           │  ← meta[] (last entry mono)
│                                        │
│ Connects the agent to GitHub repos,    │  ← #default body: server.description (clamp 2)
│ issues, PRs, and Actions runs.         │
│                                        │
│ [github] [code-host]                   │  ← tag chips (StatusPill xs neutral)
│                                        │
│ [Configure] [Toggle]            [⋯]    │  ← #actions
└────────────────────────────────────────┘
```

---

## 11 · Removals (summary)

This view's redesign deletes:

- `apps/desktop/src/components/mcp/McpServerCard.vue` (replaced by `<EntityCard>` — closes CC-9)
- `apps/desktop/src/components/mcp/McpTokenSummary.vue` (replaced by `<TokenBudgetBar>` — closes CC-7)
- `McpServerCard.vue:117` — `⚡` emoji (§G1)
- `McpTokenSummary.vue:31` — `📊` emoji (§G1)
- `McpManagerView.vue:107/111/115/141/157/197/213/217` — every inline `<svg>` icon path (§G1; replaced by `<Icon>`)
- `McpManagerView.vue:280` — `background: var(--gradient-accent)` on the primary button (§G3)
- `McpManagerView.vue:294` / `:298` — `transform: translateY(...)` hover/active (§G4)
- `McpManagerView.vue:441–459` — `.section-heading` uppercase / `text.micro` heading (§G7 / `00-globals §CC-10`)
- `McpManagerView.vue:537–608` — bespoke `.empty-state` / `.empty-hero` / `.empty-features` (replaced by `<EmptyState>`)
- `McpManagerView.vue:611–616` — bespoke `.server-grid` (handled by `<EntityCard>` parent grid)
- `McpManagerView.vue:184` — literal `×` dismiss glyph (replaced by Lucide `x`)
- The `add-server.css:9` `backdrop-filter: blur(8px)` glass — out of scope of this view but **must** be cleared by the Add Server modal migration to `<Modal>` from primitives (`00-globals §G2`); this view does not import that stylesheet directly after the modal lands as a primitive.

---

## 11.1 · Cross-reference index

| Topic | This spec | Source-of-truth |
|---|---|---|
| Iconography (Lucide-only, no emoji) | §2.2, §3.2, §5.2, §10 | `00-globals §G1` |
| Glass / backdrop-filter ban | §5, §7.7, §10 | `00-globals §G2` |
| Marketing gradient ban | §5.2, §10 | `00-globals §G3` |
| Hover state (color/border, never transform) | §5.2, §10 | `00-globals §G4` |
| Motion budget (120/180/220ms, reduced-motion) | §7.2, §9 | `00-globals §G5` |
| Color from token only | §4 | `00-globals §G6` |
| `text.micro` discipline | §10 | `00-globals §G7` |
| Density & 4px grid | §IA, §1 | `00-globals §G8` |
| Tabular numerals on numeric columns | §1.1, §3.1, §10.1 | `00-globals §G9` |
| Sidebar / tab strip / breadcrumb chrome | §IA, §6.2 | `01-chrome.md §1.1, §1.2, §1.3` |
| `<PageHeader>` (single canonical) | §IA, §1, §5.2 | `01-chrome.md §1.4` |
| `<DataGrid>` props / keyboard / states | §1, §7, §8 | `02-primitives.md §DataGrid` |
| `<EntityCard>` field mapping | §2.1 | `02-primitives.md §EntityCard` |
| `<TokenBudgetBar>` (CC-7) | §3 | `02-primitives.md §TokenBudgetBar` |
| `<KPI>` / `<KPIRow>` (CC-4) | §3.3 | `02-primitives.md §KPI` |
| `<ToolbarRow>` flat hairline | §5 | `02-primitives.md §ToolbarRow` |
| `<EmptyState>` | §7.1, §7.6 | `02-primitives.md §EmptyState` |
| `<StatusPill>` tone / size / variant | §4 | `02-primitives.md §StatusPill` |

---

## 12 · Acceptance

- [ ] `McpManagerView.vue` renders only `<PageHeader>`, `<KPIRow>`, `<TokenBudgetBar>`, `<ToolbarRow>`, `<DataGrid>` / `<EntityCard>`, `<EmptyState>`, `<Banner>`, `<Modal>` from `@tracepilot/ui` — no local layout CSS beyond a thin grid wrapper
- [ ] `<TokenBudgetBar>` appears exactly **once** at page level + once per row in `size="sm"`; `McpTokenSummary.vue` is deleted
- [ ] `<EntityCard>` is the only card archetype in this view; `McpServerCard.vue` is deleted
- [ ] No emoji remain in the MCP source tree (`rg "[\u{1F300}-\u{1FAFF}]" apps/desktop/src/views/mcp apps/desktop/src/components/mcp` returns 0 hits) — closes `00-globals §G1`
- [ ] No glass on this view's surfaces; the modal scrim file is the only legal `backdrop-filter` site (`00-globals §G2`)
- [ ] No `linear-gradient(...)` fills in this view's CSS; primary action uses the canonical `<Button variant="primary">` (`00-globals §G3`)
- [ ] No `transform` on hover anywhere in MCP Manager source (`00-globals §G4`)
- [ ] Status is conveyed by tone **and** icon **and** label on every row (`00-globals §G6` accessibility)
- [ ] All numeric columns use `tnum` and `--font-mono` (`00-globals §G9`)
- [ ] Row click, `Enter`, and `Cmd/Ctrl+Click` all route to `mcp-server-detail` correctly; back navigation lands on the same row, scrolled into view
- [ ] Density, view (Grid/Cards), sort, and filter chips persist across reload and across navigation to detail
- [ ] `prefers-reduced-motion` disables the refresh-spin and the per-row `loader-2` (`00-globals §G5`)
- [ ] Renders cleanly at 1× and 2× DPI in dark and light themes
