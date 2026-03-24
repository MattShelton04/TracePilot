# Implementation Plan 2: CI/CD Pipeline (Workstream B)

**Priority**: Tier 1 — RELEASE BLOCKER  
**Estimated Scope**: ~30 lines YAML changes  
**Dependencies**: None (can start immediately, do first for fast feedback)

---

## B1: Add PR Trigger

**File**: `.github/workflows/ci.yml`

```yaml
# BEFORE (line 3-5)
on:
  push:
    branches: [main]

# AFTER
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

### Acceptance Criteria
- Open a test PR → CI runs automatically

---

## B2: Enable Clippy

**File**: `.github/workflows/ci.yml` (lines 54-56)

The comment block is three lines: a description comment on line 54, then the two commented-out step lines on lines 55-56. Either delete all three lines and replace with the uncommented step, or uncomment just lines 55-56 and remove the description on line 54.

```yaml
# BEFORE (3-line comment block)
# Temporarily disabled Rust lint step.
# - name: Rust lint
#   run: cargo clippy --workspace --exclude tracepilot-desktop -- -D warnings

# AFTER (delete all three comment lines, insert active step)
- name: Rust lint
  run: cargo clippy --workspace --exclude tracepilot-desktop -- -D warnings
```

**Pre-work**: Run `cargo clippy --workspace --exclude tracepilot-desktop -- -D warnings` locally first. Fix any warnings before enabling in CI.

### Acceptance Criteria
- Clippy passes locally with zero warnings
- CI step is green

---

## B3: Enable Biome Lint

**File**: `.github/workflows/ci.yml` (lines 64-66)

Same pattern as B2 — the comment block is three lines: a description comment on line 64, then the two commented-out step lines on lines 65-66. Either delete all three lines and replace with the uncommented step, or uncomment just lines 65-66 and remove the description on line 64.

```yaml
# BEFORE (3-line comment block)
# Temporarily disabled pnpm lint step.
# - name: Lint
#   run: pnpm lint

# AFTER (delete all three comment lines, insert active step)
- name: Lint
  run: pnpm lint
```

**Pre-work**: Run `pnpm lint` locally. Fix any errors. Current `biome.json` has `noExplicitAny` as warn (not error), so this should be relatively clean.

### Acceptance Criteria
- `pnpm lint` passes locally
- CI step is green

---

## B4: Add Production Build Validation

**File**: `.github/workflows/ci.yml` — add after typecheck step:

```yaml
- name: Frontend build
  run: pnpm build

- name: CLI build
  run: pnpm --filter @tracepilot/cli build

- name: Rust build check
  run: cargo check --workspace --exclude tracepilot-desktop
```

> Note: Full `cargo build --release` is slow for CI. `cargo check` validates compilation without producing binaries. The release workflow handles actual artifact building. The `--exclude tracepilot-desktop` flag is consistent with the clippy/test exclusion pattern. The CLI build step is included because `@tracepilot/cli` currently has a broken build due to `@tracepilot/types` resolution issues — CI should catch this.

### Acceptance Criteria
- All three steps pass in CI

---

## B5: Add Cargo Audit

**File**: `.github/workflows/ci.yml` — add after Rust tests:

```yaml
- name: Security audit
  uses: rustsec/audit-check@v2
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
```

The `rustsec/audit-check` action is preferred over manual `cargo install cargo-audit` because it handles advisory DB caching and updates automatically.

> **Manual alternative**: If the action doesn't suit your needs, you can use `cargo install cargo-audit --quiet && cargo audit` directly, but you'll need to manage caching yourself.

### Acceptance Criteria
- No critical/high vulnerabilities reported
- Known advisories are documented if ignored

---

## B6: Re-enable Dependabot

**File**: `.github/dependabot.yml`

```yaml
# BEFORE
version: 2
updates: []

# AFTER
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      dev-dependencies:
        dependency-type: "development"
  - package-ecosystem: "cargo"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "monthly"
```

### Acceptance Criteria
- Dependabot creates PRs for outdated dependencies within a week

---

## Review Notes

*Corrections applied from 4-model review:*

1. **B2/B3**: Clarified that the commented blocks in `ci.yml` are 3 lines each (description comment + two step lines). Instructions now specify deleting the full block or uncommenting only the step lines.
2. **B4**: Changed `cargo check --workspace` → `cargo check --workspace --exclude tracepilot-desktop` for consistency with the clippy/test exclusion pattern. Added a `pnpm --filter @tracepilot/cli build` step to catch the currently broken CLI build (`@tracepilot/types` resolution issue).
3. **B5**: Consolidated to recommend `rustsec/audit-check@v2` action as the primary approach. The manual `cargo install` alternative is noted but not the default recommendation.
