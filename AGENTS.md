# Running UI development

When a task needs to observe or verify the running app, read
[the app automation skill](.github/skills/tracepilot-app-automation/SKILL.md).
It uses the pinned Playwright agent CLI; agents start the real Windows Tauri app
with `pnpm app:start -Instance <slug> -Fixtures` (synthetic data) and drive it
with `pnpm pw <slug> …`. Frontend-only mocks are available with `pnpm app:ui`, but do
not prove backend behavior.

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
[docs/agents/protocol.md](docs/agents/protocol.md). When choosing what to improve, skip the experimental areas listed in
[focus.md](docs/agents/focus.md) unless you're asked to work on them.

# Working here as an agent

- **Validate** with `pnpm check:changed`; it runs the
  [protocol's table](docs/agents/protocol.md#verify-proportionately) rows that match
  your diff. Don't run `just ci` before pushing; the PR's CI is the full gate.
  Run it locally only when you aren't confident a change will pass, as the protocol describes.
- **Finish** (unless told otherwise) by committing, pushing, opening the PR,
  reporting its link, and stopping. Workers don't watch CI; an orchestrator waits with
  `gh pr checks <n> --watch --fail-fast`. Never sleep-then-check.
- **Changelog:** add a `changelog.d/<slug>.md` fragment for user-facing changes;
  never edit `CHANGELOG.md`.
- **App:** `pnpm app:start -Instance <slug> -Fixtures`, or `-RealData` when the
  maintainer asks you to check their own sessions. That's pre-authorized for local
  verification only; real data never goes into commits, PRs or screenshots.
- **Editing:** prefer the Edit tool. Put scripted edits in a script file, not an
  inline heredoc. Set `PYTHONUTF8=1` for Python. `jq` isn't installed; use `node -e`.
- **Windows shells:** PowerShell doesn't expand globs, so use `rg -g '<glob>'`.
  Single-quote patterns. Use `pwsh -NoProfile`, and check `$LASTEXITCODE` after
  native commands.
- **Worktrees:** stay inside yours and don't `cd` to other absolute paths. Create
  one with `pnpm worktree:new <slug>`, remove finished ones with
  `pnpm worktree:clean`. Build setup and sccache: [local builds](docs/local-builds.md).
- **Generated-file conflicts** (`bindings.ts`, `ipc-commands.json`): re-run
  `pnpm gen:bindings` instead of resolving by hand.

# Releases

To prepare a release ("update the project to vX.Y.Z"), follow
[the release guide](docs/releasing.md) up to an open PR.

# Repository notes

For site work, read [the landing-page guide](docs/landing-page.md) and run `pnpm site:check` after building.

Each worktree builds its own Rust `target/`. See [local builds](docs/local-builds.md)
for worktree setup, sccache and housekeeping; after changing Rust dependencies,
run `cargo hakari generate && cargo hakari manage-deps`.

Keep session scratch files, logs, and one-off audit reports outside tracked
source (or in an existing ignored agent area). Add a reusable script only when
it has a clear purpose and a discoverable invocation in `scripts/README.md`.
Put lasting decisions and troubleshooting guidance in the relevant canonical
document instead of a new dated completion report.
