# TracePilot Orchestration — UI Pages & Prototypes Plan

> Based on findings from `docs/copilot-cli-integration-report.md` (Parts 1–6).
> Each page listed here will get multiple HTML prototype variants using the Variant C design system.

---

## Page Inventory

### 1. 🚀 Session Launcher

**Purpose**: Launch new Copilot CLI sessions with pre-configured settings directly from TracePilot.

**Key Data Displayed**:
- Repository selector (from trusted_folders in config.json)
- Branch picker (git branch list for selected repo)
- Model selector (all 19 available models from SDK)
- Reasoning effort toggle (low / medium / high)
- Template presets dropdown
- Initial prompt text area
- Advanced options: auto-approve, create worktree, headless mode, env vars, custom instructions path

**Operations**:
- `copilot.exe -p "{prompt}" --model {model}` CLI spawn
- `git worktree add` if worktree option selected
- `git branch -a` for branch listing
- Template load/save (local JSON)
- "Dry run" preview (shows exact command that would execute)

**UI Components**: Form layout, model cards with tier badges, prompt textarea with history, toggle switches, command preview panel, "Launch" + "Launch Headless" action buttons.

**Prototype variants**: 3 (wizard-style, single-page form, split-panel with live preview)

---

### 2. 📊 Mission Control Dashboard

**Purpose**: Real-time overview of ALL active Copilot CLI sessions across repositories. The "fleet management" command center.

**Key Data Displayed**:
- Active session count with status breakdown (working / idle / error / waiting for input)
- Per-session cards: repo, branch, model, status indicator, token counter, current turn, elapsed time
- Aggregate stats: total tokens, total premium requests, active worktrees
- Status timeline sparklines per session
- Session health indicators (stuck detection, error rate)

**Operations**:
- Poll `inuse.*.lock` files for active session discovery
- Tail `events.jsonl` for latest activity per session
- Read `workspace.yaml` for repo/branch metadata
- Open session in terminal (existing `resume_session_in_terminal`)
- Navigate to existing session detail views
- Kill/terminate session process

**UI Components**: Status cards grid, mini sparkline charts, status badges with pulse animation, aggregate stat counters, auto-refresh indicator, session action dropdown.

**Prototype variants**: 3 (card grid, table/list view, kanban-by-status columns)

---

### 3. 🔧 Configuration Injector

**Purpose**: GUI for modifying Copilot CLI configuration files — agent YAML definitions, config.json, and environment settings.

**Key Data Displayed**:
- Agent definitions (5 agents): name, current model, tools list, prompt excerpt
- config.json values: model, reasoning_effort, trusted_folders, banner
- Environment variable overrides
- Change diff preview (before → after)
- Backup history with restore points

**Operations**:
- Read/parse agent YAML files from `pkg/universal/1.0.8/definitions/`
- Read/write `~/.copilot/config.json`
- YAML serialization with structure validation
- Backup creation (timestamped `.bak` files)
- Diff generation for preview
- Auto-update disable warning

**Sub-views**:
- **Agent Editor**: Card per agent, click to expand inline editor with model dropdown, prompt editor, tools checklist
- **Global Config**: Form for config.json fields
- **Environment**: Key-value editor for env var overrides
- **Backup Manager**: List of backups with restore/delete

**Prototype variants**: 3 (tabbed panels, accordion/expandable cards, sidebar-detail split)

---

### 4. 🌳 Git Worktree Manager

**Purpose**: Create, manage, and clean up git worktrees for parallel Copilot sessions.

**Key Data Displayed**:
- Active worktrees: path, branch, linked session (if any), disk usage, created date
- Repository overview: main repo path, total worktrees, total disk used
- Session↔worktree associations
- Cleanup recommendations (stale worktrees, completed sessions)

**Operations**:
- `git worktree list` — enumerate existing worktrees
- `git worktree add <path> -b <branch>` — create new worktree
- `git worktree remove <path>` — clean up
- `git worktree prune` — remove stale entries
- Disk usage calculation per worktree
- Auto-cleanup policy settings (remove after N days, on session complete)

**UI Components**: Worktree list/grid, disk usage bar chart, create worktree dialog, cleanup wizard, repository selector.

**Prototype variants**: 3 (file-manager style, timeline/gantt view, dashboard cards)

