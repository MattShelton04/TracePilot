# TracePilot — developer task runner (https://github.com/casey/just)
#
# One entry point for the most common dev tasks. All recipes are thin
# wrappers around existing `pnpm` / `cargo` scripts — they add no new
# behaviour. Keep recipes in sync with `package.json` and
# `.github/workflows/ci.yml`.
#
# Usage: `just --list` to discover, `just <recipe>` to run.

set windows-shell := ["pwsh.exe", "-NoLogo", "-NoProfile", "-Command"]

# Default recipe: show the list.
default:
    @just --list

# Install JS dependencies (pnpm workspace).
install:
    pnpm install

# Run Tauri dev (desktop app, hot reload).
dev:
    pnpm --filter @tracepilot/desktop tauri dev

# Frontend build across the workspace.
build:
    pnpm build

# Build the release Tauri bundle / installer.
build-app:
    pnpm --filter @tracepilot/desktop tauri build

# Workspace typecheck (vue-tsc + tsc across packages).
typecheck:
    pnpm typecheck

# Run all tests (JS/TS via vitest across the workspace).
test:
    pnpm test

# UI tests only (@tracepilot/ui package).
test-ui:
    pnpm --filter @tracepilot/ui test

# Rust tests — mirrors CI (excludes the desktop crate).
test-rust:
    cargo test --workspace --exclude tracepilot-desktop

# Lint: Biome (JS/TS) + clippy (Rust), both hard-fail — mirrors CI.
lint:
    -pnpm lint
    -cargo clippy --workspace --exclude tracepilot-desktop --all-targets -- -D warnings

# Format / auto-fix: rustfmt + Biome write.
fmt:
    cargo fmt --all
    pnpm biome check --write .

# Regenerate TS bindings from Rust types.
gen-bindings:
    pnpm gen:bindings

# Enforce per-file size budgets.
check-sizes:
    node scripts/check-file-sizes.mjs

# Run everything CI runs (cargo check, typecheck, build, tests, lint, fmt check).
# Order mirrors `.github/workflows/ci.yml` so local runs catch the same
# failures in roughly the same order.
ci:
    cargo check --workspace --exclude tracepilot-desktop
    pnpm typecheck
    pnpm build
    cargo test --workspace --exclude tracepilot-desktop
    pnpm test
    cargo fmt --all -- --check
    -cargo clippy --workspace --exclude tracepilot-desktop --all-targets -- -D warnings
    -pnpm biome check --error-on-warnings .
    node scripts/check-file-sizes.mjs
    node scripts/check-doc-links.mjs
    node scripts/check-adr.mjs
    node scripts/check-catalog-drift.mjs
    node scripts/check-csp.mjs
    node scripts/check-public-api.mjs

# Docs-only lints (fast, no deps).
check-docs:
    node scripts/check-doc-links.mjs
    node scripts/check-adr.mjs

# CSP static regression guard (FU-02) — fails if tauri.conf.json weakens CSP.
check-csp:
    node scripts/check-csp.mjs

# Public-API drift guard for tracepilot-orchestrator (FU-10).
# Regenerate the baseline with `node scripts/check-public-api.mjs --update`
# when a change to `crates/tracepilot-orchestrator/src/lib.rs` is deliberate.
public-api-check:
    node scripts/check-public-api.mjs

# Flamegraph a single criterion bench (FU-07).
# `cargo flamegraph` is an opt-in dev tool (install separately with
# `cargo install flamegraph`). Linux needs `perf`, macOS needs `dtrace`;
# on Windows consider `samply` as a cross-platform alternative.
# Usage: `just bench-flamegraph ipc_hot_path`
bench-flamegraph BENCH:
    pwsh.exe -NoLogo -NoProfile -File scripts/bench-flamegraph.ps1 {{BENCH}}
