# @tracepilot/ui

Shared Vue 3 component library and design-token source for TracePilot apps.

## Design tokens

The canonical design tokens live in [`src/styles/tokens.css`](./src/styles/tokens.css). That file defines every CSS custom property consumed by components in this package (colors, typography, spacing, radii, shadows, z-index, transitions, agent/chart palettes, syntax highlighting, etc.) for both the default dark theme (`:root`) and the light theme (`:root[data-theme="light"]`).

### Consumer contract

Components in this package read tokens unconditionally via `var(--token-name, …)`. **They will render unstyled if the consuming app does not load `tokens.css`.** Apps MUST import the stylesheet at (or near) the top of their global CSS cascade:

```css
/* apps/your-app/src/styles.css */
@import "@tracepilot/ui/tokens.css";
/* …your app's own styles follow… */
```

TypeScript / JavaScript consumers that need to read token values programmatically (e.g., for Chart.js datasets or canvas animations) should use the runtime helpers exported from the package:

```ts
import { getChartColors, getDesignToken, getSemanticColors } from "@tracepilot/ui";

const accent = getDesignToken("--accent-fg");
const chartPalette = getChartColors();
```

These helpers call `getComputedStyle(document.documentElement).getPropertyValue(...)`, so `tokens.css` must be loaded before any component that invokes them mounts. No hardcoded hex fallbacks are embedded in the helpers — `tokens.css` is the single source of truth.

### Required CSS variables

See the comment banner and groupings inside [`src/styles/tokens.css`](./src/styles/tokens.css) for the authoritative list. Broadly:

- `--font-family`, `--font-mono`
- `--canvas-*`, `--surface-*`, `--border-*`
- `--text-*`
- `--accent-*`, `--success-*`, `--warning-*`, `--danger-*`, `--done-*`, `--neutral-*`, `--attention-*`
- `--shadow-*`, `--gradient-*`
- `--radius-*`, `--transition-*`, `--z-*`
- `--sidebar-width`, `--sidebar-collapsed`, `--header-height`, `--content-max-width`
- `--chart-*`, `--agent-color-*`, `--syn-*`
- `--state-hover-overlay`, `--backdrop-color`, `--chart-tooltip-bg`, `--chart-tooltip-fg`, `--chart-active-emphasis`

Forking these values in a consumer's own stylesheet is not supported; update `tokens.css` in `@tracepilot/ui` and let consumers pick up the change.

## Package exports

| Subpath                      | Purpose                                     |
| ---------------------------- | ------------------------------------------- |
| `@tracepilot/ui`             | Vue components, composables, utilities      |
| `@tracepilot/ui/tokens.css`  | Canonical design-token CSS (import in apps) |

## Compatibility shims (temporary)

For one release after wave 14 (phase 5.2), `apps/desktop` keeps thin re-export shims so existing imports keep working:

- `apps/desktop/src/styles/design-tokens.css` → re-imports `@tracepilot/ui/tokens.css`
- `apps/desktop/src/utils/designTokens.ts` → re-exports the readers from `@tracepilot/ui`

Both will be deleted in the release following 0.6.x; migrate desktop call sites to the package paths directly.

## Scripts

```bash
pnpm --filter @tracepilot/ui typecheck
pnpm --filter @tracepilot/ui test run
```
