# Dependency measurements and validation

[Overview](README.md) · [Changes](upgrades.md) · [Security](security.md) · [Roadmap](roadmap.md)

The comparison is the **entire audited change set** against merged main `e3ff0935641de98b96da49f9c2c9fb5b83e3cbf1`, not a sum of isolated improvements. All runs were local Windows observations on 2026-09-27 UTC. The candidate was measured as an uncommitted diff; its manifest/lock/source hashes and raw samples are preserved in the compact measurement record accompanying this page. Committing it for review does not change those content identities. Later changes on main are outside these paired measurements and require separate PR integration checks. Large stdout/stderr, timing HTML and captures remain in ignored `.agent/dependency-audit/`.

## Environment and method

- Windows 11 Pro 10.0.22621; AMD Ryzen 5 3600, six cores / 12 logical processors; 16,726,584 KiB physical memory; Balanced power plan. The machine was not a dedicated benchmark host.
- Rust/cargo 1.94.0, rustc `4a4ef493e` (2026-03-02), cargo `85eff7c80` (2026-01-15), LLVM 21.1.8; host `x86_64-pc-windows-msvc`. Installed default VS tools 14.40.33807 / linker file 14.40.33808.0; this is the discovered default MSVC installation, not a captured verbose linker command.
- Node 22.19.0 and npm 11.6.0 held constant. pnpm changes deliberately from 10.32.1 to 10.34.5. The patched candidate pnpm is isolated under the ignored audit tools directory; no global tool was replaced.
- Shipping release profile: opt-level 2, thin LTO, one codegen unit, strip enabled. No RUSTC_WRAPPER, CARGO_BUILD_JOBS or compiler-cache override; Cargo defaults to host concurrency. OS filesystem caches were uncontrolled. Only light source/document review ran during timed builds; workers did not compile/test/benchmark concurrently.
- A **fresh Rust build** means a new, previously nonexistent CARGO_TARGET_DIR, with downloaded registry sources already available. `--locked --offline` excludes registry download latency. Baseline and candidate each have separate fresh debug and release targets. One sample per side was collected because each release compile takes several minutes; no statistical speedup is claimed.
- Frontend and CLI timings are three consecutive fresh command processes with installed dependencies and uncontrolled warm filesystem/source caches. Vite regenerates dist; these are not empty-download or cold-OS-cache measurements. Desktop `pnpm build` includes vue-tsc and Vite; CLI `pnpm build:cli` includes tsc and esbuild. Runs are sequential by revision, not interleaved, so small timing differences are not causal evidence.
- Fresh pnpm installation uses new stores and no pre-existing node_modules. Baseline uses an immutable managed baseline checkout; candidate uses a fresh copy of the eight active manifests, catalog and lock (install scripts require no first-party source). Both report reused=0. Network conditions and global native prebuild caches are uncontrolled. This is one observation per side.
- Disk cost sums regular-file lengths below the new root node_modules and isolated store; reparse points/junctions are not followed. File IDs deduplicate hardlinks within and across the two roots. These are logical bytes, **not** NTFS allocated blocks. Per-workspace bin wrappers, checkout sources and global native prebuild caches are outside this defined footprint.
- RustSec uses the same saved advisory database commit for the pair. npm registry audit endpoints are live and offer no pinned advisory database revision; both were queried the same day, so database drift cannot be excluded. Scanner failures are not interpreted as zero findings.

## Paired observations

All entries below are **measured**. Deltas compare the complete retained change set; `n` is samples per revision. Timing rows use medians; memory rows use the maximum process peak. Counts and artifact lengths have one deterministic observation, not a distribution. Full samples, hashes and receipts are in the ignored `.agent/dependency-audit/measurements.json` capture.

### Dependency populations

| ID / metric (unit) | Baseline | Delivered | Absolute delta | Delta % | n |
| --- | ---: | ---: | ---: | ---: | ---: |
| COUNT-cargo — Cargo direct (declaration edges) | 119 | 113 | -6 | -5.04% | 1 |
| COUNT-pnpm — pnpm direct (declaration edges) | 77 | 75 | -2 | -2.60% | 1 |
| COUNT-npm-island — isolated npm direct (declaration edges) | 1 | 1 | 0 | +0.00% | 1 |
| COUNT-cargo_lock_packages — Cargo all-feature lock instances (packages) | 723 | 721 | -2 | -0.28% | 1 |
| COUNT-cargo_default_metadata_packages — Cargo default all-target metadata (packages) | 697 | 694 | -3 | -0.43% | 1 |
| COUNT-cargo_windows_metadata_packages — Cargo Windows resolver packages (packages) | 463 | 458 | -5 | -1.08% | 1 |
| COUNT-pnpm_lock_packages — pnpm locked packages (packages) | 429 | 430 | +1 | +0.23% | 1 |
| COUNT-npm_island_locked_nodes — isolated npm locked packages (packages) | 1 | 1 | 0 | +0.00% | 1 |
| COUNT-pnpm_local_presence_true — Windows pnpm installed packages (packages) | 316 | 308 | -8 | -2.53% | 1 |
| DUPLICATES-cargo — cargo duplicate-version families (families) | 63 | 63 | 0 | +0.00% | 1 |
| DUPLICATES-pnpm — pnpm duplicate-version families (families) | 46 | 46 | 0 | +0.00% | 1 |

