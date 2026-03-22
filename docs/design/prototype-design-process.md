# TracePilot Prototype Design Process

> A guide to how TracePilot UI prototypes were created, organized, and evaluated.
> Use this process to create future prototypes with consistent design language.

## Overview

TracePilot prototypes are **self-contained HTML/CSS/JS files** that can be previewed in any browser without a build step. Each prototype contains its own markup, styles, and mock data, while sharing design tokens and utility code via centralized shared resources.

This approach was used to rapidly explore and compare multiple design directions before committing to implementation in the Vue/TypeScript desktop app.

---

## Directory Structure

```
docs/design/prototypes/
├── shared/                     # Shared design system files
│   ├── design-system-c.css     # Variant C tokens ("Hybrid") ← PRODUCTION
│   └── shared.js               # Theme toggle, tab switching, mock data
├── setup-window/               # Setup wizard design report
│   └── design-report.md        # Design decisions for setup window
└── (prototypes removed)        # See git history for historical prototypes
```

> **Note:** Historical prototype HTML files (variant-a/, variant-b/, variant-c/, features/, components/, orchestration/, loading-screens/) were removed during docs cleanup. The design decisions from those prototypes are captured in the markdown documentation. See git history for the original files.

---

## Design Variants

Three design variants were developed and compared. **Variant C** was chosen for production.

### Variant A — "Primer Evolved"

| Property | Value |
|----------|-------|
| **Accent color** | Blue `#58a6ff` (dark) / `#0969da` (light) |
| **Canvas** | GitHub dark `#0d1117` |
| **Font** | System font stack (`-apple-system`, `Segoe UI`) |
| **Border style** | Visible solid borders (`#30363d`) |
| **Spacing** | Generous (16px gaps, 20px padding) |
| **Inspiration** | GitHub Primer design system |
| **CSS file** | `shared/design-system-a.css` *(removed)* |

### Variant B — "Linear Minimal"

| Property | Value |
|----------|-------|
| **Accent color** | Indigo `#818cf8` / `#6366f1` |
| **Canvas** | Near-black `#09090b` |
| **Font** | Inter |
| **Border style** | Subtle rgba borders (`rgba(255,255,255,0.08)`) |
| **Spacing** | Tight (12px gaps, gradient overlays) |
| **Inspiration** | Linear, Raycast, Vercel |
| **CSS file** | `shared/design-system-b.css` *(removed)* |

### Variant C — "Hybrid" (Production) ✅

| Property | Value |
|----------|-------|
| **Accent color** | Indigo `#818cf8` / `#6366f1` |
| **Canvas** | Near-black `#09090b` |
| **Font** | Inter |
| **Border style** | Subtle rgba borders (`rgba(255,255,255,0.10)`) |
| **Spacing** | Comfortable (Primer density + Linear polish) |
| **Inspiration** | Variant B visual polish + Variant A information density |
| **CSS file** | `shared/design-system-c.css` |
| **Production CSS** | `apps/desktop/src/styles.css` |

---

## Semantic Color System

All variants share the same semantic color roles (values differ per variant):

| Role | Variant A (Primer) | Variant C (Production) | Usage |
|------|-------------------|----------------------|-------|
| **Accent** | Blue `#58a6ff` | Indigo `#818cf8` | Links, primary actions, active states |
| **Success** | Green `#3fb950` | Emerald `#34d399` | Success states, completion badges |
| **Warning** | Amber `#d29922` | Amber `#fbbf24` | Warnings, caution states |
| **Danger** | Red `#f85149` | Rose `#fb7185` | Errors, destructive actions |
| **Done** | Purple `#a371f7` | Violet `#a78bfa` | Completed items, archive states |
| **Neutral** | Gray `#8b949e` | Gray `#a1a1aa` | Secondary text, muted states |

Each color has 4 levels: `*-fg` (text/icons), `*-emphasis` (fills), `*-muted` (backgrounds), `*-subtle` (hover states).

---

## Shared Resources

### `shared/shared.js` — Common Interactivity

