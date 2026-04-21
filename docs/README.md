# TracePilot Documentation

> Developer documentation index for TracePilot — a desktop app for visualising and analysing GitHub Copilot CLI sessions.

## Architecture

| Document | Description |
|----------|-------------|
| [Architecture Overview](architecture/overview.md) | Crate and package structure, data flow, key design decisions |
| [Incremental Analytics](architecture/incremental-analytics.md) | Analytics pipeline and incremental computation strategy |

## Design

| Document | Description |
|----------|-------------|
| [Design System](design/design-system.md) | Colour tokens, typography, spacing, and component patterns |
| [Design Report](design/design-report.md) | Initial design exploration and decisions |
| [Tool-Call Rendering](design/tool-call-rendering.md) | How tool calls/results are visualised in the session viewer |
| [Adding Tool Renderers](design/adding-tool-renderers.md) | Guide for adding new tool-specific renderers |
| [Timeline Redesign](design/timeline-redesign.md) | Session timeline component redesign notes |
| [Loading Screen](loading-screen-design.md) | Loading/skeleton screen design |
| [Logo](design/logo.md) | Logo and branding assets |
| [Orchestration Pages](design/orchestration-pages-plan.md) | Design plan for orchestration management views |

## Guides

| Document | Description |
|----------|-------------|
| [Data Integration](data-integration-guide.md) | How session data flows from disk to the UI |
| [Git Worktree Guide](git-worktree-guide.md) | Working with git worktrees in TracePilot |
| [Tauri Command Registration](tauri-command-registration.md) | How Tauri IPC commands are registered and called |
| [Version Analysis](version-analysis-implementation-guide.md) | Implementing Copilot schema version analysis |
| [Store Refactoring](store-refactoring-plan.md) | Pinia store architecture and refactoring plan |

## Research

| Document | Description |
|----------|-------------|
| [Copilot CLI Integration](copilot-cli-integration-report.md) | How TracePilot integrates with Copilot CLI |
| [Copilot SDK Deep Dive](copilot-sdk-deep-dive.md) | Analysis of the Copilot SDK internals |
| [Session Viewer Report](copilot-session-viewer-report.md) | Session viewer feature analysis |
| [Data Enrichment](data-enrichment-report.md) | Data enrichment strategies for session metadata |
| [Analytics Persistence](research/analytics-persistence.md) | Persisting analytics data to disk |
| [Copilot CLI Evolution](research/copilot-cli-evolution-risks.md) | Risk analysis of Copilot CLI schema changes |
| [Optimisation Plan](research/optimization-plan.md) | Performance optimisation strategies |
| [VS Code Support](research/vscode-session-support-feasibility.md) | Feasibility of supporting VS Code Copilot sessions |

## Reports

| Document | Description |
|----------|-------------|
| [Pre-Release Audit](reports/pre-release-audit-report.md) | Comprehensive pre-release code/security/a11y audit |
| [Regression Checklist](reports/regression-checklist.md) | Manual testing checklist for release validation |
| [Security Audit](security-audit-report.md) | Security-focused audit report |
| [Tech Debt Progress (2026-04)](tech-debt-progress-report-2026-04.md) | Active progress report for the 2026-04 tech-debt wave |
| [Archived tech-debt artefacts](archive/2026-04/) | Superseded tech-debt audits, plans, reviews, and reports |

## Plans

| Document | Description |
|----------|-------------|
| [Implementation Phases](implementation-phases.md) | Original implementation phase breakdown |
| [Implementation Roadmap](implementation-roadmap.md) | High-level roadmap |
| [FTS Lean Rebuild](plans/fts-lean-rebuild.md) | Full-text search index rebuild plan |
| [Versioning & Release](versioning-updates-release-strategy.md) | Versioning strategy and release process |

## Common Frontend Components

| Document | Description |
|----------|-------------|
| [Frontend Components](common-frontend-components.md) | Shared Vue component catalogue |

## Index

Flat alphabetical index of all documents under `docs/` (excluding this README). Subdirectories with their own contents are linked at the end.