### Build time and compiled units

| ID / metric (unit) | Baseline | Delivered | Absolute delta | Delta % | n |
| --- | ---: | ---: | ---: | ---: | ---: |
| TIME-rust-debug-fresh — rust-debug-fresh (seconds) | 216.192 | 218.988 | +2.796 | +1.29% | 1 |
| TIME-rust-release-fresh — rust-release-fresh (seconds) | 582.923 | 645.034 | +62.112 | +10.66% | 1 |
| TIME-frontend-build — frontend-build (seconds) | 42.248 | 43.893 | +1.645 | +3.89% | 3 |
| TIME-cli-build — cli-build (seconds) | 3.03 | 2.761 | -0.269 | -8.89% | 3 |
| TIME-frozen-install-fresh — frozen-install-fresh (seconds) | 12.417 | 13.333 | +0.916 | +7.38% | 1 |
| COMPILE-debug-unique_compiled_packages — debug unique_compiled_packages (count) | 418 | 413 | -5 | -1.20% | 1 |
| COMPILE-debug-timing_units — debug timing_units (count) | 605 | 604 | -1 | -0.17% | 1 |
| COMPILE-debug-compiler_artifact_messages — debug compiler_artifact_messages (count) | 536 | 535 | -1 | -0.19% | 1 |
| COMPILE-release-unique_compiled_packages — release unique_compiled_packages (count) | 416 | 411 | -5 | -1.20% | 1 |
| COMPILE-release-timing_units — release timing_units (count) | 698 | 693 | -5 | -0.72% | 1 |
| COMPILE-release-compiler_artifact_messages — release compiler_artifact_messages (count) | 611 | 606 | -5 | -0.82% | 1 |

### Artifacts and installed footprint

| ID / metric (unit) | Baseline | Delivered | Absolute delta | Delta % | n |
| --- | ---: | ---: | ---: | ---: | ---: |
| SIZE-desktop — Shipping-profile desktop executable (bytes) | 41,510,912 | 41,528,832 | +17,920 | +0.04% | 1 |
| SIZE-cli — CLI index.js (bytes) | 88,156 | 88,156 | 0 | +0.00% | 1 |
| BUNDLE-bytes — Desktop JS/CSS bytes (bytes) | 2,753,983 | 2,753,983 | 0 | +0.00% | 1 |
| BUNDLE-gzipBytes — Desktop JS/CSS gzipBytes (bytes) | 839,076 | 839,076 | 0 | +0.00% | 1 |
| BUNDLE-largestChunkKb — largestChunkKb (KiB) | 305.747 | 305.747 | 0 | +0.00% | 1 |
| BUNDLE-initialLoadChunks — initialLoadChunks (assets) | 3 | 3 | 0 | +0.00% | 1 |
| DISK-node_modules — node_modules logical footprint (bytes) | 306,736,839 | 321,054,923 | +14,318,084 | +4.67% | 1 |
| DISK-store — store logical footprint (bytes) | 304,180,749 | 318,560,356 | +14,379,607 | +4.73% | 1 |
| DISK-joint — Store + node_modules unique file IDs (bytes) | 317,147,630 | 331,554,821 | +14,407,191 | +4.54% | 1 |
| SIZE-nsis — Unsigned shipping-profile NSIS installer (bytes) | 9,662,044 | 9,673,511 | +11,467 | +0.12% | 1 |
| DISK-cli-runtime — Installed CLI external runtime closure (bytes) | 13,890,540 | 13,887,765 | -2,775 | -0.02% | 1 |
| SIZE-desktop-other — desktop non-JS/CSS dist assets (bytes) | 240,532 | 240,532 | 0 | +0.00% | 1 |
| SIZE-cli-other — cli non-JS/CSS dist assets (bytes) | 139,297 | 139,297 | 0 | +0.00% | 1 |
| SIZE-cli-native — CLI better-sqlite3 native addon (bytes) | 1,902,080 | 1,902,080 | 0 | +0.00% | 1 |
| SIZE-cli-dist — Entire CLI dist directory (bytes) | 333,633 | 333,633 | 0 | +0.00% | 1 |

