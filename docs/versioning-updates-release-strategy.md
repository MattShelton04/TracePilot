# TracePilot: Versioning, Updates & Release Strategy

> **Status**: Revised — initial draft 2026-03-18, updated after multi-model peer review (Claude Opus 4.6, GPT-5.4, GPT-5.3-Codex, Gemini 3 Pro)
> **Scope**: Covers versioning strategy, changelog/update notes, release handling, code signing, auto-update detection, and integration with the existing monorepo.

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Versioning Strategy](#2-versioning-strategy)
3. [Changelog & Update Notes](#3-changelog--update-notes)
4. [Release Strategy & Code Signing](#4-release-strategy--code-signing)
5. [Auto-Update Detection](#5-auto-update-detection)
6. [In-App Update Notes Display](#6-in-app-update-notes-display)
7. [Implementation Roadmap](#7-implementation-roadmap)
8. [Future Considerations](#8-future-considerations)

---

## 1. Current State

### 1.1 How TracePilot Is Currently Deployed

Users are instructed to clone the repository and run:

```bash
git clone https://github.com/MattShelton04/TracePilot.git
cd TracePilot
pnpm install
cargo build
pnpm tauri dev
```

This is a **source-based deployment** model. There are no compiled binary releases, no distribution packages, and no installer. Every user is essentially a developer running the app from source in dev mode.

This context is foundational — it shapes every recommendation in this document. Source-based deployment has significant implications for versioning, updates, and code signing that differ substantially from traditional compiled-binary distribution.

### 1.2 Versioning: Current State

The version `0.1.0` is hardcoded in **13+ separate locations** with no synchronization mechanism:

| File | Field | Value |
|------|-------|-------|
| `Cargo.toml` (workspace) | `workspace.package.version` | `"0.1.0"` |
| `apps/desktop/src-tauri/Cargo.toml` | `package.version` | `"0.1.0"` (hardcoded, not `workspace = true`) |
| `apps/desktop/src-tauri/tauri.conf.json` | `version` | `"0.1.0"` |
| `package.json` (root) | `version` | `"0.1.0"` |
| `apps/desktop/package.json` | `version` | `"0.1.0"` |
| `apps/cli/package.json` | `version` | `"0.1.0"` |
| `packages/ui/package.json` | `version` | `"0.1.0"` |
| `packages/types/package.json` | `version` | `"0.1.0"` |
| `packages/client/package.json` | `version` | `"0.1.0"` |
| `packages/config/package.json` | `version` | `"0.1.0"` |
| `apps/desktop/src/components/SetupWizard.vue` | Hardcoded badge | `v0.1.0` |
| `apps/desktop/src/components/layout/AppSidebar.vue` | Hardcoded badge | `v0.1.0` |
| `apps/desktop/src/views/SettingsView.vue` | `const appVersion` | `'0.1.0'` |

There is no `CHANGELOG.md`, no git version tags, no `.github/workflows/` directory, and no update detection code of any kind. The `scripts/dev.ps1` file references a `scripts/release.ps1` that does not yet exist.

**Separate versioning concerns** (distinct from the app version — do not conflate):
- `config.version: 1` in `~/.copilot/tracepilot/config.toml` — the *config schema* version in `TracePilotConfig`, for config file migration
- `schema_version` SQLite table — tracks DB migration level (currently at migration 4, managed by `run_migrations()` in `tracepilot-indexer`)
- `CURRENT_ANALYTICS_VERSION = 2` in the indexer — triggers analytics recomputation when bumped

> **Note**: The DB migration and analytics versioning systems are **already fully implemented**. They auto-run on app startup and require no additional work. Only the *config schema* migration logic is not yet wired up.

### 1.3 No CI/CD

There is no `.github/` directory. No automated tests, linting, or builds run on pull requests. No release workflow exists.

---

## 2. Versioning Strategy

### 2.1 The Problem

Without a synchronization mechanism, bumping the version before a release requires manual edits to 13+ locations, creating high risk of inconsistency. It also makes it impossible for the running application to reliably know its own version.

### 2.2 Semantic Versioning

TracePilot should adopt [Semantic Versioning (SemVer)](https://semver.org/): `MAJOR.MINOR.PATCH`.

Per SemVer, the `0.y.z` range signals that the API/behaviour is unstable and anything may change. The practical convention for this pre-1.0 project is:

| Increment | When |
|-----------|------|
| `0.x → 1.0.0` | Stable, feature-complete public release |
| `MINOR` (0.1.0 → 0.2.0) | New user-facing features (new views, major capabilities) |
| `PATCH` (0.1.0 → 0.1.1) | Bug fixes, performance improvements, non-breaking changes |

> **DB schema changes**: Any release adding a new migration to `run_migrations()` should be at least a MINOR bump, since users' local indices will auto-migrate on next launch. If a schema change is destructive or irreversible, treat it as MAJOR. Document this clearly in the changelog so users know to expect a migration.

### 2.3 Single Source of Truth

**Recommendation: `Cargo.toml` workspace as the single authoritative version.**

In Tauri 2, if the `version` field is **omitted** from `tauri.conf.json`, the Tauri CLI falls back to reading the version from the Rust `Cargo.toml`. This makes `Cargo.toml` the unambiguous source of truth with no special syntax required.

> ⚠️ **Important**: There is no `"version": "cargo"` option in Tauri 2. The correct mechanism is simply to **remove the `version` field** from `tauri.conf.json`.

**Changes required:**

1. **`apps/desktop/src-tauri/Cargo.toml`** — Change `version = "0.1.0"` to `version.workspace = true`. While there, also inherit the other workspace fields that are currently hardcoded:
   ```toml
   [package]
   name = "tracepilot-desktop"
   description = "TracePilot desktop application"
   version.workspace = true
   edition.workspace = true
   authors.workspace = true
   license.workspace = true
   ```

2. **`apps/desktop/src-tauri/tauri.conf.json`** — Remove the `"version": "0.1.0"` line entirely. Tauri CLI will read it from `Cargo.toml` automatically.

3. **Root `package.json` and workspace packages** — All are `private: true` and not published to npm. Their `version` fields are informational. Keep them in sync via the bump script (§2.4) rather than treating them as authoritative.

4. **Vue hardcoded version strings** — All three locations must be replaced with the Tauri runtime API (see §2.5).

**Result after changes:**
- Bump `Cargo.toml` workspace version → Tauri picks it up automatically at build/dev time
- All Rust crates inherit from workspace — single edit point for version
- The bump script syncs JS package versions
- UI version displays read the live value via the Tauri JS SDK

### 2.4 Version Display in the UI

**Do not add a custom `get_app_version` Tauri command.** Tauri already exposes the app version through its built-in JavaScript API:

```typescript
import { getVersion } from '@tauri-apps/api/app';
const version = await getVersion(); // reads from Cargo.toml at runtime
```

The `@tauri-apps/api` package (`^2.5.0`) is already a dependency of `apps/desktop`.

The three hardcoded version strings must be replaced:

| Location | Before | After |
|----------|--------|-------|
| `SetupWizard.vue:246` | `<span class="version-pill">v0.1.0</span>` | Dynamic via `getVersion()` |
| `AppSidebar.vue:105` | `<span class="sidebar-version">v0.1.0</span>` | Dynamic via `getVersion()` |
| `SettingsView.vue:205` | `const appVersion = '0.1.0'` | `const appVersion = await getVersion()` |

A shared `useAppVersion()` composable is the right pattern — call `getVersion()` once, cache it reactively, and reference the composable in all three components. This composable must also handle the browser-only dev mode (`pnpm dev` without Tauri), where `isTauri()` returns false:

```typescript
// src/composables/useAppVersion.ts
import { ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'

const appVersion = ref('dev')

export async function initAppVersion() {
  if (isTauri()) {
    const { getVersion } = await import('@tauri-apps/api/app')
    appVersion.value = await getVersion()
  }
}

export function useAppVersion() {
  return { appVersion }
}
```

### 2.5 Version Bump Script

Create `scripts/bump-version.ps1`. Rather than fragile regex on `Cargo.toml`, use [`cargo-edit`](https://github.com/killercup/cargo-edit)'s `cargo set-version` subcommand, which understands TOML structure properly:

```powershell
# scripts/bump-version.ps1
# Usage: .\scripts\bump-version.ps1 -Version 0.2.0
# Prerequisite: cargo install cargo-edit

param(
    [Parameter(Mandatory)]
    [string]$Version
)

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Error "Version must be X.Y.Z semver (e.g. 0.2.0)"; exit 1
}

# Verify clean git working tree
$status = git status --porcelain
if ($status) {
    Write-Error "Working tree is dirty. Commit or stash changes first."
    exit 1
}

Write-Host "Bumping TracePilot to v$Version..." -ForegroundColor Cyan

# Update Cargo workspace version (uses cargo-edit, understands TOML properly)
cargo set-version --workspace $Version
if ($LASTEXITCODE -ne 0) { Write-Error "cargo set-version failed"; exit 1 }
Write-Host "  OK Cargo workspace version updated"

# Update all package.json files (encode output as UTF-8 explicitly)
Get-ChildItem -Recurse -Filter package.json |
    Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
    ForEach-Object {
        $content = Get-Content $_.FullName -Raw -Encoding UTF8
        $json = $content | ConvertFrom-Json
        if ($null -ne $json.version) {
            $json.version = $Version
            $json | ConvertTo-Json -Depth 20 |
                Set-Content -Path $_.FullName -Encoding UTF8
            Write-Host "  OK $($_.FullName)"
        }
    }

# Update Cargo.lock after version change
cargo check --workspace --quiet 2>$null
Write-Host "  OK Cargo.lock updated"

# Prompt to update CHANGELOG.md before tagging
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Update CHANGELOG.md: rename [Unreleased] -> [$Version] - $(Get-Date -Format 'yyyy-MM-dd')"
Write-Host "  2. Add a new empty [Unreleased] section at the top"
Write-Host "  3. Run: git add -A && git commit -m 'chore: release v$Version'"
Write-Host "  4. Run: git tag -s v$Version -m 'Release v$Version'  (GPG signed)"
Write-Host "  5. Run: git push origin main --tags"
```

> **Why `cargo set-version` instead of regex?** Regex editing TOML is fragile — it breaks with formatting variants, inline tables, or extra whitespace. `cargo-edit` is the idiomatic Rust tool for this and is reliably available via `cargo install cargo-edit`.

> **Why not auto-commit?** The script stops before committing so the developer can review the CHANGELOG.md changes. Release commits should be intentional, not silent.

### 2.6 Version Consistency CI Check

Add a CI job that validates all version fields match. Use `cargo metadata` to parse TOML correctly instead of regex:

```yaml
# Part of .github/workflows/ci.yml
- name: Check version consistency
  run: |
    CARGO_VER=$(cargo metadata --no-deps --format-version 1 \
      | python3 -c "import sys,json; d=json.load(sys.stdin); \
        print(next(p['version'] for p in d['packages'] if p['name']=='tracepilot-desktop'))")
    PKG_VER=$(node -p "require('./package.json').version")
    if [ "$CARGO_VER" != "$PKG_VER" ]; then
      echo "Version mismatch: Cargo=$CARGO_VER, package.json=$PKG_VER"
      exit 1
    fi
    echo "Version OK: $CARGO_VER"
```

---

## 3. Changelog & Update Notes

### 3.1 Format: Keep-a-Changelog

Adopt the [Keep-a-Changelog](https://keepachangelog.com/) format (`CHANGELOG.md` at repo root). This is the industry standard for human-readable changelogs.

```markdown
# Changelog

All notable changes to TracePilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
### Changed
### Fixed

## [0.1.0] - 2026-03-18

### Added
- Initial release: session explorer, conversation viewer, analytics dashboards
- Subagent attribution, 19 specialized tool renderers
- SQLite FTS5 search index with incremental reindex
- Cost tracking (Copilot premium request cost + wholesale API cost)
- Dark/light theme, setup wizard, active session detection
```

### 3.2 Conventional Commits + git-cliff

Adopt [Conventional Commits](https://www.conventionalcommits.org/) for commit message discipline:

- `feat:` — new feature → **Added**
- `fix:` — bug fix → **Fixed**
- `perf:` — performance → **Performance**
- `refactor:` — no functional change
- `chore:` — maintenance, version bumps
- `docs:` — documentation only
- `BREAKING CHANGE:` footer — denotes a breaking change

**Automation: `git-cliff`**

[`git-cliff`](https://git-cliff.org/) is a Rust-native changelog generator that parses Conventional Commits. Install with `cargo install git-cliff`. It generates a *draft* changelog from commit history that a human then reviews and edits before committing.

> **Keep-a-Changelog vs git-cliff:** These are complementary, not interchangeable. `git-cliff` generates a raw commit-history draft. A human curates it into a user-facing changelog. Commit messages are for developers; changelog entries are for users. Do not publish git-cliff output directly without editorial review.

Add `cliff.toml` to the repo root to configure output format. See [the git-cliff docs](https://git-cliff.org/docs/configuration) for the full schema.

**Enforcement**: Without commit message validation, Conventional Commits discipline degrades over time. Add a lightweight git hook using [`lefthook`](https://github.com/evilmartians/lefthook) (a fast cross-platform hook manager with no Node.js dependency):

```yaml
# lefthook.yml
commit-msg:
  commands:
    conventional-commit:
      run: |
        MSG=$(cat {1})
        if ! echo "$MSG" | grep -qE '^(feat|fix|perf|refactor|chore|docs|style|test|ci|build)(\(.+\))?: .+'; then
          echo "ERROR: Commit message must follow Conventional Commits format"
          echo "  Example: feat: add update notification banner"
          exit 1
        fi
```

Install: `cargo install lefthook && lefthook install`

### 3.3 Release Manifest for Machine-Readable Metadata

Do not parse `CHANGELOG.md` at runtime for app metadata — CHANGELOG.md is a human document and parsing it is fragile. Instead, maintain a separate `release-manifest.json` in the repo that is updated alongside the changelog at each release:

```json
{
  "versions": [
    {
      "version": "0.2.0",
      "date": "2026-04-01",
      "notes": {
        "added": ["Health scoring view with anomaly detection", "Export to Markdown and CSV"],
        "fixed": ["Subagent timing regression on truncated traces"],
        "changed": []
      },
      "requiresReindex": false
    },
    {
      "version": "0.1.0",
      "date": "2026-03-18",
      "notes": {
        "added": ["Initial release"],
        "fixed": [],
        "changed": []
      },
      "requiresReindex": false
    }
  ]
}
```

This file lives at `apps/desktop/public/release-manifest.json` — Vite copies it into the bundle verbatim. The app fetches it locally at runtime (no network call needed for "What's New" display).

> **`requiresReindex` flag**: This should almost always be `false`. The indexer already handles reindex decisions automatically via `CURRENT_ANALYTICS_VERSION` and DB schema migration version tracking. The flag in `release-manifest.json` is an escape hatch for the rare case where a logic change isn't reflected in those version numbers (e.g., a parsing fix that improves data quality without changing the schema). When in doubt, leave it `false` — the automatic detection handles the common case.

---

## 4. Release Strategy & Code Signing

### 4.1 The Source-Based Deployment Reality

Currently, TracePilot is deployed source-first. Users build and run it themselves via `pnpm tauri dev`. This means:

- **No code signing is needed now.** The user builds the binary themselves on their own machine. macOS Gatekeeper and Windows SmartScreen only trigger when running pre-compiled binaries downloaded from the internet. Building from source entirely bypasses these checks.
- **Security comes from source auditability** — a developer audience can inspect the GPL-licensed source before building. This is arguably more trustworthy than a signed black-box binary.

Code signing only becomes relevant when TracePilot distributes **pre-compiled binaries** (`.exe`, `.dmg`, `.AppImage`).

### 4.2 Code Signing: What's Required by Platform

| Platform | Without Signing | With Signing | Annual Cost |
|----------|-----------------|--------------|-------------|
| **Windows** | SmartScreen "Unknown publisher" warning; users click "More info → Run anyway" | No warning | ~$200–$500/yr (EV cert) |
| **macOS** | Gatekeeper blocks app; right-click → Open, or `xattr -cr TracePilot.app` | Runs normally | $99/yr (Apple Developer Program) |
| **Linux** | No OS-level restrictions for running | Packaging/distro signing norms vary | Free |

> **For developer-focused tools**: The target audience of TracePilot already works with terminals, CLIs, and source code. An unsigned binary with clear documentation is entirely acceptable to this audience.

### 4.3 Free & Low-Cost Signing Alternatives

#### Option A: SignPath Foundation (Recommended for Windows, when ready)

[SignPath Foundation](https://signpath.org/foundation/) provides **free code signing for qualifying open-source projects**:
- Requires a public repository with an OSI-approved license (GPL-3.0 ✓)
- Requires build reproducibility via GitHub Actions
- Provides Windows EV-equivalent code signing at no cost

**Process**: Apply at signpath.org → integrate signing step into GitHub Actions release workflow.

#### Option B: Apple Developer Program (macOS)

The $99/year Apple Developer Program is the only official path for macOS code signing + notarization. No free alternative exists. Document the `xattr -cr` bypass for developer users in the README and defer the $99 expense until binary distribution is prioritised.

#### Option C: GitHub Artifact Attestations (Supply Chain Integrity)

[GitHub's artifact attestations](https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds) (based on Sigstore) let users verify a binary was built from a specific commit by a specific workflow. This does **not** satisfy OS-level SmartScreen/Gatekeeper trust, but it provides meaningful supply-chain transparency for security-conscious users.

Enable in the release workflow:
```yaml
- uses: actions/attest-build-provenance@v1
  with:
    subject-path: 'target/release/bundle/**/*.msi'
```

#### Option D: GPG-Signed Git Tags (Source Deployment)

For the current source-based model, GPG-signed tags are the right trust anchor. Users can verify a tag was created by the maintainer with `git verify-tag v0.2.0`. Zero cost, works immediately.

```bash
# One-time setup: publish your GPG public key
gpg --export --armor your@email.com | gh gpg-key add -

# Tag each release with a signed tag
git tag -s v0.2.0 -m "Release v0.2.0"
```

### 4.4 GitHub Releases as the Distribution Hub

Use GitHub Releases for every version:
1. Create a release from the GPG-signed git tag
2. Paste the CHANGELOG.md section as the release body
3. Attach build artifacts when binary distribution is eventually added
4. The GitHub Releases API provides the update detection endpoint (§5)

### 4.5 Tauri Actions: Future Binary Builds

When binary distribution is desired, [`tauri-action`](https://github.com/tauri-apps/tauri-action) builds platform-native installers. **Important**: this requires **native runners** for each platform — cross-compilation is not supported for most Tauri targets. A GitHub Actions matrix is required:

```yaml
# .github/workflows/release.yml (excerpt)
jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: ubuntu-22.04
            args: ''
          - platform: windows-latest
            args: ''
          - platform: macos-latest
            args: '--target aarch64-apple-darwin'
          - platform: macos-latest
            args: '--target x86_64-apple-darwin'
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - uses: dtolnay/rust-toolchain@stable
      - run: pnpm install
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'TracePilot ${{ github.ref_name }}'
          releaseBody: 'See CHANGELOG.md for details.'
          releaseDraft: true
```

Signing secrets (Apple certificates, SignPath tokens) would be injected as GitHub Actions secrets at this stage.

---

## 5. Auto-Update Detection

### 5.1 The Challenge: Source-Based Deployment

The standard Tauri updater (`tauri-plugin-updater`) downloads a signed binary and replaces the running executable. This is **not applicable** to `pnpm tauri dev` — there is no persistent binary to replace, and the build process is ongoing in the terminal.

For source-based deployment, "updating" means:
1. `git pull` (fetch new commits)
2. `pnpm install` (if dependencies changed)
3. Restarting `pnpm tauri dev` (which triggers Rust recompilation + frontend rebuild)

The app can detect that an update is *available* and guide the user, but the user must perform the steps themselves.

### 5.2 Privacy & Opt-In Requirement

> **⚠️ Important**: Querying an external API on app startup is a phone-home behaviour. For a GPL tool that processes potentially sensitive development session data, this has privacy implications: the request reveals the user's IP address and software version to GitHub's servers and to network observers.

**Update checks must be opt-in**, not on by default. Add a setting: *"Check for updates on startup"* (default: off). When a user turns it on, show a brief explanation ("TracePilot will contact GitHub's API to check for new releases").

Alternatively, provide a manual "Check for Updates" button in Settings — this is a reasonable middle ground that requires explicit user action with no automatic phone-home.

### 5.3 Approach: GitHub Releases API

The GitHub Releases API is the simplest and most reliable approach for version checking — it doesn't require git to be installed or the CWD to be the repo:

```
GET https://api.github.com/repos/MattShelton04/TracePilot/releases/latest
```

**Important caveats:**
- This endpoint returns the latest **non-draft, non-prerelease** release ordered by the Git tag's creation date — **not** necessarily the highest semver. For a linear release history this is fine; be aware if you ever publish a patch release for an older branch.
- Unauthenticated requests are rate-limited to **60/hour per IP**. Multiple users sharing a NAT (e.g., corporate network) share this quota.
- The response must include `User-Agent`, `Accept: application/vnd.github+json`, and `X-GitHub-Api-Version: 2022-11-28` headers per GitHub's API requirements.

**Mitigation — 24-hour caching:**

Store a `lastUpdateCheck` timestamp and cached result in `localStorage`. Only make the API call if more than 24 hours have passed since the last check. This keeps API usage well within limits and avoids a network round-trip on every startup.

### 5.4 Update Check Implementation

#### Rust: `check_for_updates` Command

Add to `crates/tracepilot-tauri-bindings/src/lib.rs`. Note:
- No custom `get_app_version` command is needed — use `@tauri-apps/api/app.getVersion()` on the frontend instead
- Use the `semver` crate for correct version comparison (add `semver = "1"` to workspace deps)
- Add `reqwest` to workspace deps with `default-features = false` to minimise dependency weight

```rust
use semver::Version;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub has_update: bool,
    pub release_url: Option<String>,
    pub published_at: Option<String>,
}

#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateCheckResult, String> {
    let current_str = env!("CARGO_PKG_VERSION"); // safe: resolves in this crate; workspace unifies
    let current = Version::parse(current_str).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .user_agent(format!("TracePilot/{current_str}"))
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get("https://api.github.com/repos/MattShelton04/TracePilot/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    match response.status().as_u16() {
        404 => return Ok(UpdateCheckResult {
            current_version: current_str.to_string(),
            latest_version: None,
            has_update: false,
            release_url: None,
            published_at: None,
        }),
        429 | 403 => return Err("GitHub API rate limit reached. Try again later.".into()),
        s if s >= 500 => return Err(format!("GitHub API error: HTTP {s}")),
        _ => {}
    }

    let release: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {e}"))?;

    let latest_str = release["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v');

    let has_update = Version::parse(latest_str)
        .map(|latest| latest > current)
        .unwrap_or(false);

    Ok(UpdateCheckResult {
        current_version: current_str.to_string(),
        latest_version: Some(latest_str.to_string()),
        has_update,
        release_url: release["html_url"].as_str().map(String::from),
        published_at: release["published_at"].as_str().map(String::from),
    })
}
```

> **Dependency note**: Add to workspace `Cargo.toml`:
> ```toml
> reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
> semver = "1"
> ```
> `reqwest` with `default-features = false` avoids pulling in unnecessary features. `rustls-tls` avoids an OpenSSL dependency on Windows and macOS. `semver` is already used by Cargo itself and is a well-maintained zero-hassle crate.

> **Alternative**: If the reqwest dependency weight is a concern, the HTTP call can be made from the **frontend** (Vue) using `fetch()` via `tauri-plugin-http` (which provides capability scoping). The Rust command then only handles the version comparison logic. This avoids adding new Rust HTTP dependencies entirely.

#### Frontend: Update Check Composable

```typescript
// src/composables/useUpdateCheck.ts
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@tauri-apps/api/core'
import type { UpdateCheckResult } from '@tracepilot/types'

const CACHE_KEY = 'tracepilot-update-check'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export const updateAvailable = ref<UpdateCheckResult | null>(null)

export async function runUpdateCheck(): Promise<void> {
  if (!isTauri()) return

  // Respect 24-hour cache
  const cached = localStorage.getItem(CACHE_KEY)
  if (cached) {
    const { timestamp, result } = JSON.parse(cached) as {
      timestamp: number; result: UpdateCheckResult
    }
    if (Date.now() - timestamp < CACHE_TTL_MS) {
      if (result.hasUpdate) updateAvailable.value = result
      return
    }
  }

  try {
    const result = await invoke<UpdateCheckResult>('check_for_updates')
    localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), result }))
    if (result.hasUpdate) updateAvailable.value = result
  } catch {
    // Update check is best-effort — silently ignore network/API errors
  }
}
```

Call `runUpdateCheck()` from `App.vue` on mount, **only if the user has opted in** to update checks in Settings.

#### UI: Update Notification

A non-intrusive dismissible banner at the top of the main layout:

```
╔═══════════════════════════════════════════════════════════════╗
║ 🎉 TracePilot v0.2.0 is available  [View Release Notes] [×]  ║
╚═══════════════════════════════════════════════════════════════╝
```

Clicking **View Release Notes** opens a modal showing the changelog content and the git commands to update. The banner is dismissible per version (store `dismissedUpdateVersion` in localStorage).

#### Update Instructions Modal

Show the precise steps, including `pnpm install` which is commonly forgotten:

```
To update TracePilot to v0.2.0:

  1. In your terminal, press Ctrl+C to stop TracePilot
  2. Navigate to your TracePilot directory
  3. git status          (check for local changes first)
  4. git stash           (if you have local changes you want to keep)
  5. git pull
  6. pnpm install        (picks up any new dependencies)
  7. pnpm tauri dev      (recompiles and relaunches)

Note: If you have local modifications that conflict with upstream
changes, git pull will fail. Use git stash or git reset --hard
origin/main (discards local changes) to resolve.
```

> **Why not run `git pull` automatically?** Merge conflicts if the user has local changes, SSH vs HTTPS authentication complexity, no output during Rust recompilation, and the running process cannot replace itself. Clear instructions are more reliable and put the user in control.

### 5.5 Optional: Git Info Display in Settings

For developers who want to know exactly what commit they're running:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub commit_hash: Option<String>,
    pub branch: Option<String>,
}

#[tauri::command]
pub fn get_git_info() -> GitInfo {
    let run = |args: &[&str]| -> Option<String> {
        std::process::Command::new("git")
            .args(args)
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    GitInfo {
        commit_hash: run(&["rev-parse", "--short", "HEAD"]),
        branch: run(&["rev-parse", "--abbrev-ref", "HEAD"]),
    }
}
```

Show this in the Settings "About" section alongside the version number.

---

## 6. In-App Update Notes Display

### 6.1 Version Change Detection on Startup

When a user runs `git pull` and restarts `pnpm tauri dev`, Rust recompiles with the new version baked in. The app can detect this:

```typescript
// In App.vue or a useVersionStore
import { getVersion } from '@tauri-apps/api/app'
import { isTauri } from '@tauri-apps/api/core'

async function checkForVersionChange() {
  if (!isTauri()) return

  const current = await getVersion()
  const previous = localStorage.getItem('tracepilot-last-seen-version')

  if (previous && previous !== current) {
    showWhatsNewModal(previous, current)
  }

  localStorage.setItem('tracepilot-last-seen-version', current)
}
```

### 6.2 What's New Modal

The modal should:
- Display the new version number prominently
- Show release notes from the locally bundled `release-manifest.json`
- Handle the case where the user skipped multiple versions (e.g., 0.1.0 → 0.3.0) — show notes for all intermediate versions
- Show a **"Reindex Recommended"** prompt if `requiresReindex: true` in the manifest, with a "Reindex Now" button wired to the existing reindex flow
- Be dismissible ("Got it" stores the current version as seen)

### 6.3 Reindex Recommendation: Leveraging Existing Infrastructure

The indexer already tracks whether the index is stale:
- `CURRENT_ANALYTICS_VERSION = 2` — bumped when analytics computation logic changes
- `schema_version` table — bumped when DB schema changes
- The incremental reindex already compares these on startup and recomputes stale sessions

**Recommendation**: Rather than relying on `requiresReindex` in the release manifest, expose the existing staleness detection via a Tauri command `get_index_health()`:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexHealth {
    pub needs_reindex: bool,
    pub reason: Option<String>, // "analytics_version_mismatch", "schema_migration_pending"
    pub stale_session_count: u32,
}

#[tauri::command]
pub async fn get_index_health(state: State<'_, SharedIndexer>) -> Result<IndexHealth, String> {
    // Delegate to existing indexer logic
}
```

Call `get_index_health()` on startup alongside the version change check. If `needs_reindex: true`, prompt the user once (per launch) to reindex — with the specific reason explained in plain language. This makes the reindex prompt proactive and accurate regardless of whether a formal release was tagged.

---

## 7. Implementation Roadmap

### Phase 1: Versioning Foundation (Low Effort, High Value)

**Goal**: Single source of truth, eliminate manual version sync.

| Task | File(s) | Change |
|------|---------|--------|
| Fix desktop crate inheritance | `apps/desktop/src-tauri/Cargo.toml` | `version = "0.1.0"` → `version.workspace = true`; also inherit `edition`, `authors`, `license` |
| Remove version from Tauri config | `apps/desktop/src-tauri/tauri.conf.json` | Delete the `"version": "0.1.0"` line |
| Dynamic version in UI | `SetupWizard.vue`, `AppSidebar.vue`, `SettingsView.vue` | Replace hardcoded strings with `useAppVersion()` composable |
| Add `useAppVersion` composable | `apps/desktop/src/composables/useAppVersion.ts` | New composable using `@tauri-apps/api/app.getVersion()` with Tauri guard |
| Create CHANGELOG.md | `CHANGELOG.md` | Initial changelog with v0.1.0 entry |
| Create release-manifest.json | `apps/desktop/public/release-manifest.json` | Initial manifest with v0.1.0 entry |
| Create cliff.toml | `cliff.toml` | Configure git-cliff for changelog draft generation |
| Add lefthook.yml | `lefthook.yml` | Conventional Commits enforcement hook |
| Create bump-version script | `scripts/bump-version.ps1` | Version bump script using `cargo set-version` |
| Create release script | `scripts/release.ps1` | Orchestrates bump + CHANGELOG update + tag |

### Phase 2: CI/CD Foundation (Medium Effort)

**Goal**: Automated quality gates and release pipeline.

| Task | File(s) | Change |
|------|---------|--------|
| CI workflow | `.github/workflows/ci.yml` | On PR: `cargo test --workspace --exclude tracepilot-desktop`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, version consistency check |
| Release workflow | `.github/workflows/release.yml` | On `v*` tag: create GitHub Release with CHANGELOG body (draft); future: OS matrix + tauri-action for binary builds |
| Dependabot config | `.github/dependabot.yml` | Weekly dependency updates for npm + cargo |

**CI workflow (complete example):**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with: { version: 9 }

      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }

      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy

      - uses: Swatinem/rust-cache@v2

      - run: pnpm install --frozen-lockfile

      - name: Check version consistency
        run: |
          CARGO_VER=$(cargo metadata --no-deps --format-version 1 \
            | python3 -c "import sys,json; d=json.load(sys.stdin); \
              print(next(p['version'] for p in d['packages'] if p['name']=='tracepilot-desktop'))")
          PKG_VER=$(node -p "require('./package.json').version")
          [ "$CARGO_VER" = "$PKG_VER" ] || (echo "Version mismatch: $CARGO_VER vs $PKG_VER" && exit 1)

      - name: Rust tests
        run: cargo test --workspace --exclude tracepilot-desktop

      - name: Rust lint
        run: cargo clippy --workspace --exclude tracepilot-desktop -- -D warnings

      - name: Frontend tests
        run: pnpm test

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint
```

### Phase 3: Update Detection (Medium Effort)

**Goal**: In-app update awareness, opt-in.

| Task | File(s) | Change |
|------|---------|--------|
| Add workspace deps | `Cargo.toml` | Add `reqwest` (default-features=false, json+rustls-tls) and `semver = "1"` |
| Add `check_for_updates` command | `crates/tracepilot-tauri-bindings/src/lib.rs` | New async command (see §5.4) |
| Register command in ACL | `apps/desktop/src-tauri/capabilities/default.json` | Verify `tracepilot:default` covers new command |
| Add `UpdateCheckResult` type | `packages/types/src/` | TypeScript type matching Rust struct |
| Add update check opt-in setting | `apps/desktop/src/stores/preferences.ts` | Add `checkForUpdates: boolean` (default: false) |
| `useUpdateCheck` composable | `apps/desktop/src/composables/useUpdateCheck.ts` | With 24h caching (see §5.4) |
| Update banner component | `apps/desktop/src/components/UpdateBanner.vue` | Non-intrusive banner, dismissible per version |
| Update instructions modal | `apps/desktop/src/components/UpdateInstructionsModal.vue` | Full git pull + pnpm install instructions |
| Settings UI for update check | `apps/desktop/src/views/SettingsView.vue` | Toggle + "Check Now" button |

### Phase 4: In-App Update Notes (Medium-High Effort)

**Goal**: Show users what changed when they update.

| Task | File(s) | Change |
|------|---------|--------|
| Version change detection | `apps/desktop/src/App.vue` | Compare `getVersion()` vs `lastSeenVersion` in localStorage |
| "What's New" modal | `apps/desktop/src/components/WhatsNewModal.vue` | Reads `release-manifest.json`, handles version-skip case |
| `get_index_health` command | `crates/tracepilot-tauri-bindings/src/lib.rs` | Exposes existing staleness detection (see §6.3) |
| Startup health check | `apps/desktop/src/App.vue` | Call `get_index_health()` on mount, prompt reindex if needed |
| Git info in Settings | `crates/tracepilot-tauri-bindings/src/lib.rs` + Settings UI | `get_git_info()` command + display in About section |

---

## 8. Future Considerations

### 8.1 Binary Distribution

When TracePilot matures to `1.0.0` and binary distribution is desired:

1. **Add `tauri-plugin-updater`** — replaces the git-based update approach for compiled binary releases; supports delta updates and signature verification
2. **Apply to SignPath Foundation** — free Windows EV signing for qualifying OSS
3. **Apple Developer Program** ($99/yr) — required for macOS Gatekeeper notarization
4. **Tauri Actions matrix** — build platform-native installers on GitHub-hosted runners (see §4.5)
5. **Tauri's updater JSON endpoint** — GitHub Releases can serve the update manifest; Tauri's updater expects a specific JSON format

**GPL distribution compliance**: When distributing compiled binaries, include a `COPYING` file or README section noting that source code is available at the repository URL (required by GPL-3.0).

### 8.2 Package Manager Distribution

Once binaries exist, community packaging follows naturally:
- **macOS/Linux**: Homebrew Cask
- **Windows**: Scoop, Winget
- **Linux**: AUR, Flatpak, Snap

### 8.3 Config Schema Migration

`TracePilotConfig.version: u32` exists but migration logic is not yet implemented. The pattern to adopt: on load, if `config.version < CURRENT_CONFIG_VERSION`, run migration functions in order (same pattern as the DB `run_migrations()`). Document this as a future Phase 1 addition to `config.rs`.

### 8.4 Release Announcements

GitHub's "Watch → Custom → Releases" notifications let interested users receive emails when new releases are tagged. Mention this in the README — it's zero-effort for the maintainer and gives users a way to stay informed without the app needing to phone home at all.

---

## Summary: Recommended Approach

| Concern | Recommendation | Rationale |
|---------|---------------|-----------|
| **Version authority** | `Cargo.toml` workspace; remove `version` from tauri.conf.json | Single source of truth; Tauri falls back to Cargo automatically |
| **Version bumping** | `cargo set-version --workspace` + bump script + GPG-signed tag | Correct TOML editing; auditable; zero-cost |
| **UI version display** | `@tauri-apps/api/app.getVersion()` via shared composable | Tauri built-in; no custom command needed; handles browser-only mode |
| **Changelog** | Keep-a-Changelog format; git-cliff for drafts; human curates | Separation of automation and editorial quality |
| **Commit discipline** | Conventional Commits + lefthook enforcement | Automation only works if commits are well-formed |
| **App metadata** | `release-manifest.json` (structured) separate from `CHANGELOG.md` (prose) | Don't parse human documents programmatically |
| **Code signing (now)** | None needed + GPG-signed tags | Source builds are inherently auditable; no binary distribution yet |
| **Code signing (future)** | SignPath Foundation (Windows, free OSS) + Apple Dev Program ($99/yr) | Lowest cost path to signed binaries |
| **Update detection** | GitHub Releases API, **opt-in**, 24h cache | Respects privacy; stays within rate limits; accurate |
| **Update action** | Show instructions with all steps including `pnpm install` | User control; compilation requires terminal restart |
| **Update notes** | `lastSeenVersion` vs `getVersion()` → "What's New" modal from bundled manifest | Low friction; fires after restart |
| **Reindex prompt** | `get_index_health()` from existing indexer staleness logic | Accurate; no duplication; works independently of formal releases |
| **CI/CD** | GitHub Actions: full CI on PR, release on `v*` tag | Zero cost; standard Rust/Tauri OSS practice |
