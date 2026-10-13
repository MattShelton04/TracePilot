# Development friction analysis (October 2026)

A snapshot of where working in this repository hurts, especially with many agents
working in parallel. It draws on git history, CI and PR data, and local Claude Code and
Codex session logs. Numbers describe the repository as of `580d3d96` (2026-10-13).
Check the current code before acting on any of them; the recommendations are the part
meant to last.

## Summary

The foundations for parallel work are sound: named app instances with registry-assigned
ports and isolated data, per-worktree build tuning, change-classified CI jobs, and a
proportionate verification table in the [protocol](../agents/protocol.md). Most of the
friction comes from five things:

1. **Red CI that isn't the PR's fault.** Of 155 failed CI jobs, about 83% weren't caused
   by the code under test. The causes were Dependabot bumps, upstream advisories, main
   already broken by an earlier merge, and flaky Windows timing. The `required` check
   isn't enforced, so 17 of 164 PRs merged red, and main was red about 13% of the time.
2. **Shared files that every PR edits.** On days with several merges, 27% of commit
   pairs touch a common file. `CHANGELOG.md` is in 20% of recent PRs. Adding one IPC
   command means 6–9 hand edits across Rust, TS, mocks and capabilities.
3. **Waiting and re-checking.** Agent time goes mostly to polling CI, sleeping and
   re-running checks, not to failures. Only 1.9% of Claude Code tool calls failed, but
   there were about 370 `gh pr checks` polls and 118 wait loops (about 400 minutes).
   Every push re-runs about a minute of hooks.
4. **Windows shell and sandbox friction.** Playwright CLI calls fail 10× more often
   from PowerShell than from Bash. In Codex, about 17% of commands needed an approval
   review (99.9% approved), and `spawn EPERM` broke Node-based checks in 104 sessions.
5. **Drift and leftovers.** These were verified at the snapshot:
   - `pnpm lint` fails in the main checkout because of `.claude/worktrees/`.
   - The shared git hooks point at a deleted worktree's lefthook binary.
   - `just ci` treats checks CI requires as advisory.
   - The command-registration doc is stale.
   - About 100 backticked paths in docs no longer exist.

