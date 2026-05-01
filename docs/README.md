# TracePilot Documentation

> Developer documentation index for TracePilot — a desktop app for visualising and analysing GitHub Copilot CLI sessions.

This index lists current user/developer documentation. Stale generated tech-debt reports, historical audit reports, and one-off implementation plans were removed in the 2026-05-01 documentation cleanup; use git history if you need those artefacts.

## Start here

| Document | Description |
|----------|-------------|
| [Testing Guide](testing.md) | Canonical testing layers, commands, VRT/E2E scope, and caveats. |
| [Architecture Overview](architecture/overview.md) | Crate/package structure, data flow, and major boundaries. |
| [ADRs](adr/README.md) | Accepted architecture decisions and decision-writing conventions. |
| [Data Integration](data-integration-guide.md) | How session data flows from disk to the UI. |
| [Tauri Command Registration](tauri-command-registration.md) | How Tauri IPC commands are registered and called. |
| [On-Disk Paths](on-disk-paths.md) | Filesystem locations used by TracePilot. |
| [Performance Playbook](performance-playbook.md) | Current performance investigation and profiling guidance. |

## Architecture and design

| Document | Description |
|----------|-------------|
| [Incremental Analytics](architecture/incremental-analytics.md) | Analytics pipeline and incremental computation strategy. |
| [Design System](design/design-system.md) | Colour tokens, typography, spacing, and component patterns. |
| [Tool-Call Rendering](design/tool-call-rendering.md) | How tool calls/results are visualised in the session viewer. |
| [Adding Tool Renderers](design/adding-tool-renderers.md) | Guide for adding new tool-specific renderers. |
| [Timeline Redesign](design/timeline-redesign.md) | Session timeline component redesign notes. |
| [Loading Screen](loading-screen-design.md) | Loading/skeleton screen design. |
| [Logo](design/logo.md) | Logo and branding assets. |
| [Multi-Window Architecture](multi-window-architecture.md) | Design notes for multi-window behavior. |
| [Session Alerting](session-alerting-notifications.md) | Alerting and notification design notes. |
| [Common Frontend Components](common-frontend-components.md) | Shared Vue component catalogue. |

## Guides and references

| Document | Description |
|----------|-------------|
| [Git Worktree Guide](git-worktree-guide.md) | Working with git worktrees in TracePilot. |
| [Version Analysis](version-analysis-implementation-guide.md) | Implementing Copilot schema version analysis. |
| [Version Report Naming](reports/versions/README.md) | Naming convention for newly generated Copilot version reports. |
| [Versioning & Release](versioning-updates-release-strategy.md) | Versioning strategy and release process. |
| [Specta Migration](specta-migration-guide.md) | Specta / tauri-specta migration guide. |
| [Syntax Highlighting](syntax-highlighting.md) | Current syntax-highlighting behavior and tradeoffs. |
| [Bespoke Syntax Highlighting Analysis](syntax-highlighting-bespoke-analysis.md) | Analysis behind bespoke syntax-highlighting choices. |
| [Store Refactoring](store-refactoring-plan.md) | Pinia store architecture and refactoring notes. |

## Research and migration notes

| Document | Description |
|----------|-------------|
| [Copilot CLI Integration](copilot-cli-integration-report.md) | How TracePilot integrates with Copilot CLI. |
| [Copilot SDK Deep Dive](copilot-sdk-deep-dive.md) | Analysis of the Copilot SDK internals. |
| [Copilot SDK Data Flow](copilot-sdk-data-flow.md) | SDK data-flow and architecture notes. |
| [Copilot SDK Evaluation](copilot-sdk-integration-evaluation.md) | SDK integration evaluation. |
| [Copilot SDK Usage](copilot-sdk-usage.md) | SDK usage guide. |
| [Copilot SDK RPC Bug](copilot-sdk-rpc-method-bug.md) | JSON-RPC method-name bug note. |
| [Tantivy Search Index](tantivy-search-index.md) | Reference for the unmerged Tantivy search-index approach. |
| [Search Index Migration](search-index-migration/README.md) | Search-index migration architecture, benchmarks, and retrospective. |
| [Analytics Persistence](research/analytics-persistence.md) | Persisting analytics data to disk. |
| [Copilot CLI Evolution](research/copilot-cli-evolution-risks.md) | Risk analysis of Copilot CLI schema changes. |
| [Optimisation Plan](research/optimization-plan.md) | Performance optimisation research notes. |
| [VS Code Support](research/vscode-session-support-feasibility.md) | Feasibility of supporting VS Code Copilot sessions. |

## Other assets

| Path | Contents |
|------|----------|
| [images/](images/) | Screenshots and image assets referenced by docs. |
| [presentation/](presentation/) | Presentation/demo assets. |
| [theme-prototypes/](theme-prototypes/) | Theme prototyping artefacts. |
| [design/prototypes/](design/prototypes/) | Design prototype artefacts. |
