# Agents explorer — handover

Working notes for the `feat/agents-explorer` branch. Delete this file when the PR merges; it
records where the work is, not how the feature behaves ([the design](agents-explorer-design.md)
is the reference for that).

Last updated: 2026-09-20.

## Where the work is

The feature landed in 11 commits (`8e7e615d` … `e3c9bc60`): core extraction, indexer table,
orchestrator discovery/write/override, Tauri commands, the shared definition-editor shell, the
store and derivation utilities, the manager and editor pages, the Analytics card, docs and
visual-regression cases. All of it is behind the `agents` feature flag, on by default.

Validation already done on that base:

- `pnpm typecheck` (7 projects), `cargo test --workspace`, `apps/desktop` vitest (2355 tests),
  `packages/{types,client,ui}` and `apps/cli` vitest.
- `check-file-sizes`, `check-no-emoji-in-templates`, `check-no-backdrop-filter`, `check-doc-links`.
- Real app: 9 built-in agents on CLI 1.0.86, a `/subagents` override round-trip that left
  `settings.json` byte-identical, and a create/save/delete cycle that was cleaned up afterwards.
- Viewports 1440×960, 960×640 and 2560×1440 with no horizontal scroll.

Known pre-existing failures (present on `main`, proved in a temporary worktree — not ours to fix
here): `lint/complexity/useIndexOf` in `packages/ui/src/components/TabNav.vue`, hex colours in
`skills-manager.css`, and a z-index token violation in `FileContextMenu.vue`. `pnpm lint` also
reports gitignored `.tracepilot/` runtime artefacts.

## Round 2 — UX review feedback

Raised after running the branch. UI/UX only, apart from one backend string. Each row says what
changed and where, so an interrupted run can be picked up mid-table.

| # | Item | Where | State |
|---|---|---|---|
| 1 | Dropped the "<agent> ran N times" insight: not actionable, and the cards already say it | `utils/agents/insights.ts` | done |
| 2 | Thinned the repeated "Copilot CLI x.y.z": the version now appears once, in the editor's info bar (`sourceLabel`). The read-only reason no longer repeats it and the top bar shows a "Read-only" badge with the reason as its tooltip | `agents/discovery.rs`, `AgentEditorTopBar.vue`, `AgentsManagerView.vue`, client mock | done |
| 3 | Card metrics are three labelled figures (runs / median / failed) plus a right-aligned trend and "last run", instead of one run-on sentence | `AgentCard.vue` | done |
| 4 | Editor right pane: the shared tab strip fills the 40px header, so its underline lands on the header border instead of floating with a gap below | `styles/features/agent-editor.css` | done |
| 5 | Description sizes to its rows; advanced-section values wrap inside the pane | `styles/features/agent-editor.css` | done |
| 6 | Usage tab: four KPI tiles, one stacked outcome bar, failures, then Models / Timing / Where-it-runs in collapsed sections, then recent runs | `AgentUsageTab.vue`, new `usage/UsageStackedBar.vue` | done |
| 7 | Override dialog: the Disabled row spans the dialog with the switch at the end, behind a divider | `AgentOverrideDialog.vue` | done |
| 8 | "No definition found" is an `EmptyState` that fills the pane and offers the Usage tab | `AgentEditorView.vue` | done |
| 9 | Model pickers use `SearchableSelect` (searchable, themed, custom ids allowed); read-only definitions show the value as text | `AgentModelList.vue`, `AgentOverrideDialog.vue` | done |
| 10 | Analytics: agents-wide presentation aligned with the skills-analytics plan | `AnalyticsAgentsPanel.vue` | in progress |
| 11 | Per-agent colour from `agentMeta` (the Config Injector's map) on the card icon and accent | `AgentCard.vue` | done |

### Still to do

1. Item 10, then re-check every changed test (`AgentCard`, `entries`, `agent-editor`,
   `useAgentEditor`, `usageComponents`, `agents-manager`).
2. `pnpm typecheck`, `pnpm --filter @tracepilot/desktop test`, `pnpm test`, `cargo test -p
   tracepilot-orchestrator`, the guard-rail scripts (`check-file-sizes`, `check-no-hex-colors`,
   `check-no-emoji-in-templates`, `check-spacing-grid`, `check-doc-links`).
3. Run the real app (`pnpm app:start`, attach with the printed Playwright command) and re-check
   every screen this round touched at 1440×960, then 960×640 and 2560×1440.
4. Re-capture the two visual cases (`agents-manager`, `agent-editor`).
5. `/code-review` pass, act on confirmed findings.
6. Push `feat/agents-explorer` and raise the PR.

## Config Injector

`ConfigInjectorAgentsTab.vue` is the only overlap: it lists agents and now links each one into
the Agents editor. The Agents page supersedes it for *reading and editing definitions*; what the
Config Injector still owns is the wider injection workflow (MCP servers, instructions,
env, backups and the advanced built-in writes that the `config_injector` flag gates). Retiring it
would mean re-homing those, so the recommendation is: keep it, treat the Agents page as the
canonical agent surface, and revisit once skills/MCP get the same treatment.
