# Running UI development

When a task needs to observe or verify the running app, read
[the app automation skill](.github/skills/tracepilot-app-automation/SKILL.md).
It uses the pinned Playwright agent CLI; start the real Windows Tauri app with
`pnpm app:start` and attach using the printed command. Frontend-only mocks are
available with `pnpm app:ui`, but do not prove backend behavior.

Prioritize the default 1440×960 desktop viewport, then the 960×640 minimum and a
larger 2560×1440 viewport. See [automation](docs/app-automation.md) and
[testing](docs/testing.md) for lifecycle, diagnostics, and validation commands.

For synthetic fixtures and focused capture commands, see
[visual regression](docs/visual-regression.md). Keep renderer fixture coverage
current when adding rich tools; keep one-off stress data and captures untracked.

# Autonomous improvement tasks

Reusable task cards for autonomous agents live in [docs/agents](docs/agents/README.md).
Launch one with `Read docs/agents/tasks/<card>.md and follow it.` The shared rules
(isolated named app instances, proportionate verification, PR format) are in
[docs/agents/protocol.md](docs/agents/protocol.md). When several agents share this
machine, start the app with `pnpm app:start -Instance <name> -Fixtures`.
When choosing what to improve, skip the experimental areas listed in
[focus.md](docs/agents/focus.md) unless you're asked to work on them.

# Releases

To prepare a release ("update the project to vX.Y.Z"), follow
[the release guide](docs/releasing.md) up to an open PR.

# Repository notes

For site work, read [the landing-page guide](docs/landing-page.md) and run `pnpm site:check` after building.

Keep session scratch files, logs, and one-off audit reports outside tracked
source (or in an existing ignored agent area). Add a reusable script only when
it has a clear purpose and a discoverable invocation in `scripts/README.md`.
Put lasting decisions and troubleshooting guidance in the relevant canonical
document instead of a new dated completion report.
