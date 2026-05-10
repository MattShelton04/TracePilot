# 20 · Config Injector

> **Scope:** `apps/desktop/src/views/orchestration/ConfigInjectorView.vue` and every component under `apps/desktop/src/components/configInjector/**`. Closes the audit findings in `design-system/audit/UI-AUDIT.md` lines 194–200 ("**high concentration of MASTER violations in a small surface**").
> **Inherits:** `00-globals.md` (hygiene rules), `01-chrome.md` (chrome contract), `02-primitives.md` (component vocabulary).
> **Reads from:** `design-system/MASTER.md`.

This view is the densest concentration of MASTER violations in the orchestration tree: emoji in the `<PageHeader title>`, an emoji-as-icon `TabNav`, a hand-rolled `<nav class="breadcrumb">`, a literal `⚠️` warning banner, an emoji-keyed `agentMeta.ts` data file, and a 28px hero in `config-injector.css`. Every one of those is already forbidden by `00-globals` or `01-chrome` — this spec is about **removing** local invention, not adding new patterns.

---

## 1 · Purpose & job-to-be-done

Inject TracePilot config and agent definitions into Copilot CLI's user settings and manage the resulting versions and backups. The user must be able to:

1. See **what is currently active vs. drafted** at a glance.
2. Pick an **agent** on the left, edit its config / motto / model on the right.
3. Switch to **Global Config**, **Environment**, or **Backups** as peer surfaces.
4. Be **warned exactly once** that Copilot can overwrite customizations on auto-update — and dismiss that warning permanently per workspace.

The view is *informational + form*, not a dashboard. No KPI strip is required (see §6).

---

## 2 · Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│ PageHeader                                                             │  inherits 01-chrome §1.4
│  ├── BreadcrumbNav: Orchestration › Config Injector                    │  01-chrome §1.2
│  ├── Heading level=1: "Config Injector"                                │  02-primitives §Heading
│  └── iconName: settings   (Lucide; never emoji — 00-globals §G1)       │
├────────────────────────────────────────────────────────────────────────┤
│ <Banner variant="warning" iconName="alert-triangle" dismissible …/>    │  NEW PRIMITIVE — §4
├────────────────────────────────────────────────────────────────────────┤
│ <ToolbarRow>  TabNav: Agent Models · Global Config · Environment ·     │  02-primitives §ToolbarRow
│               Backups   (icons via iconName, count badges)             │
├────────────────────────────────────────────────────────────────────────┤
│ <SplitPane id="config-injector" initial="320" min="240" max="480">     │  02-primitives §SplitPane
│   ┌─ left: agent / item list ──────┐ ┌─ right: config form ──────────┐ │
│   │ <SectionPanel> (single frame)  │ │ <SectionPanel>                │ │
│   │   <DataGrid> rows = agents     │ │   <Heading 2>Agent name       │ │
│   │     • color rail (--agent-…)   │ │   <FormRow> model selector    │ │
│   │     • Lucide glyph 16px        │ │   <FormRow> motto             │ │
│   │     • name (Inter 500)         │ │   <FormRow> system prompt     │ │
│   │     • motto (text.small mute)  │ │   sticky footer: Save · Reset │ │
│   │     • status pill              │ │                               │ │
│   └────────────────────────────────┘ └───────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

The Global / Environment / Backups tabs reuse the same `SplitPane` skeleton — list of items on the left, detail/form on the right — so all four tabs share one geometry. **No alternative layouts per tab.** This kills CC-4 (frame soup) by giving every tab a single outer `SectionPanel` boundary instead of the current ad-hoc nested cards.

---

## 3 · Chrome (delete what is local)

### 3.1 · Delete the emoji in `PageHeader title`
`ConfigInjectorView.vue:63` currently reads:

```vue
<PageHeader title="⚙️ Config Injector" size="sm" class="config-injector-header" />
```

Replace with the canonical signature from `01-chrome §1.4`:

