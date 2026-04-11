# Tech Debt Consolidation Report — Peer Review

**Reviewer**: Copilot (automated deep review)
**Date**: 2026-04-11
**Reviewed document**: `docs/tech-debt-consolidation-report.md`

---

## 1. Validated

Spot-checked 12 specific claims against source code. Results:

| # | Claim | Verdict | Notes |
|---|-------|---------|-------|
| 1 | 21 views use `class="page-content"` (§2.1) | ✅ **Accurate** | Grep confirms exactly 21 `.vue` matches. |
| 2 | `TaskDashboardView` uses `EmptyState` component (§2.1 table) | ❌ **Inaccurate** | Uses custom `.empty-state` markup, not the `EmptyState` component. No `EmptyState` import in the file (`TaskDashboardView.vue:2`). |
| 3 | 22 raw `stat-card` instances across 5 views (§2.2) | ⚠️ **Off by one** | 21 in views + 1 in `StatCard.vue` itself = 22 repo-wide, but the report says "22 across 5 views" — actual view count is **21**. Per-view breakdown (5/4/4/4/4) is correct. |
| 4 | `loading.value = true` in 18 files, `error.value = null` in 19 (§3.1) | ✅ **Accurate** | Confirmed when scoped to `apps/desktop/src`. Repo-wide is higher (~23/21) due to docs matching. |
| 5 | Skills store repo scope bug (§3.6) — mutations call `loadSkills()` without `repoRoot` | ✅ **Confirmed bug** | `skills.ts:95` accepts `repoRoot?`, `skills.ts:100` passes it to API, but lines 132/148/160/187/199/274/286/305/338 all call `await loadSkills()` with no arg. No `currentRepoRoot` stored. |
| 6 | Client `invoke()` duplicated in 4 files (§3.7) | ✅ **Accurate** | `index.ts:60-66`, `orchestration.ts:27-33`, `skills.ts:17-23`, `mcp.ts:12-18` each define separate `invoke()`. |
| 7 | SQLite PRAGMA setup in 3 crates (§5.1) | ❌ **Inaccurate** | `tracepilot-core/utils/sqlite.rs:45-59` is `open_readonly()` — **no PRAGMAs**. Only `tracepilot-indexer/index_db/mod.rs:49-56` and `tracepilot-orchestrator/task_db/mod.rs:40-46` have the PRAGMA block. **2 crates, not 3.** |
| 8 | `SharedTaskDb` lock pattern repeated 15+ times (§5.4) | ⚠️ **Overstated** | Exact 2-line pattern appears **10 times** in `commands/tasks.rs`. Broader `"TaskDb not init"` matches reach 13. Not 15+. |
| 9 | DTO manual mapping at `helpers.rs:140-161` (§5.6) | ✅ **Accurate** | `indexed_session_to_list_item()` manually maps ~20 fields. |
| 10 | Reindex duplication in `search.rs` (§5.5) | ✅ **Accurate** | Lines 136-184 vs 231-279 are near-identical spawns differing only in `reindex_search_content` vs `rebuild_search_content`. |
| 11 | `useAsyncData` has zero production usage (§3.4) | ✅ **Accurate** | Only found in its own definition + test file. No production imports. |
| 12 | `setActivePinia(createPinia())` appears 26 times (§6.4) | ⚠️ **Off by one** | Actual count is **27**, not 26. |

**Summary**: 8/12 claims fully accurate, 3 have minor count errors, 1 is materially wrong (the `tracepilot-core` PRAGMA claim). The report's overall narrative is sound but the specific numbers need correction.

---

## 2. Gaps — What the Report Missed

### 2.1 🔴 Rust ↔ TypeScript Type Mirroring (HIGH severity)

**The single largest architectural risk not covered.** Types are manually duplicated between Rust and TypeScript with no codegen (`ts-rs`, `specta`, `typeshare` — none found in the repo):

| Domain | Rust Source | TypeScript Mirror |
|--------|-----------|-------------------|
| Config | `crates/tracepilot-tauri-bindings/src/config.rs:30-46,166-193` | `packages/types/src/config.ts:19-84` |
| Health | `crates/tracepilot-core/src/health/mod.rs:27-49` | `packages/types/src/session.ts:97-106` |
| Search | `crates/tracepilot-indexer/src/lib.rs:407-412` | `packages/types/src/search.ts:77-100` |
| Tasks | `crates/tracepilot-orchestrator/src/task_db/types.rs:103-189` | `packages/types/src/tasks.ts:35-104` |
| Events | `crates/tracepilot-core/src/models/event_types/event_type_enum.rs:12-70` | `packages/types/src/known-events.ts:2-55` |

This is worse than duplication — it's **silent drift risk**. A field added in Rust but missed in TS won't fail at compile time; it'll surface as a runtime `undefined`.

