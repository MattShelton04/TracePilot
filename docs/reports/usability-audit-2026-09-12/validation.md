# Validation and commit checkpoint

This is a 12 September 2026 validation snapshot for the ongoing desktop audit. The validation owner recorded the results below in the ignored local validation summary; this report intentionally excludes raw logs, private session content, credentials and machine-specific paths. The source audit continued after the full-suite run, including later palette, Skills, JSON and Settings work. These results do not claim that later edits or the complete live-app inventory are verified.

## Completed validation

| Check | Recorded result | Scope |
| --- | --- | --- |
| `pnpm typecheck` | Passed all five packages with typecheck scripts | Snapshot before later audit edits |
| `pnpm test` completed retry | 365 files / 3,306 tests passed | Desktop 258 files / 2,090 tests; UI 90 / 1,044; Types 6 / 115; Client 4 / 13; CLI 7 / 44 |
| `pnpm build` | Passed; Vite production build 25.37 seconds | Frontend production build; does not replace native workflow verification |
| `cargo test --workspace --exclude tracepilot-desktop` | 1,431 passed, 0 failed, 5 ignored across 24 groups, including 11 passing doctests | Desktop crate excluded; the native running app is tested separately |
| `cargo clippy --workspace --exclude tracepilot-desktop --all-targets -- -D warnings` | Passed | Same desktop-crate exclusion |
| `cargo fmt --all -- --check` | Passed | Rust formatting |
| `pnpm test:automation` | 6 passed, 0 failed, 0 skipped | Isolated automation fixtures; no claim of full product/native journey coverage |
| Visual report and extractor policy tests | 4 Node / 2 Python tests passed | Gallery generation and bounded artifact handling |
| Workflow action pins with remote commit verification | 35 references passed | Action pin policy |
| Changed-file Biome | 96 files passed, no errors/warnings; one informational suggestion | Relevant changed files; full repository advisory output is separately limited below |
| Version, file-size and documentation gates | Versions agree at 0.8.1; file sizes passed with zero allow-listed violations; tracked links 100 files and then-current audit links 5 files passed | Document edits after that snapshot need their own link/structure checks |
| Repository policy gates | ADR 14 passed; catalog drift and CSP passed; design emoji/backdrop checks passed for 240/273 files | Existing dependency/hoist advisories noted below |
| Later JSON layout regression | 3 real-Chromium geometry tests reproduced narrow keys before and passed after the shared fix | UX-031; native Explorer JSON D/M/L after images inspected, M key below viewport. Original CLI snapshot after remains pending |
| Later Settings numeric validation | Assigned owner reports 56 focused Settings/preference tests passed | UX-032/033; native invalid-width recovery, invalid Add prevention, valid 1.25 persistence, invalid existing draft/Escape and default reset checked in isolated profile; inspected after images. Remaining fields/bounds are separate |
| Later search feedback and maintenance locking | UX-034's three result cases failed before; original 4 tests passed after. Expanded DataStorage suite reports 18 passing tests, including real confirmation focus regressions | UX-034/036; native M rebuild result, both Rebuild controls disabled during path save, subsequent analytics count 74 and Reset Cancel/Escape focus return verified. Snapshot deletion untested at zero snapshots |
| Later setup navigation guards | 18 wizard/navigation tests, desktop typecheck and file-size policy passed | UX-035; native M invalid home blocks Continue/dots/heading ArrowRight; Skip saves valid startup home. Forced save failures/async races and missing default home retain component-only coverage |
| Later skill asset keyboard controls | 6 focused tests passed, including composition-event suppression | UX-037; native M named Open/Enter loads actual text, preview Escape restores Open, focused Remove visible. Physical IME and remaining New File cancellation cases untested |
| Later add-only native viewer fixture generation | 3 Node tests passed; Biome and syntax checks passed | Eight assets created, repeat created none and preserved eight; SHA256 of original manifest and rich-session files unchanged. Selected native Explorer D JSONL/CSV/invalid JSON/PNG/binary workflows now checked separately; generator tests alone do not prove viewer behavior |
| Native dialog gateway helper | Assigned owner reports 14 Node tests passed | Picker-result substitution only; native synthetic export/load now passes Rust original-archive validation/preview after UX-041 correction, then canceled unchanged. No successful import round trip or actual OS dialog is claimed |
| Later Analytics metric layout | 32 focused tests and 3 Chromium component layout tests passed | UX-039; native D/M/L geometry/content checked with no overflow; D/M/L after images inspected |
| Later Code Impact count labels | 13 targeted tests passed, including 2 new failing-before regressions; desktop typecheck, Biome and diff checks passed | UX-040; native D/M/L truthful units and no overflow; D/M/L after images inspected |
| Later full typecheck | All 5 package typechecks passed | Latest root run before date/Replay changes; does not cover subsequent edits |
| Replay keyboard | 52 tests passed, including 13 new cases; 9 failed before | UX-043 native after single-step/boundary/speed/Play/Pause checks pass; D/M/L no overflow. M/L after inspected; D rapid-seek scroll transition requires settled recapture. Deeper Replay user-deferred |
| Later date-order validation | 12 component tests and 45 combined filter/analytics/page tests passed; desktop typecheck, Biome, diff check and independent review passed | UX-042 nine of eleven cases failed before. Paired drafts preserve last valid store/filter and block invalid fetches. Native M inline validation/correction and dates/repository persistence Analytics→Tools pass; matching after inspected. Physical segmented badInput untested; informational render-budget warning under concurrent typecheck |
| Later New Skill recovery/names | Three focused component tests and independent review passed | UX-044 native M inline duplicate alert after inspected; corrected name/description persist in 100-byte SKILL.md and editor fields. Other create variants and D/L remain separate |
| Tool Analysis populated checkpoint | Actual native All Time at D/M/L: 286 calls, 5 tools, 99.7% success, 1.1s average; `view` tool 281 calls/1 failure | No document overflow at all three sizes. D image inspected; M/L image inspection and tool controls/filter states pending |
| Later Import integrity | Native own-export hash failure reproduced at D; root inspected before image | 165 export Rust tests, Clippy and independent review pass. Same original 49,823B archive validates with Rust preview natively at D; after inspected and Import canceled unchanged. Deeper Import/custom-table reconstruction deferred |
| Later visual CI head-failure policy | 5 policy tests passed; publisher queue maximum added | Commit e1b2f2f4; first hosted Linux/Pages/comment execution remains separate from local tests |
| Analytics/Code commit checkpoint | 11 focused analytics, Code and sanitized export-picker tests passed | Commit 268b8fed; complements earlier32/13/3 layout counts, not a replacement full-suite run |
| Asset overwrite prevention follow-up | Initial Rust regressions reproduce former data loss; first exclusive-create revision passes native duplicate/error/disk-preservation check | UX-038; revised sibling staging/publish passes 26 Windows Rust tests, package Clippy with warnings denied, formatting and diff checks. Reader/writer failure, retry, collision cleanup and read-only permission preservation covered; Unix executable/symlink tests not executed on Windows. Final native D staging-backend duplicate/preservation/Open/Escape pass; D image inspected, M image awaiting inspection |