```vue
<PageHeader
  :breadcrumbs="[{ label: 'Orchestration', to: { name: 'orchestration-home' } }, { label: 'Config Injector' }]"
  title="Config Injector"
  iconName="settings"
/>
```

Justification: `00-globals §G1` ("**No emoji in application chrome**" — migration table maps `⚙️` → Lucide `settings`) and `01-chrome §1.4` (`iconName?: LucideName`). The literal emoji in a *prop string* is the exact pattern the lint rule `tracepilot/no-emoji-in-templates` (00-globals §G1 Lint) is designed to fail on.

### 3.2 · Delete the local breadcrumb
`ConfigInjectorView.vue:57–61`:

```vue
<nav class="breadcrumb">
  <span class="breadcrumb-link">Orchestration</span>
  <span class="breadcrumb-sep">›</span>
  <span class="breadcrumb-current">Config Injector</span>
</nav>
```

This is the *named example* in `01-chrome §1.1` ("Ad-hoc breadcrumbs (e.g. `ConfigInjectorView`'s local breadcrumb HTML) are forbidden") and is exactly what the `tracepilot/single-breadcrumb` Stylelint rule rejects. Crumbs come **only** from `BreadcrumbNav`, embedded inside `PageHeader` via the `breadcrumbs` prop (see §3.1). Closes CC-5 for this view.

### 3.3 · Delete the local emoji-as-icon TabNav data
Lines 19–24 (and 39):

```ts
const tabs = [
  { key: "agents",   label: "Agent Models",  emoji: "🤖" },
  { key: "global",   label: "Global Config", emoji: "📋" },
  { key: "versions", label: "Environment",   emoji: "🔧" },
  { key: "backups",  label: "Backups",       emoji: "💾" },
];
// …
icon: t.emoji,
```

Replace with Lucide names from the `00-globals §G1` migration table:

| Tab | Was | Becomes |
|---|---|---|
| Agent Models | `🤖` | `bot` |
| Global Config | `📋` | `file-text` |
| Environment | `🔧` | `wrench` |
| Backups | `💾` | `database-backup` *(or `archive` if not in the curated set)* |

The `TabNav` accepts `iconName: LucideName` and renders via `<Icon>`; the emoji property is removed from the local `tabs` array entirely.

---

## 4 · Banner — [NEW PRIMITIVE]

The current "Copilot will overwrite customizations on update" message is hand-rolled (`ConfigInjectorView.vue:65–74`) with literal `⚠️` and `✕` characters and a bespoke `.warning-banner` CSS class. Three problems: (a) emoji-as-icon, (b) chrome reinvention, (c) duplicates the same shape used by `ErrorAlert variant="banner"`, but for non-error tones.

### 4.1 · Promote the pattern to `<Banner>` in `@tracepilot/ui`

Add to `packages/ui/src/components/Banner.vue`:

```ts
interface BannerProps {
  variant: 'info' | 'warning' | 'danger' | 'success';
  iconName?: LucideName;     // defaults: info → 'info', warning → 'alert-triangle',
                             //           danger → 'x-circle', success → 'check-circle-2'
  dismissible?: boolean;
  persistKey?: string;       // when set, dismissal is stored under
                             // localStorage `tracepilot:banner:<key>` and survives reload
}
// Slot: default = message; named slot `actions` = inline buttons
```

Tokens (no inline values; `00-globals §G6`):

| Variant | bg | border | fg | icon |
|---|---|---|---|---|
| `info` | `--accent-subtle` | `--border-accent` | `--text-primary` | `--accent-fg` |
| `warning` | `--warning-subtle` | `--warning-muted` | `--text-primary` | `--warning-fg` |
| `danger` | `--danger-subtle` | `--danger-muted` | `--text-primary` | `--danger-fg` |
| `success` | `--success-subtle` | `--success-muted` | `--text-primary` | `--success-fg` |

Geometry: 12px vertical / 16px horizontal padding, `--radius-md`, single 1px border (no shadow), 8px gap between icon and message, dismiss button is a 24px icon-only `<IconButton>` rendering Lucide `x` (never the literal `✕`). Inline `<code>` inside the message uses `--font-mono` and `--canvas-inset`.

