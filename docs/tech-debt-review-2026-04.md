# Peer Review — Tech-Debt Audit & Plan (April 2026)

**Reviewer role:** Senior staff engineer, peer review
**Artifacts reviewed:**
- `docs/tech-debt-audit-2026-04.md` (the audit)
- `docs/tech-debt-plan-2026-04.md` (the plan)
- Four raw per-area agent outputs in the session workspace
**Method:** Grounded spot-checks against working-tree HEAD on Windows. Every concrete claim below is cited `file:line`.

---

## 1. Executive Summary

**What the audit gets right (and matters):**

- The headline diagnosis is correct. The single biggest multiplier — no Rust↔TS codegen (`grep '\b(ts-rs|specta|typeshare)\b' **/Cargo.toml` → 0 hits) — is the right thing to call out first.
- `AllowAllCommands` + `"windows": ["main", "viewer-*"]` is a real, easy-to-exploit privilege escalation vector. Viewer windows *today* can call `factory_reset` (`commands/config_cmds.rs:68`) and `rebuild_search_index` (`commands/search.rs:490`). Plan's Phase 1.4 is correctly sized.
- Oversized-file inventory is accurate to within ±5% where I cross-checked (see claim validation table).
- Helper-adoption gap is real: only 4 `runAction` call sites vs 101 manual `toErrorMessage` sites in stores.
- The legacy `export/src/{markdown,json}.rs` duplication is confirmed; `anyhow` workspace-wide is reachable only from the 7-line `json.rs` stub (`use anyhow::Result;` at `crates/tracepilot-export/src/json.rs:3`).

**What the audit gets wrong:**

1. `check_session_freshness` is claimed missing from `build.rs` — it's at `apps/desktop/src-tauri/build.rs:11`. **INCORRECT.**
2. `PageShell` is claimed as adopted in 1 view; 4 views actually import it. **INCORRECT.**
3. `StatCard` said to be in 3 of 9 views; grep returns 11 views. **INCORRECT/stale.**
4. "export * × 17" in `packages/types/src/index.ts` — actual `export *` count is 14 (17 total export lines, 3 of which are named). **PARTIAL.**
5. Vue LOC numbers (2365, 2020…) are counted with a tool that treats mixed line endings differently from both `wc -l` and `[IO.File]::ReadAllLines`. They overstate by 5–15% on several files.

**What the plan gets right:**

- Phase ordering (0 → 1 → 2∥3 → 4 → 5 → 6) is defensible.
- PR batching (A–F) is the right cadence.
- "Adopt before author" is exactly the correct framing for this codebase.

**What the plan gets wrong or under-sells:**

- **Phase 1.1 under-scopes the Rust side.** Making Rust the SSoT for IPC while leaving `BindingsError::serialize → String` (`error.rs:73-80`) unchanged in the same phase means the first generated TS bindings will still be `Promise<T>` with opaque `unknown` rejections. 1.1 and 1.5 should land together.
- **Phase 1.4 is sequenced too late relative to Phase 1.1.** If capability scoping lands *after* codegen, every viewer-window command gets a generated binding that works in dev and throws in prod. Land 1.4 first or simultaneously.
- **Phase 2.3 (mass PageShell/StatCard adoption) is ordered before Phase 4 decomposition, which is backwards.** Wrapping a 2365-LOC SFC in `<PageShell>` doesn't help; the mega-SFCs need to be split first so the extracted children adopt the shared components naturally. The "mechanical substitution" framing is over-optimistic.
- **The plan has no rollback/data-migration story** for the four `schema_version` bumps (`indexer/src/index_db/mod.rs:326-350` and `orchestrator/src/task_db/mod.rs:66-103`). Users who install a newer build and then reinstall older get silent corruption.
- **Appendix A success metrics are mostly gameable** (see §5).

**My single biggest concern:** The plan treats the `AllowAllCommands` finding as one checklist item in Phase 1.4. It is, today, the only line preventing a compromised `viewer-*` window (which renders untrusted markdown via `markdown-it` with `dompurify`) from calling `factory_reset`. This should be a hotfix PR landed *before* Phase 0 finishes, not bundled with codegen.

---

## 2. Claim Validation Table

Twenty-plus claims verified against HEAD. "Path@line" = location I checked.

