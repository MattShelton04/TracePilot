# Visual Regression Test (VRT) Harness — `@tracepilot/ui`

Component-level VRT for shared Vue components. Built on Playwright Component
Testing (`@playwright/experimental-ct-vue`) and runs **on-demand**, not as part
of default `pnpm test` or CI gates (see _Known limitations_ below).

## What this gates

Pixel-diff coverage of the shared components most likely to regress during
Phase 4 view decomposition:

- `StatCard` — default / `variant=plain` / `accentColor` / gradient / `labelStyle=uppercase`
- `TabNav` — default / with icons / `variant=pill` / staggered
- `PageHeader` — default / `size=sm` / `size=lg` / `inlineSubtitle`
- `SegmentedControl` — `rounded=square` (default) / `rounded=pill`
- `PageShell` — default slot

Each test mounts the component via Playwright CT, locks the viewport to
1280×720, forces `prefers-color-scheme: dark` + `reducedMotion: reduce`,
disables every CSS transition/animation (`playwright/index.ts`), and compares
against a baseline PNG with `maxDiffPixels: 50`.

## Commands

```bash
# Run VRT (fails on pixel drift)
pnpm --filter @tracepilot/ui vrt

# Regenerate baselines after an intentional visual change
pnpm --filter @tracepilot/ui vrt:update
# equivalent: UPDATE_SNAPSHOTS=1 pnpm --filter @tracepilot/ui vrt
```

One-time Chromium download (~150 MB):

```bash
pnpm --filter @tracepilot/ui exec playwright install chromium
```

## Adding a new baseline

1. Create `packages/ui/src/__vrt__/<Component>.vrt.spec.ts`.
2. Mount the component with minimal props for the variants you want to pin.
3. Call `expect(component).toHaveScreenshot('<variant>.png', { maxDiffPixels: 50 })`.
4. Run `pnpm --filter @tracepilot/ui vrt:update` to produce the baseline PNGs.
5. Commit the new `__screenshots__/**` files alongside the spec.

## Updating existing baselines

Only when the visual change is **intentional**:

```bash
pnpm --filter @tracepilot/ui vrt:update
git add packages/ui/src/__vrt__/__screenshots__
```

Review the diff of the PNGs in the PR (GitHub renders image diffs inline). Any
snapshot change that is _not_ explained by the diff should be treated as a bug.

## Known limitations

1. **Windows vs Linux font rendering.** Baselines are captured on the
   developer's local machine. A Windows-captured baseline will _not_ match
   Linux pixel-for-pixel (sub-pixel antialiasing, font hinting, emoji rasters
   all differ). Until a dedicated Linux CI job exists, baselines should be
   refreshed together on one OS and VRT should stay off the default CI gates.
2. **Component-level only.** View-level (App shell, `SessionLauncherView`,
   `AnalyticsDashboardView`, …) VRT is **not** included yet.
3. **No Tauri IPC mocking.** Components that require `invoke()` from
   `@tauri-apps/api` cannot be snapshotted here yet.

## Follow-up (future waves)

- View-level VRT via Playwright + a mocked Tauri IPC transport, timed to land
  with Phase 4 decomposition so each decomposed view has a pixel-diff gate.
- Linux-only CI job that regenerates baselines nightly and posts a diff
  artifact to PRs (keeps Windows devs unblocked without breaking gates).
- Extend component coverage as new shared components ship (Badge, ModalDialog,
  DataTable, ToastContainer, …).