### 2.2 🔴 Feature Flag Defaults Already Drifting

Three independent sources of feature flag defaults are **already out of sync**:

| Flag | Rust default (`config.rs:183-193`) | TS default (`defaults.ts:111-120`) | Pinia store (`preferences.ts:81-89`) |
|------|-----------------------------------|------------------------------------|--------------------------------------|
| `export_view` | `false` | `true` | (from TS defaults) |
| `mcp_servers` | `true` | `false` | (from TS defaults) |
| `skills` | `true` | `false` | (from TS defaults) |

This is an **active bug**, not just tech debt. Users see different defaults depending on whether the Rust config or TS defaults load first.

### 2.3 🟡 Tauri Event Names are Magic Strings

Event names like `"search-indexing-started"`, `"indexing-progress"`, `"search-indexing-progress"` are hardcoded on both sides:
- Rust emits: `commands/search.rs:99-131,147-153,207-248`
- TS listens: `composables/useIndexingEvents.ts:23-35`, `stores/search.ts:124-158`

No shared constant file. A typo breaks the connection silently.

### 2.4 🟡 `window.confirm` Bypasses Shared Dialog

`SkillEditorView.vue:160,171,193` uses native `window.confirm()` while the rest of the app uses `useConfirmDialog` composable (`packages/ui/src/composables/useConfirmDialog.ts`). Inconsistent UX.

### 2.5 🟡 Logging Abstraction Exists but is Not Used

`apps/desktop/src/utils/logger.ts:32-45` provides a structured logger, but `packages/client/src/` uses raw `console.log`/`console.warn` throughout (`index.ts:60-65`, `skills.ts:17-22`, `orchestration.ts:27-32`, `mcp.ts:12-17`).

### 2.6 🟢 No `reportError()` Unification

Error reporting is fragmented: `ErrorAlert`, `ErrorState`, custom toast banners, and raw `console.error` all coexist. There's a global `ErrorBoundary.vue` mounted at `App.vue:173-175`, but no single `reportError()` function that normalizes log + display.

---

## 3. Challenges — Recommendations That Need Pushback

### 3.1 `PageShell` (§2.1) — Risks Over-Abstraction

The report proposes a `PageShell` with `error`, `loading`, `empty`, `errorHeading`, `loadingMessage`, and `emptyProps` as props/slots. This is a lot of surface area for one component.

**Concern**: Views have *meaningfully different* loading UX. Analytics pages use `LoadingOverlay` (content stays visible, dimmed), while task pages use `LoadingSpinner` (content replaced). `SessionDetailView` uses `SkeletonLoader`. Forcing all views through one component either:
- Makes `PageShell` a complex kitchen-sink component with multiple loading modes
- Forces all views into one loading UX, which may regress UX for some pages

**Recommendation**: Keep `PageShell` minimal — just `page-content > page-content-inner` wrapper + error slot. Let individual views (or feature-area shells like `AnalyticsPageShell`) handle their own loading strategy.

### 3.2 `useFilteredCollection` (§3.3) — Premature Generalization

Only 3 stores use this pattern. The filter logic differs enough (skills filter by `scope` + `enabled`, presets by `category`, tasks by `status` + `priority`) that a generic composable would need an extensive `filters` config object. The current code is simple and readable.

**Recommendation**: Defer until a 4th consumer appears. Three instances is borderline for extraction.

### 3.3 Router Split (§6.1) — High Disruption, Low Value

Splitting a 320-line route file into feature modules adds indirection for minimal gain. The file is linear, searchable, and rarely changes. Deriving sidebar items from route records (§6.1 point 2) is a better standalone win.

**Recommendation**: Do the sidebar derivation; skip the route file split unless the route file is actively causing merge conflicts.

### 3.4 `MigrationRunner` Abstraction (§5.2) — Only 2 Consumers

Extracting a generic migration runner for 2 databases is over-engineering. The indexer and task DB have different migration table names and semantics. The current code is 30-40 lines each.

**Recommendation**: Align the approach (both use a `schema_version`-style table) but keep the implementation local to each crate. Revisit if a 3rd database appears.

### 3.5 Replacing String Error Variants (§5.7) — Scope Creep Risk

Replacing `OrchestratorError::Git(String)` with structured variants carrying `#[source]` is architecturally correct but touches error handling throughout the orchestrator crate. This is a large refactor with high regression risk for moderate benefit.

**Recommendation**: Phase this incrementally — start with one variant (e.g., `Git`) and prove the pattern before converting all 7.

---

## 4. Prioritization Feedback

The report's 4-phase plan is mostly sound. Specific adjustments:

### Reprioritize UP (should be Phase 1)