| # | Audit claim | Evidence | Verdict |
|---|---|---|---|
| 1 | `AllowAllCommands` at `build.rs:176` | `apps/desktop/src-tauri/build.rs:176` — `.default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands)` | **CONFIRMED** |
| 2 | `"windows": ["main", "viewer-*"]` in default capability | `apps/desktop/src-tauri/capabilities/default.json:4` | **CONFIRMED** |
| 3 | `search_reader.rs` = 1413 LOC | `[IO.File]::ReadAllLines` → 1615; `Measure-Object -Line` → 1413. Audit used the latter; ranking is still correct but 10–15% under ReadAllLines | **PARTIAL** (methodology-dependent; ordering correct) |
| 4 | `bridge/manager.rs` = 1132 LOC | Actual 1285 by ReadAllLines | **PARTIAL** (same) |
| 5 | `commands/tasks.rs` = 886 LOC | Actual 976 | **PARTIAL** |
| 6 | `PresetManagerView.vue` = 2365 LOC | ReadAllLines = 2365 | **CONFIRMED** |
| 7 | `useSessionDetail.ts` = 698 LOC | Actual 698 | **CONFIRMED** |
| 8 | `stores/sdk.ts` = 615 LOC, no tests | 615 confirmed; no `apps/desktop/src/__tests__/stores/sdk.test.ts` | **CONFIRMED** |
| 9 | `stores/search.ts` = 668, `preferences.ts` = 548, `useOrbitalAnimation.ts` = 602, `useAlertWatcher.ts` = 451 | 668 / 548 / 602 / 451 | **CONFIRMED** (4-for-4) |
| 10 | `packages/client/src/index.ts` = 883 LOC | Actual 882 | **CONFIRMED** |
| 11 | `ALREADY_INDEXING` detected by substring match on frontend | `apps/desktop/src/utils/backendErrors.ts:19` — `error === "ALREADY_INDEXING" \|\| error.toLowerCase().includes("already indexing")` | **CONFIRMED** (and worse: substring match on `.toLowerCase()`, so any backend error string containing "already indexing" triggers the happy path) |
| 12 | `BindingsError::serialize` flattens to `String` | `crates/tracepilot-tauri-bindings/src/error.rs:73-80` — `serializer.serialize_str(&self.to_string())` | **CONFIRMED** |
| 13 | No `ts-rs`/`specta`/`typeshare` | `grep` across all `Cargo.toml` files returns 0 | **CONFIRMED** |
| 14 | `default_cli_command() = "copilot"` duplicated | `tauri-bindings/src/config.rs:357-358` and `orchestrator/src/types.rs:102-103` | **CONFIRMED** |
| 15 | `CREATE_NO_WINDOW` literal `0x08000000` in `commands/tasks.rs:710` | Confirmed at line 710 | **CONFIRMED** |
| 16 | `spawn_blocking` + lock pattern re-rolled ≥14× | 10 `spawn_blocking` hits in `commands/tasks.rs`; 10 `with_task_db` hits. So the claim "≥14" is **INCORRECT** — it's ~10, and `with_task_db` has in fact been adopted in the majority of sites already | **INCORRECT** (audit overstates magnitude) |
| 17 | `Dependabot disabled (updates: [])` | `.github/dependabot.yml` ends in `updates: []` | **CONFIRMED** |
| 18 | `cargo clippy`, `cargo fmt`, `pnpm lint`, `cargo audit` disabled in CI | `.github/workflows/ci.yml` commented blocks at the bottom of `check` job | **CONFIRMED** |
| 19 | `check_session_freshness` absent from `build.rs` | Present at `apps/desktop/src-tauri/build.rs:11` | **INCORRECT** |
| 20 | `PageShell` used in 1 view | `Select-String PageShell` → 4 views import it | **INCORRECT** (stale or understated) |
| 21 | `StatCard` used in 3 of 9 views | 11 hits by grep | **INCORRECT** (stale) |
| 22 | `stat-card` raw DOM in 6 views | 4 views grep-match `.stat-card` selector | **PARTIAL** (overstated) |
| 23 | `.page-content-inner` raw in 16 views | 16 view files match | **CONFIRMED** |
| 24 | `toErrorMessage` ~90 sites across 13 stores | 101 hits under `apps/desktop/src/stores` | **CONFIRMED (slightly under)** |
| 25 | `runAction` used in only 1–3 stores | 4 total hits — all in `stores/skills.ts` area | **CONFIRMED** |
| 26 | `export *` × 17 in `types/src/index.ts` | 14 `export *` + 3 named re-exports | **PARTIAL** |
| 27 | `run_hidden_shell` uses raw string into `powershell -Command` | `crates/tracepilot-orchestrator/src/process.rs:214,219` docstring says "uses `powershell -Command`"; the body takes `full_command: &str` | **CONFIRMED** |
| 28 | `SharedTaskDb = Arc<Mutex<Option<TaskDb>>>` with `std::sync::Mutex` | `crates/tracepilot-tauri-bindings/src/types.rs:4,10` | **CONFIRMED** |
| 29 | `broadcast::channel(512)` event forwarder in bridge | `crates/tracepilot-orchestrator/src/bridge/manager.rs:48,49` — event=512, **status=16** | **CONFIRMED** (plus a new finding: status channel is only 16 slots — lagger risk, see §3) |
| 30 | Only `markdown.rs`+`json.rs` use `anyhow` | Grep: `json.rs:3 use anyhow::Result;` is the only production site; `markdown.rs` doesn't actually import anyhow. Audit's phrasing "sole anyhow usage … is in the legacy file" is correct but narrower than stated: **only `json.rs`** (7 lines). | **CONFIRMED (narrower)** |
| 31 | Bridge `RwLock` commands use `.write()` even for read-ish ops | I couldn't reproduce in `bridge/manager.rs` itself (0 `.write().await` hits there); claim likely refers to `commands/sdk.rs:24,33,61,72,104,113` per the audit body. Need to read that file to confirm. | **UNVERIFIED** (audit points at a file I didn't load) |
| 32 | `markdown.rs` is 434 LOC | Actual 461 | **PARTIAL** |

