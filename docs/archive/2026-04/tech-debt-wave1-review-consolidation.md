# Wave 1 — Peer-Review Consolidation & Remediation

Three independent subagent reviews (Opus 4.7, GPT-5.4, Codex 5.3) were run against
the wave-1 changes (Phase 0 guard-rails + Phase 1A security hotfixes). This doc
captures the convergent findings, the remediation that shipped in-wave, and the
items explicitly deferred to wave 2 so they don't get lost.

Reviewers were given the full scope document, the diff (with the noisy
`cargo fmt --all` re-indentation ignored), and an explicit "deferrals are
intentional" guardrail.

## 1. Convergence snapshot

| # | Severity | Finding | Flagged by | Status |
|---|---|---|---|---|
| 1 | 🔴 Critical | IPv4-mapped IPv6 bypasses SSRF guard (`http://[::ffff:127.0.0.1]/`) | Opus · GPT-5.4 · Codex | **Fixed in wave 1** |
| 2 | 🔴 Critical | `check_http_server` doesn't re-validate redirect targets | Opus · GPT-5.4 · Codex | **Fixed in wave 1** |
| 3 | 🟠 Major | `useWindowLifecycle` — `onScopeDispose` after `await` no-ops | Opus · GPT-5.4 · Codex | **Fixed in wave 1** |
| 4 | 🟠 Major | `isAlreadyIndexingError` fallback no longer matches backend message | Opus | **Fixed in wave 1** |
| 5 | 🟠 Major | CI action versions not SHA-pinned | Opus · GPT-5.4 · Codex | **Fixed in wave 1** |
| 6 | 🟠 Major | `launch_session` bypasses `canonicalize_user_path` (Phase 1A.2 gap) | Opus · GPT-5.4 | **Fixed in wave 1** |
| 7 | 🟠 Major | `App.vue` error-branch in `onMounted` skips `initAlertSystem` | GPT-5.4 | **Fixed in wave 1** |
| 8 | 🟡 Minor | `validate_mcp_url` uses blocking `to_socket_addrs()` on async runtime | Opus | **Fixed in wave 1** (new `validate_mcp_url_async`) |
| 9 | 🟡 Minor | `deny.toml` license list mismatches `Cargo.toml` (GPL-3.0 vs GPL-3.0-or-later) | Codex | **Fixed in wave 1** |
| 10 | 🟡 Minor | `BindingsError::code()` lacks variant-exhaustive tests | GPT-5.4 | **Fixed in wave 1** |
| 11 | 🟡 Minor | `backendErrors.test.ts:68-70` assertion misleading | Codex | **Fixed in wave 1** |
| 12 | 🟡 Minor | Path jail has no `..`-traversal guard (documented as scope limit) | Opus | Deferred — canonicalisation handles it; ADR pending |
| 13 | 🟡 Minor | `BindingsError::to_string()` passes through upstream errors verbatim → potential info-leak | Codex | **Deferred to wave 2** — audit pass |
| 14 | 🟡 Minor | Remaining `sessions.ts` / `SettingsDataStorage.vue` still use string matching | Opus | **Deferred to wave 2** — migration |
| 15 | 🟡 Minor | No ADR documenting the filesystem trust boundary | Opus | **Deferred to wave 2** — docs-only |
| 16 | 🟡 Minor | Broadcast channel has no drop-event / lag metric | Opus | **Deferred to wave 2** — telemetry |

## 2. Fixes shipped in wave 1

### 2.1 SSRF — IPv6-mapped IPv4 bypass (finding #1)
- `crates/tracepilot-orchestrator/src/mcp/url_policy.rs`
- New `normalise_v6_to_v4()` helper normalises `::ffff:a.b.c.d` (IPv4-mapped)
  and the deprecated `::a.b.c.d` (IPv4-compatible) ranges to their V4 form
  before classification, so the V4 ranges (loopback, RFC1918, CGNAT, metadata
  endpoints) are enforced regardless of the envelope the attacker wraps them in.
- Care taken to **not** collapse `::` (unspecified) or `::1` (loopback) —
  classification continues to treat those as V6 and rejects on `is_loopback()` /
  `is_unspecified()` separately.
- 4 new unit tests: loopback, RFC1918, cloud metadata, IPv4-compat private.

### 2.2 Redirect re-validation (finding #2)
- `crates/tracepilot-orchestrator/src/mcp/health.rs`
- `reqwest::redirect::Policy::custom(...)` closure now re-runs
  `validate_mcp_url` on every hop and caps the chain at 5. Stops a hostile
  remote from 302-ing us onto a loopback / RFC1918 target after the initial
  URL passed policy.

