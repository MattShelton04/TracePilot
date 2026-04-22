# `tests/e2e/` — intentionally empty

TracePilot does **not** host desktop end-to-end tests here. The canonical
E2E path is the `tracepilot-app-automation` skill, which drives the real
Tauri 2 + WebView2 app over Chrome DevTools Protocol.

- **Runtime scenarios:** `scripts/e2e/*.mjs` (start with `smoke-test.mjs`).
- **Launcher / shutdown:** `scripts/e2e/launch.ps1` / `scripts/e2e/stop.ps1`.
- **Skill doc:** `.github/skills/tracepilot-app-automation/SKILL.md`.
- **Testing guide:** `docs/testing.md`.

Component-level visual regression lives under
`packages/ui/src/__vrt__/` (Playwright CT) and is documented in
`packages/ui/src/__vrt__/README.md`.

If you find yourself wanting to add a `*.spec.ts` under `tests/e2e/`, read
`docs/testing.md` first — the runtime layer is covered by the automation
skill rather than a Playwright project config.
