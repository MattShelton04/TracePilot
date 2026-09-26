# TracePilot Documentation

> Navigation for TracePilot's current guides, code-coupled references, and
> retained historical research.

Use the current guides for commands and behavior. Plans, prototypes, and dated
reports record decisions or evidence from their time; check the current code
before following their implementation steps. The 2026-05-01 cleanup removed
some older reports and plans, which remain recoverable from Git history.

## Start here

| Document | Description |
|----------|-------------|
| [Testing Guide](testing.md) | Canonical testing layers, commands, VRT/E2E scope, and caveats. |
| [Script and Command Index](../scripts/README.md) | Supported commands, diagnostics, CI helpers, prerequisites, and side effects. |
| [Running-App Automation](app-automation.md) | Playwright agent CLI for the real Tauri app and frontend-only UI server. |
| [Visual Regression](visual-regression.md) | Synthetic frontend comparisons, CI publisher, and interpretation limits. |
| [Architecture Overview](architecture/overview.md) | Crate/package structure, data flow, and major boundaries. |
| [ADRs](adr/README.md) | Accepted architecture decisions and decision-writing conventions. |
| [Data Integration](data-integration-guide.md) | How session data flows from disk to the UI. |
| [Tauri Command Registration](tauri-command-registration.md) | How Tauri IPC commands are registered and called. |
| [On-Disk Paths](on-disk-paths.md) | Filesystem locations used by TracePilot. |
| [Performance Playbook](performance-playbook.md) | Current performance investigation and profiling guidance. |
| [Exact Context Capture Guide](exact-context-capture.md) | Enable, run, inspect, store, and delete isolated model-request snapshots. |
| [Agent Communication](features/agent-communication.md) | Timeline Messages modes, communication evidence, live refresh, and Agents usage counters. |

## Architecture and design references

| Document | Description |
|----------|-------------|
| [Incremental Analytics](architecture/incremental-analytics.md) | Analytics pipeline and incremental computation strategy. |
| [Design System Master](../design-system/MASTER.md) | Current design intent; production tokens live in `packages/ui/src/styles/tokens.css`. |
| [Variant C Design Reference](design/design-system.md) | Historical design and component patterns used by retained prototypes. |
| [Tool-Call Rendering](design/tool-call-rendering.md) | How tool calls/results are visualised in the session viewer. |
| [Adding Tool Renderers](design/adding-tool-renderers.md) | Guide for adding new tool-specific renderers. |
| [Timeline Redesign](design/timeline-redesign.md) | Historical session timeline redesign notes. |
| [Loading Screen Design History](loading-screen-design.md) | Orbital concept selection, current implementation, and open design review item. |
| [Logo](design/logo.md) | Logo and branding assets. |
| [Multi-Window Architecture](multi-window-architecture.md) | Multi-window design notes; compare with current implementation. |
| [Session Alerting](session-alerting-notifications.md) | Alerting and notification design notes; compare with current implementation. |
| [Common Frontend Components](common-frontend-components.md) | Shared Vue component catalogue. |

## Guides and references

| Document | Description |
|----------|-------------|
| [Git Worktree Guide](git-worktree-guide.md) | Working with git worktrees in TracePilot. |
| [Version Analysis](version-analysis-implementation-guide.md) | Implementing Copilot schema version analysis. |
| [Versioning & Release Proposal](versioning-updates-release-strategy.md) | Historical strategy draft; use the root README for the current release process. |
| [Specta Migration](specta-migration-guide.md) | Specta / tauri-specta migration guide. |
| [Syntax Highlighting](syntax-highlighting.md) | Current syntax-highlighting behavior and tradeoffs. |
| [Bespoke Syntax Highlighting Analysis](syntax-highlighting-bespoke-analysis.md) | Analysis behind bespoke syntax-highlighting choices. |

## Proposals, research, and historical evidence

| Document | Description |
|----------|-------------|
| [Copilot Live Attach Plan](features/copilot-live-attach-plan.md) | Official Rust SDK migration, verified attach findings, and the phased live-session roadmap. |
| [Copilot CLI Integration](copilot-cli-integration-report.md) | How TracePilot integrates with Copilot CLI. |
| [Copilot SDK Deep Dive](copilot-sdk-deep-dive.md) | Historical analysis of the retired community SDK; superseded by ADR-0015. |
| [Copilot SDK Data Flow](copilot-sdk-data-flow.md) | SDK data-flow notes from the community-SDK era; see the live attach plan for verified behavior. |
| [Copilot SDK Evaluation](copilot-sdk-integration-evaluation.md) | Historical evaluation of the retired community SDK. |
| [Copilot SDK Usage](copilot-sdk-usage.md) | SDK usage guide. |
| [Tantivy Search Index](tantivy-search-index.md) | Historical reference for the unmerged search-index approach. |
| [Search Index Migration](search-index-migration/README.md) | Shelved migration, benchmarks, and failure lessons; not an active implementation guide. |
| [Multi-Window Implementation RFC](multi-window-implementation-plan.md) | Historical amended plan; several parts have since landed. |
| [Exact Context Capture Plan](features/exact-context-capture-plan.md) | Feasibility research and phased plan; use the current guide above for operation. |
| [Prompt-Cache Insights](features/prompt-cache-insights-plan.md) | Proposed cache-expiry and resume analysis. |
| [Skills Analytics](features/skills-analytics-design.md) | Feature design; compare delivered behavior with current code. |
| [Agents Explorer](features/agents-explorer-design.md) | Delivered feature design and decision record. |
| [Session Replay Communication](features/session-replay-design.md) | Design and implementation guide for adding exchange playback to Session Replay. |
| [Copilot CLI Evolution](research/copilot-cli-evolution-risks.md) | Risk analysis of Copilot CLI schema changes. |
| [Copilot Session Store](research/copilot-session-store-db.md) | What the CLI's `session-store.db` contains, who has it, and how TracePilot could safely read it. |
| [Incremental Analytics Delivery](research/optimization-plan.md) | Dated implementation record and one remaining fallback limitation; use the architecture reference for current design. |
| [VS Code Support](research/vscode-session-support-feasibility.md) | Feasibility of supporting VS Code Copilot sessions. |
| [Pricing Model](pricing-model.md) | Dated pricing reference; verify rates before using estimates. |
| [Performance Evidence](reports/performance-mission.md) | Native measurements, methods, and limitations; retain alongside its JSON evidence. |
| [Usability Audit](reports/usability-audit-2026-09-12/findings.md) | Dated findings with linked coverage, validation, and screenshots. |
| [Version Reports](reports/versions/README.md) | Dated Copilot CLI schema/corpus reports and generation guidance. |

## Other assets

| Path | Contents |
|------|----------|
| [images/](images/) | Screenshots and image assets referenced by docs. |
| [presentation/](presentation/) | Presentation/demo assets. |
| [theme-prototypes/](theme-prototypes/) | Theme prototyping artefacts. |
| [design/prototypes/](design/prototypes/) | Design prototype artefacts. |