The initial `pnpm test` attempt ran concurrently with typecheck and failed the unchanged syntax-highlighting Rust ReDoS timing smoke test: 231.216ms against a 200ms threshold. A complete retry without concurrent typecheck passed all packages. No threshold or implementation change was made to obtain that retry result. The 3,306 count belongs to that completed run, not an estimate of the later test inventory.

Targeted checks and native before/after results are attached to individual [findings](findings.md) and [surface rows](surface-coverage.md). Passing component mocks or browser geometry tests does not establish Rust IPC, persisted behavior or OS-dialog completion. The visual CI report also retains its first hosted Linux/Pages/comment-run limitations in [visual-regression.md](../../visual-regression.md).

## Baseline and tool limitations

- The public API baseline check fails because the existing `pub mod context_capture` on the default branch is absent from the stored baseline; the audit did not change that declaration relative to the default branch.
- Full repository design checks report two existing hexadecimal fallbacks in `skills-manager.css` and an existing literal z-index in `FileContextMenu.vue`, both unchanged against the default branch. Spacing-grid remains advisory with 648 reported values.
- Full-repository advisory Biome includes pre-existing generated artifacts with invalid JSON and reports errors/warnings. The relevant changed-file gate passes independently; it is not described as a clean full-repository lint result.
- The production dependency audit reports two existing vulnerabilities, one high in `nanoid <3.3.18` and one moderate. No lockfile changes were made by the audit at this checkpoint. `cargo-audit` is unavailable locally, so the hosted Rust security audit remains unverified here.
- Catalog drift passes with existing Vue peer-dependency and lucide hoist advisories. Five ignored Rust tests comprise the subagent-heavy reconstruction performance test and four documentation examples; they are not counted as executed passes.
- Validation-only cleanup removed redundant comments to satisfy file-size checks and formatted affected files. It did not change product behavior.
- Automatic approval review initially rejected bulk optional-feature enabling because effects on an existing profile were uncertain. The live owner verified the complete audit-owner manifest and all configured paths in the isolated audit home, then an exact live-home guard and scoped justification were approved. Optional features were enabled only there; no SDK connection or provider request was made. OS notifications/taskbar flash were disabled before the in-app alert test. This resolved tooling limitation is not a product defect.
- Check Now was clicked, but its result was not resnapshotted before a Rust watcher restart. No update-check result is claimed. Native picker substitution tests do not establish an OS dialog or successful round trip; the later native export/load attempt now passes original-archive validation/preview after UX-041 correction, canceled unchanged.

