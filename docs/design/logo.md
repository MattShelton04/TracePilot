# Logo & Branding

## Asset files

| File | Purpose |
|------|---------|
| `assets/logo.svg` | Full-color logo (README, marketing) |
| `assets/logo-white.svg` | `currentColor` variant (adapts to parent `color`) |
| `assets/logo-icon.svg` | Filled indigo hex + white eye (raster icon source) |

## Shared component

All in-app logo usage goes through a single Vue component:

```vue
import LogoIcon from '@/components/icons/LogoIcon.vue';

<LogoIcon :size="24" />
```

The `size` prop controls the rendered pixel dimensions. The SVG geometry is defined once in `LogoIcon.vue` — do **not** inline SVG paths elsewhere.

## Updating the logo

1. **Edit the SVG geometry** in `assets/logo.svg` (the source of truth for the design)
2. **Mirror the geometry** into `assets/logo-white.svg` (replace colors with `currentColor`)
3. **Mirror the geometry** into `assets/logo-icon.svg` (filled hex + white strokes)
4. **Update `LogoIcon.vue`** — copy the same path/polygon/circle elements using `currentColor`
5. **Update `apps/desktop/public/favicon.svg`** — copy from `assets/logo-icon.svg`
6. **Regenerate Tauri bundle icons:**
   ```bash
   cd apps/desktop
   pnpm tauri icon ../../assets/logo-icon.svg
   ```
   This produces `src-tauri/icons/` — ico, icns, and PNGs for all platforms.
7. **Delete mobile dirs** (desktop-only app):
   ```bash
   rm -rf apps/desktop/src-tauri/icons/android apps/desktop/src-tauri/icons/ios
   ```

## Where the logo appears

| Location | File | Variant |
|----------|------|---------|
| Sidebar brand | `AppSidebar.vue` | `<LogoIcon>` (white via container CSS) |
| Setup wizard | `SetupWizard.vue` | `<LogoIcon>` (white via container CSS) |
| Settings about | `SettingsView.vue` | `<LogoIcon>` (white via container CSS) |
| Desktop icon | `src-tauri/icons/icon.ico` | Generated from `logo-icon.svg` |
| macOS icon | `src-tauri/icons/icon.icns` | Generated from `logo-icon.svg` |
| Favicon | `public/favicon.svg` | Copy of `logo-icon.svg` |
| README | `README.md` | `<img src="assets/logo.svg">` |

## Design notes

- The hex badge fills ~95% of the 64×64 viewBox (points reach x=5/59, y=2/62)
- All in-app containers use indigo gradient backgrounds — the `currentColor` variant inherits `color: white` from CSS
- The `tauri icon` command also generates Appx (Windows Store) PNGs — these are kept
