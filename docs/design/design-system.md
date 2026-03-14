# TracePilot Design System

> A sleek, GitHub-inspired design language for the TracePilot desktop application.

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Color System](#color-system)
3. [Typography](#typography)
4. [Spacing & Layout](#spacing--layout)
5. [Component Library](#component-library)
6. [Page Layouts](#page-layouts)
7. [Responsive Strategy](#responsive-strategy)
8. [Accessibility](#accessibility)

---

## Design Philosophy

TracePilot draws inspiration from **GitHub's Primer design system** while establishing its own identity as a developer tool for session inspection. The design prioritizes:

- **Information density** — Show meaningful data without clutter
- **Scanability** — Use consistent patterns so users can quickly parse session lists and details
- **Visual hierarchy** — Distinct levels: page title → section → content → metadata
- **Dark-first** — Optimized for dark theme (developer preference), with full light theme support
- **Familiar patterns** — GitHub-like cards, tables, badges, and navigation

### Brand Identity

TracePilot is a diagnostic/inspection tool. The design should feel like a **control panel** — organized, precise, professional. We avoid playful elements and favor a structured, data-driven aesthetic.

---

## Color System

### Dark Theme (Default)

```css
:root[data-theme="dark"], :root {
  /* Canvas / Background layers */
  --color-canvas-default: #0d1117;        /* Page background */
  --color-canvas-subtle: #161b22;         /* Card/panel backgrounds */
  --color-canvas-inset: #010409;          /* Inset areas, code blocks */
  --color-canvas-overlay: #1c2128;        /* Modals, dropdowns */

  /* Border */
  --color-border-default: #30363d;
  --color-border-muted: #21262d;
  --color-border-subtle: #1b1f23;

  /* Text */
  --color-text-primary: #e6edf3;
  --color-text-secondary: #8b949e;
  --color-text-tertiary: #6e7681;
  --color-text-link: #58a6ff;
  --color-text-inverse: #0d1117;

  /* Accent — TracePilot blue (GitHub-aligned) */
  --color-accent-fg: #58a6ff;
  --color-accent-emphasis: #1f6feb;
  --color-accent-muted: rgba(56, 139, 253, 0.15);
  --color-accent-subtle: rgba(56, 139, 253, 0.10);

  /* Semantic colors */
  --color-success-fg: #3fb950;
  --color-success-emphasis: #238636;
  --color-success-muted: rgba(63, 185, 80, 0.15);

  --color-warning-fg: #d29922;
  --color-warning-emphasis: #9e6a03;
  --color-warning-muted: rgba(210, 153, 34, 0.15);

  --color-danger-fg: #f85149;
  --color-danger-emphasis: #da3633;
  --color-danger-muted: rgba(248, 81, 73, 0.10);

  --color-done-fg: #a371f7;
  --color-done-emphasis: #8957e5;
  --color-done-muted: rgba(163, 113, 247, 0.15);

  /* Neutral scales for badges/labels */
  --color-neutral-fg: #8b949e;
  --color-neutral-emphasis: #6e7681;
  --color-neutral-muted: rgba(110, 118, 129, 0.20);

  /* Header */
  --color-header-bg: #161b22;
  --color-header-border: #30363d;

  /* Sidebar */
  --color-sidebar-bg: #0d1117;
  --color-sidebar-border: #21262d;
  --color-sidebar-active: rgba(56, 139, 253, 0.15);
  --color-sidebar-hover: rgba(177, 186, 196, 0.08);

  /* Shadow */
  --color-shadow-sm: 0 1px 0 rgba(27, 31, 35, 0.04);
  --color-shadow-md: 0 3px 6px rgba(0, 0, 0, 0.3);
  --color-shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.4);
}
```

### Light Theme

```css
:root[data-theme="light"] {
  --color-canvas-default: #ffffff;
  --color-canvas-subtle: #f6f8fa;
  --color-canvas-inset: #eff2f5;
  --color-canvas-overlay: #ffffff;

  --color-border-default: #d0d7de;
  --color-border-muted: #d8dee4;
  --color-border-subtle: #e8e8e8;

  --color-text-primary: #1f2328;
  --color-text-secondary: #636c76;
  --color-text-tertiary: #8c959f;
  --color-text-link: #0969da;
  --color-text-inverse: #ffffff;

  --color-accent-fg: #0969da;
  --color-accent-emphasis: #0550ae;
  --color-accent-muted: rgba(9, 105, 218, 0.12);
  --color-accent-subtle: rgba(9, 105, 218, 0.08);

  --color-success-fg: #1a7f37;
  --color-success-emphasis: #1a7f37;
  --color-success-muted: rgba(26, 127, 55, 0.12);

  --color-warning-fg: #9a6700;
  --color-warning-emphasis: #7d4e00;
  --color-warning-muted: rgba(154, 103, 0, 0.12);

  --color-danger-fg: #d1242f;
  --color-danger-emphasis: #cf222e;
  --color-danger-muted: rgba(209, 36, 47, 0.10);

  --color-done-fg: #8250df;
  --color-done-emphasis: #6639ba;
  --color-done-muted: rgba(130, 80, 223, 0.12);

  --color-neutral-fg: #636c76;
  --color-neutral-emphasis: #57606a;
  --color-neutral-muted: rgba(99, 108, 118, 0.12);

  --color-header-bg: #f6f8fa;
  --color-header-border: #d0d7de;

  --color-sidebar-bg: #ffffff;
  --color-sidebar-border: #d0d7de;
  --color-sidebar-active: rgba(9, 105, 218, 0.12);
  --color-sidebar-hover: rgba(208, 215, 222, 0.32);

  --color-shadow-sm: 0 1px 0 rgba(27, 31, 35, 0.04);
  --color-shadow-md: 0 3px 6px rgba(140, 149, 159, 0.15);
  --color-shadow-lg: 0 8px 24px rgba(140, 149, 159, 0.20);
}
```

### Semantic Color Usage

| Purpose | Variable | Example Usage |
|---------|----------|---------------|
| Repo name badge | `--color-accent-fg` | Blue text on subtle blue bg |
| Branch name badge | `--color-success-fg` | Green text on subtle green bg |
| Model name badge | `--color-done-fg` | Purple text on subtle purple bg |
| Host type badge | `--color-neutral-fg` | Gray text on subtle gray bg |
| Error states | `--color-danger-fg` | Red borders, text |
| Warnings / premium | `--color-warning-fg` | Amber for costs, warnings |
| Event types | Per-prefix mapping | session=blue, user=green, assistant=purple, tool=amber |

---

## Typography

### Font Stack

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
```

### Type Scale

| Name | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| `display` | 24px (1.5rem) | 700 | 1.25 | Page titles only |
| `title-lg` | 20px (1.25rem) | 600 | 1.3 | Session title in detail view |
| `title-md` | 16px (1rem) | 600 | 1.4 | Section headings, card titles |
| `title-sm` | 14px (0.875rem) | 600 | 1.5 | Sub-section headings |
| `body` | 14px (0.875rem) | 400 | 1.5 | Default body text |
| `body-sm` | 12px (0.75rem) | 400 | 1.5 | Secondary info, timestamps |
| `caption` | 11px (0.6875rem) | 500 | 1.4 | Badges, labels, counters |

### Tailwind Classes Mapping

```
display    → text-2xl font-bold
title-lg   → text-xl font-semibold
title-md   → text-base font-semibold
title-sm   → text-sm font-semibold
body       → text-sm
body-sm    → text-xs
caption    → text-[11px] font-medium
```

---

## Spacing & Layout

### Spacing Scale

Use Tailwind's default spacing with these conventions:
- `gap-1` (4px) — Between related inline items (badge text + icon)
- `gap-2` (8px) — Between badges, small items
- `gap-3` (12px) — Between card sections
- `gap-4` (16px) — Between cards, standard section gap
- `gap-6` (24px) — Between major sections
- `gap-8` (32px) — Between page regions

### Border Radius

- **Cards/Panels**: `rounded-lg` (8px) — consistent everywhere
- **Badges/Pills**: `rounded-full` — fully rounded
- **Buttons**: `rounded-md` (6px) — slightly smaller than cards
- **Tables**: `rounded-lg` on outer container, square inner cells

### Layout Grid

The app uses a **sidebar + main content** layout:

```
┌────────────────────────────────────────────────────┐
│ Header (48px)                                      │
├─────────┬──────────────────────────────────────────┤
│ Sidebar │ Main Content Area                        │
│ (240px) │                                          │
│         │  ┌──────────────────────────────────────┐│
│ ≡ Nav   │  │ Page content with max-width: 1280px  ││
│         │  │                                      ││
│         │  └──────────────────────────────────────┘│
│         │                                          │
└─────────┴──────────────────────────────────────────┘
```

- **Header**: Fixed, 48px height, full width
- **Sidebar**: Fixed, 240px width, collapsible to icon-only (48px) at <1024px
- **Main content**: Fluid, scrollable, max-width 1280px, centered

---

## Component Library

### 1. AppHeader

Top navigation bar with logo, breadcrumbs, theme toggle, and session count.

```
┌──────────────────────────────────────────────────────┐
│ 🔍 TracePilot          Sessions (76)  🌙/☀️  ⚙️    │
└──────────────────────────────────────────────────────┘
```

**Specs:**
- Height: 48px
- Background: `--color-header-bg`
- Border bottom: `--color-header-border`
- Logo: Bold accent text, no icon initially
- Right side: theme toggle button, settings (future)

### 2. AppSidebar

Left navigation with route links and session quick stats.

```
┌─────────────┐
│ ◉ Sessions  │ ← Active state with accent bg
│ 🔍 Search   │
│             │
│ ─────────── │
│ STATS       │
│ 76 sessions │
│ 3 repos     │
│ 12 branches │
└─────────────┘
```

**Specs:**
- Width: 240px (desktop), collapses to 48px (tablet)
- Hidden on mobile (<768px), becomes hamburger menu
- Active item: left border accent + subtle accent bg
- Navigation items: 12px icon + 14px label

### 3. SessionCard (Redesigned)

The primary card for session lists. Information-dense but scanable.

```
┌────────────────────────────────────────────────┐
│ Implemented login feature with OAuth           │
│                                                │
│ [example/project] [main] [cli] [opus-4.6]     │
│                                                │
│ 2,450 events · 12 turns · +54/-12 lines       │
│                                            1h  │
└────────────────────────────────────────────────┘
```

**Specs:**
- Background: `--color-canvas-subtle`
- Border: `--color-border-default`, accent on hover
- Title: `title-md` weight, single line truncated
- Badges: Pill badges with semantic colors
- Stats row: `body-sm` muted text with dot separators
- Relative time: bottom-right, muted
- Hover: border accent + subtle elevation (shadow-sm)
- Active/Selected: accent left border (2px)

### 4. Badge

Reusable pill badge for metadata.

**Variants:**
| Variant | Text Color | Background | Usage |
|---------|-----------|------------|-------|
| `accent` | `--color-accent-fg` | `--color-accent-muted` | Repo names |
| `success` | `--color-success-fg` | `--color-success-muted` | Branch names |
| `done` | `--color-done-fg` | `--color-done-muted` | Model names |
| `neutral` | `--color-neutral-fg` | `--color-neutral-muted` | Host type, misc |
| `warning` | `--color-warning-fg` | `--color-warning-muted` | Premium, costs |
| `danger` | `--color-danger-fg` | `--color-danger-muted` | Errors, failures |

**Specs:**
- Padding: `px-2 py-0.5`
- Font: `caption` (11px, font-medium)
- Border radius: `rounded-full`
- No border, background-only

### 5. StatCard

Compact stat display for overview metrics.

```
┌──────────────┐
│     2,450    │
│    Events    │
│   ▲ 12%     │
└──────────────┘
```

**Specs:**
- Value: `text-2xl font-bold`, semantic color
- Label: `body-sm text-secondary`
- Optional trend indicator: small text below
- Background: `--color-canvas-subtle`
- Border: `--color-border-default`

### 6. DataTable

For events, models, and other tabular data.

**Specs:**
- Container: `rounded-lg` border, no outer padding
- Header: `--color-canvas-subtle` bg, uppercase `caption` text
- Rows: alternate hover state, `--color-border-muted` separators
- Cells: `px-4 py-2.5` padding
- Sortable columns: caret indicator, cursor pointer
- Sticky header on scroll

### 7. TabNav (Existing, to be used)

Route-aware tab navigation for session detail sub-pages.

**Specs:**
- Border bottom: `--color-border-default`
- Active tab: accent bottom border (2px), accent text
- Inactive: secondary text, hover to primary
- Counter badges: neutral pill badges next to tab labels (e.g., "Events (2,450)")

### 8. SearchBar

Unified search with icon, clear button, and keyboard shortcut hint.

```
┌───────────────────────────────────────┐
│ 🔍 Search sessions...        ⌘K      │
└───────────────────────────────────────┘
```

**Specs:**
- Full width within its container
- Left icon: magnifying glass, `text-tertiary`
- Placeholder: `text-tertiary`
- Border: `--color-border-default`, focus: accent
- Background: `--color-canvas-default` (not inset)
- Clear button (×) appears when text present
- `Ctrl+K` / `⌘K` hint on right

### 9. ProgressBar

For todo completion tracking.

**Specs:**
- Height: 8px
- Background: `--color-border-muted`
- Fill: `--color-success-emphasis`
- Border radius: `rounded-full`
- Segmented option: colored segments for each status

### 10. ConversationBubble

Chat-style display for conversation turns.

```
┌─ User ──────────────────────────────────────┐
│ Can you fix the login page?                 │
└─────────────────────────────────────────────┘

    ┌─ Assistant (claude-opus-4.6) ─── 2m 34s ─┐
    │ I'll fix the login page. Let me check     │
    │ the current implementation...              │
    │                                            │
    │ ▸ 5 tool calls                             │
    └────────────────────────────────────────────┘
```

**Specs:**
- User messages: left-aligned, `--color-canvas-subtle` bg
- Assistant messages: left-aligned, slight indent, `--color-canvas-inset` bg
- Turn header: `body-sm` with turn number, model badge, duration
- Tool calls: collapsible section below message
- Expand/collapse: chevron icon, smooth transition

### 11. EventRow

Compact event display with type coloring.

**Specs:**
- Type badge: colored per prefix (session=accent, user=success, assistant=done, tool=warning)
- Timestamp: `body-sm` muted
- ID: monospace, truncated
- Hover: subtle highlight
- Optional: expand to show full event data JSON

### 12. StatusIcon

SVG icons for todo status (replacing emojis).

| Status | Icon | Color |
|--------|------|-------|
| `done` | ✓ checkmark circle | `--color-success-fg` |
| `in_progress` | ◐ half circle / spinner | `--color-accent-fg` |
| `blocked` | ⊘ no-entry circle | `--color-danger-fg` |
| `pending` | ○ empty circle | `--color-text-tertiary` |

---

## Page Layouts

### Page 1: Session List (Home)

The primary page. Shows all sessions in a scanable grid.

```
┌────────────────────────────────────────────────────────────────────┐
│ Sessions                                                  76 total │
│                                                                    │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ 🔍 Search sessions...                               ⌘K     │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                                                    │
│ [All repos ▾] [All branches ▾] [Recently updated ▾] [↻ Reindex]  │
│                                                                    │
│ ┌─────────────────────────┐ ┌─────────────────────────┐           │
│ │ Impl login with OAuth   │ │ Fixed CSS layout issues  │           │
│ │ [repo] [main] [opus]    │ │ [frontend] [feat] [gpt]  │           │
│ │ 2450 events · 12 turns  │ │ 890 events · 5 turns     │           │
│ │                     1h  │ │                     2h   │           │
│ └─────────────────────────┘ └─────────────────────────┘           │
│ ┌─────────────────────────┐                                       │
│ │ Set up CI/CD pipeline   │                                       │
│ │ [infra] [devops] [sonnet│                                       │
│ │ 4200 events · 22 turns  │                                       │
│ │                     1d  │                                       │
│ └─────────────────────────┘                                       │
└────────────────────────────────────────────────────────────────────┘
```

**Key changes from current:**
- Remove the giant magnifying glass SVG background
- Search bar at top, prominent but not dominating
- Filter bar below search, compact single row
- Session count in page header
- Cards in responsive grid (1-3 columns)
- Better empty state

### Page 2: Session Detail — Overview Tab

Two-column layout with session info and quick stats.

```
┌────────────────────────────────────────────────────────────────────┐
│ ← Back to Sessions                                                │
│                                                                    │
│ Implemented login feature with OAuth                              │
│ [example/project] [main] [cli] [claude-opus-4.6]                  │
│                                                                    │
│ [Overview] [Conversation] [Events] [Todos] [Metrics]              │
│ ──────────────────────────────────────────────────────             │
│                                                                    │
│ ┌─ Session Info ─────────┐ ┌───────┐ ┌───────┐                   │
│ │ ID        abc-123-def  │ │ 2,450 │ │  12   │                   │
│ │ Repo      example/proj │ │Events │ │Turns  │                   │
│ │ Branch    main         │ ├───────┤ ├───────┤                   │
│ │ CWD       /Users/...   │ │   3   │ │  1.3  │                   │
│ │ Host      cli          │ │Checks │ │Premiu │                   │
│ │ Created   Mar 14 10:30 │ └───────┘ └───────┘                   │
│ │ Updated   Mar 14 12:45 │                                        │
│ └────────────────────────┘ ┌─ Summary ─────────────┐             │
│                            │ API Duration    2m 34s │             │
│ ┌─ Checkpoints (3) ─────┐ │ Current Model opus-4.6│             │
│ │ ① Phase 1 complete    │ │ Shutdown       normal  │             │
│ │ ② Added auth module   │ │ Code     +54 -12 lines │             │
│ │ ③ Fixed tests         │ └────────────────────────┘             │
│ └────────────────────────┘                                        │
└────────────────────────────────────────────────────────────────────┘
```

### Page 3: Session Detail — Conversation Tab

Chat-style conversation with collapsible tool calls.

```
┌────────────────────────────────────────────────────────────────────┐
│ [Overview] [Conversation] [Events] [Todos] [Metrics]              │
│ ──────────────────────────────────────────────────────             │
│                                                                    │
│ Turn 1                                     claude-opus-4.6  2m 34s│
│ ┌─────────────────────────────────────────────────────────────┐   │
│ │ 👤 User                                                     │   │
│ │ Can you implement the login feature with OAuth?             │   │
│ └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │ 🤖 Assistant                                              │    │
│   │ I'll implement the OAuth login. Let me start by checking  │    │
│   │ the current auth setup...                                 │    │
│   │                                                            │    │
│   │ ▸ 5 tool calls (3 ✓, 1 ✗, 1 pending)                     │    │
│   │   ├─ read_file src/auth.ts ✓ 120ms                       │    │
│   │   ├─ edit_file src/auth.ts ✓ 340ms                       │    │
│   │   ├─ run_command npm test ✗ 2.1s  "Error: ..."           │    │
│   │   ├─ edit_file src/auth.ts ✓ 280ms                       │    │
│   │   └─ run_command npm test ✓ 1.8s                         │    │
│   └──────────────────────────────────────────────────────────┘    │
│                                                                    │
│ Turn 2                                     claude-opus-4.6  1m 12s│
│ ┌─────────────────────────────────────────────────────────────┐   │
│ │ 👤 User                                                     │   │
│ │ Great, now add unit tests for the login module.             │   │
│ └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### Page 4: Session Detail — Events Tab

Table view with type filtering and pagination.

```
┌────────────────────────────────────────────────────────────────────┐
│ [Overview] [Conversation] [Events] [Todos] [Metrics]              │
│ ──────────────────────────────────────────────────────             │
│                                                                    │
│ [All types ▾]                    100 of 2,450 events              │
│                                                                    │
│ ┌─────┬─────────────────────┬──────────┬────────────────────────┐ │
│ │  #  │ Type                │ Time     │ ID                     │ │
│ ├─────┼─────────────────────┼──────────┼────────────────────────┤ │
│ │  1  │ session.start       │ 10:30:01 │ evt-abc-123            │ │
│ │  2  │ user.message        │ 10:30:02 │ evt-def-456            │ │
│ │  3  │ assistant.turn_start│ 10:30:03 │ evt-ghi-789            │ │
│ │  4  │ tool.execution_start│ 10:30:04 │ evt-jkl-012            │ │
│ │  5  │ tool.execution_compl│ 10:30:05 │ evt-mno-345            │ │
│ └─────┴─────────────────────┴──────────┴────────────────────────┘ │
│                                                                    │
│ [← Previous]          Page 1 of 25           [Next →]             │
└────────────────────────────────────────────────────────────────────┘
```

### Page 5: Session Detail — Todos Tab

Progress tracking with status icons and dependencies.

```
┌────────────────────────────────────────────────────────────────────┐
│ [Overview] [Conversation] [Events] [Todos] [Metrics]              │
│ ──────────────────────────────────────────────────────             │
│                                                                    │
│ 7/12 completed                                                    │
│ [████████████████████░░░░░░░░░░]  58%                             │
│                                                                    │
│ ┌─────────────────────────────────────────────────────────────┐   │
│ │ ✓ Create user auth module                           done    │   │
│ │   Implement JWT-based authentication in src/auth/           │   │
│ │   ID: user-auth                                             │   │
│ └─────────────────────────────────────────────────────────────┘   │
│ ┌─────────────────────────────────────────────────────────────┐   │
│ │ ◐ Add API routes                                in_progress │   │
│ │   Create REST endpoints for login, logout, refresh          │   │
│ │   Depends on: [Create user auth module]                     │   │
│ └─────────────────────────────────────────────────────────────┘   │
│ ┌─────────────────────────────────────────────────────────────┐   │
│ │ ○ Write integration tests                        pending    │   │
│ │   End-to-end tests for all auth flows                       │   │
│ │   Depends on: [Add API routes]                              │   │
│ └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### Page 6: Session Detail — Metrics Tab

Model usage, tokens, and performance data.

```
┌────────────────────────────────────────────────────────────────────┐
│ [Overview] [Conversation] [Events] [Todos] [Metrics]              │
│ ──────────────────────────────────────────────────────             │
│                                                                    │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│ │  1.2M    │ │    47    │ │   1.3    │ │    3     │             │
│ │ Tokens   │ │ Requests │ │ Premium  │ │ Models   │             │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘             │
│                                                                    │
│ ┌─────────────────────────────────────────────────────────────┐   │
│ │ Model          │ Req │ Input  │ Output │ Cache │ Total │Cost│   │
│ ├────────────────┼─────┼────────┼────────┼───────┼───────┼────│   │
│ │ claude-opus-4.6│  32 │ 892.3K │  45.2K │ 234K  │ 937.5K│0.87│  │
│ │ gpt-5.4        │  15 │ 234.1K │  23.4K │  89K  │ 257.5K│0.46│  │
│ └────────────────┴─────┴────────┴────────┴───────┴───────┴────┘   │
│                                                                    │
│ Token Distribution                                                │
│ claude-opus-4.6  [████████████████████████░░░░░]  78%   937.5K   │
│ gpt-5.4          [███████░░░░░░░░░░░░░░░░░░░░░░]  22%   257.5K   │
│                                                                    │
│ ┌─ Code Changes ──────────────────────────────────────────────┐   │
│ │ +54 lines added  -12 lines removed  3 files modified        │   │
│ │ src/auth/login.ts · src/auth/oauth.ts · src/auth/index.ts   │   │
│ └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

---

## Responsive Strategy

### Breakpoints

| Name | Width | Layout Changes |
|------|-------|----------------|
| `sm` | <768px | Sidebar hidden → hamburger menu, single column grid, stacked filters |
| `md` | 768–1023px | Sidebar collapsed (48px, icons only), 2-column card grid |
| `lg` | 1024–1279px | Sidebar expanded (240px), 2-column card grid |
| `xl` | ≥1280px | Full layout, 3-column card grid, max-width content |

### Key Responsive Rules

1. **Header**: Always visible, full width
2. **Sidebar**: 240px → 48px → hidden (with hamburger toggle)
3. **Session grid**: 3 cols → 2 cols → 1 col
4. **Detail layout**: 2 cols → stacked
5. **Tables**: Horizontal scroll on small screens
6. **Filter bar**: Wraps to multiple rows on narrow screens

---

## Accessibility

### Requirements

1. **Keyboard navigation**: All interactive elements focusable, logical tab order
2. **Focus indicators**: Visible focus ring (2px accent outline, 2px offset)
3. **Semantic HTML**: Proper heading hierarchy, landmark roles, aria-labels
4. **Status icons**: SVG icons with `aria-label` (no emoji)
5. **Color contrast**: WCAG AA minimum (4.5:1 for text, 3:1 for UI)
6. **Screen reader**: Meaningful alt text, aria-live for dynamic content
7. **Reduced motion**: Respect `prefers-reduced-motion` for transitions

### Focus Style

```css
:focus-visible {
  outline: 2px solid var(--color-accent-fg);
  outline-offset: 2px;
  border-radius: 4px;
}
```

---

## Migration from Current Design

### What Changes

| Current | New |
|---------|-----|
| CSS variables (--bg, --surface, etc.) | Expanded Primer-aligned variables |
| BEM classes in styles.css | Remove all BEM, Tailwind + CSS vars only |
| Hardcoded purple-400/500 | `--color-done-fg/muted` via badges |
| Emoji status icons (✅🔄🚫⏳) | SVG StatusIcon component |
| No sidebar, header-only nav | Sidebar + header layout |
| Giant search SVG background | Clean SearchBar component |
| Inline tab nav in detail view | Use TabNav shared component |
| Duplicate SearchView page | Remove, merge into SessionList search |
| No light theme | Full light theme via CSS variables |
| No theme toggle | Theme toggle in header |

### Files to Create/Modify

**New shared components** (`packages/ui/src/components/`):
- `AppSidebar.vue` — Sidebar navigation
- `StatCard.vue` — Metric stat display
- `StatusIcon.vue` — SVG status icons
- `ThemeToggle.vue` — Dark/light switch
- `ConversationBubble.vue` — Chat message display

**Modified components:**
- `Badge.vue` — Updated variants
- `SessionCard.vue` — Redesigned layout
- `SearchInput.vue` — Enhanced with clear button, shortcut hint
- `TabNav.vue` — Counter badges support

**Modified views:**
- `App.vue` — Sidebar layout
- `SessionListView.vue` — New layout, remove SVG
- `SessionDetailView.vue` — Use TabNav, breadcrumb
- All 5 tab views — Updated styling

**Modified styles:**
- `styles.css` — Complete rewrite with new color system

**Deleted:**
- `SearchView.vue` — Merged into SessionListView