## Coherent implementation commits

These commits were observed on the dedicated audit branch. They group completed changes by user-visible outcome; a commit does not imply all surrounding feature states have native coverage.

| Commit | Outcome |
| --- | --- |
| [c1412e8e](https://github.com/MattShelton04/TracePilot/commit/c1412e8e31163e8c07454633f9d0d2c174083e8c) | Keep setup and session controls usable by keyboard |
| [0ed0b2f9](https://github.com/MattShelton04/TracePilot/commit/0ed0b2f989ab3ff48456c9cd1bae18a3a36998dd) | Preserve dialog focus and unsaved skill edits |
| [6dfcb79f](https://github.com/MattShelton04/TracePilot/commit/6dfcb79f4ee0bbec251b0a55b147e043bcd4267b) | Compare populated desktop frontend views across pull requests |
| [a2570bf9](https://github.com/MattShelton04/TracePilot/commit/a2570bf966f6651bb66d4ef20a8f8d9c3f4fbbac) | Keep tabs, Explorer panes and Todo details reachable |
| [10ca2d62](https://github.com/MattShelton04/TracePilot/commit/10ca2d6228c917f2cd640e38327851572fdb9e3f) | Clarify comparisons and keep export previews current |
| [45f1a3ff](https://github.com/MattShelton04/TracePilot/commit/45f1a3ffd4bd8d00606da4b5899ef9f59423b30f) | Align palette destinations and restore keyboard controls |
| [ae5aa01a](https://github.com/MattShelton04/TracePilot/commit/ae5aa01a61d3545b5bde292809f88caed8fd632e) | Make desktop forms and worktree rows readable |
| [278d7ea7](https://github.com/MattShelton04/TracePilot/commit/278d7ea7d8237c44b162ba8b9e568e6ee4c2540a) | Validate Settings drafts, guard setup navigation and serialize data maintenance |
| [e1b2f2f4](https://github.com/MattShelton04/TracePilot/commit/e1b2f2f4bcb251c28cb3f0bd66e1686859f2a3e9) | Make visual CI failures explicit and prepare isolated native viewer fixtures |
| [268b8fed](https://github.com/MattShelton04/TracePilot/commit/268b8fed389e62e3d780bbe5afaf6ad7560a87a7) | Keep analytics metrics readable and clarify file count units |

Latest bounded commits: [2200ee2c](https://github.com/MattShelton04/TracePilot/commit/2200ee2c) final Skills controls/recovery (25 focused tests); [d4d78a2e](https://github.com/MattShelton04/TracePilot/commit/d4d78a2e) original export integrity (165 tests); [2f49b7ba](https://github.com/MattShelton04/TracePilot/commit/2f49b7ba) paired date drafts (45 tests); [b40e4c20](https://github.com/MattShelton04/TracePilot/commit/b40e4c20) Replay keyboard ownership (52 tests). Independent Code/date review additionally reports 31 focused tests passed. These overlapping targeted groups are not summed into a full-suite count.

Later changes, final review, remaining native reconciliation, evidence privacy review, push and pull request remain part of the ongoing audit. Deeper MCP, Worktrees, Launcher, Import, Compare and Replay workflows remain deferred at the user's direction; no exhaustive audit claim is made.

## Publication checkpoint

Nine unpublished audit commits were checked after sanitizing a private test title: no rewritten patch or current target test contains the removed token, only the intended test file differs in affected rewritten trees, and the real index remained empty during this review. Report commit links use the verified rewrite journal mapping. Six root-inspected fixture-only toolbar/Analytics/Code before/after copies are approved public evidence; private captures and raw logs remain ignored. This does not approve unrelated artifacts or claim the audit complete.