Provides to all prototype HTML pages:
- **Theme toggle** — Dark/light switching with `localStorage` persistence
- **Tab switching** — Click handlers for `.tab-nav-item` → `.tab-panel` visibility
- **Collapsible sections** — Chevron animation for `[data-collapse]` triggers
- **Mock session data** — 3+ realistic session objects with IDs, repos, metrics
- **DOM initialization** — Auto-runs on `DOMContentLoaded`

### `shared/design-system-c.css` — Design Tokens (Production)

Provides ~650+ lines of CSS including:
- Color tokens (canvas, border, text, semantic colors)
- Typography scale (11px–32px, mono + sans font stacks)
- Spacing scale (4px–64px)
- Border radius scale
- Shadow system (sm/md/lg + glow variants)
- Sidebar layout (width, collapsed states)
- Card, badge, button, table component styles
- Light theme overrides via `[data-theme="light"]`

> **Note:** Variant A and B design system CSS files were removed during cleanup. Their token values are documented in the tables above for reference.

### `shared/shared.js` — Common Interactivity

Provides to all prototype HTML pages:
- **Theme toggle** — Dark/light switching with `localStorage` persistence
- **Tab switching** — Click handlers for `.tab-nav-item` → `.tab-panel` visibility
- **Collapsible sections** — Chevron animation for `[data-collapse]` triggers
- **Mock session data** — 3+ realistic session objects with IDs, repos, metrics
- **DOM initialization** — Auto-runs on `DOMContentLoaded`

---

## How to Create a New Prototype

### 1. Create the HTML File

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TracePilot — [Page Name]</title>
  <link rel="stylesheet" href="../shared/design-system-c.css">
  <style>
    /* Page-specific styles here */
  </style>
</head>
<body>
  <!-- Use component classes from the design system -->
  <div class="layout">
    <aside class="sidebar"><!-- nav --></aside>
    <main class="main-content"><!-- content --></main>
  </div>
  <script src="../shared/shared.js"></script>
  <script>
    // Page-specific interactivity
  </script>
</body>
</html>
```

### 2. Always Use Variant C Design Tokens

Reference the production design system: `shared/design-system-c.css`

Key tokens to use:
```css
/* Backgrounds */
background: var(--canvas-default);    /* Page background (#09090b) */
background: var(--canvas-subtle);     /* Card backgrounds (#111113) */

/* Text */
color: var(--text-primary);           /* Main text (#fafafa) */
color: var(--text-secondary);         /* Secondary text (#a1a1aa) */

/* Accent */
color: var(--accent-fg);              /* Indigo links/highlights (#818cf8) */
background: var(--accent-emphasis);   /* Indigo buttons (#6366f1) */

/* Semantic */
color: var(--success-fg);             /* Success (#34d399) */
color: var(--warning-fg);             /* Warning (#fbbf24) */
color: var(--danger-fg);              /* Danger (#fb7185) */
color: var(--done-fg);                /* Done (#a78bfa) */

/* Borders */
border: 1px solid var(--border-default);  /* rgba(255,255,255,0.10) */

/* Shadows */
box-shadow: var(--shadow-md);         /* Elevated cards */
```

### 3. Use Shared Interactivity

Include `shared/shared.js` for theme toggle, tabs, and collapsible sections.

### 4. Include Mock Data

For general pages, define mock data inline or import from `shared.js`.

### 5. Serve and Review

```bash
cd docs/design/prototypes
python -m http.server 3333
# Visit http://localhost:3333/your-page.html
```

---

## Design Decision Process

1. **Create variants** — Build 2–3 visual alternatives as HTML prototypes
2. **Compare side-by-side** — Use `design-report.md` to document tradeoffs
3. **Capture screenshots** — Save to `screenshots/` for async review
4. **Select winner** — Document rationale in the design report
5. **Implement in Vue** — Port the chosen prototype to the production app
6. **Clean up** — Remove rejected variants after implementation

---

## Related Documentation

- **Design system reference:** [`docs/design/design-system.md`](design-system.md)
- **Design comparison report:** [`docs/design/design-report.md`](design-report.md)
- **Production CSS:** `apps/desktop/src/styles.css`
- **Common UI components:** [`docs/common-frontend-components.md`](../common-frontend-components.md)