### Security categories

| ID / metric (unit) | Baseline | Delivered | Absolute delta | Delta % | n |
| --- | ---: | ---: | ---: | ---: | ---: |
| SEC-npm — Unique full-pnpm advisories (advisories) | 27 | 0 | -27 | -100.00% | 1 |
| SEC-unsound — RustSec unsound warning instances (warnings) | 6 | 2 | -4 | -66.67% | 1 |
| SEC-unmaintained — RustSec maintenance warning instances (warnings) | 8 | 8 | 0 | +0.00% | 1 |

### Backend phase timings and memory

| ID / metric (unit) | Baseline | Delivered | Absolute delta | Delta % | n |
| --- | ---: | ---: | ---: | ---: | ---: |
| RUNTIME-0 — session index (fresh) (ms) | 470 | 422.5 | -47.5 | -10.11% | 4 |
| RSS-0 — session index (fresh) peak working set (MiB) | 34.34 | 34.18 | -0.16 | -0.47% | 4 |
| RUNTIME-1 — search index (fresh) (ms) | 327 | 331 | +4 | +1.22% | 4 |
| RSS-1 — search index (fresh) peak working set (MiB) | 35.523 | 35.656 | +0.133 | +0.37% | 4 |
| RUNTIME-2 — incremental search, 10 small changed (ms) | 57.5 | 57 | -0.5 | -0.87% | 4 |
| RSS-2 — incremental search, 10 small changed peak working set (MiB) | 9.555 | 9.445 | -0.109 | -1.14% | 4 |
| RUNTIME-3 — incremental search, 3 large changed (ms) | 194.5 | 197 | +2.5 | +1.29% | 4 |
| RSS-3 — incremental search, 3 large changed peak working set (MiB) | 30.145 | 30.293 | +0.148 | +0.49% | 4 |
| RUNTIME-4 — analytics disk-scan fallback (ms) | 120 | 117 | -3 | -2.50% | 4 |
| RSS-4 — analytics disk-scan fallback peak working set (MiB) | 34.426 | 34.387 | -0.039 | -0.11% | 4 |

Fresh build times are single observations: debug +1.3% and release +10.7% do **not** establish a speedup or a causal regression. Frontend baseline samples range 38.77–52.93 s versus final 43.37–45.92 s. CLI ranges 2.61–3.15 s versus 2.75–3.03 s. Security and ownership are the demonstrated benefits; installed tooling grew and shipping byte savings were not established.

The runtime corpus is fixture version 1, typical scale: 100 sessions, 17,292 events, 1,912 turns, 4,722 tool calls and 7,321,544 source bytes. Existing `probe-compare.mjs` ran four repetitions per revision in alternating ABBA-style order, with fresh scratch databases and one process per phase. No tested phase crossed its advisory ±15% band; this is a small fixed-corpus regression control, not proof of universal performance equivalence. Windows peak working set is not retained heap. These probes do not isolate LRU or IPC cache latency.

Unsigned NSIS installers were packaged from the saved shipping-profile executables using the same Tauri CLI, with updater artifacts/signing disabled. Packaging restored each input executable SHA-256 unchanged. These shipping-identity installers were **not installed**; installation behavior was separately tested with the dedicated E2E identity and CI functional profile (opt-level 2, no LTO, 16 codegen units). Signed updater and MSI behavior remain **not run**; they require signing material and the corresponding release environment.

## What changed and what did not

B01 removes six Cargo member edges and unused shared declarations; feature reduction alone does not eliminate packages still introduced elsewhere. In a like-for-like default all-target metadata view, B01 removes only serde_path_to_error (697 → 696). B02 additionally removes allocator-api2, producing 721 all-feature lock instances (723 baseline) and 694 default metadata packages (697 baseline). Do not compare 723 all-feature instances with 696 default packages and call the difference a saving.

The three Rust security targets and supported JS parent/lock refreshes were retained. B03/B04 toolchain resolution is a combined graph experiment: Vitest/tsx/esbuild/security refresh, redundant declaration removal and Lefthook provisioning share the final lock. Their standalone byte savings were not separately measured or summed. All 241 desktop dist files have identical relative names and SHA-256 hashes across the baseline artifact reconstruction and candidate, including JS/CSS, fonts and other assets; the dependency changes primarily affect build/test/install tooling.