| Document | Title / Description |
|----------|---------------------|
| [agent-automation-report.md](agent-automation-report.md) | TracePilot Agent Automation — Report & Implementation Plan |
| [ai-agent-task-system-implementation-plan.md](ai-agent-task-system-implementation-plan.md) | AI Agent Task System — Implementation Plan |
| [ai-agent-task-system.md](ai-agent-task-system.md) | TracePilot AI Agent Task System — Final Architecture |
| [ai-task-system.md](ai-task-system.md) | AI Task System |
| [common-frontend-components.md](common-frontend-components.md) | Common Frontend Components |
| [copilot-cli-integration-report.md](copilot-cli-integration-report.md) | Copilot CLI Integration & Session Orchestration — Research Report |
| [copilot-sdk-data-flow.md](copilot-sdk-data-flow.md) | Copilot SDK Data Flow & Architecture Deep Dive |
| [copilot-sdk-deep-dive.md](copilot-sdk-deep-dive.md) | Copilot SDK Deep Dive — TracePilot Integration Analysis |
| [copilot-sdk-integration-evaluation.md](copilot-sdk-integration-evaluation.md) | Copilot SDK Integration Evaluation — TracePilot |
| [copilot-sdk-rpc-method-bug.md](copilot-sdk-rpc-method-bug.md) | Copilot Community Rust SDK — JSON-RPC Method Name Bug |
| [copilot-sdk-usage.md](copilot-sdk-usage.md) | Copilot SDK Integration Guide |
| [copilot-session-viewer-report.md](copilot-session-viewer-report.md) | TracePilot Session Viewer — Research & Implementation Plan |
| [data-enrichment-report.md](data-enrichment-report.md) | TracePilot Data Enrichment Report |
| [data-integration-guide.md](data-integration-guide.md) | Data Integration Guide |
| [git-worktree-guide.md](git-worktree-guide.md) | Git Worktree Guide for TracePilot |
| [implementation-phases.md](implementation-phases.md) | TracePilot — Implementation Roadmap (phase breakdown) |
| [implementation-plan.md](implementation-plan.md) | TracePilot Tech Debt Consolidation — Implementation Plan |
| [implementation-roadmap.md](implementation-roadmap.md) | TracePilot Orchestration — Implementation Roadmap |
| [loading-screen-design.md](loading-screen-design.md) | TracePilot Loading Screen Design |
| [multi-window-architecture.md](multi-window-architecture.md) | Multi-Window Architecture Design |
| [multi-window-implementation-plan.md](multi-window-implementation-plan.md) | Multi-Window & Alerting — Implementation Plan |
| [performance-analysis-report.md](performance-analysis-report.md) | TracePilot Performance Analysis & Profiling Strategy Report |
| [performance-playbook.md](performance-playbook.md) | Performance Playbook |
| [performance-profiling-results.md](performance-profiling-results.md) | TracePilot Performance Profiling Results |
| [search-index-replacement-analysis.md](search-index-replacement-analysis.md) | Search Index Replacement Analysis: SQLite FTS5 → Tantivy / FST |
| [security-audit-report.md](security-audit-report.md) | TracePilot Comprehensive Security Audit Report |
| [session-alerting-notifications.md](session-alerting-notifications.md) | Session Alerting & Notification System |
| [session-file-explorer-analysis.md](session-file-explorer-analysis.md) | Session File Explorer — Technical Analysis Report |
| [specta-migration-guide.md](specta-migration-guide.md) | Specta / tauri-specta migration guide |
| [store-refactoring-plan.md](store-refactoring-plan.md) | Store Refactoring Plan: Extract Duplicate Async Fetch Pattern |
| [tantivy-search-index.md](tantivy-search-index.md) | Tantivy Search Index (reference — not merged) |
| [tauri-command-registration.md](tauri-command-registration.md) | Tauri 2 Command Registration Guide |
| [tech-debt-progress-report-2026-04.md](tech-debt-progress-report-2026-04.md) | Tech-Debt Remediation — Progress Report (April 2026) |
| [theme-audit-report.md](theme-audit-report.md) | TracePilot Theme & Design System Audit |
| [version-analysis-implementation-guide.md](version-analysis-implementation-guide.md) | Version Analysis Implementation Guide |
| [versioning-updates-release-strategy.md](versioning-updates-release-strategy.md) | TracePilot: Versioning, Updates & Release Strategy |

### Subdirectories

| Path | Contents |
|------|----------|
| [adr/](adr/) | Architecture Decision Records (0001–…). |
| [architecture/](architecture/) | Architecture overview and subsystem design notes. |
| [archive/2026-04/](archive/2026-04/) | Superseded 2026-04 tech-debt audits, plans, reviews, and reports. |
| [design/](design/) | Design system, tool-call rendering, timeline, logo, prototypes. |
| [images/](images/) | Screenshots and image assets referenced by docs. |
| [plans/](plans/) | Active implementation plans (e.g. FTS lean rebuild). |
| [presentation/](presentation/) | Presentation/demo assets. |
| [reports/](reports/) | Audit and regression reports (pre-release audit, regression checklist, impl-plan-* reports). |
| [research/](research/) | Research notes on analytics persistence, Copilot CLI evolution, optimisation, VS Code support. |
| [search-index-migration/](search-index-migration/) | Working notes for the search-index migration effort. |
| [theme-prototypes/](theme-prototypes/) | Theme prototyping artefacts. |
