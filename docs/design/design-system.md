# TracePilot Design System — Variant C

> A modern, dark-first design language for the TracePilot desktop application.
> Hybrid of Linear/Raycast visual polish with GitHub Primer information density.

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Color Tokens](#color-tokens)
3. [Typography](#typography)
4. [Component Classes](#component-classes)
5. [Spacing & Layout](#spacing--layout)
6. [Responsive Breakpoints](#responsive-breakpoints)
7. [Theme Support](#theme-support)
8. [Accessibility](#accessibility)

---

## Design Philosophy

TracePilot's **Variant C** design system combines two inspirations:

- **Linear/Raycast polish** — Indigo accent, Inter font, gradient effects, translateY hover micro-animations
- **GitHub Primer density** — Generous pill badges, comfortable spacing, strong semantic color mapping

The result is a design that feels premium and modern while maintaining the information density needed for a developer inspection tool.

### Principles

- **Dark-first** — Optimized for dark theme (developer preference), with full light theme support
- **Information density** — Show meaningful data without clutter
- **Progressive disclosure** — Glance (session card) → Scan (detail tabs) → Commit (raw events)
- **Familiar patterns** — Cards, tables, badges, and navigation developers already know

### Source Files

- **Production CSS:** `apps/desktop/src/styles.css`
- **Design reference:** `docs/design/prototypes/shared/design-system-c.css`

---

## Color Tokens

All colors are defined as CSS custom properties on `:root` and overridden via `[data-theme="light"]`.

### Canvas (Backgrounds)

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--canvas-default` | `#09090b` | `#ffffff` | Page background |
| `--canvas-subtle` | `#111113` | `#f4f4f5` | Card/panel backgrounds |
| `--canvas-inset` | `#0a0a0c` | `#fafafa` | Inset areas, code blocks |
| `--canvas-overlay` | `#18181b` | `#ffffff` | Modals, dropdowns |
| `--canvas-raised` | `#1c1c1f` | `#ffffff` | Elevated surfaces |

### Text

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--text-primary` | `#fafafa` | `#18181b` | Primary content |
| `--text-secondary` | `#a1a1aa` | `#52525b` | Secondary info, labels |
| `--text-tertiary` | `#71717a` | `#71717a` | Muted text, placeholders |
| `--text-placeholder` | `#52525b` | `#a1a1aa` | Input placeholders |
| `--text-link` | `#818cf8` | `#6366f1` | Links |
| `--text-inverse` | `#09090b` | `#fafafa` | Text on colored backgrounds |

### Borders

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--border-default` | `rgba(255,255,255,0.10)` | `rgba(0,0,0,0.10)` | Card/panel borders |
| `--border-muted` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.06)` | Subtle separators |
| `--border-subtle` | `rgba(255,255,255,0.04)` | `rgba(0,0,0,0.04)` | Very subtle dividers |
| `--border-accent` | `rgba(99,102,241,0.5)` | `rgba(99,102,241,0.4)` | Focus/active borders |
| `--border-glow` | `rgba(99,102,241,0.15)` | `rgba(99,102,241,0.10)` | Hover glow effect |

### Semantic Colors

Each semantic palette has four tokens: `-fg` (text), `-emphasis` (strong fill), `-muted` (background), `-subtle` (very faint).

#### Accent (Indigo) — Primary brand, repo badges, links

| Token | Dark | Light |
|-------|------|-------|
| `--accent-fg` | `#818cf8` | `#6366f1` |
| `--accent-emphasis` | `#6366f1` | `#4f46e5` |
| `--accent-muted` | `rgba(99,102,241,0.25)` | `rgba(99,102,241,0.15)` |
| `--accent-subtle` | `rgba(99,102,241,0.10)` | `rgba(99,102,241,0.06)` |

#### Success (Emerald) — Branches, completion, progress

| Token | Dark | Light |
|-------|------|-------|
| `--success-fg` | `#34d399` | `#059669` |
| `--success-emphasis` | `#10b981` | `#047857` |
| `--success-muted` | `rgba(16,185,129,0.25)` | `rgba(16,185,129,0.15)` |
| `--success-subtle` | `rgba(16,185,129,0.10)` | `rgba(16,185,129,0.06)` |

#### Warning (Amber) — Costs, caution, premium requests

| Token | Dark | Light |
|-------|------|-------|
| `--warning-fg` | `#fbbf24` | `#d97706` |
| `--warning-emphasis` | `#f59e0b` | `#b45309` |
| `--warning-muted` | `rgba(245,158,11,0.25)` | `rgba(245,158,11,0.15)` |
| `--warning-subtle` | `rgba(245,158,11,0.10)` | `rgba(245,158,11,0.06)` |

#### Danger (Rose) — Errors, failures, critical flags

| Token | Dark | Light |
|-------|------|-------|
| `--danger-fg` | `#fb7185` | `#e11d48` |
| `--danger-emphasis` | `#f43f5e` | `#be123c` |
| `--danger-muted` | `rgba(244,63,94,0.25)` | `rgba(244,63,94,0.15)` |
| `--danger-subtle` | `rgba(244,63,94,0.10)` | `rgba(244,63,94,0.06)` |

#### Done (Violet) — Model names, completed states

| Token | Dark | Light |
|-------|------|-------|
| `--done-fg` | `#a78bfa` | `#7c3aed` |
| `--done-emphasis` | `#8b5cf6` | `#6d28d9` |
| `--done-muted` | `rgba(139,92,246,0.25)` | `rgba(139,92,246,0.15)` |
| `--done-subtle` | `rgba(139,92,246,0.10)` | `rgba(139,92,246,0.06)` |

#### Neutral — Host type badges, misc labels

| Token | Dark | Light |
|-------|------|-------|
| `--neutral-fg` | `#a1a1aa` | `#52525b` |
| `--neutral-emphasis` | `#71717a` | `#3f3f46` |
| `--neutral-muted` | `rgba(113,113,122,0.25)` | `rgba(113,113,122,0.15)` |
| `--neutral-subtle` | `rgba(113,113,122,0.10)` | `rgba(113,113,122,0.06)` |

### Shadows & Glows

| Token | Value |
|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.3)` |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.4)` |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,0.5)` |
| `--shadow-glow-accent` | `0 0 20px rgba(99,102,241,0.15)` |
| `--shadow-glow-success` | `0 0 20px rgba(16,185,129,0.15)` |

### Gradients

| Token | Value |
|-------|-------|
| `--gradient-accent` | `linear-gradient(135deg, #6366f1, #8b5cf6)` |
| `--gradient-card` | `linear-gradient(145deg, var(--canvas-subtle), var(--canvas-default))` |
| `--gradient-surface` | `linear-gradient(180deg, var(--canvas-subtle) 0%, var(--canvas-default) 100%)` |

---

## Typography

### Font Stack

```css
--font-family: 'Inter Variable', -apple-system, BlinkMacSystemFont, sans-serif;
```

Inter is bundled locally (no CDN dependency). Monospace code uses JetBrains Mono with Fira Code fallback.

### Type Scale

| Class | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| `.text-display` | 1.5rem (24px) | 600 | 1.3 | Page titles |
| `.text-title-lg` | 1.125rem (18px) | 600 | 1.4 | Section headings |
| `.text-title-md` | 0.9375rem (15px) | 600 | 1.4 | Card titles, sub-headings |
| `.text-title-sm` | 0.8125rem (13px) | 600 | 1.4 | Minor headings |
| `.text-body` | 0.8125rem (13px) | 400 | 1.55 | Default body text |
| `.text-body-sm` | 0.75rem (12px) | 400 | 1.5 | Secondary info, timestamps |
| `.text-caption` | 0.6875rem (11px) | 500 | 1.4 | Badges, labels, counters |

### Letter Spacing

Variant C uses `-0.02em` letter-spacing globally — relaxed from Linear's -0.03em, tighter than Primer's 0.

---

## Component Classes

### Cards & Containers

| Class | Description |
|-------|-------------|
| `.card` | Base card — `--canvas-subtle` bg, `--border-default` border, `--radius-md` corners |
| `.card-interactive` | Extends `.card` with hover: `translateY(-1px)`, accent border glow |
| `.section-panel` | Bordered content section with optional `.section-panel-header` |
| `.chart-container` | Min-height 220px container for SVG/canvas charts |

### Badges

| Class | Color | Usage |
|-------|-------|-------|
| `.badge` | Base style | 0.6875rem font, 2px 8px padding, `--radius-full` |
| `.badge-accent` | Indigo | Repo names |
| `.badge-success` | Emerald | Branch names |
| `.badge-done` | Violet | Model names |
| `.badge-neutral` | Gray | Host type, misc |
| `.badge-warning` | Amber | Costs, premium |
| `.badge-danger` | Rose | Errors, failures |

Event badges (`.event-badge`) use a smaller 0.625rem size with prefix-based coloring:

| Class | Color | Prefix |
|-------|-------|--------|
| `.event-session` | Indigo | `session.*` events |
| `.event-user` | Emerald | `user.*` events |
| `.event-assistant` | Violet | `assistant.*` events |
| `.event-tool` | Amber | `tool.*` events |
| `.event-context` | Gray | `context.*` events |
| `.event-subagent` | Rose | `subagent.*` events |

### Stat Cards

| Class | Description |
|-------|-------------|
| `.stat-card` | Compact metric display with 14px padding |
| `.stat-card-value` | Large number — 1.5rem, weight 700 |
| `.stat-card-value.accent` | Indigo value |
| `.stat-card-value.success` | Emerald value |
| `.stat-card-value.warning` | Amber value |
| `.stat-card-value.danger` | Rose value |
| `.stat-card-value.done` | Violet value |
| `.stat-card-label` | 0.6875rem label, tertiary text |
| `.stat-card-trend` | Optional trend indicator (`.up` green, `.down` red) |

### Data Table

| Class | Description |
|-------|-------------|
| `.data-table` | Full-width table with `border-collapse: separate` |
| `.data-table th` | Sticky header, 0.6875rem uppercase, tertiary text |
| `.data-table td` | 9px 14px padding, `--border-muted` separators |
| `.data-table tbody tr:hover` | Subtle row highlight |

### Progress

| Class | Description |
|-------|-------------|
| `.progress-bar` | 6px height track |
| `.progress-bar-fill` | Accent gradient fill, animatable width |

### Buttons

| Class | Description |
|-------|-------------|
| `.btn` | Base button — 6px padding, 1px border |
| `.btn-primary` | Accent gradient fill, inverse text |
| `.btn-ghost` | Transparent, subtle hover |
| `.btn-sm` | Compact 4px padding variant |
| `.btn-group` | Horizontal button group with `.btn.active` state |
| `.transport-btn` | Media playback transport controls |

### Forms

| Class | Description |
|-------|-------------|
| `.form-group` | Label + input wrapper, 16px bottom margin |
| `.form-label` | 0.75rem, weight 500, tertiary text |
| `.form-input` | 7px padding, accent focus ring |
| `.form-switch` | 36×20px toggle switch, `.on` for active state |
| `.filter-select` | Custom-styled `<select>` for toolbar filters |
| `.search-container` | Search bar with `.search-icon`, `.search-input`, `.search-shortcut` |

### Conversation

| Class | Description |
|-------|-------------|
| `.turn-group` | Conversation turn container, 16px gap |
| `.turn-item` | Single turn wrapper |
| `.turn-avatar.user` | Success-colored user avatar |
| `.turn-avatar.assistant` | Done-colored assistant avatar |
| `.turn-bubble.user` | Canvas-subtle background |
| `.turn-bubble.assistant` | Canvas-inset background |
| `.role-badge` / `.role-badge-sm` | User/assistant/tool role indicators |

### Tool Calls

| Class | Description |
|-------|-------------|
| `.tool-calls-container` | Bordered container for tool call list |
| `.tool-call-header` | Clickable header (cursor: pointer) |
| `.tool-call-item` | Individual tool call row |
| `.tool-call-status.success` | Green checkmark |
| `.tool-call-status.failed` | Red X mark |
| `.tool-call-duration` | 0.625rem, tabular-nums for alignment |

### Data Visualization

| Class | Description |
|-------|-------------|
| `.token-bar` | Horizontal bar chart for token distribution |
| `.timeline-scrubber` | Playback timeline with `.timeline-track`, `.timeline-progress`, `.timeline-thumb` |
| `.swimlane` | Horizontal swimlane with `.swimlane-label`, `.swimlane-track`, `.swimlane-bar` |
| `.diff-panel` / `.diff-side` | Side-by-side comparison layout |

### Navigation

| Class | Description |
|-------|-------------|
| `.sidebar` | 240px fixed sidebar, collapses at 900px |
| `.sidebar-nav-item` | Nav link, `.active` shows accent left border + highlight |
| `.sidebar-nav-badge` | Count badge on nav items |
| `.breadcrumb` | Path breadcrumb with `.breadcrumb-sep`, `.breadcrumb-current` |
| `.tab-nav` | Tab bar with `.tab-nav-item`, `.tab-count` badges |

### Utility Classes

| Class | Description |
|-------|-------------|
| `.grid-2` / `.grid-3` / `.grid-4` | Fixed-column grids, 14px gap |
| `.grid-cards` | Auto-fill responsive grid, `minmax(300px, 1fr)` |
| `.flex` / `.flex-col` | Flexbox helpers |
| `.gap-1` … `.gap-8` | Gap scale: 4px to 28px |
| `.truncate` | Single-line text overflow ellipsis |
| `.skeleton` | Pulsing loading placeholder |
| `.fade-in` | 0.2s fadeIn animation |
| `.gradient-value` | Gradient background-clip text effect |

---

## Spacing & Layout

### Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| `gap-1` | 4px | Between related inline items |
| `gap-2` | 8px | Between badges, small items |
| `gap-3` | 12px | Between card sections |
| `gap-4` | 16px | Between cards, standard section gap |
| `gap-6` | 24px | Between major sections |
| `gap-8` | 28px | Between page regions |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 6px | Buttons, small elements |
| `--radius-md` | 8px | Cards, panels |
| `--radius-lg` | 10px | Large containers |
| `--radius-xl` | 12px | Modals, overlays |
| `--radius-full` | 9999px | Pill badges |

### Layout Structure

| Token | Value |
|-------|-------|
| `--sidebar-width` | 240px |
| `--sidebar-collapsed` | 56px |
| `--content-max-width` | 1200px |

```
┌──────────────────────────────────────────────────┐
│ (no fixed header — sidebar-only navigation)      │
├─────────┬────────────────────────────────────────┤
│ Sidebar │ Main Content Area                      │
│ (240px) │                                        │
│         │  max-width: 1200px, centered           │
│ ≡ Nav   │  padding: 24px                         │
│         │                                        │
└─────────┴────────────────────────────────────────┘
```

### Transitions

| Token | Value | Usage |
|-------|-------|-------|
| `--transition-fast` | 100ms ease | Hover states, micro-interactions |
| `--transition-normal` | 180ms ease | Panels, tab switches |
| `--transition-slow` | 280ms ease | Page transitions, overlays |

### Z-Index Stack

| Token | Value | Usage |
|-------|-------|-------|
| `--z-sidebar` | 40 | Sidebar navigation |
| `--z-header` | 50 | Fixed header (if present) |
| `--z-overlay` | 60 | Backdrop overlays |
| `--z-modal` | 70 | Modal dialogs |
| `--z-tooltip` | 80 | Tooltips, popovers |

---

## Responsive Breakpoints

Two breakpoints control layout adaptation:

### ≤ 1200px (Tablet / Medium)

- `.grid-4` → 2 columns
- `.grid-3` → 2 columns
- Stat grids compress

### ≤ 900px (Mobile / Narrow)

- `.grid-4`, `.grid-3`, `.grid-2` → 1 column
- `.grid-cards` → single column
- `.sidebar` → hidden (`display: none`)
- `.page-content` padding → 16px

```css
@media (max-width: 1200px) {
  .grid-4 { grid-template-columns: repeat(2, 1fr); }
  .grid-3 { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 900px) {
  .grid-4, .grid-3, .grid-2 { grid-template-columns: 1fr; }
  .grid-cards { grid-template-columns: 1fr; }
  .sidebar { display: none; }
  .page-content { padding: 16px; }
}
```

---

## Theme Support

### Dark Theme (Default)

Applied via `:root` with no attribute or `data-theme="dark"`. Near-black backgrounds (`#09090b`) with zinc-based text scale.

### Light Theme

Activated by setting `data-theme="light"` on the `<html>` element. White backgrounds, darker text, reduced opacity for borders and overlays.

### Theme Switching

- Toggle via the `.theme-toggle` button in the sidebar
- Preference persisted to `localStorage`
- Applied before Vue mounts (in `index.html` script) to prevent flash of wrong theme

### Accessibility Preferences

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

@media (prefers-contrast: more) {
  /* Removes gradients, uses solid colors for better contrast */
}
```

### Custom Scrollbars

```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); }  /* Dark */
[data-theme="light"] ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); }
```

---

## Accessibility

### ARIA Roles & Landmarks

| Attribute | Component | Purpose |
|-----------|-----------|---------|
| `role="navigation"` | AppSidebar | Main navigation landmark |
| `role="button"` | ToolCallsGroup | Expandable sections |
| `role="status"` | LoadingOverlay | Loading state announcements |
| `role="img"` | SVG Charts | Chart descriptions via `aria-label` |
| `role="slider"` | Session Replay | Timeline scrubber with `aria-valuenow`, `aria-valuemax` |
| `role="region"` | Comparison View | Labeled comparison panels |
| `role="row"` | Timeline Swimlane | Accessible row semantics |
| `aria-expanded` | Tool calls, tabs | Collapsible section state |
| `aria-current="page"` | Breadcrumb | Current page indicator |
| `aria-hidden="true"` | Decorative SVGs | Hidden from screen readers |
| `aria-live="polite"` | Loading states | Dynamic content updates |

### Keyboard Navigation

- **Tab order:** Sidebar → Main content, logical reading order
- **Focus visible:** `2px solid var(--accent-fg)` outline with `2px` offset on all interactive elements
- **Enter/Space:** Activates buttons, toggles, and collapsible sections
- **Escape:** Closes modals and command palette

### Focus Styles

```css
a:focus-visible,
button:focus-visible,
input:focus-visible,
select:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}
```

### Form Controls

- All `<input>` and `<select>` elements have associated `<label>` elements
- Icon-only buttons include `aria-label` descriptions
- Data tables include `aria-label` for screen reader context

### Color Contrast

- All semantic color pairs (text on muted background) meet WCAG 2.1 AA contrast ratios
- `prefers-contrast: more` media query removes gradients and uses solid, higher-contrast colors