### 2.3 Async DNS (finding #8)
- Added `validate_mcp_url_async` that offloads `to_socket_addrs()` via
  `tokio::task::spawn_blocking`. `check_http_server` now uses the async
  variant so the tokio runtime never stalls on slow DNS. The sync
  `validate_mcp_url` is retained for the redirect-policy closure (which
  runs on reqwest's own worker thread) and for unit tests.

### 2.4 `useWindowLifecycle` scope safety (finding #3)
- `apps/desktop/src/composables/useWindowLifecycle.ts`
- Rewritten to register `onScopeDispose` **synchronously from `<script setup>`
  top level**, before any `await`. A `cancelled` flag lets mid-flight teardown
  cancel pending unlistens that are queued by the async attach path.
- A new `enabled?: () => boolean` option replaces the previous
  "call this only in the main window" convention.
- `apps/desktop/src/App.vue` now calls `useWindowLifecycle({ enabled: () => isMain(), ... })`
  at top level and no longer wires it up inside the `onMounted` awaited
  config-load (which was why the scope was lost).

### 2.5 `initAlertSystem` regression (finding #7)
- `apps/desktop/src/App.vue` — the `catch` branch of the config-load
  in `onMounted` previously returned early without arming the alert
  watcher, so a single failed load would silently disable in-app alerts
  for the remainder of the session. `initAlertSystem()` is now called
  from both the success and catch branches.

### 2.6 `launch_session` path jail (finding #6)
- `crates/tracepilot-orchestrator/src/launcher.rs`
- `launch_session` now funnels `config.repo_path` through `canonicalize_user_path`
  (Phase 1A.2 compliance that was missed in the first pass).
- `canonicalize_user_path` got two correctness fixes while there: it rejects
  NUL-byte inputs, and it strips Windows verbatim `\\?\` prefix in its return
  value so downstream callers (explorer, terminal, launcher) all see a
  consistent canonical form. `open_in_explorer` was simplified accordingly —
  the prefix strip lives in exactly one place now.

### 2.7 `isAlreadyIndexingError` regression (finding #4)
- `apps/desktop/src/utils/backendErrors.ts` substring fallback now matches both
  `"already indexing"` AND the actual current backend message
  `"already in progress"`. Paired with envelope-form detection via
  `getErrorCode(e) === "ALREADY_INDEXING"` which remains the preferred path.
- `apps/desktop/src/__tests__/utils/backendErrors.test.ts` — the misleading
  test at L68-70 (which silently passed because its assertion was trivially
  true) was replaced with four clearer tests covering the envelope, the
  fallback string, rejection of unrelated VALIDATION errors, and the legacy
  substring-inside-VALIDATION path.

### 2.8 CI SHA pinning (finding #5)
- `.github/workflows/ci.yml` — every third-party action pinned to a real
  commit SHA resolved via the GitHub refs API, with a trailing `# vX.Y.Z`
  comment on each line for humans. Covers `actions/checkout`,
  `pnpm/action-setup`, `actions/setup-node`, `dtolnay/rust-toolchain`,
  `Swatinem/rust-cache`, `rustsec/audit-check`.

### 2.9 License lint drift (finding #9)
- `deny.toml` — `"GPL-3.0"` → `"GPL-3.0-or-later"` to match the workspace
  license declared in `Cargo.toml`. Prevents a future `cargo deny check`
  false-negative on a transitive dep that publishes `GPL-3.0-or-later`.

### 2.10 `BindingsError` variant coverage (finding #10)
- `crates/tracepilot-tauri-bindings/src/error.rs` — new
  `every_variant_maps_to_stable_code` test constructs directly-constructible
  variants (`Io`, `Semver`, `Uuid`, `AlreadyIndexing`, `Validation`) and
  asserts their `.code().as_str()`. Transparent wrappers (`Core`, `Bridge`,
  etc.) are covered by compile-time exhaustiveness of the `code()` match —
  adding a variant without updating it is a build error. A comment in the
  test documents this deliberately.

## 3. Items explicitly deferred to wave 2

These are tracked and will be first-class scope candidates for wave-2
`ask_user`:

1. **Phase 1A.1 — capability scoping**: split main-window vs viewer-window
   Tauri permissions; remove blanket `AllowAllCommands`.
2. **Phase 1A.4 — shell argv split**: deprecate `run_hidden_shell(cmd: String)`
   in favour of `run_hidden_shell(program, &[args])`.
3. **Callsite migration**: move `sessions.ts` and `SettingsDataStorage.vue`
   off ad-hoc string matching onto `getErrorCode(e) === "ALREADY_INDEXING"`.
4. **`BindingsError::to_string()` info-leak audit** — several
   `#[error(transparent)]` variants pass upstream errors verbatim into the
   frontend envelope. Codex flagged potential path / config leakage.
5. **ADR 0002** — the filesystem trust boundary (what
   `canonicalize_user_path` *is* and *is not* — it's a hygiene gate, not a
   jail root).
6. **Broadcast-channel drop metric** — `tokio::sync::broadcast` silently
   drops events on slow consumers; need a receiver-lag counter.

## 4. Validation run summary (post-remediation)

- `cargo test -p tracepilot-orchestrator -p tracepilot-tauri-bindings` — **519 passed**
  (371 orchestrator incl. 12 url_policy, 148 bindings incl. 4 error).
- `cargo fmt --all -- --check` — clean.
- `cargo clippy -p tracepilot-orchestrator -p tracepilot-tauri-bindings --all-targets -D warnings`
  — clean (pre-existing `tracepilot-core` `too_many_arguments` warnings are
  out of scope for this wave).
- `pnpm --filter @tracepilot/desktop typecheck` — clean.
- `pnpm --filter @tracepilot/desktop test` — **1218 passed** (was 1216; added 2
  backendErrors tests).
- `node scripts/check-file-sizes.mjs` — clean (88 allow-listed). Note:
  `crates/tracepilot-indexer/src/index_db/helpers.rs` crossed the 500-line
  budget and was added to the allowlist with a wave-2 TODO for decomposition.

## 5. Meta-observations

- **Reviewer convergence** on findings #1, #2, #3, #5 was unanimous across
  Opus 4.7, GPT-5.4 and Codex 5.3 — high confidence those were real issues.
- GPT-5.4's run was the slowest (≈ 16 minutes) and stalled on a tool call
  for several minutes before finishing. For future waves, if Opus + Codex
  converge, don't block on GPT-5.4 past a reasonable timeout.
- All three reviewers correctly ignored the `cargo fmt` noise thanks to the
  explicit scope guard in the prompt. Worth repeating that guard each wave.
- Nothing in the reviews contradicted anything else; the three reviews felt
  complementary rather than redundant.
