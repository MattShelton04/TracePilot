# 00 · Globals — Hygiene Rules

> **Scope:** Cross-cutting rules every TracePilot surface must obey. Closes the cross-cutting findings in `design-system/audit/UI-AUDIT.md` (CC-1, CC-2, CC-3, CC-10, CC-11, CC-12, CC-13).
> **Reads from:** `design-system/MASTER.md` (the contract). This file says how to enforce it in code.
> **Audience:** the engineer doing the global hygiene PR — and every per-view spec that references "the global rules in 00-globals.md".

This is the **first** PR in the redesign sequence. It must merge before any per-view spec is implemented, because per-view specs assume the rules below already hold.

---

## G1 · Iconography (closes CC-1)

### Rule
**Lucide is the sole icon set.** No emoji in application chrome. Sizes: **16px** (in dense rows / inline) or **20px** (in headers / toolbars). Stroke: **1.5px**. Color: `currentColor` — set the parent's `color` to a token (`--text-secondary`, `--accent-fg`, `--success-fg`, …).

### Implementation
1. **Adopt** [`lucide-vue-next`](https://lucide.dev/guide/packages/lucide-vue-next) as the canonical import. Re-export a curated subset from `packages/ui/src/icons/index.ts` so consumers `import { Search, Folder, … } from '@tracepilot/ui/icons'`. This lets us swap libraries later without touching every file.
2. **Wrap** in a single `<Icon>` component in `packages/ui` that enforces stroke + size:
   ```vue
   <Icon name="search" size="20" />        <!-- header / toolbar -->
   <Icon name="check-circle-2" size="16" /> <!-- inline / row -->
   ```
   `size` must be `16 | 20`. No other values. The component clamps stroke at `1.5`.
3. **Forbidden** in `apps/desktop/src/**/*.vue` and `packages/ui/src/**/*.vue`:
   - Inline SVG paths.
   - Imports from `@heroicons/*`, `phosphor-icons`, `tabler-icons` — Lucide only.
   - String literals containing emoji **in template bodies, in `default`/`label`/`title` props, or in data files used to render UI** (e.g. `agentMeta.ts`, `SessionLauncherTemplates`, `useExportConfig`).

### Migration mapping (source → Lucide name)
Use this table when replacing emoji found by the audit:

| Emoji | Lucide |
|---|---|
| 🎯 (intent / objective) | `target` |
| ⚡ (skill / sub-agent / activity) | `zap` |
| ⚙️ (settings / config) | `settings` |
| 🚀 (launch / run) | `rocket` |
| 🔍 (search / inspect) | `search` |
| 📊 (analytics / chart) | `bar-chart-3` |
| 📁 (folder / files) | `folder` |
| 📂 (open folder) | `folder-open` |
| 🤖 (bot / agent) | `bot` |
| 🧰 (tools) | `wrench` |
| ✅ / ☑️ (done / pass) | `check-circle-2` |
| ❌ / ⛔ (fail / blocked) | `x-circle` |
| ⚠️ (warning) | `alert-triangle` |
| ℹ️ (info) | `info` |
| 🔔 (alert / notification) | `bell` |
| 📝 (note / template) | `file-text` |
| 💡 (tip / idea) | `lightbulb` |
| 🧠 (reasoning / think) | `brain` |
| 🔌 (mcp / plug) | `plug` |
| 🔄 / ♻️ (refresh / retry) | `refresh-cw` |
| 📤 (export / upload) | `upload` |
| 📥 (import / download) | `download` |
| 🌳 (worktree / branch) | `git-branch` |

### User-supplied emoji (skill author icons, template names)
Some emoji come from **user content**, not chrome. For those:
- Render in a `<UserContentEmoji>` wrapper that:
  - Uses `font-family: var(--font-sans)` (no system emoji forced).
  - Constrains size to match the surrounding `text.body` line-box (no oversize).
  - Sets `aria-hidden="true"` and exposes the parent label via `aria-label`.
  - Adds `outline: 1px solid var(--border-subtle)` + 4px padding so it's visually quarantined from chrome icons.
- **Never** treat user emoji as the only label — pair with text.

### Lint
Add a Biome / ESLint custom rule (`tracepilot/no-emoji-in-templates`) that flags emoji codepoints in:
- `*.vue` `<template>` blocks
- `*.ts` files imported by Vue components, in any string assigned to keys named `icon`, `label`, `title`, `name`, `placeholder`.

Allow-list path: `packages/ui/src/components/UserContentEmoji.vue` and the migration table above.

### Acceptance
- [ ] `rg "[\u{1F300}-\u{1FAFF}]" apps/desktop/src packages/ui/src` returns 0 hits in `<template>` blocks
- [ ] `lucide-vue-next` is the only icon dependency in `package.json`
- [ ] `<Icon>` is imported from `@tracepilot/ui` everywhere; no inline SVG icon paths remain in `apps/desktop`

---

## G2 · No glassmorphism on data or chrome (closes CC-2)

### Rule
**`backdrop-filter: blur(...)` is banned** on any surface that:
- Renders data (tables, lists, cards, log streams).
- Sits behind chrome (sidebars, headers, tab strips, toolbars, drawers).
- Is itself a popover, menu, or modal panel.

### The only allowed use
The dim **scrim behind a modal** (the full-viewport overlay underneath the modal panel) — and even there, capped at **`backdrop-filter: blur(4px)`** with `background: rgba(0,0,0,.55)`. The modal panel itself uses solid `--canvas-raised`.

### Replacement recipes
| Was glass… | Becomes |
|---|---|
| Sticky toolbars / sub-headers | `background: var(--canvas-subtle); border-bottom: 1px solid var(--border-subtle);` |
| Popovers, menus | `background: var(--canvas-overlay); border: 1px solid var(--border-default); box-shadow: var(--shadow-md);` |
| Modal panels | `background: var(--canvas-raised); border: 1px solid var(--border-default); box-shadow: var(--shadow-lg);` |
| Side drawers (Alert Center) | `background: var(--canvas-raised); border-left: 1px solid var(--border-subtle);` |
| Command palette panel | `background: var(--canvas-raised); border: 1px solid var(--border-default); box-shadow: var(--shadow-lg);` |
| Modal scrim | `background: rgba(0,0,0,.55); backdrop-filter: blur(4px);` ← **only place blur is legal** |

### Lint
Stylelint custom rule (`tracepilot/no-backdrop-filter`) flagging `backdrop-filter` in any `.css/.vue` outside `packages/ui/src/components/Modal/scrim.css`.

### Acceptance
- [ ] `rg "backdrop-filter" apps/desktop/src packages/ui/src` returns one hit, in the modal scrim file
- [ ] Sticky `SessionListView` toolbar and `SessionDetailPanel` header use `--canvas-subtle` + hairline only

---

## G3 · No marketing gradients on app surfaces (closes CC-3)

### Rule
**No `linear-gradient(...)` fills** on cards, tiles, headers, banners, or page backgrounds.

### Allowed gradients
1. The single **ambient radial accent** already present in `App.vue` (a `radial-gradient` at ≤7% opacity behind the canvas). Defined once, never duplicated.
2. **`--gradient-accent`** — reserved for the **brand mark/logo** SVG fill only. Not for tiles, buttons, banners.
3. Chart series ramps (sequential, defined in `tokens.css` chart palette) — these aren't decorative gradients, they encode magnitude.

### Deprecated tokens
The audit flagged `--gradient-card` and `--gradient-surface` as enabling reuse of the bad pattern. Action:
1. `grep` every consumer; replace with the recipe in §G2.
2. Mark both tokens with a CSS `--deprecated-…` rename in `tokens.css`, leaving aliases for one release, then delete.

### Hero typography
Cap at `text.h1` (20/28 600) **outside** of:
- Empty-state titles → `text.display` (28/34 600) allowed.
- Onboarding (Wizard step welcome) → `text.display` allowed.

Anywhere else, sizes ≥ 24px are forbidden. The audit found `font-size: 36px`/`2.5rem`/`48px` in app chrome — all must be reduced to `text.h1`.

### Acceptance
- [ ] `rg "linear-gradient" apps/desktop/src packages/ui/src` returns zero hits in component CSS (matches only `tokens.css` for `--gradient-accent`)
- [ ] `rg "font-size:\s*(2\.5rem|36px|48px|40px|32px)" apps/desktop/src` returns zero hits outside empty-state / wizard files

---

## G4 · Hover & focus states (closes CC-12)

### Rule
**Hover changes color and border. Never layout.** No `transform: translateY(...)`, no `scale`, no margin/padding mutation on hover.

### Recipe
```css
.card,
.row {
  transition:
    background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    border-color    120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    color           120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}
.card:hover,
.row:hover {
  background-color: var(--surface-tertiary);
  border-color:     var(--border-emphasis);
}
.row[aria-selected="true"] {
  background-color: var(--accent-subtle);
  border-color:     var(--border-accent);
}
```

### Focus
Always visible. 2px ring, 2px offset, color `var(--accent-emphasis)`:
```css
:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
  border-radius: inherit;
}
```
Never remove `:focus-visible` — only override when replacing with an equivalent ring.

### Acceptance
- [ ] `rg "translateY\(-" apps/desktop/src packages/ui/src` returns zero hits in `:hover` blocks
- [ ] No `transform:\s*scale` in `:hover` selectors anywhere in the app

---

## G5 · Motion budget (closes CC-13)

### Allowed durations
- **120ms** — micro: color/border transitions, hover, focus.
- **180ms** — standard: open/close, tab switch, popover.
- **220ms** — large: modal/drawer enter, page transitions.

> Nothing > 240ms in the main app. Linear progress bars and skeletons are exempt (continuous).

### Easing
`cubic-bezier(0.2, 0.6, 0.2, 1)` (calm ease-out). Linear is reserved for indeterminate progress.

### Properties
`transform` and `opacity` only. **Never** animate `width`, `height`, `top`, `left`, `margin`, `padding` — they cause layout thrash on dense tables.

### Forbidden
- Decorative auto-play loops (`pulse-glow`, `fadeInUp` cascade, `drift-motion` skew).
- `animation: ... infinite` outside indeterminate-progress contexts.

### `prefers-reduced-motion`
Wrap every animation:
```css
@media (prefers-reduced-motion: no-preference) {
  /* …animations… */
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    transition-duration: 1ms !important;
  }
}
```
Cross-fades may still happen, but capped at 80ms.

### Acceptance
- [ ] `rg "animation:.*infinite" apps/desktop/src packages/ui/src` returns zero hits
- [ ] `rg "@keyframes (pulse-glow|fadeInUp|drift-motion)" apps/desktop/src` returns zero hits
- [ ] All `transition`/`animation` durations are one of `120ms | 180ms | 220ms` (lint regex: `transition[^;]*\d+ms` → match must be in allow-list)

### Intentional quirk — `?67` easter egg
The audit called this out as ad-hoc, but the user has confirmed it stays. **Re-house it** so it survives this hygiene pass without breaking the rules:
- Move the keyframes from `SessionListView.vue` into `apps/desktop/src/styles/easter-eggs.css` (a single, named, opt-in file).
- Trigger by adding `data-easter-egg="67"` to `<html>` when the search query equals `"67"` — don't transform `<body>`.
- Wrap the `@keyframes` in `@media (prefers-reduced-motion: no-preference)` so it self-disables.
- Reduce skew amplitude to **±2°** (the original ±10° is uncomfortable enough to read as a bug).
- Leave a 2-line comment in `easter-eggs.css` explaining what it is — **future contributors should know it's intentional, not a regression to be fixed.**

---

## G6 · Color from token only (closes CC-11)

### Rule
**No hex literals, no `rgb(...)`, no `hsl(...)` in component CSS.** Every color must come from `var(--…)` defined in `packages/ui/src/styles/tokens.css`.

### Exceptions
- The **token file itself** (`tokens.css`).
- Logo / brand SVGs (one file, `packages/ui/src/components/Logo.vue`).
- Modal scrim's `rgba(0,0,0,.55)` (it's an alpha-on-black, not a brand color, and tying it to a token would require defining a new one for one consumer).

