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
| [Security Audit](SECURITY_AUDIT_REPORT.md) | Security-focused audit report |
| [Tech Debt Report](tech-debt-report.md) | Known tech debt and improvement opportunities |
| [Tech Debt — Future](tech-debt-future-improvements.md) | Longer-term tech debt items |

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