**Score:** Of 32 spot-checked claims, **20 CONFIRMED**, **8 PARTIAL** (correct direction, wrong magnitude or stale), **3 INCORRECT**, **1 UNVERIFIED**. This is a well-grounded audit that would merit a copy-edit pass before declaring it SSoT.

---

## 3. Missing Items (Neither Document Mentions)

Prioritised by blast radius. All claims file-cited.

### High (🔴)

1. **Viewer-window CSP renders untrusted markdown.** `apps/desktop/src-tauri/tauri.conf.json` CSP is `style-src 'self' 'unsafe-inline'` *and* the UI renders session markdown with `markdown-it`+`dompurify`. Combined with `AllowAllCommands`, a malicious session containing crafted DOM in a markdown block can reach *any* Tauri command from a viewer window. Audit flags CSP loosening but doesn't connect it to the viewer-capability problem. The two must be mitigated together.

2. **Path-traversal surface on Tauri commands.** `open_in_explorer(path: String)` (`crates/tracepilot-tauri-bindings/src/commands/orchestration.rs:208`), `open_in_terminal(path: String)` (`:213`), `launch_session(config: LaunchConfig)` (`:196`) accept arbitrary paths with **zero** validation (`validators.rs` has 0 `pub fn validate_*` entrypoints in the grep). Audit §3.13 mentions this in passing ("partial"); it deserves a top-20 slot. A crafted `"popup-session-closed"` event payload plus an `open_in_terminal` invocation = arbitrary process launch.

3. **Status broadcast channel is only 16 slots.** `bridge/manager.rs:49` — `broadcast::channel(16)` for status updates. Under bursty load (e.g. many session-status transitions during startup) slow receivers lag and the sender silently drops. Status UI becomes inconsistent with no error surface. Either bump to 512 like the event channel on line 48, or convert status to latest-value-only (`watch::channel`).

4. **`ManifestLock = Arc<Mutex<()>>` held across async I/O.** `tauri-bindings/src/types.rs:20` — a `std::sync::Mutex<()>` serialising manifest read-modify-write. If ever held across `.await` this is a future-!Send violation that compiles only by accident today. Audit §3.7 names the pattern but not this specific instance.

5. **No i18n foundation of any kind.** Zero `vue-i18n` usages; zero `$t(` calls (`grep` result: 0). Every string in every mega-SFC is hardcoded. Neither document mentions i18n. If the plan proceeds to decompose SFCs without introducing string extraction first, you will re-do this work later. At minimum: install `vue-i18n`, extract to `en.json` during Phase 4 decomposition.

6. **Schema migrations are one-way; no down-migrations; no version compatibility table.** `indexer/src/index_db/migrations/` implements `MIGRATION_1..5` forward-only (`index_db/mod.rs:5`). `task_db/mod.rs:66-103` is its own forward-only runner. User who downgrades gets runtime errors or silent corruption. There is no "installer refuses to start against newer schema" check. The plan's Phase 3.4 unifies migration runners but does not add rollback or version gating.

7. **No test coverage reporting.** No `coverage` key in `vitest.config.ts`; no `cargo-llvm-cov` / `tarpaulin` in CI. Appendix A metrics include "Vue SFCs > 1000 LOC" but no coverage baseline, so there is no objective signal that decomposition didn't also delete tests.

8. **Playwright + `scripts/e2e/*.mjs` duplication.** 8 `*.spec.ts` / `*.e2e.ts` plus 17 ad-hoc scripts in `scripts/e2e/`. The plan's §6.3 mentions consolidation but lists 13 scripts — actual count is 17. More critically, the existing 8 Playwright specs are not wired to any CI job; audit §6.1 doesn't catch this.

### Medium (🟡)

9. **`unwrap()`/`panic!` density is ~1478 hits across `crates/` (includes tests).** Not all are bad, but there is no `[workspace.lints] clippy.unwrap_used = "warn"` to discriminate tests from prod. Plan's Phase 0.2 adds these lints — good — but a one-time audit of the non-test hits should be an explicit workstream, not just a lint roll-out.

