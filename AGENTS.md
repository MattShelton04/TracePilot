# Running UI development

When a task needs to observe or verify the running app, read
[the app automation skill](.github/skills/tracepilot-app-automation/SKILL.md).
It uses the pinned Playwright agent CLI; start the real Windows Tauri app with
`pnpm app:start` and attach using the printed command. Frontend-only mocks are
available with `pnpm app:ui`, but do not prove backend behavior.

Prioritize the default 1440×960 desktop viewport, then the 960×640 minimum and a
larger 2560×1440 viewport. See [automation](docs/app-automation.md) and
[testing](docs/testing.md) for lifecycle, diagnostics, and validation commands.

For rich tools and large Session Metrics, generate the shared synthetic corpus
with `node scripts/fixtures/session-fixtures.mjs`, then launch with
`pnpm app:start -DataRoot <absolute-path-to-.tracepilot/tool-metrics-fixtures>`.
The generator preserves config/index data and refuses edited fixtures; use a
fresh `--root` after changing fixture contracts. Focused visual captures use
`node scripts/visual/capture.mjs --group=rich-tools` or `--group=metrics`
(`--channel=msedge` on Windows). Default CI covers App views and Rich tools in
separate report sections; Metrics stress is local opt-in. Keep generated sessions
and screenshots ignored; only generators and tests belong in source.
See [visual regression](docs/visual-regression.md) for cases, viewport options,
and iteration. Keep renderer registry coverage in
`scripts/fixtures/session-fixtures.test.mjs` current when adding tools.

# Repository notes

Keep session scratch files, logs, and one-off audit reports outside tracked
source (or in an existing ignored agent area). Add a reusable script only when
it has a clear purpose and a discoverable invocation in `scripts/README.md`.
Put lasting decisions and troubleshooting guidance in the relevant canonical
document instead of a new dated completion report.