### 4.2 · Usage in this view

```vue
<Banner
  v-if="store.hasCustomizations"
  variant="warning"
  iconName="alert-triangle"
  dismissible
  persistKey="config-injector:overwrite-warning"
>
  Copilot will overwrite customizations on update. Set
  <code>COPILOT_AUTO_UPDATE=false</code> to prevent. We recommend reinjecting after every update
  rather than disabling auto-update.
</Banner>
```

Replaces `useDismissable("config-injector-warning")` — `Banner`'s `persistKey` subsumes that composable, so the local import goes away.

### 4.3 · Lint surface
- `tracepilot/no-local-reimplementation` (02-primitives Common Contract) gains `.warning-banner`, `.warning-banner-text`, `.warning-banner-close` to its forbidden-class list.
- `tracepilot/no-emoji-in-templates` already catches the `⚠️` and `✕` literals.

---

## 5 · `agentMeta.ts` — migrate emoji → Lucide

`apps/desktop/src/components/configInjector/agentMeta.ts:7–32` hard-codes:

```ts
explore:           { emoji: "🔍", colorVar: "--accent-emphasis", … }
task:              { emoji: "⚡", colorVar: "--warning-emphasis", … }
"code-review":     { emoji: "📝", colorVar: "--success-emphasis", … }
"rubber-duck":     { emoji: "🦆", colorVar: "--agent-color-rubber-duck", … }
research:          { emoji: "🔬", colorVar: "--done-emphasis", … }
"configure-copilot": { emoji: "⚙️", colorVar: "--neutral-emphasis", … }
DEFAULT:           { emoji: "🤖", … }
```

This is the textbook case from `00-globals §G1` ("emoji **in data files used to render UI** (e.g. `agentMeta.ts`)"). Migrate the `emoji` field to `iconName: LucideName` using the §G1 mapping:

| Agent | Was | `iconName` |
|---|---|---|
| `explore` | `🔍` | `search` |
| `task` | `⚡` | `zap` |
| `code-review` | `📝` | `file-text` |
| `rubber-duck` | `🦆` | `bird` *(closest curated Lucide; pair with `colorVar` for identity)* |
| `research` | `🔬` | `flask-conical` |
| `configure-copilot` | `⚙️` | `settings` |
| `DEFAULT` | `🤖` | `bot` |

Public shape:

```ts
export interface AgentMeta {
  iconName: LucideName;   // was: emoji
  colorVar: string;       // unchanged — these are agent identity tokens (MASTER §2.4)
  motto: string;
}
```