| Item | Current Phase | Why Move Up |
|------|--------------|-------------|
| **Feature flag drift fix** (§2.2 gap above) | Not in report | Active bug — users see wrong defaults. Single source of truth needed immediately. |
| **Skills store repo scope bug** (§3.6) | Phase 4 (4.4) | Confirmed real bug, not cleanup. Should be Phase 1 — it's a small, isolated fix. |

### Reprioritize DOWN (should be later or dropped)

| Item | Current Phase | Why Move Down |
|------|--------------|---------------|
| `useFilteredCollection` (3.1) | Phase 3 | Only 3 consumers; premature. Move to Phase 4 or backlog. |
| Router split (3.3) | Phase 3 | Low value; keep sidebar derivation, drop file split. |
| `MigrationRunner` (3.2) | Phase 3 | Only 2 consumers; keep local. Drop. |

### Add to Plan

| Item | Suggested Phase | Rationale |
|------|----------------|-----------|
| Rust ↔ TS type codegen (e.g., `ts-rs`) | Phase 2 | Prevents silent drift; pairs well with DTO work (2.6). |
| Tauri event name constants | Phase 2 | Trivial to do; prevents subtle event routing bugs. |
| Feature flag single source of truth | Phase 1 | Active bug. Define flags in one place, derive everywhere. |

### Proposed Revised Phase 1

1. Fix feature flag drift (new — active bug)
2. Fix skills store repo scope bug (moved from 4.4 — active bug)
3. Extract `PageShell` — but **minimal version** (wrapper + error only, no loading mode)
4. Extract `runAction`/`runMutation` store helpers (1.2 — unchanged)
5. Migrate stat-card divs → `StatCard` (1.3 — unchanged)
6. Extract `with_task_db()` Rust helper (1.4 — unchanged)
7. Extract shared SQLite opener (1.5 — but note: only 2 crates, not 3)

---

## 5. Risks

### 5.1 `PageShell` Migration — Highest Risk Item

- **21 views touched simultaneously.** Even with careful slot design, this will produce merge conflicts with any in-flight feature branches.
- **Loading UX regression**: As noted in §3.1, different views intentionally use different loading strategies. A one-size-fits-all component may degrade UX.
- **Mitigation**: Migrate in batches (analytics views first, then tasks, then others). Ship a minimal `PageShell` first; add loading/empty support as a follow-up.

### 5.2 `SectionPanel` Migration — CSS Reconciliation Required

The report correctly flags this (§2.3 note): `SectionPanel.vue` has scoped CSS with different `margin-bottom` and header styling than the global `.section-panel` class in `components.css`. Migrating 19 instances without reconciling these styles will cause visual regressions.

- **Mitigation**: Create a side-by-side visual comparison first. Decide which CSS is canonical before migrating.

### 5.3 Moving Composables to `@tracepilot/ui` (§3.5) — Import Graph Risk

`useAsyncGuard`, `useCachedFetch`, and `useAutoRefresh` may have transitive dependencies on app-level code (stores, router, Tauri API). Moving them to a shared package requires verifying they're truly generic.

- **Mitigation**: Check each composable's import graph before moving. `useAsyncGuard` (pure Vue reactivity) is safe. `useCachedFetch` may reference Tauri's `invoke` — verify.

### 5.4 Store Helper Extraction (§3.1-3.2) — Type Inference

The proposed `runAction<T>` helper returns `Promise<T | undefined>`. Callers that currently set `data.value = result` inline will need to handle the `undefined` case. This changes the ergonomics at every call site.

- **Mitigation**: Consider an alternative API that accepts the `data` ref directly:
  ```typescript
  await runAction(loading, error, data, () => apiCall(), "context");
  ```
  This keeps the "set data on success" behavior internal.

### 5.5 Rust DTO `From` Impls (§5.6) — Hidden Logic

The manual mapping in `helpers.rs:140-161` doesn't just copy fields — it may include transformations (date formatting, optional field defaulting, computed properties). A mechanical `From` impl must preserve this logic.

- **Mitigation**: Audit each mapping for non-trivial transforms before converting to `From`.

### 5.6 Feature Flag Drift — Ship-Blocking if Mishandled

The Rust and TS defaults are currently out of sync (§2.2 above). Any consolidation must decide: which defaults are correct? Changing defaults changes user-visible behavior.

- **Mitigation**: Treat as a product decision, not just an engineering task. Get sign-off on intended defaults before consolidating.

---

## Summary

The report is **substantively correct** and well-evidenced. Its biggest weakness is **what it doesn't cover**: Rust/TS type mirroring and feature flag drift are higher-severity issues than most items in the report. Some recommendations (PageShell, filtered collection, router split, migration runner) are over-scoped for their consumer count. The phasing should promote bug fixes (skills store, feature flags) to Phase 1 and defer premature abstractions. The highest-risk migration is PageShell (21 views) — do it incrementally, not atomically.
