# TracePilot design system

This is the reference for how TracePilot's UI looks and behaves today, and the
rules new UI follows. It describes the shipped app. Where the app still breaks a
rule, the gap is listed under [Known debt](#7-known-debt) instead of being
described as done.

- **Tokens:** [`packages/ui/src/styles/tokens.css`](../packages/ui/src/styles/tokens.css)
  is the only source of colour, radius, shadow, motion and z-index values. This
  file explains them; it never redefines them.
- **Components:** [components.md](components.md) covers the app chrome and the
  shared primitives in `@tracepilot/ui`.
- **Surfaces:** [surfaces.md](surfaces.md) has short notes for individual views.
- **Tool renderers:** [Adding tool renderers](../docs/design/adding-tool-renderers.md).

TracePilot is a desktop tool for reading and auditing AI agent sessions (GitHub
Copilot CLI and Claude Code). The audience is developers. The style is a calm,
dense, dark-first developer tool: layered neutral surfaces, 1px hairlines,
colour reserved for state and data, Lucide icons, and no marketing decoration.

---

## 1. Colour

All colours come from tokens. Dark is the default theme; light is set with
`:root[data-theme="light"]` and redefines the same names. Components never test
the theme themselves.

### Neutrals

| Token | Use |
|---|---|
| `--canvas-default` | App background |
| `--canvas-subtle` | Inline panels, active tab, subtle differentiation |
| `--canvas-inset` | Code blocks, terminal output, table wells |
| `--canvas-overlay` | Popovers, menus |
| `--canvas-raised` | Cards, modals |
| `--surface-secondary`, `--surface-tertiary` | Nested surfaces, hover and selected rows |
| `--border-subtle` < `--border-muted` < `--border-default` < `--border-emphasis` | Hairlines, from quietest to strongest. Inputs and cards use `--border-default`. |
| `--text-primary` · `--text-secondary` · `--text-tertiary` · `--text-placeholder` | Headings and primary copy · body and labels · metadata and timestamps · placeholders and disabled |
| `--text-link`, `--text-on-emphasis`, `--text-inverse` | Links · text on filled colour (buttons, badges) · dark text on light fills |

### Accent (indigo)

`--accent-fg` (text and icons), `--accent-emphasis` and `--accent-emphasis-hover`
(filled primary buttons), `--accent-muted` and `--accent-subtle` (tints),
`--border-accent`. Use the accent for primary actions, focus, active selection
and links only.

### State

Each state has `-fg`, `-emphasis`, `-muted` and `-subtle` forms.

| Family | Meaning |
|---|---|
| `--success-*` (emerald) | Passed, completed tool call, healthy |
| `--warning-*` (amber) | Slow, retried, soft failure |
| `--danger-*` (rose) | Error, failed tool call. Also the destructive button colour. |
| `--done-*` (violet) | Finished or closed, as opposed to passed |
| `--neutral-*` (zinc) | Cancelled, skipped, not applicable |
| `--attention-fg`, `--attention-subtle` (orange) | Notice-level emphasis, distinct from warning |

Outcome is always shown with state colours, never categorical ones, and never
by colour alone: pair it with an icon or a label.

### Source

`--claude-fg`, `--claude-emphasis`, `--claude-muted`, `--claude-subtle` and
`--claude-border` tint Claude Code sessions (source badges, the Claude session
card). Copilot sessions use the default accent.

### Categorical and chart colours

- `--agent-color-main`, `-explore`, `-general-purpose`, `-code-review`,
  `-rubber-duck` and `-task` colour agent lanes and badges. The mapping lives in
  `packages/ui/src/utils/agentTypes.ts`. Keep the same agent on the same colour
  in every view.
- `--chart-*` (success, danger, primary, secondary, warning, info, cyan,
  orange, lime, pink, plus `-light` variants) are the series colours. Charts read
  them through `packages/ui/src/utils/designTokens.ts`, whose fallbacks must
  match `tokens.css`.
- `--chart-tooltip-bg`, `--chart-tooltip-fg` and `--chart-active-emphasis`
  style chart tooltips and hover emphasis.
- `--syn-*` is the syntax-highlighting palette.

### Other colour tokens

`--state-hover-overlay` (hover wash), `--backdrop-color` (modal scrim),
`--border-glow`, `--shadow-glow-*` and the `--gradient-*` tokens. The gradient
and glow tokens are legacy; don't use them in new UI (see
[Known debt](#7-known-debt)).

---

## 2. Typography

| Role | Family | Token |
|---|---|---|
| UI, headings, body | Inter Variable, bundled via `@fontsource-variable/inter` | `--font-family` |
| IDs, paths, durations, code | JetBrains Mono, then the system monospace | `--font-mono` |

There are no type-scale tokens. The scale below is applied through components
(`Heading`, `PageHeader`, `EmptyState`, `StatusPill`) and plain CSS:

| Use | Size / line height | Weight |
|---|---|---|
| Empty-state and onboarding titles | 28 / 34 | 600 |
| Page title (`Heading` level 1, `PageHeader`) | 20 / 28 | 600 |
| Section heading (level 2) | 16 / 22 | 600 |
| Card or panel heading (level 3) | 14 / 20 | 600 |
| Sub-heading (level 4) | 13 / 18 | 600 |
| Body | 13 / 18 | 400 |
| Metadata, hints | 12 / 16 | 400 |
| Badges, status pills | 11 / 14, uppercase, 0.04em tracking | 500 |
| Mono values | 12 / 18 | 400 |

Rules:

- Use tabular numerals (`font-variant-numeric: tabular-nums`) for durations,
  counts, sizes, costs and percentages.
- Nothing above 20px outside empty states and onboarding.
- Only badge-sized text gets letter spacing.
- Keep prose under about 75 characters per line.

---

## 3. Shape, elevation and spacing

- **Radius:** `--radius-sm` 6px (pills, inputs), `--radius-md` 8px (buttons,
  cards), `--radius-lg` 10px, `--radius-xl` 12px (modals), `--radius-full`.
  Nothing rounder than 12px on data surfaces.
- **Elevation:** prefer a border and a tonal step over a shadow. Use
  `--shadow-sm|md|lg` only for things that float (menus, popovers, modals,
  toasts).
- **Spacing:** a 4px grid: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80.
  `pnpm check:spacing` reports off-grid values but doesn't fail.
- **Layout:** `--sidebar-width` (240px), `--sidebar-collapsed` (56px) and
  `--content-max-width` (1600px). The app is designed at 1440×960 and must work
  at 960×640 and 2560×1440.

---

## 4. Motion

- **Tokens:** `--duration-fast` 120ms (hover, focus, colour), `--duration-normal`
  180ms (tab switch, popover), `--duration-slow` 220ms (modal, drawer), with
  `--ease-out`. The older `--transition-fast|normal|slow` (100/180/280ms ease)
  are still widely used; prefer the duration tokens in new code.
- Animate `transform` and `opacity` only. Hover changes colour, background or
  border, never size or position.
- Honour `prefers-reduced-motion`: drop transforms and keep fades short.
- **First-appearance reveals:** `useFirstReveal` with `data-reveal` (styles in
  `apps/desktop/src/styles/animations.css`) may fade items in the first time
  they appear. Don't apply it to whole panels or repeat it on every refresh.
- Loading: skeletons that reserve the final layout for anything slow, spinners
  for short waits. No looping decoration on data views.
- The session list's `67` search easter egg is intentional. Keep it.

---

## 5. Icons, emoji and interaction

- **Icons:** Lucide only (`lucide-vue-next`), usually 16px inline and 20px in
  headers, coloured with `currentColor`. Icons picked by name (templates,
  presets) resolve through `packages/ui/src/icons/lucideRegistry.ts`.
- **Emoji:** never as UI icons. Emoji that users typed (template names, prompts)
  may render as data; wrap them in `UserContentEmoji` and mark the template with
  `<!-- design-system: allow-emoji -->`.
- **Focus:** every interactive element shows a 2px `--accent-fg` outline with a
  2px offset (`apps/desktop/src/styles/utilities.css`).
- **Glass:** no `backdrop-filter` on data or chrome. A floating surface is
  `--canvas-overlay` or `--canvas-raised` + `--border-default` + `--shadow-md`
  or `--shadow-lg`. A modal scrim is `--backdrop-color`.
- **Z-index:** only the `--z-*` tokens: `--z-sidebar` 40, `--z-header` and
  `--z-sticky` 50, `--z-fab` 55, `--z-overlay` 60, `--z-modal` 70,
  `--z-tooltip` 80. The literals `-1`, `0`, `1` and `auto` are fine for local
  stacking.
- **Keyboard:** register shortcuts through `useShortcut` so they appear in the
  `?` help overlay. Ctrl/Cmd+K opens the palette.
- **Accessibility:** icon-only buttons need `aria-label`; charts need a text or
  table alternative; dialogs trap focus and close on Esc.
- **Feedback:** confirm routine success inline; use toasts for async results
  and errors. Don't put primary information only in a tooltip.

---

## 6. Enforcement

`pnpm check:design-system` runs four scripts over `apps/desktop/src`. CI runs it
in the repository checks, and lefthook runs each one with `--staged` before a
commit.

| Script | Rule | Opt-out |
|---|---|---|
| `scripts/check-no-hex-colors.mjs` | No hex colours in `.vue`, `.css`, `.scss` | `design-system: allow-hex (reason)` on the line |
| `scripts/check-no-emoji-in-templates.mjs` | No emoji in `<template>` blocks | `<!-- design-system: allow-emoji -->` in the template, for user content only |
| `scripts/check-no-backdrop-filter.mjs` | No `backdrop-filter` | None |
| `scripts/check-z-index-tokens.mjs` | z-index from `--z-*` tokens | None |

Each script has an `ALLOW_FILES` list of files that broke the rule before it
existed. The lists only shrink: when a listed file is fixed, or moved, the full
check fails until its entry is removed. Never add a file to a list to get a new
change through.

The scripts don't scan `packages/ui` yet; shared components there follow the
same rules by review.

---

## 7. Known debt

These rules are not fully met yet. Fix them when you are already working on the
surface; don't open a redesign for them.

| Gap | Find it |
|---|---|
| Glass on toolbars and overlays | the `ALLOW_FILES` list in `scripts/check-no-backdrop-filter.mjs` |
| Gradient fills (`--gradient-*`, `linear-gradient`) on cards and stat tiles | `rg -l "linear-gradient\|var\(--gradient" apps/desktop/src` |
| Hover lift (`translateY`) on cards | `rg "translateY\(-" apps/desktop/src` |
| Oversized titles (28px and up) outside empty states | Orchestration home stats, export and config injector styles |
| Decorative looping animation (orchestration fade-in, wizard pulse) | `rg "@keyframes" apps/desktop/src` |
| Emoji in templates and data files | the `ALLOW_FILES` list in `scripts/check-no-emoji-in-templates.mjs`; export presets in `useExportConfig.ts` |
| Raw `<h1>`–`<h3>` and uppercase micro section titles instead of `Heading` | Settings panels, launcher, sidebar section titles |
| `StatCard` (gradient tiles) instead of the `KPI` and `KPIRow` primitives | `rg -l "<StatCard" apps/desktop/src` |
| Hand-rolled split panes and modal overlays | skill and agent editors, skills manager's new-skill modal |
| Raw z-index values | the `ALLOW_FILES` list in `scripts/check-z-index-tokens.mjs` |

Proposed primitives that were never built, and don't exist: `DataGrid`,
`SplitPane`, `EntityCard`, `ToolbarRow`, `TokenBudgetBar`. Don't reference them
as if they exist. Build one only when a change needs it, and document it in
[components.md](components.md) when you do.