The new Lefthook Windows executable is 14,122,496 bytes and is a major contributor to the net install footprint increase. It is developer tooling, not a shipped desktop or CLI runtime asset. The fresh install logs show only allowed esbuild and better-sqlite3 lifecycle scripts. `lefthook --version` returns 2.1.14; before/after Git hook hashes and core.hooksPath match. `pnpm ignored-builds` reports None because explicitly blocked `allowBuilds: false` is not a pending automatic build approval.

The desktop host serde_json removal was **rejected**: the first B01 all-target check failed with E0433 from `tauri::generate_context!` at main.rs:49. It was restored with a manifest comment, and the corrected check passed. This failed experiment contributes no claimed final saving.

The UI compiler-dom removal was also **rejected**. Playwright CT generates a compiler import in its UI entry; a transitive copy under Vue does not provide that importer link in pnpm. Restoring the baseline direct dev declaration (`^3.5.0`, locked 3.5.30) repairs the test build. The final count is 75 pnpm declarations, a net reduction of two after three removals and the new Lefthook declaration. Fresh install measurements and graph capture were repeated after restoration. Shipping JS/CSS and Rust runtime dependency versions were unaffected by this restoration.

## Compile attribution and artifacts

Cargo timing rows include compile/build-script units and can overlap in wall time. They cannot be added as a serial critical path. Compiler-artifact JSON messages are a different population again; the compact record gives both units and unique compiled package identities. Resolved packages that did not compile on Windows are not counted as shipped.

Baseline release hotspots were the desktop crate (233.9 s), bindings (182.5 s), SDK (108.5 s) and windows 0.61.3 (82.3 s). These are unit durations, not independent costs that can be subtracted from total wall time. Feature/declaration cleanup does not eliminate those families. The fresh Cargo desktop release builds include embedded already-built frontend assets, but do not run Tauri's beforeBuildCommand or create an installer; frontend timing is reported separately.

The CLI output is an ESM JavaScript bundle requiring Node and external `better-sqlite3`, `chalk`, `commander` and `yaml` packages. Its output size alone is not a standalone executable/distribution footprint. The native todo smoke specifically exercises createRequire/better-sqlite3 loading. Detached published-package installation was not established by a workspace smoke.

The entire CLI dist directory is 333,633 bytes on both sides, including generated modules, declarations and maps; index.js alone is 88,156 bytes. Its four external roots introduce 41 installed runtime/optional packages with no unresolved required edges. Their logical closure is 13,890,540 → 13,887,765 bytes, including generated pnpm bin wrappers; wrapper format and checkout-path differences affect this small delta, so it is not a product byte-saving claim. The 1,902,080-byte better-sqlite3 Windows addon has identical SHA-256 on both sides. The separately measured desktop non-JS/CSS assets total 240,532 bytes on both sides.

## Correctness and native validation

| Contract | Final result and boundary |
| --- | --- |
| Frozen install / peers | Pass on a new candidate store and manifest-only install root; compiler-dom restoration included. No Git hooks installed. |
| JavaScript unit suite | 4,026 tests in 439 files pass across types, client, CLI, UI and desktop. Vitest 4 mock migrations preserve the tested behavior. |
| Rust workspace | 1,722 pass, seven intentionally ignored; no failures; desktop excluded by the repository test contract. Separate desktop release and native tests pass. |
| Rust quality / optional features | Clippy with warnings denied, rustfmt, desktop tokio-console compile, and benchmark dhat-heap example compile pass. Profiler runtime and other native targets were not run. |
| TypeScript / generated IPC | Root recursive typecheck and gen:bindings pass; no generated-file diff. |
| Frontend / CLI / native SQLite | Production builds pass; CLI smoke creates a real todo database and exercises the external better-sqlite3 loader. |
| Component tests | 5/6 pass on both baseline and candidate. PageHeader expects 1232×32 and renders 1232×49; both actual PNGs have SHA-256 `138efaea9f25fc44cae4e2fe8d0b504055c1de60feaf8f9d6625fd9e0f3be609`. No snapshot update. |
| Native Windows integration | 3/3 journeys pass: first-run indexing, detail/search/todos/analytics, data refresh, empty-to-populated discovery and persisted settings/restart. Dedicated NSIS install/uninstall exits 0; registered E2E identity removed. |
| Interactive native app | app:start verified real Rust IPC using a fresh 128-session corpus; library, overview and conversation inspected. Captures opened at 1440×960, 960×640 and 2560×1440. No console errors; slow-indexing and unavailable notification action-registration warnings recorded. Matching app processes stopped and CLI detached. |
| Repository policy | Catalog, CSP, public API, docs links, ADR, file sizes, pinned workflow actions and three design gates pass. Z-index policy fails on unchanged baseline FileContextMenu.vue:84. Catalog retains a Vue peer warning and Lucide hoist suggestion. |
| Script / pricing / publisher contracts | 138 Node script tests and two Python publisher extraction tests pass; pricing matches the frozen source (44 token tiers, 18 annual multipliers). Final Biome check passes. |
| Graph invariants | 15 tests pass, including source/checksum/integrity identity, peer-context edges, direct census, absence handling and explicit per-node update disposition. |
| Security and distribution policy | Full/prod pnpm and isolated npm audits pass at zero findings; fixed-DB RustSec has zero vulnerabilities, eight maintenance and two unsound notices. Cargo-deny exits 7 with remaining policy/advisory findings and scanner-resolution diagnostics; see security. |

