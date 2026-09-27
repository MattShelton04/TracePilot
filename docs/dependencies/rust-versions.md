# Rust direct version review

This table covers all 48 third-party crate names declared directly in the eight Rust manifests at baseline revision e3ff0935641de98b96da49f9c2c9fb5b83e3cbf1. The [direct declaration inventory](rust.md) has all 119 individual rows, including scope, features, target, use site and six removals. Versions and declared MSRV/license below were verified against the live primary crates.io API on 2026-09-27. Latest stable is registry publication status; the compatible candidate is the highest non-yanked stable version admitted by the baseline Cargo requirement. Exact prerelease pins were checked separately.

The working branch currently updates direct lru to 0.18.5 and transitive anyhow to 1.0.104; all other direct locked versions are retained at this snapshot. “Keep current” is the recommendation unless a row names a coordinated migration or security fix. Compatibility is a resolver property, not proof of API behavior, MSRV for undeclared crates or platform packaging.

| Group | Names |
| --- | ---: |
| Patch decisions | 2 |
| Exact pin groups | 5 |
| Tauri native coordination | 8 |
| API or major-line deferrals | 11 |
| Routine and current | 22 |

## Patch decisions

| Crate / primary registry | Baseline constraint and lock | Current / candidate / latest stable | Declared candidate MSRV and license | Recommendation and reason |
| --- | --- | --- | --- | --- |
| [anyhow](https://crates.io/api/v1/crates/anyhow) | ^1; 1.0.102 | 1.0.104 (transitive; direct removed) / 1.0.104 / 1.0.104 | 1.68; MIT OR Apache-2.0 | Keep patched transitive 1.0.104; unused direct edge removed. |
| [lru](https://crates.io/api/v1/crates/lru) | ^0.12; 0.12.5 | 0.18.5 / 0.12.5 / 0.18.5 | baseline candidate MSRV not declared; delivered 0.18.5 MSRV 1.85.0; MIT | Keep patched 0.18.5; test cache eviction/resize and audit. |

## Exact pin groups

| Crate / primary registry | Baseline constraint and lock | Current / candidate / latest stable | Declared candidate MSRV and license | Recommendation and reason |
| --- | --- | --- | --- | --- |
| [github-copilot-sdk](https://crates.io/api/v1/crates/github-copilot-sdk) | =1.0.14; 1.0.14 | 1.0.14 / 1.0.14 / 1.0.14 | 1.94.0; MIT | Keep exact 1.0.14; always-compiled SDK sets Rust 1.94.0 floor. |
| [specta](https://crates.io/api/v1/crates/specta) | =2.0.0-rc.24; 2.0.0-rc.24 | 2.0.0-rc.24 / 2.0.0-rc.24 / 1.0.5 (stable 1.x is an older API line) | not declared; MIT | Keep exact IPC codegen quartet; migrate together only with generated TS contract validation. |
| [specta-serde](https://crates.io/api/v1/crates/specta-serde) | =0.0.11; 0.0.11 | 0.0.11 / 0.0.11 / 0.0.12 | not declared; MIT | Keep exact IPC codegen quartet; migrate together only with generated TS contract validation. |
| [specta-typescript](https://crates.io/api/v1/crates/specta-typescript) | =0.0.11; 0.0.11 | 0.0.11 / 0.0.11 / 0.0.12 | not declared; MIT | Keep exact IPC codegen quartet; migrate together only with generated TS contract validation. |
| [tauri-specta](https://crates.io/api/v1/crates/tauri-specta) | =2.0.0-rc.24; 2.0.0-rc.24 | 2.0.0-rc.24 / 2.0.0-rc.24 / 1.0.2 (stable 1.x is an older API line) | not declared; MIT | Keep exact IPC codegen quartet; migrate together only with generated TS contract validation. |

## Tauri native coordination

| Crate / primary registry | Baseline constraint and lock | Current / candidate / latest stable | Declared candidate MSRV and license | Recommendation and reason |
| --- | --- | --- | --- | --- |
| [tauri](https://crates.io/api/v1/crates/tauri) | ^2; 2.10.3 | 2.10.3 / 2.12.0 / 2.12.0 | 1.90; Apache-2.0 OR MIT | Keep current native set pending coordinated Tauri/plugin, JS package, capability and packaging tests. |
| [tauri-build](https://crates.io/api/v1/crates/tauri-build) | ^2; 2.5.6 | 2.5.6 / 2.7.0 / 2.7.0 | 1.90; Apache-2.0 OR MIT | Keep current native set pending coordinated Tauri/plugin, JS package, capability and packaging tests. |
| [tauri-plugin-dialog](https://crates.io/api/v1/crates/tauri-plugin-dialog) | ^2.6.0; 2.6.0 | 2.6.0 / 2.8.0 / 2.8.0 | 1.90; Apache-2.0 OR MIT | Keep current native set pending coordinated Tauri/plugin, JS package, capability and packaging tests. |
| [tauri-plugin-log](https://crates.io/api/v1/crates/tauri-plugin-log) | ^2; 2.8.0 | 2.8.0 / 2.10.0 / 2.10.0 | 1.90; Apache-2.0 OR MIT | Keep current native set pending coordinated Tauri/plugin, JS package, capability and packaging tests. |
| [tauri-plugin-notification](https://crates.io/api/v1/crates/tauri-plugin-notification) | ^2; 2.3.3 | 2.3.3 / 2.5.0 / 2.5.0 | 1.90; Apache-2.0 OR MIT | Keep current native set pending coordinated Tauri/plugin, JS package, capability and packaging tests. |
| [tauri-plugin-opener](https://crates.io/api/v1/crates/tauri-plugin-opener) | ^2; 2.5.3 | 2.5.3 / 2.6.0 / 2.6.0 | 1.90; Apache-2.0 OR MIT | Keep current native set pending coordinated Tauri/plugin, JS package, capability and packaging tests. |
| [tauri-plugin-process](https://crates.io/api/v1/crates/tauri-plugin-process) | ^2; 2.3.1 | 2.3.1 / 2.4.0 / 2.4.0 | 1.90; Apache-2.0 OR MIT | Keep current native set pending coordinated Tauri/plugin, JS package, capability and packaging tests. |
| [tauri-plugin-updater](https://crates.io/api/v1/crates/tauri-plugin-updater) | ^2; 2.10.0 | 2.10.0 / 2.13.0 / 2.13.0 | 1.90; Apache-2.0 OR MIT | Keep current native set pending coordinated Tauri/plugin, JS package, capability and packaging tests. |

## API or major-line deferrals

| Crate / primary registry | Baseline constraint and lock | Current / candidate / latest stable | Declared candidate MSRV and license | Recommendation and reason |
| --- | --- | --- | --- | --- |
| [axum](https://crates.io/api/v1/crates/axum) | ^0.7; 0.7.9 | 0.7.9 / 0.7.9 / 0.8.9 | 1.66; MIT | Keep 0.7 with narrowed raw-byte capture features; 0.8 is an API migration. |
| [base64](https://crates.io/api/v1/crates/base64) | ^0.22; 0.22.1 | 0.22.1 / 0.22.1 / 0.23.1 | 1.48.0; MIT OR Apache-2.0 | Keep current compatible line; newer major/minor line requires API and MSRV review. |
| [console-subscriber](https://crates.io/api/v1/crates/console-subscriber) | ^0.4; 0.4.1 | 0.4.1 / 0.4.1 / 0.5.0 | 1.74.0; MIT | Keep current compatible line; newer major/minor line requires API and MSRV review. |
| [criterion](https://crates.io/api/v1/crates/criterion) | ^0.5; 0.5.1 | 0.5.1 / 0.5.1 / 0.8.2 | not declared; Apache-2.0 OR MIT | Keep current compatible line; newer major/minor line requires API and MSRV review. |
| [reqwest](https://crates.io/api/v1/crates/reqwest) | ^0.12; 0.12.28 | 0.12.28 / 0.12.28 / 0.13.5 | 1.64.0; MIT OR Apache-2.0 | Keep 0.12: SDK still needs 0.12 while updater uses 0.13; a 0.13 move cannot deduplicate. |
| [rusqlite](https://crates.io/api/v1/crates/rusqlite) | ^0.32; 0.32.1 | 0.32.1 / 0.32.1 / 0.40.2 | not declared; MIT | Keep SQLite 0.32 stack until bundled/trace/backup migration is validated. |
| [sha2](https://crates.io/api/v1/crates/sha2) | ^0.10; 0.10.9 | 0.10.9 / 0.10.9 / 0.11.0 | not declared; MIT OR Apache-2.0 | Keep current compatible line; newer major/minor line requires API and MSRV review. |
| [similar](https://crates.io/api/v1/crates/similar) | ^2; 2.7.0 | 2.7.0 / 2.7.0 / 3.2.0 | 1.60; Apache-2.0 | Keep current compatible line; newer major/minor line requires API and MSRV review. |
| [strum](https://crates.io/api/v1/crates/strum) | ^0.27; 0.27.2 | 0.27.2 / 0.27.2 / 0.28.0 | 1.66.1; MIT | Keep current compatible line; newer major/minor line requires API and MSRV review. |
| [toml](https://crates.io/api/v1/crates/toml) | ^0.8; 0.8.2 | 0.8.2 / 0.8.23 / 1.1.6+spec-1.1.0 | 1.66; MIT OR Apache-2.0 | Keep config TOML 0.8 until round-trip migration; Tauri build uses a separate 0.9 line. |
| [zip](https://crates.io/api/v1/crates/zip) | ^4; 4.6.1 | 4.6.1 / 4.6.1 / 8.6.0 | 1.82.0; MIT | Keep own ZIP 4 with Deflate; SDK build uses ZIP 2 and updater uses ZIP 4. |

## Routine and current

| Crate / primary registry | Baseline constraint and lock | Current / candidate / latest stable | Declared candidate MSRV and license | Recommendation and reason |
| --- | --- | --- | --- | --- |
| [chrono](https://crates.io/api/v1/crates/chrono) | ^0.4; 0.4.44 | 0.4.44 / 0.4.45 / 0.4.45 | 1.62.0; MIT OR Apache-2.0 | Keep current lock; compatible 0.4.45 is a selective tested refresh, not a blanket update. |
| [dashmap](https://crates.io/api/v1/crates/dashmap) | ^6; 6.1.0 | 6.1.0 / 6.2.1 / 6.2.1 | 1.65; MIT | Keep current lock; compatible 6.2.1 is a selective tested refresh, not a blanket update. |
| [dhat](https://crates.io/api/v1/crates/dhat) | ^0.3; 0.3.3 | 0.3.3 / 0.3.3 / 0.3.3 | not declared; MIT OR Apache-2.0 | Keep optional 0.3.3, already latest; the benchmark examples compile with dhat-heap, while runtime profiling behavior remains untested. |
| [embed-manifest](https://crates.io/api/v1/crates/embed-manifest) | ^1; 1.5.0 | 1.5.0 / 1.5.1 / 1.5.1 | 1.85.0; MIT | Keep current lock; compatible 1.5.1 is a selective tested refresh, not a blanket update. |
| [filetime](https://crates.io/api/v1/crates/filetime) | ^0.2; 0.2.27 | 0.2.27 / 0.2.29 / 0.2.29 | 1.75.0; MIT/Apache-2.0 | Keep current lock; compatible 0.2.29 is a selective tested refresh, not a blanket update. |
| [image](https://crates.io/api/v1/crates/image) | ^0.25.10; 0.25.10 | 0.25.10 / 0.25.10 / 0.25.10 | 1.88.0; MIT OR Apache-2.0 | Keep 0.25.10 and narrow decoders with resource limits. |
| [log](https://crates.io/api/v1/crates/log) | ^0.4; 0.4.29 | 0.4.29 / 0.4.34 / 0.4.34 | 1.71.0; MIT OR Apache-2.0 | Keep current lock; compatible 0.4.34 is a selective tested refresh, not a blanket update. |
| [once_cell](https://crates.io/api/v1/crates/once_cell) | ^1; 1.21.4 | 1.21.4 / 1.21.4 / 1.21.4 | 1.65; MIT OR Apache-2.0 | Keep current lock; no change needed without a demonstrated benefit. |
| [rayon](https://crates.io/api/v1/crates/rayon) | ^1.10; 1.11.0 | 1.11.0 / 1.12.0 / 1.12.0 | 1.80; MIT OR Apache-2.0 | Keep current lock; compatible 1.12.0 is a selective tested refresh, not a blanket update. |
| [regex](https://crates.io/api/v1/crates/regex) | ^1; 1.12.3 | 1.12.3 / 1.13.1 / 1.13.1 | 1.65; MIT OR Apache-2.0 | Keep current lock; compatible 1.13.1 is a selective tested refresh, not a blanket update. |
| [semver](https://crates.io/api/v1/crates/semver) | ^1; 1.0.27 | 1.0.27 / 1.0.28 / 1.0.28 | 1.68; MIT OR Apache-2.0 | Keep current lock; compatible 1.0.28 is a selective tested refresh, not a blanket update. |
| [serde](https://crates.io/api/v1/crates/serde) | ^1; 1.0.228 | 1.0.228 / 1.0.229 / 1.0.229 | 1.56; MIT OR Apache-2.0 | Keep current lock; compatible 1.0.229 is a selective tested refresh, not a blanket update. |
| [serde_json](https://crates.io/api/v1/crates/serde_json) | ^1; 1.0.149 | 1.0.149 / 1.0.151 / 1.0.151 | 1.71; MIT OR Apache-2.0 | Keep current lock; compatible 1.0.151 is a selective tested refresh, not a blanket update. |
| [serde_norway](https://crates.io/api/v1/crates/serde_norway) | ^0.9.42; 0.9.42 | 0.9.42 / 0.9.42 / 0.9.42 | 1.71.1; MIT OR Apache-2.0 | Keep current lock; no change needed without a demonstrated benefit. |
| [tempfile](https://crates.io/api/v1/crates/tempfile) | ^3; 3.27.0 | 3.27.0 / 3.27.0 / 3.27.0 | 1.63; MIT OR Apache-2.0 | Keep current lock; no change needed without a demonstrated benefit. |
| [thiserror](https://crates.io/api/v1/crates/thiserror) | ^2; 2.0.18 | 2.0.18 / 2.0.21 / 2.0.21 | 1.77; MIT OR Apache-2.0 | Keep current lock; compatible 2.0.21 is a selective tested refresh, not a blanket update. |
| [tokio](https://crates.io/api/v1/crates/tokio) | ^1; 1.50.0 | 1.50.0 / 1.53.1 / 1.53.1 | 1.71; MIT | Keep current 1.50 lock with narrowed root features; union still includes Tauri-required fs. |
| [tracing](https://crates.io/api/v1/crates/tracing) | ^0.1; 0.1.44 | 0.1.44 / 0.1.44 / 0.1.44 | 1.65.0; MIT | Keep current lock; no change needed without a demonstrated benefit. |
| [tracing-subscriber](https://crates.io/api/v1/crates/tracing-subscriber) | ^0.3; 0.3.23 | 0.3.23 / 0.3.23 / 0.3.23 | 1.65.0; MIT | Keep current lock; no change needed without a demonstrated benefit. |
| [url](https://crates.io/api/v1/crates/url) | ^2; 2.5.8 | 2.5.8 / 2.5.8 / 2.5.8 | 1.63; MIT OR Apache-2.0 | Keep current lock; no change needed without a demonstrated benefit. |
| [uuid](https://crates.io/api/v1/crates/uuid) | ^1; 1.22.0 | 1.22.0 / 1.26.1 / 1.26.1 | 1.85.0; Apache-2.0 OR MIT | Keep current lock; compatible 1.26.1 is a selective tested refresh, not a blanket update. |
| [walkdir](https://crates.io/api/v1/crates/walkdir) | ^2; 2.5.0 | 2.5.0 / 2.5.0 / 2.5.0 | not declared; Unlicense/MIT | Keep current lock; no change needed without a demonstrated benefit. |

## Decision risk and validation

Scores use the ordinal likelihood x impact rubric in [upgrade decisions](upgrades.md). Likelihood 5 is reserved for demonstrated incompatibility; these are triage scores, not probabilities. Stay means retaining the delivered version or deferring the named migration.

| Group and exact target | Change risk / stay risk | Effort and blocker |
| --- | --- | --- |
| Delivered lru 0.18.5 | 3x5 before validation, 2x5 after relevant Windows checks / 3x5 on affected 0.12.5 | Hours. Check cache capacity, get/put ordering, resize eviction, native session behavior and RustSec scan; 0.18 crosses several pre-1.0 lines. |
| Delivered anyhow 1.0.104 and event-listener 5.4.2 | 2x5 before, 1x5 after compiled Windows checks but 2x5 on unexecuted Linux / 3x5 on affected versions | Under a day. Cargo resolver accepts both; Linux zbus path needs execution before claiming native behavior. |
| Keep SDK =1.0.14 and Specta exact quartet | 4x4 for any coordinated migration / 1x2 for keeping current pins | High effort. No replacement target is selected until protocol and generated IPC contracts pass. |
| Keep current Tauri 2.x set | 4x4 for the latest compatible set / 2x3 for staying | High effort. Windows packaging, Linux GTK/WebKit, capability scopes, JS companions and updater flows block a blind refresh. |
| Keep reqwest 0.12, ZIP 4, rusqlite 0.32 and config TOML 0.8 | 4x4 for coordinated major migrations / 2x2 for keeping | Multi-day if attempted. SDK/updater retain parallel reqwest/ZIP lines; SQLite bundled/trace/backup and TOML round-trips need dedicated tests. |
| Keep optional console-subscriber 0.4.1 and dhat 0.3.3 | 2x2 for profiler changes / 1x1 for keeping | Hours. Separate opt-in compile checks passed; runtime profiler behavior remains untested, and all-features changes allocation from ordinary release mode. |
| Other compatible lock refreshes | 2x2 per selected crate / 1x1 for staying | Hours per batch with affected-consumer tests; no blanket refresh is recommended by this audit. |

Saved final checks passed: `cargo check --locked --offline -p tracepilot-desktop --features tokio-console`, `cargo check --locked --offline -p tracepilot-bench --features dhat-heap --examples`, `cargo clippy --locked --offline --workspace --exclude tracepilot-desktop --all-targets -- -D warnings`, `pnpm gen:bindings`, and `pnpm typecheck`. The optional checks compile their named targets; they do not exercise the desktop console at runtime or the core allocator test. If profiling behavior becomes a release criterion, run `cargo test --locked -p tracepilot-core --lib --features dhat-heap` serially and review the generated profile.

## Transitive patch and compatibility notes

[event-listener 5.4.2](https://crates.io/api/v1/crates/event-listener) is the exact latest patched release for the Linux-only zbus route, with declared Rust 1.60 and Apache-2.0 OR MIT license. Its 5.4.2 release removes the concurrent-queue dependency and fixes StackSlot Send/Sync bounds. It is not one of the 48 direct names. [security review](security.md) traces all 14 RustSec warnings and major duplicate families.

The exact Copilot SDK 1.0.14 declares Rust 1.94.0, the highest declared rust-version among baseline packages. The local baseline debug and release builds passed with rustc 1.94.0. Root workspace.package has no rust-version metadata; adding it across all members would impose the app floor on standalone library crates as well, so that is a project policy choice. None of the registry-compatible direct candidates with a declared MSRV exceeds 1.94.0, but absent MSRV fields are unknown rather than zero.

Reqwest 0.12 remains for the SDK and first-party MCP/update clients while Tauri updater uses 0.13. ZIP 2 is SDK build-time; ZIP 4 is updater and first-party export. Windows-sys versions, Apple objc2 framework crates, hashbrown lines, TOML edit generations and rand lines reflect upstream ABI, target, build or API boundaries. Their lock multiplicity does not imply identical copies ship in a single target. [Measurements](measurements.md) uses compiled unit timing rather than lock counts.

The final RustSec scan reports zero vulnerability-category entries and ten warning instances (eight unmaintained, two unsound: Linux glib and build-only rand). The final cargo-deny run reports eight maintenance advisory errors, seven internal path-wildcard errors, two CDLA license rejects and 58 duplicate warnings. These are distinct scopes; the four patched unsoundness instances no longer appear in RustSec. Cross-platform native builds, profiler runtime behavior and distribution notices remain for lead validation.