### If you need a color that doesn't exist
Add the token to `packages/ui/src/styles/tokens.css` with a name from the existing taxonomy (`--{role}-{variant}`). Do not inline-fallback.

### Lint
Stylelint `color-no-hex` enabled in `apps/desktop/src/**/*.vue` and `packages/ui/src/**/*.vue`. Override file: `tokens.css`.

### Acceptance
- [ ] Stylelint passes with `color-no-hex` on the codebase
- [ ] `SessionTimelineView.vue` lines 96–97 (#161b22 / #30363d Primer leftovers) replaced with tokens
- [ ] `WizardStepWelcome.vue:58` inline gradient hexes replaced with `--gradient-accent`

---

## G7 · `text.micro` discipline (closes CC-10)

### Rule
**`text.micro`** (11/14 500 uppercase tracking 0.04em) is for **badges and status pills only**. Not section headings, not sidebar group labels.

### Replacement
- App sidebar section labels → `text.small` weight 500, mixed-case, `color: var(--text-tertiary)`.
- Settings panel titles → `text.h3` (14/20 600), mixed-case.
- Any "section divider label" → `text.small` 500 + 1px hairline above.

### Heading enforcement
Introduce `<Heading level="1|2|3">` in `packages/ui` that maps to the type-scale tokens. After it lands, lint against raw `<h1..h6>` in `apps/desktop/src/**/*.vue` (must use `<Heading>` so we can audit usage).

### Acceptance
- [ ] No `text-transform: uppercase` on elements that aren't pills/badges/`<kbd>`
- [ ] `<Heading>` is the only way to render section/page titles in `apps/desktop`

---

## G8 · Density & spacing

- Default density is **Comfortable** (32px row height). Compact (28px) is a per-view toggle, persisted via `localStorage` key `tracepilot:density:<viewId>`.
- Row padding: comfortable `0 12px`; compact `0 8px`.
- Spacing must come from the 4px grid: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56 · 80`. No 5/7/9/13/15/18/22.
- Stylelint `tracepilot/spacing-grid` rule rejects `margin`/`padding`/`gap` values not on the grid.

---

## G9 · Tabular numerals on numeric columns

Any column or cell that renders a number, count, duration, byte size, or percentage must enable `tnum`:
```css
.numeric { font-feature-settings: 'tnum' 1, 'cv11' 1, 'ss01' 1; }
```
This is on by default at `:root` in MASTER §3.2 — re-apply locally only if you're inside a parent that overrides `font-feature-settings`.

Charts: tick labels render in `--font-mono` (JetBrains Mono); legend / axis labels in `--font-sans` (Inter).

---

## G10 · Z-index discipline

Use only the tokens defined in MASTER §7:
```
--z-sidebar: 40
--z-header:  50
--z-fab:     55
--z-overlay: 60
--z-modal:   70
--z-tooltip: 80
```
No raw `z-index: 9999`. Stylelint `tracepilot/z-index-token-only` rejects numeric `z-index` outside of `tokens.css`.

---

## Hygiene PR — definition of done

Every checklist item from §G1–§G10 above passes, plus:

- [ ] `pnpm --filter @tracepilot/desktop typecheck` passes
- [ ] `pnpm --filter @tracepilot/ui typecheck` passes
- [ ] All Stylelint rules introduced here pass (`pnpm lint:css`)
- [ ] All ESLint/Biome rules introduced here pass
- [ ] Visual smoke test on **dark** and **light**: Session List, Session Detail (Conversation tab), Orchestration Home, Settings, Wizard
- [ ] No regression in `prefers-reduced-motion` — verify by toggling the OS setting
- [ ] Updated `CHANGELOG.md` under `Changed` and `Removed` (gradient tokens, decorative animations)

---

## How per-view specs reference this file

When a per-view spec says "see 00-globals §G2" it means the spec is **delegating** that concern to this file — the per-view spec will not re-state the rule, it will only note any view-specific exception (and exceptions are rare, and require justification).

If a future per-view spec needs to break a global rule, it must:
1. Cite the rule it's breaking (`G3`).
2. Justify why (one paragraph).
3. Define a scoped allow-list (file paths + selector) so the lint rule can ignore it surgically — not globally.

Such exceptions are reviewed at the same level as adding a new token: rare, considered, documented.