Consumers (`ConfigInjectorAgentsTab.vue`, the agent row in §2's left list, any tooltip) render through `<Icon :name="meta.iconName" :size="16" :style="{ color: \`var(\${meta.colorVar})\` }" />`. The agent's identity is now **icon + color rail**, not a glyph; identity remains stable because `colorVar` is unchanged.

`ConfigInjectorBackupsTab.vue:65` (`<span class="backup-emoji">{{ backupEmoji(...) }}</span>`) follows the same migration: replace the `backupEmoji` helper with a `backupIconName` helper returning Lucide names (`file-text`, `folder`, `settings`, etc.) keyed off `sourcePath`.

---

## 6 · Body — single `SectionPanel` per pane (closes CC-4)

The current view nests `.config-injector-page > .page-content-inner > .config-injector-tabs > tab-specific cards > inner panels`. That is **frame soup**. The contract for every tab body is:

1. **One** outer `SectionPanel` per pane (left, right) with `--canvas-subtle` background and a single 1px hairline.
2. **No** card-inside-card. A child `SectionPanel` must add information density, not visual nesting.
3. Form rows are `<FormRow>` (label left, control right, help text below; 32px row by default per `00-globals §G8`). Inputs and selects come from `@tracepilot/ui`.
4. The detail pane has a **sticky footer** (`position: sticky; bottom: 0; background: var(--canvas-subtle); border-top: 1px solid var(--border-subtle)`) with **Save** (primary) and **Reset** (ghost). No floating action bar.

**KPIRow:** not used in this view. Config Injector is a form, not a metrics surface — the audit's "missing 'currently active vs. drafted' indicator" is satisfied by a **`StatusPill`** in the right-pane heading (`tone="success" label="Active"` vs. `tone="warning" label="Draft"`), not by a metric tile strip.

---

## 7 · No glass anywhere

`config-injector.css:186` carries a `font-size: 28px` hero (CC-3, `00-globals §G3`) — delete; the page title comes from `<PageHeader>` and is `text.h1` (20/28). Per the audit, the file does **not** currently use `backdrop-filter` directly, but the rule still applies: **zero `backdrop-filter` outside the modal scrim** (`00-globals §G2`). All sticky surfaces in this view (the `ToolbarRow` carrying the `TabNav`, the right-pane footer) use `--canvas-subtle` + 1px hairline, never blur.

---

## 8 · Tokens & motion

Color: only `var(--…)` tokens from `packages/ui/src/styles/tokens.css` (`00-globals §G6`). Specifically forbidden in this view: any hex literal, any `rgb(...)`, any `linear-gradient(...)` on a tile, banner, or header — `config-injector.css:331` (`background: linear-gradient(135deg, var(--done-emphasis), var(--done-fg));`) is replaced with a flat `var(--done-subtle)` fill plus `var(--done-fg)` foreground.

Motion: `00-globals §G5` budget — 120ms color/border, 180ms tab switch and `Banner` enter/leave, 220ms `SplitPane` handle drop. Only `transform` / `opacity` animate; the `Transition name="banner"` block must not animate `height` (current implementation is implicitly height-based — switch to `opacity` + `translateY(-2px)`).

---

## 9 · Component inventory (after redesign)

| Layer | Component | Source |
|---|---|---|
| Page chrome | `<PageHeader>` (with `breadcrumbs`, `iconName="settings"`) | `01-chrome §1.4` |
| Inline alert | `<Banner variant="warning" iconName="alert-triangle">` | **NEW** — §4 |
| Tab strip | `<TabNav>` inside `<ToolbarRow>` | `02-primitives §ToolbarRow` |
| Body shell | `<SplitPane id="config-injector">` | `02-primitives §SplitPane` |
| Panes | `<SectionPanel>` ×2 (single frame each) | shared primitive |
| Left list | `<DataGrid>` (agents/backups/env vars depending on tab) | `02-primitives §DataGrid` |
| Right detail | `<Heading level=2>` + `<FormRow>` ×N + sticky footer | `02-primitives §Heading` |
| Status indicator | `<StatusPill tone="success|warning">` | `02-primitives §StatusPill` |
| Empty state per tab | `<EmptyState>` | `02-primitives §EmptyState` |
| Icons everywhere | `<Icon name="…" size="16|20">` | `00-globals §G1` |

Deleted from this view:
- `<nav class="breadcrumb">` and `.breadcrumb-*` CSS classes.
- `.warning-banner`, `.warning-banner-text`, `.warning-banner-close` CSS classes.
- The `emoji` field on the local `tabs` array.
- `useDismissable("config-injector-warning")` import (subsumed by `Banner persistKey`).
- `config-injector.css:186` 28px hero rule and `config-injector.css:331` linear-gradient fill.

---

## 10 · Acceptance

Each item below must be machine-verifiable. The view is not "done" until every box is checked.

### Emoji & icons
- [ ] `rg "[\u{1F300}-\u{1FAFF}]" apps/desktop/src/views/orchestration/ConfigInjectorView.vue apps/desktop/src/components/configInjector` returns **zero** hits.
- [ ] `rg "emoji" apps/desktop/src/components/configInjector` returns zero hits in `.ts` and `.vue` source (no field named `emoji`, no helper named `*Emoji`).
- [ ] `agentMeta.ts` exports `AgentMeta { iconName: LucideName; colorVar; motto }` — no `emoji` key.
- [ ] `ConfigInjectorView.vue` imports `<Icon>` from `@tracepilot/ui`; no inline SVG paths.
- [ ] The `PageHeader` is rendered with `iconName="settings"` and a `title` prop containing letters only.

### Breadcrumbs
- [ ] `rg "class=\"breadcrumb" apps/desktop/src/views/orchestration/ConfigInjectorView.vue` returns zero hits.
- [ ] The view's only breadcrumb source is `<PageHeader :breadcrumbs="…">`, which delegates to `BreadcrumbNav` (01-chrome §1.2).
- [ ] Stylelint `tracepilot/single-breadcrumb` passes for this file.

### Banner primitive
- [ ] `packages/ui/src/components/Banner.vue` exists and is exported from `packages/ui/src/components/index.ts`.
- [ ] The customization warning uses `<Banner variant="warning" iconName="alert-triangle" persistKey="config-injector:overwrite-warning" dismissible>`.
- [ ] No `.warning-banner*` classes remain in `apps/desktop/src/styles/features/config-injector.css`.
- [ ] Dismissal persists across reload via `localStorage` key `tracepilot:banner:config-injector:overwrite-warning`.

### Frame & layout
- [ ] Each tab renders **one** `<SplitPane>` with **one** `<SectionPanel>` per pane — verified by snapshot test.
- [ ] No nested `SectionPanel` more than 1 level deep.
- [ ] The right-pane footer is `position: sticky; bottom: 0` with `--canvas-subtle` and a `--border-subtle` top hairline — no shadow.

### Tokens & glass
- [ ] Stylelint `color-no-hex` passes on `apps/desktop/src/styles/features/config-injector.css` and `apps/desktop/src/views/orchestration/ConfigInjectorView.vue`.
- [ ] `rg "backdrop-filter" apps/desktop/src/styles/features/config-injector.css apps/desktop/src/components/configInjector` returns zero hits.
- [ ] `rg "linear-gradient" apps/desktop/src/styles/features/config-injector.css` returns zero hits.
- [ ] `config-injector.css:186` (28px hero) is removed; the page title is rendered by `<Heading level="1">` inside `<PageHeader>`.

### Motion
- [ ] All `transition` durations in `config-injector.css` are one of `120ms | 180ms | 220ms`.
- [ ] The `Transition name="banner"` animates `opacity` and `transform` only.
- [ ] `prefers-reduced-motion: reduce` collapses banner enter/leave to ≤ 80ms cross-fade.

### Behaviour
- [ ] Active vs. drafted state for the selected agent is visible as a `<StatusPill>` in the right-pane heading.
- [ ] `Cmd/Ctrl+S` saves the current form when focus is inside the right pane; the keyboard shortcut is shown as `<kbd>` next to the **Save** button.
- [ ] All four tabs (Agents / Global / Environment / Backups) share the same `<SplitPane>` skeleton — the only differences are the left-pane data source and right-pane form fields.

---

## 11 · Migration order

1. Land the **`<Banner>` primitive** (§4) in `@tracepilot/ui`.
2. Migrate **`agentMeta.ts`** (§5) — emoji → `iconName`. Update `ConfigInjectorAgentsTab.vue` and `ConfigInjectorBackupsTab.vue` consumers.
3. Rewrite **`ConfigInjectorView.vue`**: delete the local breadcrumb, delete the emoji from `PageHeader title`, swap the warning block for `<Banner>`, drop `useDismissable`, swap `tabs[].emoji` for `iconName`.
4. Restructure each tab body to **one `SplitPane` + one `SectionPanel` per pane** (§6). Delete `config-injector.css:186` and `:331`.
5. Run lint: `tracepilot/no-emoji-in-templates`, `tracepilot/single-breadcrumb`, `tracepilot/single-page-header`, `color-no-hex`, `tracepilot/no-backdrop-filter`. All must pass before merge.

> When this view ships, the audit's note that Config Injector is a "high concentration of MASTER violations in a small surface" is closed. Subsequent regressions must fail lint, not review.