The [prioritized recommendations](#recommendations) are grouped by effort. Tier 1 items
are each under an hour and remove a large share of the noise above.

## Data sources

| Source | Window | Volume |
| --- | --- | --- |
| Git history | 2026-03-14 → 10-13 | 611 non-merge commits (199 in the last 90 days), all `--numstat` |
| GitHub Actions | 2026-09-20 → 10-13 | 500 CI runs, logs from all 155 failed jobs classified |
| Pull requests | #832 → #1032 | 200 PRs (164 merged), bodies and comment threads |
| Claude Code sessions | 2026-09-19 → 10-13 | 90 sessions + 132 subagent transcripts, 27.4K tool calls, 273 user prompts |
| Codex sessions | 2026-07 → 10 | 95 user threads, 180 subagent threads, 19.1K shell commands, 3,254 approval reviews |
| Repository audit | at `580d3d96` | docs, scripts, hooks, workflows, justfile, package scripts |

Session logs were parsed read-only on the maintainer's machine, and only aggregates and
paraphrased themes appear here. The analysis scripts were one-off and aren't tracked.

## Findings

### 1. Churn hotspots and conflict magnets

The most-touched files over the last 90 days (199 commits):

| File | Share of commits | Why it changes |
| --- | --- | --- |
| `CHANGELOG.md` | 20% | Every user-facing PR adds an `[Unreleased]` line ([protocol.md](../agents/protocol.md) *Ship* step 1) |
| `packages/types/src/index.ts` | 15% | Hand-written barrel of 34 `export type {…} from` blocks |
| `crates/tracepilot-indexer/src/index_db/types.rs` | 13% | Session row shape; mirrored by hand in TS |
| `scripts/README.md` | 13% | Every new script must be listed |
| `packages/client/src/internal/mockData.ts` | 12% | One mock file for every view |
| `apps/desktop/src/components/session/SessionDetailPanel.vue` | 12% | Hub file for every session-detail feature |
| `crates/tracepilot-tauri-bindings/src/lib.rs` | 11% | `generate_handler![]` list |
| `ipc_command_names.rs`, tauri-bindings `types.rs`, `packages/client/src/commands.ts` | 10% each | IPC command chain (see below) |
| Generated `bindings.ts` / `ipc-commands.json` | 9% / 10% | Regenerated on IPC changes |

What that means for parallel work:

- **Overlap rate.** Of 2,105 pairs of commits that landed on the same day, 27% share at
  least one file. Excluding CHANGELOG and version files still leaves 24%.
- **The Claude Code work packages (Oct 7–13, 111 commits).** Living research docs served
  as shared status trackers: `mapping.md` was in 17% of commits and `claude-code-sessions.md`
  in 16%. They became the biggest overlap sources.
- **Bigger PRs.** The median recent PR touches 18 files and 604 lines; the median feature
  touches 22 files. Only 2 of 199 recent PRs touched a single file.
- **Fixes after features.** 38% of feature commits were followed within 3 days by a fix
  touching the same files, for example the October redesigns #994–#1009 followed by the
  QA fixes #1014–#1017. Large surfaces landed before anyone checked them in the app.
- **No god files.** Only `SessionDetailPanel.vue` (651 lines) and `OverviewTab.vue`
  (657) are both large and high-churn. Earlier splits of `lib.rs` and the types barrel
  worked.
- **Migration numbering.** `migrations/plan.rs` numbers migrations `version: N`, so two
  parallel PRs that each add a migration will claim the same number.

### 2. The IPC command chain

Adding one command means editing three hand-maintained name lists, two generated files,
mocks, and sometimes a capability list. Since `ipc_command_names.rs` was introduced
(#506), every commit that edited it also edited `lib.rs` and `ipc-commands.json`. Most also
edited `commands.ts` (23 of 24), the types barrel (18) and `mockData.ts` (17). The full
chain:

1. `crates/tracepilot-tauri-bindings/src/ipc_command_names.rs`, the list itself
2. `lib.rs` `generate_handler![]`
3. `specta_exports.rs`
4. `packages/client/src/commands.ts` `IPC_COMMANDS`, a hand-written copy of step 1
   (about 190 names) that only a contract test keeps in sync
5. a client wrapper module and a mock route
6. sometimes `apps/desktop/src-tauri/capabilities/viewer.json`; #973 fixed a drift here
7. `pnpm gen:bindings`, then commit `bindings.ts` and `ipc-commands.json`

The steps are documented only in a comment at the top of `ipc_command_names.rs`.
[tauri-command-registration.md](../tauri-command-registration.md), listed under "Start
here", still describes the old `build.rs` list. No doc says that conflicts in generated
files are resolved by re-running `pnpm gen:bindings` rather than by hand.

Separately, 45% of recent commits touch both Rust and TS. Domain types such as
`conversation.rs`/`conversation.ts`, `analytics/types.rs` and orchestrator types are
still mirrored by hand.

### 3. CI and merge health

Shape and timing:

- PR CI takes 8.9 minutes median (10.6 p90). The Windows installer E2E (8.5 minutes
  median) is the last job to finish in 90% of green runs.
- Job selection is coarse: a Vue-only PR still runs Rust on three OSes plus the
  installer E2E.

Root causes of the 155 failed jobs:

| Category | Jobs | Share | Examples |
| --- | --- | --- | --- |
| Dependabot upgrades | 50 | 32% | Tauri npm and crate versions bumped separately (18); test-stack majors; vite 8 `manualChunks`. **0 of 25 Dependabot PRs merged.** |
| Upstream advisories | 34 | 22% | One `pnpm audit --prod` advisory turned every PR and main red for about 1.5 days (Oct 6–7). The rustsec action failed twice on a checks-API error. |
| Main already broken | 18 | 12% | #905 merged with stale bindings; #1004 merged with a failing E2E assertion |
| Flaky tests / Windows timing | 26 | 17% | See below |
| Real defects in the PR | 27 | 17% | clippy (8; floating `stable` toolchain), file-size budget just over the limit (7), biome, snapshots |

Merge gating:

- The `required` aggregate job exists, but the main rulesets enforce no status checks
  and admins are exempt. 17 of 164 merged PRs merged with a red final commit. During the
  advisory outage this hid #905's real bindings break.
- `cancel-in-progress: true` also applies to main pushes (`ci.yml:12-14`). Merges land
  about every 10 minutes, so 25% of main runs never finish and a break can't be traced
  to one commit.
- 39 PR bodies explain "pre-existing" failures. Agents spend effort re-explaining main's
  known breakage instead of fixing it once.
- Bots wrote 383 of about 456 PR comments. The pricing report posted "needs review" on
  67 PRs that didn't touch pricing.

Flaky tests:

| Test | Evidence | Status |
| --- | --- | --- |
| `SessionDetailPanel.test.ts` (resume, auto-refresh cases) | 9 failures on 6 unrelated branches and main | Fixed by #961/#963 |
| `useAnalyticsPage.test.ts`, `analyticsPrefetch.ts` `idle()` | 3 failures on unrelated PRs: "window is not defined" after teardown | **Probably still latent**: `analyticsPrefetch.ts:32` reads `window.requestIdleCallback` without first checking that `window` exists |
| Native E2E "Startup timed out after 60s" / CDP connect | 6 failures, including on main at `ab453914` | **Open** |
| Windows automation contracts (`diagnostic-lifecycle`, stale-PID cases) | 5 failures, 4 on main | Fixed by #930 |
| `process_start_time_reads_a_live_process…` (Windows) | 2, green on rerun | Fixed by #955 |

### 4. Agent session friction

Claude Code and Codex hit different problems, but both lose time to waiting and checking
far more than to failed commands.

**Waiting on CI and background work.**

| Signal | Claude Code | Codex |
| --- | --- | --- |
| CI polls (`gh pr checks`, incl. `--watch`) | about 370 | about 245 (44 false failures from a non-zero exit while checks were pending) |
| Waiting | 65 sleep-then-check commands blocked by the harness; 118 `until grep` loops (about 403 minutes) | 516 `sleep` calls (about 5 hours) |

The [protocol](../agents/protocol.md) has no single recommended way to wait.

**Validation cost.**

| Check | Claude Code (runs, total time) | Codex (median / p90 time) |
| --- | --- | --- |
| vitest | 1,107 runs, 17 h | — |
| `cargo test` | 811 runs, 12 h | 20 s / 172 s |
| lint | 882 runs, 9 h | — |
| typecheck | 444 runs, 7.7 h | — |
| `git push` | 277 runs, 4.7 h (55 s median) | — |

- Pushes are slow because pre-push re-runs the full `pnpm typecheck`, `cargo fmt --check`,
  the file-size check and the spacing check.
- Agents chain checks by hand and re-type the same output filters, such as
  `^(error|warning)` and `test result|FAILED|panicked`.
- Codex ran `just ci` 14 times at 14–21 minutes each, although the protocol doesn't ask
  for it.

**Windows shells.**

| Issue | Evidence |
| --- | --- |
| Playwright CLI from PowerShell | `pnpm exec playwright-cli` failed 10% of the time in PowerShell vs 1% in Bash: shim quoting of inline JS, browser session not yet attached, `resize` syntax, ambiguous locators. Several agents wrote their own `pw.sh` wrapper. |
| Globs | PowerShell doesn't expand globs like `crates/*/Cargo.toml` for `rg`: 255 failures in 128 Codex sessions |
| Syntax and escaping | 79 PowerShell parser errors; 34 Bash heredocs with unterminated quotes |
| Encoding | cp1252 errors in Python, worked around by hand 265 times |
| Shell profile | A profile line that fails in the sandbox polluted 440 outputs, until agents switched to `-NoProfile` |

**Sandbox and permissions (Codex).**

- 3,254 approval reviews, 3 denials. The highest-volume families are vitest/pnpm (973),
  playwright-cli (879), gh (564), git (438) and cargo (233).
- 165 `spawn EPERM` failures in 104 sessions. They broke vitest, biome and the
  repository's own `check-*.mjs` scripts, which spawn `git ls-files`.
- 29 `index.lock: Permission denied` failures, and 18 offline `pnpm install` failures.

**Worktree bootstrap.**

- In Codex, 21 of 54 `pnpm install` runs in worktrees failed, and 40 "biome/vitest is not
  recognized" errors came from worktrees without `node_modules`.
- The first Rust build in a new worktree takes 76 s median and 300 s p90 in Claude Code;
  Codex worktrees ran clippy at 64 s vs 36 s.
- Worktrees live in three places: `.agent/worktrees/`, `.claude/worktrees/` and a sibling
  folder. 15 folders under `.agent/worktrees/` are no longer registered with git, and 12
  still hold a `target/`.

**What the maintainer keeps having to say.** These themes come from 531 maintainer
messages across both tools, paraphrased:

| Theme | Messages |
| --- | --- |
| Commit, push and open the PR, often after the work was otherwise done | 85 |
| "Continue", after compaction or an early stop | about 95 |
| Test in the real app, with my own sessions, and look at it | about 80 |
| Keep it lean: don't overcomplicate, too many review rounds, trim | about 45 |
| Write a handover or the next prompt | about 30 |
| Release notes: short, flat bullets | 25 |
| Merge latest main and resolve conflicts (CHANGELOG named) | 11 |
| UI polish | 19, mostly clipped tooltips, missing pointer cursors and load jitter |

**Context agents keep reloading.**

- `protocol.md` was read in 112 Claude Code and 113 Codex sessions, and `AGENTS.md` in 171
  Codex sessions.
- The automation skill was read in 92 Claude Code and 79 Codex sessions.
- 19 Claude Code agents read `scripts/automation/app.ps1` and 19 read the file-size
  script source to learn how they work.
- `.cargo/config.toml` and `CARGO_TARGET_DIR` were rediscovered in about 40 Claude Code
  transcripts.

### 5. Verified drift and broken tooling (at `580d3d96`)

1. **`pnpm lint` fails in the main checkout.** Biome reports a nested root configuration
   for each `.claude/worktrees/*/biome.json`. `.claude/` is ignored only via the local
   `.git/info/exclude`, which Biome doesn't read; `.agent/` is in `.gitignore`.
2. **The shared git hooks point at a deleted worktree.** The installed `pre-commit` hook
   hard-codes `.agent/worktrees/claude-code-q1/node_modules/…/lefthook.exe`. Hooks are
   shared by all worktrees, so any `hooks:install` rewrites them for everyone. In a
   worktree without `node_modules`, hooks print "Can't find lefthook" and exit 0, so
   they silently don't run.
3. **`just ci` and `just lint` disagree with CI.** `justfile:48-51,72-74` mark clippy,
   fmt and Biome as advisory (`-`), but CI requires all three. `just ci` also skips the
   hakari check, the bindings-freshness diff, the design-system checks and the
   `node --test` suites.
4. **`tauri-command-registration.md` is stale** (see [§2](#2-the-ipc-command-chain)).
5. **Real data is the documented default.** `AGENTS.md`, the automation skill,
   `app-automation.md`, `testing.md` and `README.md` lead with bare `pnpm app:start`,
   which runs on the maintainer's real sessions. Only `protocol.md` says to use a named,
   isolated instance.
6. **Contradictory build advice.** [local-builds.md](../local-builds.md) says never to
   share `CARGO_TARGET_DIR`, while [orchestrate.md](../agents/tasks/orchestrate.md)
   allows pointing workers at the main checkout's `target/`.
7. **`lefthook.yml` understates the file-size check.** It claims under 300 ms; the check
   measured 6.6–12.8 s on a loaded machine, and it runs on every commit and push.
8. **No Claude Code project setup.** There's no `CLAUDE.md` and no tracked
   `.claude/settings.json` or skills. The only skill lives in `.github/skills/`, which
   Claude Code doesn't scan. The [agent README](../agents/README.md) mentions
   `.claude/commands/<card>.md` launchers that don't exist.
9. **No toolchain pin.** There's no `rust-toolchain.toml`. CI uses floating `stable`, and
   new clippy lints have failed agent branches.
10. **Stale paths in docs.** About 100 backticked paths no longer exist, 62 of them in
    five historical docs. About 61% of `docs/` by line count is historical, plan,
    research or report material that sits next to the current guides.
    [git-worktree-guide.md](../features/worktree-manager.md) (now moved there) documents the product's Worktree
    Manager, so agents searching for contributor worktree setup land in the wrong place.
11. **Mixed PowerShell versions.** `package.json` invokes `powershell` (5.1) while the
    justfile requires `pwsh` (7).

## Recommendations

Effort is S (under an hour), M (half a day) or L (multi-day). Items marked **[settings]**
need a repository or local configuration change the maintainer should make or approve,
not a code PR.

### Tier 1: quick wins

| # | Change | Fixes | Effort |
| --- | --- | --- | --- |
| 1 | Add `.claude/worktrees/` (and other local `.claude/` state) to `.gitignore` | `pnpm lint` failing in the main checkout | S |
| 2 | Changelog lines go in the PR body for every card, not just orchestrate. Optionally use per-PR fragment files assembled at release. | The biggest single conflict source (20% of PRs) | S |
| 3 | Run `cancel-in-progress` only for `pull_request` events | 25% of main runs cancelled; breaks that can't be traced to a commit | S |
| 4 | Move `pnpm audit` / `cargo audit` out of the PR gate (schedule + main pushes, or only when lockfiles change) | 22% of red jobs | S |
| 5 | ~~Make `required` a required status check or use a merge queue~~ **Declined:** the maintainer often merges before checks finish, and gating adds too much overhead. Items 3, 4, 6 and 29 reduce how often main goes red instead. | 17 red merges; main red 13% of the time | — |
| 6 | Give Dependabot grouping (Tauri npm + crates together), ignore majors, monthly schedule | 32% of red jobs; 0/25 Dependabot PRs merged | S |
| 7 | Add `rust-toolchain.toml` pinning the CI toolchain | clippy drift between local and CI | S |
| 8 | Fix `just ci` / `just lint`: drop the advisory `-` prefixes and add the missing CI steps, or label it as a subset | A local "CI" that passes what CI rejects | S |
| 9 | Rewrite `tauri-command-registration.md` from the `ipc_command_names.rs` comment, and add "on generated-file conflicts, re-run `pnpm gen:bindings`" | Agents following stale steps | S |
| 10 | Fix the latent `analyticsPrefetch` teardown race | A known flaky source on unrelated PRs | S |
| 11 | Post the pricing report only when pricing files change, and update one sticky bot comment instead of posting new ones | 67 irrelevant comments | S |

### Tier 2: agent workflow

| # | Change | Fixes | Effort |
| --- | --- | --- | --- |
| 12 | Add a short **"Working here as an agent"** section to `AGENTS.md`, with a matching `CLAUDE.md` that imports `@AGENTS.md`. It should cover the validation table, the default ending (commit, push, open PR, report the link, stop), the waiting rule, how to edit files, Windows shell rules, and a one-line build-setup pointer. | Reloading `protocol.md` in about 225 sessions; 85 "push it" and about 95 "continue" messages | S |
| 13 | Make agents isolated by default: `app.ps1` refuses the real-data default when an agent environment variable (`CLAUDECODE`, `CODEX_*`) is set, unless `-RealData` is passed. Docs lead with `-Instance <slug> -Fixtures`. A `-RealData` switch opens a read-only snapshot for when the maintainer asks for real sessions. | Agents accidentally running on real data, and the opposite (refusing real-data checks when asked) | M |
| 14 | `pnpm check:changed`: classify changed files (reuse `scripts/ci/classify-changes.mjs`) and run only the matching rows of the protocol table, one PASS/FAIL line each | Hand-chained checks; 17 h of vitest and 9 h of lint re-runs; `just ci` run locally | M |
| 15 | Slim pre-push: run typecheck and fmt only for packages and crates that changed, and on pre-commit check only staged files' sizes | 4.7 h of `git push` time | S–M |
| 16 | One waiting recipe: `gh pr checks <n> --watch --fail-fast` (or a background run plus a Monitor) and "never sleep-then-check". Workers finish once the PR is open; the orchestrator watches CI. | About 615 polls; 5+ h of sleeping | S |
| 17 | Playwright wrappers: `scripts/automation/pw.sh` / `pw.ps1` that run JS from a file, plus a troubleshooting table in the skill (attach first, `resize` syntax, strict-mode locators) | The 10× PowerShell failure rate | S–M |
| 18 | Worktree lifecycle scripts: `worktree:new <slug>` (one location, install, offline error hint, instance name) and `worktree:clean` (stop the instance, remove folders git no longer tracks and their `target/`) | Bootstrap failures, 15 orphaned folders, disk use | M |
| 19 | A hook shim that is safe across worktrees: resolve lefthook from the current worktree, and warn loudly instead of passing silently when it's missing | Hooks silently not running | S |
| 20 | **[settings]** A tracked `.claude/settings.json` with an allowlist for safe high-volume commands (pnpm test/typecheck/lint, cargo test/clippy/fmt, `node scripts/check-*`, read-only git/gh, playwright-cli), the skill mirrored to `.claude/skills/`, and the card launchers. A matching rules file for local Codex config. | Codex's 3,254 reviews (99.9% approved); Claude Code permission prompts | S–M |
| 21 | Make the `check-*.mjs` scripts fall back to a filesystem walk when `git ls-files` can't be spawned. `check-doc-links` already does this. | `spawn EPERM` breaking checks in 54 Codex sessions | S |

### Tier 3: structural changes to reduce conflicts

| # | Change | Fixes | Effort |
| --- | --- | --- | --- |
| 22 | Generate the IPC chain from `ipc_command_names.rs`: emit `IPC_COMMANDS` from `gen-bindings` and assert that `generate_handler![]`, `specta_exports` and the capabilities list match it. Mark the generated folders `linguist-generated`. | 6–9 hand edits per command; capability drift | M |
| 23 | Replace the hand-maintained barrels (`packages/types`, `packages/ui`) with `export *` per module or a generated barrel | 15% and 7% commit share, one-line conflicts | M |
| 24 | Make session detail a registry: each section or tab registers itself, so features add files instead of editing `SessionDetailPanel.vue` and `OverviewTab.vue` | 12% hub churn and overlap pairs | M–L |
| 25 | Split `mockData.ts` by feature, matching the client modules | 12% churn | M |
| 26 | Generate `scripts/README.md` entries from script headers, or have a check enforce them, so new scripts don't edit a shared table | 13% churn | M |
| 27 | Collision-safe migrations: a CI check for duplicate `version` numbers, or timestamped versions | Silent parallel migration clashes | S–M |
| 28 | Never use shared docs as live status trackers. Put work-package status in the PR or in per-package files, and update the canonical doc once at the end. | `mapping.md` / `claude-code-sessions.md` overlap | S (process) |
| 29 | Shorten the CI critical path: split a `rust` change group out of `desktop` so Vue-only PRs skip the Rust matrix, and give the installer E2E one automatic retry, limited to startup/CDP timeouts | 8.5 min critical path; startup-timeout flakes | M |
| 30 | Move historical docs to `docs/archive/`. Add a Providers section to `architecture/overview.md`. Rename the worktree guide to say it covers the product feature. Extend `check-doc-links` to check backticked paths in current docs. | Agents reading stale guidance | M |
| 31 | Reduce fix-after-feature: smaller vertical slices, and run `qa-pass` before merging large redesigns, not after | 38% of features followed within 3 days by a fix | Process |

### Suggested order

1. **CI signal, items 1–11.** Most of them are one-line config or doc changes, and
   together they remove most CI that turns red for reasons unrelated to the PR.
2. **Agent workflow, items 12–21.** These address the maintainer's most-repeated
   instructions and most of the waiting time.
3. **Conflict surface, items 22–28,** in order of churn share: the IPC chain, the
   barrels, the session-detail registry, then mocks.
4. **Items 29–31** as capacity allows.

Re-measure the same signals about a month after Tier 1–2 land: red-job causes,
same-day file overlap, fix-within-3-days rate, and CI polls per session.

## Implementation status

Everything except item 5 landed together in October 2026. Where to find each piece:

| Items | What changed | Where |
| --- | --- | --- |
| 1, 12, 16, 20, 28, 31 | Local `.claude/` state ignored. Short agent rules in `AGENTS.md`, with `CLAUDE.md` importing it. The protocol now covers fragments, the default ending, one waiting recipe, sandbox notes, small slices and QA before large redesigns. A tracked `.claude/settings.json` allowlist, card launchers and a skill pointer. | [AGENTS.md](../../AGENTS.md), [protocol](../agents/protocol.md), [agent README](../agents/README.md) (includes a Codex rules snippet to copy locally) |
| 2 | Changelog fragments in `changelog.d/`, merged at release by `pnpm changelog:collect` | [changelog.d](../../changelog.d/README.md), [releasing](../releasing.md) |
| 3, 4, 7, 11, 29 | Main CI runs are no longer cancelled. Audits run on PRs only when manifests change, plus on main and daily. Toolchain pinned in `rust-toolchain.toml`. Pricing report runs only for pricing changes. New `rust` change group. One E2E retry, limited to startup/CDP timeouts. | [testing](../testing.md) CI sections, `.github/workflows/` |
| 6 | Dependabot runs monthly, ignores majors, and groups minor/patch updates and Tauri packages within each ecosystem | `.github/dependabot.yml` |
| 8, 15, 19, 21 | Hook shims that work in every worktree (`pnpm hooks:install` sets `core.hooksPath`) and warn when skipped. Pre-commit checks only staged files; pre-push checks only what the branch changed. `just ci` mirrors CI. Check scripts fall back to a filesystem walk when they can't spawn Git. | [contributing](../../CONTRIBUTING.md), [local builds](../local-builds.md), `scripts/git-hooks/`, `scripts/lib/` |
| 9, 22, 27 | One `with_ipc_commands!` list drives the handler, the manifest and the generated TS `IPC_COMMANDS`. Tests cover specta exports and capabilities. Generated files are marked `linguist-generated`. The migration-uniqueness test already existed; the plan now explains renumbering. | [command registration](../tauri-command-registration.md) |
| 10, 23, 25 | `analyticsPrefetch` teardown guard. Star-export barrels and UI sub-barrels. Mock routes split per client module. | `packages/types`, `packages/ui`, `packages/client/src/mock/routes/` |
| 13, 17 | Agents must start a named instance (`-Fixtures` or `-RealData`). `pnpm pw` wraps the Playwright CLI. `app:stop` also ends stray desktop processes. | [automation skill](../../.github/skills/tracepilot-app-automation/SKILL.md), [app automation](../app-automation.md) |
| 14, 18 | `pnpm check:changed`, `pnpm worktree:new`, `pnpm worktree:clean` | [script index](../../scripts/README.md) |
| 24 | Session tabs, their routes and Overview sections render from registries; the panel's header and actions are separate components | `apps/desktop/src/config/sessionTabs.ts`, `apps/desktop/src/views/tabs/overview/` |
| 26 | Per-group script READMEs, checked by `check-scripts-index.mjs` | [script index](../../scripts/README.md) |
| 30 | 31 historical docs moved to `docs/archive/`. The architecture overview has a Providers section. The worktree guide is renamed. `check-doc-links` now checks backticked repository paths. | [archive](../archive/README.md), [overview](../architecture/overview.md) |

The shared `.git/hooks` still point at a deleted worktree until someone runs
`pnpm hooks:install` once in any checkout.