---

### 5. 📋 Session Templates

**Purpose**: Create, save, manage, and share reusable session configuration presets.

**Key Data Displayed**:
- Template cards: name, description, model, reasoning effort, tools config, tags
- Template categories (Bug Fix, Feature Build, Code Review, Refactor, Testing, Documentation, Custom)
- Usage statistics per template (times used, avg session success rate)
- Shareable template format (JSON export/import)

**Operations**:
- CRUD operations on template JSON files (stored in `~/.copilot/tracepilot/templates/`)
- Duplicate template
- Import/export templates (JSON)
- Apply template to launcher (fills in Session Launcher form)
- Quick-launch from template (skip launcher form)

**UI Components**: Template card grid, category filter tabs, template editor modal/drawer, JSON preview, import/export buttons.

**Prototype variants**: 2 (card gallery, list table with inline preview)

---

### 6. 🧩 Extension Manager

**Purpose**: Browse, create, install, enable/disable, and manage Copilot CLI extensions (.mjs files).

**Key Data Displayed**:
- Installed extensions: name, file path, hooks used, enabled status, description
- Extension template library (pre-built common patterns)
- Hook coverage matrix (which hooks each extension uses)
- Validation status (syntax OK, import check, dry-run result)

**Operations**:
- List extensions from `.github/extensions/` directories
- Create extension from template (auto-lint, context injection, tool blocking, etc.)
- Enable/disable by renaming file
- Validate: syntax check, import verification, dry-run
- Edit extension code (basic code editor or link to IDE)
- Deploy to project-level or user-level location

**UI Components**: Extension card grid, template picker dialog, validation status indicators, code preview panel, hook coverage table.

**Prototype variants**: 2 (app-store style, developer tools panel)

---

### 7. 💰 Cost & Budget Tracker

**Purpose**: Monitor token usage, premium request consumption, and set budget guardrails.

**Key Data Displayed**:
- Current period usage: premium requests used / remaining (from quota API)
- Per-model cost breakdown (from existing analytics aggregator)
- Per-session cost attribution
- Budget vs actual: progress bars, trend charts
- Historical usage trends (daily/weekly/monthly)
- Cost projections based on current burn rate

**Operations**:
- Read from existing TracePilot analytics index (already has token data)
- Query GitHub quota API (`account.getQuota`)
- Set budget limits (daily/weekly/monthly)
- Budget alert thresholds (warn at 75%, 90%, 100%)
- Per-model budget caps
- Cost-per-session calculation

**UI Components**: Budget progress rings, usage trend line charts, model cost breakdown bar chart, alert configuration, session cost table.

**Prototype variants**: 2 (dashboard with charts, compact sidebar widget)

---

### 8. 🧪 A/B Testing Arena

**Purpose**: Run the same task with different configurations (models, prompts, settings) in parallel worktrees and compare outcomes.

**Key Data Displayed**:
- Test configuration: task prompt, variants (model A vs B vs C), worktree paths
- Live progress comparison (tokens, duration, turns per variant)
- Results comparison: code diff, token efficiency, success/failure, cost
- Winner selection with reasoning
- Test history

**Operations**:
- Create N worktrees for N variants
- Launch N parallel CLI sessions with different configs
- Monitor all sessions via dashboard polling
- Diff outputs between variants
- Calculate efficiency metrics per variant
- Archive test results

**UI Components**: Split comparison panels (2-up or 3-up), progress bars per variant, diff viewer, metric comparison table, winner badge.

**Prototype variants**: 2 (split-screen comparison, tournament bracket)

---

### 9. 📦 Batch Operations

**Purpose**: Execute the same task across multiple repositories/branches simultaneously with queue management.

**Key Data Displayed**:
- Batch job definition: task prompt, target repos/branches, concurrency limit
- Queue status: queued, running, completed, failed
- Per-target progress cards (repo → status → result)
- Aggregate completion percentage
- Error summary with retry options

**Operations**:
- Define target list (repos + branches)
- Configure concurrency limit (default: 2-3)
- Launch batch via CLI spawn per target
- Queue management (pause, resume, cancel, retry failed)
- Aggregate results into summary report

**UI Components**: Target list builder, queue visualization, progress grid, concurrency slider, batch summary panel, error log accordion.

