# TracePilot — Design System (MASTER)

> **Global Source of Truth.** Page-specific overrides live in `design-system/pages/<page>.md` and take precedence over this file. If no page file exists, follow this Master exclusively.

TracePilot is a desktop observability and insight tool for Copilot CLI sessions. It traces tool calls, token usage, latency, errors, and session timelines for a technical audience: developers, DevOps engineers, and power users of agentic AI tools.

The design language is a **precision developer tool**: a cross between Linear's calm geometry, Warp's modern terminal identity, and the data-density discipline of Grafana Cloud / Datadog — desktop-native, keyboard-first, no marketing gloss.

---

## 1. Recommended UI Style

**Style:** *Functional Minimalism with Engineered Density* (a.k.a. "Pro Tool Dark").

| Trait | Direction |
|---|---|
| Surface model | Layered dark surfaces (1–4 elevations), thin 1px hairlines, near-zero shadow |
| Geometry | 4px grid, 6px / 8px corner radii, sharp 1px dividers |
| Density | **Default: Comfortable (32px rows)** with Compact toggle (28px rows). Never < 24px |
| Typography | Single sans for UI, monospace for IDs/values/code/timing |
| Color | Mostly neutral; color is reserved for **state** (pass/warn/fail/info) and **categorical traces** |
| Motion | 120–200ms ease-out; transform/opacity only; everything skippable |
| Iconography | **Lucide** (sole icon set), 1.5px stroke, 16px / 20px — never emoji |
| Chrome | Quiet. Signal goes to data, not decoration |

### Rationale
- **Linear's precision** → strict grid, hairlines, restrained palette, monospace anchors keep numeric data legible.
- **Warp's modern identity** → confident dark canvas with one electric accent (cyan/blue) and a terminal-grade mono.
- **Grafana / Datadog discipline** → semantic state colors, categorical palettes for traces/spans, dense tables that stay readable at 1440px and scale to 4K.
- **Desktop-native** → respects native focus rings, drag regions, menus, and keyboard navigation; avoids web-marketing patterns (oversized hero text, gradients-as-fill, decorative emoji).

---

## 2. Color Palette

All values target **WCAG AA (4.5:1)** for text on their stated background. The system is dark-first; a light mode is defined for parity.

**Source of truth:** `packages/ui/src/styles/tokens.css`. MASTER documents intent and discipline; code reads from the canonical token file. Token names below match that file exactly — do not introduce parallel names.

### 2.1 Neutrals — Canvas, Surfaces, Borders, Text

A neutral zinc ramp. Backgrounds step up by ~3% lightness per elevation. Borders are alpha-on-white (dark) / alpha-on-black (light) so they tonally blend instead of looking painted on.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--canvas-default`  | `#09090B` | `#FFFFFF` | App background, behind everything |
| `--canvas-subtle`   | `#111113` | `#F4F4F5` | Inline panels, subtle differentiation |
| `--canvas-inset`    | `#0A0A0C` | `#FAFAFA` | Code blocks, terminal panes, table well |
| `--canvas-overlay`  | `#18181B` | `#FFFFFF` | Popovers, menus |
| `--canvas-raised`   | `#1C1C1F` | `#FFFFFF` | Cards, modals, raised surfaces |
| `--surface-secondary` | `#1C1C1F` | `#E4E4E7` | Secondary surface (`= --canvas-raised` dark) |
| `--surface-tertiary`  | `#27272A` | `#D4D4D8` | Hover, selected row, nested chip |
| `--border-subtle`   | `rgba(255,255,255,.04)` | `rgba(0,0,0,.04)` | Default 1px hairlines |
| `--border-muted`    | `rgba(255,255,255,.06)` | `rgba(0,0,0,.06)` | Less-prominent dividers |
| `--border-default`  | `rgba(255,255,255,.10)` | `rgba(0,0,0,.10)` | Inputs, cards on canvas |
| `--border-emphasis` | `rgba(255,255,255,.20)` | `rgba(0,0,0,.20)` | Focus-adjacent, dense table dividers |
| `--text-primary`    | `#FAFAFA` | `#18181B` | Headings, primary copy |
| `--text-secondary`  | `#A1A1AA` | `#52525B` | Body, labels |
| `--text-tertiary`   | `#71717A` | `#71717A` | Hints, timestamps, metadata |
| `--text-placeholder`| `#52525B` | `#A1A1AA` | Input placeholders, disabled |
| `--text-link`       | `#818CF8` | `#6366F1` | Hyperlinks |