Linux/macOS native compilation, paid/provider-backed Copilot execution, signed updater/MSI installation, notification actions/native dialogs and detached published CLI installation remain **not run**. Resolver graphs, protocol-peer tests and workspace smoke tests do not establish those contracts. Their prerequisites and follow-up ownership are in the roadmap.

A clean npm/RustSec vulnerability category does not clear the remaining maintenance/unsoundness, distribution-policy or scanner-resolution notices. Cargo-deny still fails; its classes and exact scanner limitations are in [security](security.md). Advisory bundle budgets remain exceeded at baseline and candidate; they were not weakened.

## Reproduce

Run from the repository root after installing the declared toolchain. Preserve an immutable baseline checkout before edits. New target/store directories are required for fresh measurements; do not delete normal caches.

```powershell
pnpm install --frozen-lockfile --strict-peer-dependencies
python scripts/dependencies/capture_inputs.py final --pnpm-cli <existing-pnpm-cli.cjs>
python scripts/dependencies/generate_graph.py final
python scripts/dependencies/test_graph.py --graph .agent/dependency-audit/final/graph.json

$env:CARGO_TARGET_DIR = '<new-owned-debug-target>'
cargo build --locked --offline --workspace --timings --message-format=json
$env:CARGO_TARGET_DIR = '<new-owned-release-target>'
cargo build --locked --offline --release -p tracepilot-desktop --timings --message-format=json

# Run each of these three times, sequentially; record wall time and exit status.
pnpm build
pnpm build:cli
node scripts/perf/check-bundle.mjs --output=<owned-bundle.json> --summary=<owned-bundle.md>

pnpm typecheck
pnpm test
node --test scripts/cli/cli-smoke.test.mjs
cargo test --locked --workspace --exclude tracepilot-desktop
cargo clippy --locked --workspace --exclude tracepilot-desktop --all-targets -- -D warnings
cargo fmt --all -- --check
pnpm gen:bindings
# Inspect generated-file diff; do not hand-edit generated output.
node scripts/check-catalog-drift.mjs
node scripts/check-csp.mjs
node scripts/check-public-api.mjs
node scripts/check-doc-links.mjs
node scripts/check-adr.mjs
```

For runtime comparisons, build `performance_probe` and `index_probe` in each saved release target, generate one corpus with `performance_probe generate --root <new-absolute-owned-root> --scale typical`, then run:

```powershell
node scripts/perf/probe-compare.mjs --base=<baseline-index-probe.exe> --head=<candidate-index-probe.exe> --sessions=<corpus>/copilot/session-state --work=<new-owned-scratch> --repeats=4 --output=<result.json> --summary=<result.md>
```

For the unsigned packaging comparison, set each revision's `CARGO_TARGET_DIR` to its saved shipping target and run `pnpm tauri bundle --bundles nsis --ci --no-sign --config <override.json>`, where the override contains `{"bundle":{"createUpdaterArtifacts":false}}`. Compare installer lengths and check that the bundler restores the input executable hash. The separate native install journey uses `pnpm test:e2e -Install`; to serialize its builds, follow the staged commands in the E2E harness and invoke it with `-Install -SkipBuild` after the frontend, fixture and dedicated installer exist. Never compare its CI codegen binary size with a shipping-profile binary.

Use the optional-feature commands in [Rust](rust-versions.md), the [native E2E contract](../../tests/e2e/README.md) and [app automation skill](../../.github/skills/tracepilot-app-automation/SKILL.md) for native checks. E2E data and runtime probes must use owned synthetic roots. Do not use the user's live session directory or contact a paid model provider as part of a dependency check.

Baseline raw samples are immutable. If future code, toolchains or fixtures differ, create a new pair and identify the changed variables; do not compare a warm build with these fresh samples or unrelated CI timings. Signed installers/updaters and other-platform runtime performance require their own environment and are not represented by Windows resolver graphs.