**Prototype variants**: 2 (pipeline/flow visualization, simple list with progress)

---

### 10. 🧠 Session Knowledge Base

**Purpose**: Browse, curate, and manage cross-session knowledge/memories with scoping controls.

**Key Data Displayed**:
- All stored memories across sessions (from `store_memory` events)
- Memory metadata: subject, fact, citations, category, source session, repo scope
- Scope tags: universal vs repo-specific
- Memory search with relevance scoring
- Memory injection candidates for active sessions

**Operations**:
- Aggregate `store_memory` tool calls from indexed sessions
- Tag memories with scope (universal / repo-specific)
- Mark memories as approved/rejected for injection
- Export memory collections
- Search memories by keyword, subject, repo

**UI Components**: Memory card list with tags, scope filter tabs, search bar, bulk tag editor, memory detail drawer, injection controls.

**Prototype variants**: 2 (knowledge graph visualization, searchable list)

---

### 11. 🏠 Orchestration Home / Getting Started

**Purpose**: Landing page that ties all orchestration features together with onboarding guidance and quick actions.

**Key Data Displayed**:
- Quick stats: active sessions, total worktrees, budget usage, recent launches
- Quick action buttons: Launch Session, Open Dashboard, Configure Agents
- Getting started wizard progress (for new users)
- Recent activity feed
- System health: Copilot CLI version, auto-update status, SDK availability

**Operations**:
- Aggregate data from all other orchestration pages
- Feature discovery / onboarding checklist
- Quick-launch shortcuts

**UI Components**: Hero stat cards, quick action grid, activity feed list, onboarding progress stepper, system status badges.

**Prototype variants**: 2 (dashboard with cards, guided wizard)

---

### 12. 🔌 MCP Server Manager

**Purpose**: Add, configure, test, and monitor MCP (Model Context Protocol) servers for enhanced session capabilities.

**Key Data Displayed**:
- Configured MCP servers: name, URL, status (connected/disconnected), capabilities
- Server health indicators (latency, error rate)
- Available tool list per server
- Configuration details (auth, headers, timeout)

**Operations**:
- Add/remove MCP server configurations
- Test connectivity (ping/health check)
- Browse available tools per server
- Enable/disable per-session or globally
- Import server configs from JSON

**UI Components**: Server list with status dots, add server dialog, connectivity test panel, tool browser accordion.

**Prototype variants**: 1 (admin panel style)

---

## Prototype Summary

| # | Page | Prototype Count | Priority |
|---|------|----------------|----------|
| 1 | Session Launcher | 3 | 🔴 Tier 1 |
| 2 | Mission Control Dashboard | 3 | 🔴 Tier 1 |
| 3 | Configuration Injector | 3 | 🔴 Tier 1 |
| 4 | Git Worktree Manager | 3 | 🔴 Tier 1 |
| 5 | Session Templates | 2 | 🟠 Tier 2 |
| 6 | Extension Manager | 2 | 🟠 Tier 2 |
| 7 | Cost & Budget Tracker | 2 | 🟠 Tier 2 |
| 8 | A/B Testing Arena | 2 | 🟡 Tier 3 |
| 9 | Batch Operations | 2 | 🟡 Tier 3 |
| 10 | Session Knowledge Base | 2 | 🟡 Tier 3 |
| 11 | Orchestration Home | 2 | 🟠 Tier 2 |
| 12 | MCP Server Manager | 1 | 🟡 Tier 3 |
| **Total** | **12 pages** | **27 prototypes** | |

---

## Design System Notes

All prototypes will use:
- **Variant C design system** (`shared/design-system-c.css`)
- **Inter font** via Google Fonts
- **Dark-first** with light theme support
- **Shared sidebar** via `shared.js` `generateSidebar()` — will need to add new orchestration nav items
- **Consistent component library**: cards, badges, toggles, dropdowns, tables, modals, tooltips
- **SVG icons** inline (consistent with existing ICONS object)

New shared infrastructure needed:
- Extended sidebar with "Orchestration" section containing new nav items
- Shared mock data for orchestration features (worktrees, templates, active sessions, budgets, extensions)
- New ICONS for: rocket (launcher), git-branch (worktrees), puzzle (extensions), dollar (budget), flask (A/B test), package (batch), brain (knowledge), play-circle (MCP)