### 2.2 Accent — Indigo

One electric accent. Used sparingly: primary actions, focus rings, active selection, hyperlinks, and the categorical[0] data series.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--accent-fg`            | `#818CF8` | `#6366F1` | Accent text/icon on canvas, active tab |
| `--accent-emphasis`      | `#6366F1` | `#4F46E5` | Primary buttons, focus ring, selected mark |
| `--accent-emphasis-hover`| `#4F46E5` | `#4338CA` | Hover/press of `accent-emphasis` |
| `--accent-muted`         | `rgba(99,102,241,.25)` | `rgba(99,102,241,.15)` | Pressed bg, focus halo |
| `--accent-subtle`        | `rgba(99,102,241,.10)` | `rgba(99,102,241,.06)` | Selected row tint, soft chip |
| `--border-accent`        | `rgba(99,102,241,.50)` | `rgba(99,102,241,.40)` | Accent border on inputs/cards |

> **On-accent text** uses `--text-on-emphasis` (`rgba(255,255,255,.95)`) — the same in both modes for high contrast on colored emphasis backgrounds.

### 2.3 Semantic / State

Used consistently across status pills, log severities, span outcomes, and chart series. Each color has a `-fg` (text/icon), `-emphasis` (filled), `-muted` (alpha .25), and `-subtle` (alpha .10) form.

| Concept | `-fg` (dark) | `-emphasis` (dark) | Meaning |
|---|---|---|---|
| `--success-*` (emerald) | `#34D399` | `#10B981` | Pass, completed tool call, healthy |
| `--warning-*` (amber)   | `#FBBF24` | `#F59E0B` | Slow span, retry, soft-failure |
| `--danger-*` (rose)     | `#FB7185` | `#F43F5E` | Error, failed tool call, exception |
| `--done-*` (violet)     | `#A78BFA` | `#8B5CF6` | Completed/closed (distinct from success: terminal state, not pass/fail) |
| `--neutral-*` (zinc)    | `#A1A1AA` | `#71717A` | Cancelled, skipped, n/a |
| `--attention-*` (orange)| `#FB923C` | `#FB923C` | Notice-level emphasis (distinct from warning amber) |

Light mode uses deeper variants (`--success-fg: #059669`, `--warning-fg: #D97706`, `--danger-fg: #E11D48`) — see `tokens.css` for exact values.

### 2.4 Categorical — Agents, Lanes, Series

Eight stable colors for swimlanes, span types, token sources, and chart series. Order is deliberate — pick by index. The first six map to existing agent identities and **must not be reassigned**.

| # | Token | Hex | Bound to |
|---|---|---|---|
| 0 | `--agent-color-main`            | `#6366F1` | Main agent (= accent) |
| 1 | `--agent-color-explore`         | `#22D3EE` | Explore subagent |
| 2 | `--agent-color-general-purpose` | `#A78BFA` | General-purpose subagent |
| 3 | `--agent-color-code-review`     | `#F472B6` | Code-review subagent |
| 4 | `--agent-color-rubber-duck`     | `#FDE047` | Rubber-duck subagent |
| 5 | `--agent-color-task`            | `#FBBF24` | Task subagent |
| 6 | `--chart-info`                  | `#38BDF8` | Generic info series |
| 7 | `--chart-lime`                  | `#84CC16` | Generic lime series |

> Outcome (pass/warn/fail) **always** uses semantic state — never categorical. Latency / duration uses a sequential ramp `--chart-primary` → `--chart-secondary` (indigo → violet).

### 2.5 Destructive