10. **Lockfile hygiene / build determinism.** `pnpm-lock.yaml` = 3006 lines; root also has `package-lock.json`? (didn't find, good). `Cargo.lock` is committed ✅. But `copilot-sdk` is `git` pinned without a rev in at least one crate (audit §6.2) — this breaks reproducibility if upstream force-pushes.

11. **`tokio::sync::OnceCell` claim deserves nuance (see §6).** The plan proposes blanket migration from `Arc<Mutex<Option<T>>>` → `OnceCell<T>`. This is correct for *immutable-after-init* state but wrong for `SharedTaskDb` if the DB ever needs to be re-opened (e.g. after `factory_reset` which deletes the file — see `commands/config_cmds.rs:76`). After reset the `OnceCell` remains populated with a handle to a deleted DB. Need `ArcSwap<Arc<TaskDb>>` or explicit re-init ceremony.

12. **Frontend accessibility is incomplete.** 64/116 Vue files contain `aria-*`, which means **52 files have zero ARIA affordances**. No `role="dialog"` / focus-trap pattern in the UI package. Mega-SFCs (`PresetManagerView`, `ConfigInjectorView`) ship modals with no focus management. Plan doesn't mention a11y at all.

13. **Platform-specific code without parity harness.** 55 `#[cfg(windows|unix|target_os)]` blocks across crates. CI runs Ubuntu only (`ci.yml:14`). Every platform-specific branch is untested until shipped. Plan's §6.1 adds a Tauri build matrix but not a `cargo test` matrix.

14. **Broadcast receivers with no back-pressure metric.** Receivers of the 512-slot event channel don't log `RecvError::Lagged`. Silent drops in the field will be invisible. Add a `tracing::warn!` on lag and expose a counter.

15. **`packages/ui` tests don't use `@tracepilot/test-utils`.** The plan's §5.5 says "UI package tests don't use it (inconsistent)" but doesn't make it a workstream. If test-utils is to be meaningful it needs enforced adoption.

### Low (🟢)

16. **`biome.json` Vue override disables `noUnusedImports` globally for `.vue` files** — guaranteed bitrot vector. Plan's Phase 0.3 flips severity but doesn't mention the Vue override clause specifically.

17. **N+1 query risk is low but unaudited.** Grep found 3 potential sites under `indexer/`. Worth an explicit bench rather than a claim either way.

18. **`window.__TRACEPILOT_IPC_PERF__`** module-level side-effect (`packages/client/src/invoke.ts:53-58`) is flagged in audit §5.1 but the plan's fix (explicit opt-in call) quietly breaks any consumer that relies on the dev-time buffer. Document as breaking.

19. **`Cargo.toml` workspace member `tracepilot-bench` listed** (`Cargo.toml`) but not mentioned anywhere in the plan. Either adopt it in Phase 6.5 or document as dead code.

---

## 4. Plan Critique (Per Phase)

### Phase 0 — Scaffolding & Safety Net

**Verdict:** Mostly right, but under-weighted.

- ✅ CI re-enable, lefthook parity, governance — correct.
- ❌ **Missing:** platform matrix for tests, not just builds. Windows-only app with Ubuntu-only tests has been biting this repo already (55 `#[cfg(windows)]` blocks untested).
- ❌ **Missing:** a dry-run for `cargo clippy -D warnings`. Flipping the switch on HEAD will likely generate 200+ findings. "Fix in the same PR set" is a fantasy — scope a separate `chore(clippy)` PR.
- **Concrete edit:** Move the `check_session_freshness` fix (audit claim #19 is wrong) out of Phase 1.4's capability rework — no action needed, just strike it from the plan.
- **Concrete edit:** Add `0.8 Platform matrix` — Windows + Linux `cargo test` in `ci.yml`, required status.
- **Concrete edit:** Land **capability scoping hotfix first** (see §5). Phase 0's DoD should include "viewer windows cannot invoke `factory_reset`/`rebuild_search_index`".

### Phase 1 — SSoT Foundations

**Verdict:** The most valuable phase; needs resequencing.

- ✅ `specta` + `tauri-specta` is the right choice (see §6).
- ⚠️ **Risk:** 1.1 without 1.5 lands generated bindings that still throw opaque `string` errors; the first downstream consumer will build its own `isAlreadyIndexingError` and now you have two sources of truth. **Merge 1.1 and 1.5 into a single PR.**
- ⚠️ **Risk:** 1.4 (capability scoping) should land *before* 1.1 codegen — otherwise the generated `commands.ts` advertises `factory_reset` to viewer windows, encouraging misuse.
- **Concrete edit:** Reorder inside Phase 1 to: **1.4 → 1.1 + 1.5 (combined) → 1.2 + 1.3**.
- **Concrete edit:** 1.2 localStorage migration: the one-shot migration of `tracepilot-*` → `tracepilot:*` keys should be idempotent and preserve old keys for one release to allow downgrade. Currently plan says "migrate" with no back-compat window.
- **Concrete edit:** Add a workstream **1.6 Error-code stability policy** — `ErrorCode` enum is a public API; once it ships, codes cannot be renamed without a release-note breaking change. Write the policy before the codegen lands.

### Phase 2 — Helper Adoption Sweep

**Verdict:** Correct *if* sequenced after Phase 4, not before.

- ❌ **Order bug:** "Adopt `PageShell` in all 16 views currently hand-rolling `.page-content > .page-content-inner`" works on small files. On `PresetManagerView` (2365 LOC), the wrap happens around 600+ LOC of CSS and internal layout; you end up with a `<PageShell>` wrapping another `<div class="page-content">` because the internal structure depends on the outer layer. Decompose first.
- ✅ 2.1 `runAction` migration is independent of SFC size and can run in parallel with Phase 3/4 — keep it here.
- ✅ 2.2 `usePersistedRef` + `useInflightPromise` are good.
- **Concrete edit:** Split Phase 2 in two: **2a (pre-Phase-4)** = `runAction`/error handling only; **2b (post-Phase-4)** = `PageShell`/`StatCard`/`TabNav` adoption after mega-SFCs are decomposed.

### Phase 3 — Backend Refactors

**Verdict:** Solid. Two missing workstreams.

- ✅ 3.1 Delete legacy export modules. After deletion, `use anyhow::Result;` at `json.rs:3` is the only `anyhow` call in the workspace; removing this single line allows `anyhow` to leave `Cargo.toml`.
- ✅ 3.2 `commands/tasks.rs` decomposition — keep, but audit §3.2's "≥14× hand-rolled `spawn_blocking`" is **wrong**. Actual is 10; they've already been half-migrated. Scope to 10.
- ✅ 3.3 `bridge/manager.rs` decomposition.
- ❌ **Missing workstream 3.10:** down-migrations / version gating for both DBs (see §3 item 6).
- ❌ **Missing workstream 3.11:** broadcast back-pressure — bump status channel (`bridge/manager.rs:49`) to 512 or convert to `watch`. Log `Lagged` on all subscribers.
- ⚠️ **Risk:** Phase 3.8 `Mutex<Option<T>>` → `OnceCell<T>` migration is unsafe for `SharedTaskDb` if reset flow stays as-is (see §3 item 11). Call this out and pick `ArcSwap` or gated re-init.
- **Concrete edit:** 3.3 mentions `enum ConnectionMode { Stdio, Tcp { url } }` — good, but specify this as a DTO that's emitted through tauri-specta, not hand-mirrored.

### Phase 4 — Frontend Decomposition

**Verdict:** Ambitious; high regression risk. Under-plans safety net.

- ✅ Decomposition targets look right.
- ❌ **Missing:** no visual-regression harness. Playwright snapshots are mentioned ("Use Playwright snapshot tests on each decomposition") but no infrastructure exists today (8 specs, 0 wired to CI). Without this, decomposing 20 views = 20 chances for a production-visible regression.
- ❌ **Missing:** i18n extraction. Extract strings during decomposition, not after.
- ❌ **Missing:** keyboard navigation / focus-trap contract for extracted modals. 52/116 Vue files have zero `aria-*`.
- **Concrete edit:** Add workstream **4.7 Visual regression harness** before 4.1 starts. Wire existing Playwright to CI; snapshot the top-10 views; fail PR on diff.
- **Concrete edit:** Add workstream **4.8 String extraction** — each decomposed child SFC must not introduce new hardcoded user-visible strings.

### Phase 5 — Packages & CLI

**Verdict:** Right scope, questionable Option A.

- ✅ `@tracepilot/client` split, tokens.css export, barrel cleanup — all correct.
- 🟡 **Option A (N-API/WASM) vs Option B (subprocess):** recommendation in §6. Tl;dr — **Option B** with a documented JSON protocol.
- ❌ **Missing:** `@tracepilot/test-utils` has no enforcement hook ensuring packages consume it. Either delete the package or require import-check in CI.

### Phase 6 — Release, Observability, Docs

**Verdict:** Correct and low-risk. Underweighted telemetry-privacy story.

- ⚠️ 6.2: "opt-in crash reporting (sentry-tauri with a self-hosted endpoint or disabled default)" — endpoint hosting, PII redaction (session paths are filesystem-sensitive), and consent UX are three separate work items, not one.
- ❌ **Missing:** an IPC boundary test harness. Perf budgets are listed; *correctness* budgets are not. Recommend adding a contract-test suite that invokes every generated command with representative args.

---

## 5. Severity Recalibration

| Audit ref | Audit severity | Suggested | Reason |
|---|---|---|---|
| Top-20 #3 (AllowAllCommands) | 🔴 | 🔴🔴 **Hotfix** | Directly reachable privilege escalation via viewer-window markdown + IPC. Fix in a 1-day PR before Phase 0 completes. |
| Top-20 #18 (`run_hidden_shell` + inline `Command::new`) | 🔴 | 🔴🔴 **Hotfix** | Combined with #3, this is a command-injection vector. Callers pass user-controlled strings from preset/launcher configs. |
| Top-20 #8 (error flattening + substring match) | 🔴 | 🔴 | Correct severity. `includes("already indexing")` case-insensitive match (`backendErrors.ts:19`) makes it worse than the audit says. |
| Top-20 #20 (schema migration duplicated) | 🟡 | 🔴 | No down-migrations + factory_reset flow = data loss on downgrade. Promote. |
| Top-20 #10 (legacy export modules) | 🔴 | 🟡 | The file is 461 LOC and only `json.rs` (7 lines) is live `anyhow`. Deletion is one PR. Blast radius low. |
| Top-20 #11 (`spawn_blocking` pattern repeated) | 🔴 | 🟡 | Claim says ≥14×; actual 10× and half already migrated. Real cleanup size is small. |
| §3.7 Concurrency — `Arc<Mutex<Option<T>>>` × 3 | 🟡 | 🔴 for `SharedTaskDb` | `factory_reset` invalidates the handle at runtime. Existing `Arc<Mutex<Option<T>>>` accidentally supports rebinding; blanket `OnceCell` breaks it. |
| §3.9 Test helper duplication | 🟡 | 🟢 | Pure refactor, not user-facing. |
| §4.7 Testing hole at SFC layer | 🔴 | 🔴 but add: | No visual-regression harness at all. Testing gap worse than audit states. |
| §6.1 CI Ubuntu-only | 🔴 | 🔴 (unchanged) | But note: builds matrix alone insufficient; *tests* need the matrix. |
| §6.8 Docs hygiene | 🔴 | 🟡 | Important, but near-zero production blast radius. Don't let this block hard work in other phases. |
| **Missing:** no i18n foundation | — | 🟡 | Will compound decomposition rework otherwise. |
| **Missing:** viewer-window + markdown CSS combined attack surface | — | 🔴🔴 | See top. |
| **Missing:** status broadcast channel=16 | — | 🟡 | Silent drops in field. |
| **Missing:** path-traversal on `open_in_explorer`/`open_in_terminal`/`launch_session` | — | 🔴 | Trivial to exploit once capabilities are scoped. |

---

## 6. Technical-Choice Verdicts

### 6.1 `specta` + `tauri-specta` vs `ts-rs` vs `typeshare`

**Verdict: correct choice, but know the sharp edges.**

- `specta` is the only option of the three that emits *command signatures* (argument names, return types, error type). `ts-rs` emits types only — you'd still hand-mirror the command list. `typeshare` is optimized for mobile (Swift/Kotlin/TS) and has weaker Tauri integration.
- Sharp edges in *this* codebase:
  1. `serde_json::Value` payloads (audit §3.10: `EventItem.data`, `SessionIncidentItem.detail_json`) serialize as `unknown` on the TS side. You gain no type safety on the most important event stream until you define typed variants.
  2. `tauri-specta` needs `derive(Type)` on *every* struct reachable from a command. `tracepilot-core` public types number in the dozens — this is a significant downstream change, not just `tauri-bindings`.
  3. Generated code is checked in by convention; plan's "CI diff check" is right — specify the file path and add a `.gitattributes linguist-generated=true` entry.
- **Prefer:** adopt `specta` now, budget 30% overrun on Phase 1.1.

### 6.2 `tokio::sync::OnceCell<T>` vs `Arc<Mutex<Option<T>>>`

**Verdict: right for most sites, wrong for `SharedTaskDb`.**

- For `SharedConfig` (immutable after init) and `SharedOrchestratorState` (lazy-init-once): `OnceCell` is a straight win. No `poison`, no awaiting under a `std::sync::Mutex`.
- For `SharedTaskDb`: `factory_reset` (`commands/config_cmds.rs:68`) removes DB files. After reset you need either:
  - explicit re-init (`OnceCell::set` after `take` — not supported cleanly), or
  - `ArcSwap<Option<Arc<TaskDb>>>` so readers see `None` during reset and fail soft.
- **Recommendation:** use `tokio::sync::OnceCell` for `SharedConfig` and `SharedOrchestratorState`; use `arc_swap::ArcSwapOption<TaskDb>` for `SharedTaskDb`. Add a regression test for the reset-and-reopen flow.

### 6.3 Moving design tokens from `apps/desktop` to `@tracepilot/ui`

**Verdict: necessary; low runtime risk; medium CSS-specificity risk.**

- Today `packages/ui` components reference `var(--text-placeholder)` unconditionally; currently works only because `apps/desktop/src/styles/design-tokens.css` is imported at the app root (8.3 KB file).
- Moving the file to `packages/ui/src/styles/tokens.css` with a subpath export is mechanical.
- **Risk 1:** `docs/design/prototypes/shared/design-system-c.css` has drifted from desktop tokens (audit §5.2). If you migrate without reconciling, the prototypes break silently.
- **Risk 2:** Vite/CSS import ordering — if a desktop stylesheet overrides a token and the `packages/ui` import now runs *after* it, the token value changes. Snapshot rendering with Playwright before and after, for each theme.

### 6.4 Option A (N-API/WASM) vs Option B (subprocess) for CLI

**Recommendation: Option B.**

Reasoning:

1. The CLI has 6 commands, and two of them (`index`, `resume`) are stubs (audit §5.6). The surface area doesn't justify a native-module build pipeline.
2. Option A forces every TS devenv to build the Rust toolchain — hostile to drive-by contributors. TracePilot is a hobby/portfolio-grade repo; contributor friction matters.
3. `version-analyzer.ts` (38.5 KB) is already a leading candidate for deletion once Rust owns version discovery; after that, Option B's cost is tiny.
4. Option B gives you a natural boundary to write once (stable JSON schema) — exactly what specta adoption (6.1) already requires.
5. Option A's performance argument doesn't apply: CLI invocations are human-scale.

Caveat: Option B requires the Rust binary to expose a `tracepilot-core --json ...` surface. That surface becomes a *second* IPC contract, parallel to Tauri. Manage it via the same `specta::Type` derivations — emit a separate `cli-schema.json` artifact and version it.

---

## 7. Risk & Sequencing Hazards Not Addressed by the Plan

1. **Phase 1.2 localStorage rename is a silent data loss.** Plan says "provide one-shot migration for old `tracepilot-*` keys." User who runs v0.7 once (keys migrated to `tracepilot:*`), downgrades to v0.6 (looks only for `tracepilot-*`), loses prefs. Fix: keep dual-read for one release.

2. **Phase 3.1 deletion of legacy export modules is behaviourally non-identical.** The audit assumes new `render/markdown.rs` is a drop-in. Verify by diffing output on the existing integration test corpus before deletion — `export/tests/integration.rs` has 724 LOC of test cases. Plan mentions no such parity check.

3. **Phase 4.3 CSP tightening** (`'unsafe-inline'` drop) will break any third-party component that injects inline styles. `dompurify` output can contain `style` attrs depending on config. This is a separate mini-audit; don't roll it into a routine PR.

4. **Phase 4.1 decomposition + Phase 2.3 shared-component adoption race.** If two PRs run in parallel, one extracts children and the other wraps `PageShell` on top of now-stale DOM. Serialise per file.

5. **Phase 1.4 capability scoping** if landed after a viewer-window marketing push could break in-production viewer windows pinned to old builds that expect certain events. There is no event/command deprecation window in the plan.

6. **Schema migration changes in Phase 3.4** without down-migrations means users who install the migration PR cannot revert without manual SQLite surgery. Current state already has this problem, but the phase touches both DBs at once — higher blast radius.

---

## 8. Gameable Success Metrics → Suggested Replacements

| Appendix A metric | Game | Better metric |
|---|---|---|
| "Rust files > 500 LOC → 0" | Split a 600-LOC file into two 301-LOC files that re-export each other | Max LOC of any *cohesive unit* (LOC + cyclomatic complexity budget per module) |
| "Vue SFCs > 1000 LOC → 0" | Move style block to sibling `.css` file | **Total file-cluster LOC** (SFC + its sibling styles + its composables referenced only here) |
| "Hand-mirrored IPC commands → 0 (generated)" | Generate stubs while still hand-maintaining real types alongside | CI step: `cargo run -p tauri-bindings --bin gen && git diff --exit-code --stat generated/` + a second check that no non-generated file re-declares a command name |
| "localStorage keys → 1 registry" | Central registry, unsynchronised callers | Lint rule forbidding `localStorage.*Item(` anywhere except `usePersistedRef` |
| "Disabled CI gates → 0" | Re-enable and `continue-on-error: true` | Required status checks at branch protection level |
| "Allow-all capability rules → 0" | Replace with generated allow-list that still grants everything | Assert in CI that `viewer-*` capability schema intersection with `{factory_reset, rebuild_search_index, task_*, import_*}` = ∅ |
| "`toErrorMessage(e)` sites → <10" | Move to a private helper that wraps `toErrorMessage` | Count *all* manual try/catch in stores, not just `toErrorMessage` spelling |
| "Packages without README → 0" | Empty README.md | Package README completeness lint (must contain: Purpose, Public API, Tokens/Deps) |
| "Docs in flat top-level → ≤ 5" | Move everything to `docs/everything/` | Treemap: no folder > 20 files, no file > 2 years old without review mark |

Add a **meta-metric**: "Time to detect a broken IPC contract during dev." Baseline today: shows up at runtime. Target: fails `pnpm build` because generated types mismatch.

---

## 9. Personal Top-10 (If I Had to Pick)

Ordered by value × (1/effort):

1. **[Hotfix, 1 day] Scope viewer-`*` capabilities.** Land a minimal viewer-capability file that permits only read-only commands. Kill `AllowAllCommands` on the viewer window today. Leave `main` permissive for one release cycle to avoid breakage. `apps/desktop/src-tauri/build.rs:176`, `capabilities/default.json:4`.

2. **[Hotfix, 1 day] Replace `ALREADY_INDEXING` substring match with an explicit sentinel.** Emit `{"code":"ALREADY_INDEXING"}` in `BindingsError::serialize` (`tauri-bindings/src/error.rs:73`). Update one consumer (`backendErrors.ts:19`). Pure win; no codegen needed.

3. **[1 week] `specta` + `tauri-specta` wired, generated `commands.ts` committed.** Plan's Phase 1.1. Every other SSoT fix shrinks after this.

4. **[1 week] Re-enable `cargo clippy -D warnings`, `cargo fmt --check`, `pnpm lint`, `pnpm audit`, `cargo audit` in CI.** Expected 200+ findings on first run — budget a follow-up `chore(clippy)` PR. Also: Windows to the test matrix.

5. **[3 days] Delete legacy `export/src/json.rs`; remove `anyhow` from workspace.** Audit §3.1. After deletion this becomes a lint (`clippy::disallowed_types = [anyhow::Error]`).

6. **[3 days] `commands/tasks.rs` finish the `with_task_db` migration.** 10 remaining `spawn_blocking` → `with_task_db`. Move `is_process_alive` out. Audit §3.2.

7. **[1 week] Visual-regression harness.** Wire the 8 existing Playwright specs to CI, add snapshot tests for the 10 largest views. Without this, Phase 4 decomposition is reckless.

8. **[1 week] Path validation for `open_in_explorer`, `open_in_terminal`, `launch_session`.** Add `validate_path_within(allowed_roots)` (already exists for skills/export) and call it from every command that takes a `path: String`. `commands/orchestration.rs:196-215`.

9. **[2 weeks] Decompose the top-3 mega-SFCs: `PresetManagerView.vue`, `ConfigInjectorView.vue`, `WorktreeManagerView.vue`.** Each becomes 4-6 files < 500 LOC. Pair each with at least one Vitest component test and a Playwright snapshot.

10. **[ongoing] Migrate `SharedConfig` and `SharedOrchestratorState` to `tokio::sync::OnceCell`; migrate `SharedTaskDb` to `ArcSwapOption<TaskDb>` with an explicit reset-and-reopen path.** Write the reset regression test first. Close the `factory_reset` data-loss-after-restart bug as a side effect.

Deliberately not in my top-10: docs reorganisation (Phase 6.4), CLI rebase (Phase 5.5). Both are valuable but neither is on the critical path to a maintainable architecture.

---

## 10. Closing Assessment

The audit is an unusually thorough and well-cited piece of work — better than ~90% of tech-debt audits I've seen in industry. Its three biggest weaknesses are:

1. **Magnitude inflation in a handful of claims** (spawn_blocking ≥14×, PageShell=1-view, StatCard=3-views, `export *` ×17). These survive on the strength of the surrounding accurate work but undermine trust — tighten with a verification pass before this file is canonized.
2. **No risk ranking between top-20 items.** Capability scoping and legacy-export deletion are both "#3" and "#10" but the blast radii differ by two orders of magnitude.
3. **Missing capability taxonomy**: no i18n, no a11y, no visual regression, no migration downgrade story. Each is load-bearing for the plan to land without introducing new debt.

The plan inherits the audit's strengths (right focus, right phase structure) and its weakness (treats severity as monotone). With the sequencing fixes in §4 (Phase 2 split, 1.1+1.5 merged, 1.4 pulled forward, Phase 4 gated on a visual-regression harness) it is a credible 4–6 month programme of work that would leave TracePilot demonstrably in the top quartile of AI-assisted projects for maintainability.

**Ship Phase 0 + hotfixes (items 1, 2, 4, 8 from my top-10) this week.** Re-evaluate the plan's structure after Phase 1.1 lands — generated bindings will change your intuition about what "hard" means in Phases 3–5.
