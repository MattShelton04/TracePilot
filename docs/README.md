# TracePilot Documentation

> Navigation for TracePilot's current guides and code-coupled references.

Use the current guides for commands and behavior. Delivered plans, superseded
research and one-off reports live in the [archive](archive/README.md); they may
be stale, so check the current code before following them.

## Start here

| Document | Description |
|----------|-------------|
| [Testing Guide](testing.md) | Canonical testing layers, commands, VRT/E2E scope, and caveats. |
| [Local Builds](local-builds.md) | Build-time and disk settings, worktree setup, sccache, and `target/` housekeeping for parallel agents. |
| [Script and Command Index](../scripts/README.md) | Supported commands, diagnostics, CI helpers, prerequisites, and side effects. |
| [Running-App Automation](app-automation.md) | Playwright agent CLI for the real Tauri app and frontend-only UI server. |
| [Releasing](releasing.md) | Release PR checklist: version bump, changelog and in-app notes, validation, tagging. |
| [Agent Task Playbook](agents/README.md) | Task cards and the shared protocol for autonomous coding agents, including hands-off orchestration. |
| [Visual Regression](visual-regression.md) | Synthetic frontend comparisons, CI publisher, and interpretation limits. |
| [Architecture Overview](architecture/overview.md) | Crate/package structure, data flow, and major boundaries. |
| [ADRs](adr/README.md) | Accepted architecture decisions and decision-writing conventions. |
| [Tauri Command Registration](tauri-command-registration.md) | How Tauri IPC commands are registered and called. |
| [On-Disk Paths](on-disk-paths.md) | Filesystem locations used by TracePilot. |
| [Performance Playbook](performance-playbook.md) | Current performance investigation and profiling guidance. |
| [Dependencies](dependencies/README.md) | Complete dependency graph, usage inventory, update decisions, security findings, and measured costs. |
| [Exact Context Capture Guide](exact-context-capture.md) | Enable, run, inspect, store, and delete isolated model-request snapshots. |
| [Claude Code Sessions](claude-code-sessions.md) | Experimental: enable Claude Code sessions, what is supported, costs, live state, diagnostics, and troubleshooting. |
| [Agent Communication](features/agent-communication.md) | Timeline Messages modes, communication evidence, live refresh, and Agents usage counters. |

## Architecture and design references

| Document | Description |
|----------|-------------|
| [Session Index Database](database/README.md) | `index.db` design rationale, storage profile, known issues, and the [table/column reference](database/schema.md). |
| [Incremental Analytics](architecture/incremental-analytics.md) | Analytics pipeline and incremental computation strategy. |
| [Design System](../design-system/MASTER.md) | Design rules, tokens, components and surface notes for the desktop app. |
| [Adding Tool Renderers](design/adding-tool-renderers.md) | Guide for adding new tool-specific renderers. |
| [Loading Screen Design History](loading-screen-design.md) | Orbital concept selection, current implementation, and open design review item. |
| [Logo](design/logo.md) | Logo and branding assets. |
| [Common Frontend Components](common-frontend-components.md) | Shared Vue component catalogue. |

## Guides and references

| Document | Description |
|----------|-------------|
| [Worktree Manager](features/worktree-manager.md) | The app's Worktree Manager feature. Contributor worktrees: [local builds](local-builds.md). |
| [Copilot SDK Usage](copilot-sdk-usage.md) | SDK bridge setup, steering and live attach. |
| [Pricing Model](pricing-model.md) | Copilot rates, historical estimates, deterministic update workflow, and validation. |
| [Specta Migration](specta-migration-guide.md) | Specta / tauri-specta migration guide. |
| [Syntax Highlighting](syntax-highlighting.md) | Current syntax-highlighting behavior and tradeoffs. |
| [Bespoke Syntax Highlighting Analysis](syntax-highlighting-bespoke-analysis.md) | Analysis behind bespoke syntax-highlighting choices. |

## Proposals, research, and evidence

| Document | Description |
|----------|-------------|
| [Copilot Live Attach Plan](features/copilot-live-attach-plan.md) | Official Rust SDK migration, verified attach findings, and the phased live-session roadmap. |
| [Custom Analytics Dashboards](features/custom-dashboards.md) | Proposed user-arranged dashboard layouts. |
| [Prompt-Cache Insights](features/prompt-cache-insights-plan.md) | Proposed cache-expiry and resume analysis. |
| [Session Replay Communication](features/session-replay-design.md) | Design and implementation guide for adding exchange playback to Session Replay. |
| [Claude Code Integration Plan](research/claude-code-integration/README.md) | Deeper Claude Code study: data comparison, mapping tables, multi-source provider architecture, analytics mixing, and a leveled task plan. |
| [Performance Evidence](reports/performance-mission.md) | Native measurements, methods, and limitations; retain alongside its JSON evidence. |
| [Development Friction (October 2026)](reports/development-friction-2026-10.md) | Churn hotspots, CI failure causes, agent-session friction, and prioritized improvements for parallel development. |
| [Usability Audit](reports/usability-audit-2026-09-12/findings.md) | Dated findings with linked coverage, validation, and screenshots. |
| [Version Reports](reports/versions/README.md) | Dated Copilot CLI schema/corpus reports and generation guidance. |
| [Archive](archive/README.md) | Delivered plans, superseded research and one-off reports; may be stale. |

## Other assets

| Path | Contents |
|------|----------|
| [images/](images/) | Screenshots and image assets referenced by docs. |
| [presentation/](presentation/) | Presentation/demo assets. |