Use the rose ramp; do not introduce a separate destructive token.

| Action | Tokens |
|---|---|
| Destructive button bg | `--danger-emphasis` (`#F43F5E`) |
| Destructive button bg-hover | derived: `color-mix(in oklab, var(--danger-emphasis), black 8%)` |
| Destructive button fg | `--text-on-emphasis` (`rgba(255,255,255,.95)`) |
| Destructive banner | `--danger-subtle` bg + `--danger-fg` text + `--danger-muted` border |

---

## 3. Typography

A single workhorse sans for UI and a precision monospace for data.

### 3.1 Pairing

| Role | Family | Source |
|---|---|---|
| UI / Headings / Body | **Inter** | Google Fonts |
| Mono / Data / Code / IDs | **JetBrains Mono** | Google Fonts |

Both ship with the `tnum` (tabular numerals) feature — **always enable** for any numeric column, timer, or counter.

### 3.2 Google Fonts Import

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

:root {
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  font-feature-settings: 'cv11', 'ss01', 'tnum';
}
```

> Share link: <https://fonts.google.com/share?selection.family=Inter:wght@400;500;600;700|JetBrains+Mono:wght@400;500;600>

### 3.3 Type Scale

Compact, desktop-tuned. Body floors at 13px (UI chrome) / 14px (reading content).

| Token | Size / Line | Weight | Usage |
|---|---|---|---|
| `text.display` | 28 / 34 | 600 | Empty-state titles, onboarding only |
| `text.h1`      | 20 / 28 | 600 | Page title |
| `text.h2`      | 16 / 22 | 600 | Section heading |
| `text.h3`      | 14 / 20 | 600 | Card / panel heading |
| `text.body`    | 13 / 18 | 400 | Default UI text |
| `text.body-strong` | 13 / 18 | 500 | Inline emphasis, labels |
| `text.small`   | 12 / 16 | 400 | Metadata, hints |
| `text.micro`   | 11 / 14 | 500 | Badges, status pills (uppercase, tracking 0.04em) |
| `text.mono`    | 12 / 18 | 400 | IDs, durations, hashes, paths |
| `text.code`    | 13 / 20 | 400 | Code blocks, terminal output |

**Rules**
- Tabular numerals on every duration, count, byte size, percentage.
- Never letter-space body text. Only `micro` may use tracking.
- Line length for prose ≤ 75ch. Tables/log lines may exceed.

---

## 4. Effects & Motion

### 4.1 Elevation

Dark UI prefers **borders + tonal shifts** over shadows. Use shadow only for true overlays.

| Token | Value | Use |
|---|---|---|
| `elev.0` | none | Inline surfaces |
| `elev.1` | `0 0 0 1px var(--border-subtle)` | Cards, inputs |
| `elev.2` | `0 1px 0 0 rgba(0,0,0,.4), 0 0 0 1px var(--border-default)` | Sticky headers, raised rows |
| `elev.3` | `0 8px 24px rgba(0,0,0,.45), 0 0 0 1px var(--border-default)` | Popovers, menus |
| `elev.4` | `0 24px 64px rgba(0,0,0,.55), 0 0 0 1px var(--border-default)` | Modals, command palette |

### 4.2 Radius

| Token | Value | Use |
|---|---|---|
| `radius.sm` | 4px  | Pills, badges, inputs |
| `radius.md` | 6px  | Buttons, cards, panels |
| `radius.lg` | 10px | Modals, command palette |
| `radius.full` | 9999px | Avatars, status dots |

### 4.3 Spacing (4px grid)

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56 · 80`. No 5/7/9/13/15. Density toggle scales row padding ±2px.

### 4.4 Motion Principles

