# TracePilot Theme & Design System Audit

> Generated 2026-03-29 — Full analysis of the current theme architecture, what works, what doesn't, and recommendations for improvement.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Current Theme System](#current-theme-system)
3. [Design Token Inventory](#design-token-inventory)
4. [What's Working Well](#whats-working-well)
5. [Issues & Problems](#issues--problems)
6. [Recommendations](#recommendations)

---

## Architecture Overview

### Stack
| Layer | Technology |
|---|---|
| CSS Framework | Tailwind CSS v4 (CSS-first, no config file) |
| Design Tokens | Custom CSS variables in `design-tokens.css` |
| Font | Inter Variable (`@fontsource-variable/inter`) |
| Monospace | JetBrains Mono / Fira Code / system fallbacks |
| Icons | Inline SVGs + emoji (no external icon library) |
| Theme Switching | `data-theme` attribute on `<html>` |
| Persistence | `localStorage` + backend `config.toml` via Tauri |
| Build | Vite + `@tailwindcss/vite` plugin |

### File Map
```
apps/desktop/src/
├── styles.css                    # Entry point: imports Tailwind + all modules
├── styles/
│   ├── design-tokens.css         # ★ Central token file (dark default + light override)
│   ├── base.css                  # Resets, typography utilities
│   ├── layout.css                # App shell: sidebar, main content, breadcrumbs
│   ├── components.css            # Cards, badges, buttons, forms, tables, progress
│   ├── features.css              # Domain-specific: session cards, timelines, charts
│   ├── conversation.css          # Chat/turn rendering, tool calls, reasoning blocks
│   ├── overlays.css              # Modals, command palette
│   ├── chart-shared.css          # SVG chart base styles
│   ├── animations.css            # Shared keyframes (spin)
│   ├── utilities.css             # Utility classes, scrollbar, a11y, reduced-motion
│   └── responsive.css            # Breakpoint overrides
├── stores/preferences.ts         # Theme state management + persistence
├── main.ts                       # Pre-mount theme initialization (FOUC prevention)
│
packages/ui/src/
├── components/                   # 40+ shared Vue components (no standalone CSS)
├── utils/
│   ├── agentTypes.ts             # AGENT_COLORS (CSS var references)
│   ├── toolCall.ts               # CATEGORY_COLORS (Tailwind arbitrary values)
│   └── contentTypes.ts           # Content type color config
```

---

## Current Theme System

### Themes Available
Only **2 themes**: `dark` (default) and `light`.

```typescript
// stores/preferences.ts
type ThemeOption = 'dark' | 'light';
```

### How It Works
1. **Startup** (`main.ts:12-16`): Reads `localStorage["tracepilot-theme"]`, sets `html[data-theme=...]` before Vue mount (prevents FOUC)
2. **Store** (`preferences.ts`): `theme` ref watches and calls `applyTheme()` which sets both `data-theme` and `localStorage`
3. **CSS** (`design-tokens.css`): `:root` defines dark tokens; `:root[data-theme="light"]` overrides for light
4. **Persistence**: Dual-write to `localStorage` (instant) and `config.toml` via Tauri (canonical)

### Theme Selector UI
- **Sidebar footer**: Sun/moon icon toggle button (`AppSidebar.vue:249-263`)
- **Settings > General**: `BtnGroup` with Light/Dark options (`SettingsGeneral.vue:26-30`)
- **Orphaned**: `ThemeToggle.vue` exists but is unused/not imported anywhere

### No System Theme Support
There is no `prefers-color-scheme` media query or "auto/system" theme option.

---

## Design Token Inventory

### Canvas (Backgrounds)
| Token | Dark | Light |
|---|---|---|
| `--canvas-default` | `#09090b` | `#ffffff` |
| `--canvas-subtle` | `#111113` | `#f4f4f5` |
| `--canvas-inset` | `#0a0a0c` | `#fafafa` |
| `--canvas-overlay` | `#18181b` | `#ffffff` |
| `--canvas-raised` | `#1c1c1f` | `#ffffff` |

### Text
| Token | Dark | Light |
|---|---|---|
| `--text-primary` | `#fafafa` | `#18181b` |
| `--text-secondary` | `#a1a1aa` | `#52525b` |
| `--text-tertiary` | `#71717a` | `#71717a` |
| `--text-placeholder` | `#52525b` | `#a1a1aa` |
| `--text-link` | `#818cf8` | `#6366f1` |
| `--text-inverse` | `#09090b` | `#fafafa` |
| `--text-on-emphasis` | `rgba(255,255,255,0.95)` | same |

### Accent (Indigo — Brand Color)
| Token | Dark | Light |
|---|---|---|
| `--accent-fg` | `#818cf8` | `#6366f1` |
| `--accent-emphasis` | `#6366f1` | `#4f46e5` |
| `--accent-muted` | `rgba(99,102,241,0.25)` | `rgba(99,102,241,0.15)` |
| `--accent-subtle` | `rgba(99,102,241,0.10)` | `rgba(99,102,241,0.06)` |

### Semantic Colors
Each has `-fg`, `-emphasis`, `-muted`, `-subtle` variants:
- **Success** (Emerald): `#34d399` / `#10b981`
- **Warning** (Amber): `#fbbf24` / `#f59e0b`
- **Danger** (Rose): `#fb7185` / `#f43f5e`
- **Done** (Violet): `#a78bfa` / `#8b5cf6`
- **Neutral** (Zinc): `#a1a1aa` / `#71717a`

### Layout & Spacing
| Token | Value |
|---|---|
| `--sidebar-width` | `240px` |
| `--sidebar-collapsed` | `56px` |
| `--content-max-width` | `1600px` (user-configurable) |
| `--radius-sm/md/lg/xl/full` | `6/8/10/12/9999px` |
| `--transition-fast/normal/slow` | `100/180/280ms ease` |
| `--z-sidebar/header/fab/overlay/modal/tooltip` | `40-80` |

### Gradients
| Token | Value |
|---|---|
| `--gradient-accent` | `linear-gradient(135deg, #6366f1, #8b5cf6)` |
| `--gradient-card` | `linear-gradient(145deg, subtle→default)` |
| `--gradient-surface` | `linear-gradient(180deg, subtle→default)` |

### Agent Colors (5 agent types)
| Agent | Dark | Light |
|---|---|---|
| Main | `#6366f1` | `#4f46e5` |
| Explore | `#22d3ee` | `#0891b2` |
| General Purpose | `#a78bfa` | `#7c3aed` |
| Code Review | `#f472b6` | `#db2777` |
| Task | `#fbbf24` | `#d97706` |

### Chart Colors (12 palette slots)
Defined as CSS variables but also duplicated as TypeScript constants in `utils/chartColors.ts`.

---

## What's Working Well

### ✅ Solid Token Architecture
The `design-tokens.css` file is well-organized with clear naming conventions (`canvas-*`, `text-*`, `accent-*`, semantic color groups). The token vocabulary is consistent and expressive.

### ✅ Centralized & Predictable
One file controls the entire visual language. Changing `--accent-emphasis` from indigo to teal would ripple through buttons, links, badges, focus rings, gradients, and active states.

### ✅ FOUC Prevention
Theme is applied from `localStorage` before Vue mounts (`main.ts:12-16`), preventing flash of wrong theme.

### ✅ Component System Uses Tokens Well
Global CSS classes (`.card`, `.btn`, `.badge-*`, `.section-panel`) consistently reference design tokens. The shared `@tracepilot/ui` package correctly depends on host-app tokens via CSS variables.

### ✅ Accessibility
- Focus-visible outlines use `--accent-fg`
- `prefers-reduced-motion` support disables animations
- `prefers-contrast: more` overrides gradient text effects

### ✅ Responsive Design
Mobile breakpoint transforms sidebar to bottom nav bar. Grid layouts gracefully collapse.

### ✅ Light/Dark Parity
Both themes have complete token coverage. The light theme adjusts muted/subtle alpha values appropriately (lower opacity for light backgrounds).

---

## Issues & Problems

### 🔴 Hardcoded Colors (Theme-Breaking)

Several places use literal hex/rgba values instead of CSS variables, meaning they **won't respond to theme changes**:

| Location | Issue |
|---|---|
| `components.css:292` | `.btn-primary` uses `color: white` |
| `components.css:294` | Hardcoded indigo shadow `rgba(99,102,241,0.3)` |
| `components.css:350` | Form switch thumb `background: white` |
| `layout.css:39-42` | Sidebar brand icon `color: white` + hardcoded shadow |
| `layout.css:190-219` | Update buttons: `#fff`, `#6366f1`, `#4f46e5`, `#818cf8` |
| `features.css:143` | Swimlane bar text `color: white` |
| `features.css:324` | `.gradient-value` hardcoded indigo gradient |
| `ReplayTransportBar.vue:128-172` | `#fff`, `#a78bfa`, hardcoded rgba |
| `SessionComparisonView.vue:231-238` | Local chart palette hexes |
| `CodeBlock.vue:177-190` | Fixed syntax highlight colors |
| `SqlResultRenderer.vue:132-136` | Fixed syntax/data-type colors |
| `ShellOutputRenderer.vue:167-169` | macOS traffic-light colors |
| `FormSwitch.vue:54` | White thumb |

### 🔴 Undefined / Mismatched Token Names

Some components reference CSS variable names that **don't exist** in `design-tokens.css`:

| Undefined Token | Used In |
|---|---|
| `--bg-subtle` | `SearchSyntaxHelpModal.vue`, `SearchBrowsePresets.vue` |
| `--border-secondary` | `layout.css:110` |
| `--accent-emphasis-hover` | `layout.css:203` |
| `--bg-tertiary` | `SettingsDataStorage.vue:273` |
| `--color-fg-default` | `UpdateInstructionsModal.vue`, `WhatsNewModal.vue` |
| `--color-accent-fg` | `SettingsUpdates.vue:130` |
| `--color-danger` | `SessionCard.vue:95` |

These silently fall back to `initial` or their CSS fallback values, creating visual inconsistency.

### 🟡 Chart Colors Not Theme-Reactive

`utils/chartColors.ts` defines `CHART_COLORS`, `DONUT_PALETTE`, and `MODEL_PALETTE` as static TypeScript hex constants. These are consumed by analytics views at render time but **don't update when the theme changes**.

### 🟡 Only 2 Themes (Dark/Light)

The current `ThemeOption` type is hardcoded to `'dark' | 'light'`. There's no:
- System/auto theme (`prefers-color-scheme`)
- Custom accent color selection
- Additional themed variants (high contrast, OLED, warm, etc.)

### 🟡 Tailwind Utility Collisions

`utilities.css` intentionally shadows Tailwind class names (`.gap-1`, `.gap-2`, etc.) with different values. This creates confusion about which system is authoritative.

### 🟡 Orphaned ThemeToggle Component

`ThemeToggle.vue` exists but is imported nowhere. It also directly mutates `document.documentElement` instead of going through the store, which would bypass reactive state.

### 🟡 Theme Selector Buried in Settings

The primary theme selector is a simple Light/Dark `BtnGroup` in Settings > General. There's no visual preview, no accent color picker, and no way to explore alternative looks.

---

## Recommendations

### Immediate Wins (Low Risk)
1. **Add system/auto theme** — respect `prefers-color-scheme` as a third option
2. **Delete orphaned `ThemeToggle.vue`** — it's dead code
3. **Fix undefined token references** — map `--color-*` / `--bg-*` names to the canonical `--canvas-*` / `--text-*` tokens
4. **Replace hardcoded `white`** — use `--text-on-emphasis` or `--text-inverse` where appropriate

### Medium Effort (High Impact)
5. **Introduce accent color customization** — the token architecture already supports this; changing `--accent-fg` / `--accent-emphasis` and `--gradient-accent` would recolor the entire app
6. **Add new theme presets** — create additional `[data-theme="..."]` blocks with different palettes
7. **Make chart colors theme-reactive** — use `getComputedStyle` to read CSS variables, or define chart palettes as CSS vars
8. **Upgrade theme selector UI** — visual swatches with live preview instead of plain text buttons

### Aspirational
9. **Full custom theme editor** — HSL-based color picker that generates a complete token set
10. **Theme sharing/export** — serialize themes as JSON/CSS
11. **Per-session theme hints** — different accent colors for different repos/projects

---

*See companion HTML prototypes in `docs/theme-prototypes/` for visual explorations of new theme ideas.*
