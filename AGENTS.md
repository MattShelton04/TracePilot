# Running UI development

When a task needs to observe or verify the running app, read
[the app automation skill](.github/skills/tracepilot-app-automation/SKILL.md).
It uses the pinned Playwright agent CLI; start the real Windows Tauri app with
`pnpm app:start` and attach using the printed command. Frontend-only mocks are
available with `pnpm app:ui`, but do not prove backend behavior.

Prioritize the default 1440×960 desktop viewport, then the 960×640 minimum and a
larger 2560×1440 viewport. See [automation](docs/app-automation.md) and
[testing](docs/testing.md) for lifecycle, diagnostics, and validation commands.

# Repository notes

Keep session scratch files, logs, and one-off audit reports outside tracked
source (or in an existing ignored agent area). Add a reusable script only when
it has a clear purpose and a discoverable invocation in `scripts/README.md`.
Put lasting decisions and troubleshooting guidance in the relevant canonical
document instead of a new dated completion report.