- **Duration:** micro 120ms · standard 180ms · large/overlays 220ms. Nothing > 240ms in the main app.
- **Easing:** `cubic-bezier(0.2, 0.6, 0.2, 1)` (ease-out, calm). Use linear only for indeterminate progress.
- **Properties:** animate `transform` and `opacity` only — never `width/height/top/left` (causes layout thrash on dense tables).
- **State changes:** color/border transitions 120ms. Selection/hover never causes layout shift.
- **Skeletons** for any async > 200ms; spinners for > 600ms; reserve space to prevent content jumping.
- **`prefers-reduced-motion`:** disable transforms, keep instant cross-fade ≤ 80ms.
- **Keyboard:** focus ring is 2px `accent.primary` with 2px offset; visible on every interactive element.
- **Sound:** none.

### 4.5 Data Visualization Defaults

- Categorical series use `cat.*` in order; reuse the same index for the same trace across views.
- Latency / duration uses a sequential ramp (cyan → violet → pink) to encode magnitude.
- Outcome (pass/warn/fail) always uses `state.*` — never categorical.
- Grids: `border.subtle`, 1px, 50% opacity. Axis labels: `text.muted`, 11px, mono.
- Chart fonts: JetBrains Mono for ticks, Inter for labels/legends.

---

## 5. Anti-Patterns to Explicitly Avoid

- ❌ **Emoji as icons** (🚀 ⚙️ 📊). Use Lucide SVG, 1.5px stroke, single set.
- ❌ **Marketing gradients** as primary surface fill (purple→pink hero washes). One subtle radial accent is the limit.
- ❌ **Glassmorphism / heavy blur** on data surfaces — kills text contrast on dense tables.
- ❌ **Drop-shadow stacks on every card.** Hairlines + tonal elevation only.
- ❌ **Rounded-2xl everywhere** (`16px+` radii on data tables/rows). Looks consumer-app, not tool.
- ❌ **Color-only state.** Always pair color with an icon or label (color-blind safety).
- ❌ **Proportional digits** in tables, timers, token counts. Always `tnum`.
- ❌ **Animation on hover that shifts layout** (`scale`, margin changes in rows). Use background/border/color only.
- ❌ **Long animations** (> 240ms) on routine UI; never auto-playing decorative motion.
- ❌ **Hero-style typography** (32px+ display) outside empty states / onboarding.
- ❌ **More than 3 fonts.** Inter + JetBrains Mono only.
- ❌ **Mixing icon sets** (Heroicons + Lucide + custom). Pick Lucide; stay there.
- ❌ **Rainbow log levels.** Severity uses `state.*` exclusively.
- ❌ **Light-on-light or `bg-white/10` "glass"** in light mode — invisible borders.
- ❌ **Scroll-jacking, parallax, snap-scroll** in the desktop app.
- ❌ **Toast spam** for routine success. Use inline confirmation; reserve toasts for async/error.
- ❌ **Tooltips for primary information.** If it matters, show it in the row.
- ❌ **Centered body text** in panels. Left-align everything except numeric columns (right-align).

---

## 6. Pre-Delivery Checklist

Run through this before any UI is considered "done."

### Visual & Identity
- [ ] Only Inter + JetBrains Mono — no third family
- [ ] Lucide icons only, 16px or 20px, 1.5px stroke
- [ ] No emoji used as UI iconography
- [ ] Brand accent (`#3DB8FF`) appears only on primary action / focus / active selection
- [ ] Tabular numerals enabled on every numeric column, timer, counter
- [ ] All radii from `{4, 6, 10, 9999}`; spacing on 4px grid
- [ ] No drop shadows on inline surfaces; shadow only on `elev.3+` overlays

### Color & Contrast
- [ ] Body text ≥ 4.5:1 contrast against its surface (both modes)
- [ ] State color always paired with icon or text label (not color-only)
- [ ] Categorical series follow `cat.*` order and are stable across views
- [ ] Light mode tested: borders visible, no `bg-white/10` ghosts
- [ ] Disabled state visibly distinct from muted/secondary

### Interaction
- [ ] Every clickable surface has `cursor: pointer` and a hover state (color/border, not transform)
- [ ] Every interactive element has a visible 2px focus ring with 2px offset
- [ ] Tab order matches visual order; arrow-key nav in lists/tables
- [ ] Keyboard shortcut surfaced via `kbd` chip near affordance
- [ ] Command palette opens on `Cmd/Ctrl+K`
- [ ] Buttons disable + show inline spinner during async; never double-fire

