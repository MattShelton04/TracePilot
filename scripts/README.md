# `scripts/`

Helper scripts invoked by developers and CI. Everything here is either a
cross-platform Node/Python script or a paired PowerShell + POSIX shell shim.
Keep this index in sync when scripts are added, renamed, or removed.

## Index

| Script | Purpose |
| --- | --- |
| `bench.ps1` | Run the `tracepilot-bench` Criterion suite locally (Windows). |
| `build.ps1` | Full release build of the desktop app + Rust workspace (Windows). |
| `bump-version.ps1` | Synchronise the Cargo workspace/lockfile and root/pnpm workspace package versions. Tauri inherits the Cargo version; third-party fixtures and non-workspace packages are excluded. |
| `check-file-sizes.mjs` | File-size gate enforced by lefthook/CI. Fails on new per-file LOC-cap violations; see top-of-file allowlist. |
| `clean.ps1` | Remove build artefacts (`target/`, `dist/`, `node_modules/.cache`, etc.). |
| `dev.ps1` | Launch `pnpm tauri dev` with sensible local defaults (Windows). |
| `pgo-build.ps1` / `pgo-build.sh` | Two-phase profile-guided optimisation build of the Rust workspace. |
| `validate-session-versions.py` | Verify `supported-copilot-versions.json` covers the Copilot CLI session schema fixtures under `packages/test-utils/fixtures/`. |
| `automation/` | Development lifecycle and native readiness checks behind `pnpm app:start`, `app:ui`, `app:status`, and `app:stop`. Interaction uses the upstream Playwright CLI; see [automation](../docs/app-automation.md). |
| `e2e/test.ps1` | Build and run the native integration suite; `-Install` also installs/uninstalls the isolated NSIS package. See [native integration tests](../tests/e2e/README.md). |
| Other `e2e/` scripts | Optional diagnostics for the running Tauri app: shared `connect.mjs`, `smoke-test.mjs`, `perf-profile.mjs`, and README media capture. See [testing](../docs/testing.md). |

## Conventions

- **Windows-first** — PowerShell scripts are the canonical form; any POSIX `.sh`
  counterpart is expected to mirror behaviour, not extend it.
- **No implicit installs** — scripts assume `pnpm install` has already been run.
  `package.json#scripts.start` deliberately does NOT chain `pnpm install` (see
  Plan §6.3 / Wave 48).
- **Node scripts use `.mjs`** and rely only on Node ≥ 20 built-ins unless a dep
  is already in the root `devDependencies`.

## Deferred

A `justfile` mirroring the `.ps1` scripts and a Node/TS port of
`validate-session-versions.py` are tracked under Plan §6.3 and remain out
of scope for the current wave. The `tracepilot-app-automation` skill and
Playwright CLI remain the interactive path. The native integration suite in
`tests/e2e/` is the repeatable CI gate; older smoke/perf scripts remain optional
diagnostics (see [testing](../docs/testing.md)).