### Motion
- [ ] Transitions 120–220ms, ease-out, on transform/opacity only
- [ ] No layout-shifting hover (no `scale` on table rows)
- [ ] `prefers-reduced-motion` respected — transforms removed, fades ≤ 80ms
- [ ] Skeletons reserve final layout dimensions (no content jump)

### Data Density
- [ ] Tables readable at 1280px with all critical columns visible
- [ ] Compact / Comfortable density toggle persists per view
- [ ] Long IDs / paths use mono + middle-truncation with copy affordance
- [ ] Empty states explain *why* and offer the next action
- [ ] Error states show error + likely cause + actionable recovery

### Accessibility
- [ ] All icon-only buttons have `aria-label`
- [ ] Form inputs use `<label for>`; errors announced via `aria-live`
- [ ] Focus is never trapped except in modals (with explicit Esc dismissal)
- [ ] No information conveyed by color alone
- [ ] Charts have an accessible table fallback or `aria-describedby` summary

### Desktop Polish
- [ ] Native window controls respected; custom title bar (if any) preserves drag region
- [ ] Right-click context menus on rows where actions exist
- [ ] Resizable panels remember width across sessions
- [ ] Selection state survives sort / filter / scroll
- [ ] Renders cleanly at 1× and 2× DPI; no half-pixel hairlines

---

## 7. Quick Reference (canonical token names)

These are the tokens defined in `packages/ui/src/styles/tokens.css`. **Always import that file at the top of the cascade and reference these CSS variables** — do not redefine values inline.

```css
@import "@tracepilot/ui/tokens.css";

/* Canonical names you will use most: */
/* Canvas / surfaces */
--canvas-default; --canvas-subtle; --canvas-inset; --canvas-overlay; --canvas-raised;
--surface-secondary; --surface-tertiary;

/* Borders */
--border-subtle; --border-muted; --border-default; --border-emphasis; --border-accent;

/* Text */
--text-primary; --text-secondary; --text-tertiary; --text-placeholder;
--text-link; --text-on-emphasis;

/* Accent (Indigo) */
--accent-fg; --accent-emphasis; --accent-emphasis-hover;
--accent-muted; --accent-subtle;

/* State (each has -fg, -emphasis, -muted, -subtle) */
--success-*;  /* emerald */
--warning-*;  /* amber */
--danger-*;   /* rose */
--done-*;     /* violet — terminal/closed, not pass */
--neutral-*;  /* zinc */
--attention-* /* orange — notice */

/* Categorical (agents) */
--agent-color-main; --agent-color-explore; --agent-color-general-purpose;
--agent-color-code-review; --agent-color-rubber-duck; --agent-color-task;

/* Chart palette (use after agents are exhausted) */
--chart-success; --chart-danger; --chart-primary; --chart-secondary;
--chart-warning; --chart-info; --chart-cyan; --chart-orange; --chart-lime;

/* Radius */
--radius-sm: 6px; --radius-md: 8px; --radius-lg: 10px; --radius-xl: 12px; --radius-full;

/* Transitions */
--transition-fast: 100ms ease;     /* prefer cubic-bezier(0.2,0.6,0.2,1) for new code */
--transition-normal: 180ms ease;
--transition-slow: 280ms ease;

/* Shadows (use sparingly — overlays only) */
--shadow-sm; --shadow-md; --shadow-lg;
--shadow-glow-accent; --shadow-glow-success;

/* Z-index scale */
--z-sidebar: 40; --z-header: 50; --z-fab: 55;
--z-overlay: 60; --z-modal: 70; --z-tooltip: 80;
```

> If a token you need does not exist, **add it to `packages/ui/src/styles/tokens.css`** and reference it. Never inline a hex in a component stylesheet.

---

*This Master is the contract for every TracePilot screen. Deviations belong in `design-system/pages/<page>.md` with a one-line rationale.*
