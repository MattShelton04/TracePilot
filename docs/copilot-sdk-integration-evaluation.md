# Copilot SDK Integration Evaluation — TracePilot

> **TracePilot** | Report generated: 2026-04-12
> Supersedes: [copilot-sdk-deep-dive.md](copilot-sdk-deep-dive.md) (2026-03-19)
>
> This report evaluates integration of the GitHub Copilot SDK into TracePilot,
> compares integration strategies, identifies new capabilities, and provides a
> concrete implementation roadmap.
>
> **Historical note:** Sections that mention the experimental AI task orchestrator are retained as historical SDK evaluation context only. The AI Tasks feature, task DB, task IPC, task presets, and UI routes were removed after v0.6.4.
>
> **Multi-model review completed**: Claude Opus 4.6, GPT 5.4, GPT 5.3 Codex.
> See [Part 8: Consolidated Review Feedback](#part-8-consolidated-review-feedback) for findings.

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Part 1: What Has Changed Since the Last Report](#part-1-what-has-changed-since-the-last-report)
- [Part 2: Integration Strategy Evaluation](#part-2-integration-strategy-evaluation)
  - [2.1 Option A — Node.js Sidecar (Official SDK)](#21-option-a--nodejs-sidecar-official-sdk)
  - [2.2 Option B — Rust Native (Community SDK)](#22-option-b--rust-native-community-sdk)
  - [2.3 Option C — Custom Rust JSON-RPC Client](#23-option-c--custom-rust-json-rpc-client)
  - [2.4 Option D — Hybrid Phased Approach](#24-option-d--hybrid-phased-approach-recommended)
  - [2.5 Comparison Matrix](#25-comparison-matrix)
- [Part 3: What the SDK Enables for TracePilot](#part-3-what-the-sdk-enables-for-tracepilot)
  - [3.1 Improvements to Existing Features](#31-improvements-to-existing-features)
  - [3.2 New Features Only Possible with SDK](#32-new-features-only-possible-with-sdk)
  - [3.3 SDK Event Coverage vs File-Watching](#33-sdk-event-coverage-vs-file-watching)
- [Part 4: The Hybrid Data Pipeline](#part-4-the-hybrid-data-pipeline)
  - [4.1 When to Use SDK Events vs JSONL Files](#41-when-to-use-sdk-events-vs-jsonl-files)
  - [4.2 Event Bridge Architecture](#42-event-bridge-architecture)
  - [4.3 Graceful Degradation](#43-graceful-degradation)
- [Part 5: Integration Points in TracePilot](#part-5-integration-points-in-tracepilot)
- [Part 6: Implementation Roadmap](#part-6-implementation-roadmap)
  - [Phase 0 — Foundation](#phase-0--foundation)
  - [Phase 1 — Core SDK Integration](#phase-1--core-sdk-integration)
  - [Phase 2 — Active Orchestration](#phase-2--active-orchestration)
  - [Phase 3 — Advanced Features](#phase-3--advanced-features)
  - [Phase 4 — Power Features](#phase-4--power-features)
- [Part 7: Risk Analysis & Mitigations](#part-7-risk-analysis--mitigations)
- [Part 8: Consolidated Review Feedback](#part-8-consolidated-review-feedback)
  - [8.1 Consensus Findings](#81-consensus-findings)
  - [8.2 Key Disagreements & Resolutions](#82-key-disagreements--resolutions)
  - [8.3 Notable Unique Findings per Reviewer](#83-notable-unique-findings-per-reviewer)
  - [8.4 Improvements Applied to This Report](#84-improvements-applied-to-this-report)
- [Appendix A: Complete SDK API Reference](#appendix-a-complete-sdk-api-reference)
- [Appendix B: Event Type Mapping — SDK ↔ TracePilot](#appendix-b-event-type-mapping--sdk--tracepilot)
- [Appendix C: Community Rust SDK Evaluation](#appendix-c-community-rust-sdk-evaluation)

---

## Executive Summary

The GitHub Copilot SDK (v0.2.1 stable, with v0.2.2-preview.0 available; **public preview — not yet GA**) is a **JSON-RPC 2.0 client library** available in TypeScript, Go, Python, Java, .NET, and (via a community crate) Rust. It communicates with the Copilot CLI in **headless server mode**, enabling programmatic session control, real-time event streaming, custom tool injection, hook-based guardrails, and multi-session orchestration.

### Key Findings

1. **SDK v0.2.0+ adds significant new capabilities** since our last report (2026-03-19): WASM transport, fine-grained system prompt customization (`customize` mode with section-level overrides), OpenTelemetry distributed tracing, blob attachments, new RPC methods for skills/MCP/extensions/plugins management, UI elicitation APIs, and shell execution.

2. **A community Rust SDK (`copilot-sdk`) exists at v0.1.17** with broad parity for core session operations: 41 event types, 47 session methods, all 6 hooks, tool registration, BYOK, fleet mode, MCP support. MIT-licensed, last commit 2026-03-19, uses tokio async runtime. **Caveat**: Runtime management APIs (skills/mcp/extensions RPCs, UI elicitation) are unverified. Single-maintainer risk is significant.

3. **The recommended integration strategy is a Hybrid Phased Approach (Option D)**: Start with the Rust community SDK for immediate, zero-dependency-overhead integration of core features (session launch, event streaming, model control). Add the Node.js official SDK as a lazy-start sidecar only when advanced features requiring hooks/tools/steering are needed.

4. **Hybrid architecture is mandatory**: SDK for live orchestration, JSONL files for historical analytics. The SDK's `assistant.usage` events are ephemeral in the SDK (not returned by `getMessages()`), though the standalone CLI does write them to `events.jsonl`. JSONL parsing remains indispensable for TracePilot's historical token analytics and cost tracking.

5. **12 new features become possible** with SDK integration, and **8 existing features can be substantially improved**. The most impactful are: real-time session dashboard, programmatic session launch (replacing CLI-spawn), mid-session model switching, cost guardrails via hooks, and session steering from the TracePilot UI.

### Top 10 Features Enabled by SDK Integration

| # | Feature | Impact | Effort | SDK Required |
|---|---------|--------|--------|-------------|
| 1 | **Programmatic Session Launch** | Replaces brittle CLI-spawn with typed API | Medium | Yes |
| 2 | **Real-Time Session Dashboard** | Push-based events replace 5s polling | Medium | Yes |
| 3 | **Session Steering from UI** | Send messages / switch models mid-session | Medium | Yes |
| 4 | **Cost Guardrails (Hook-Based)** | Deny tool calls when budget exceeded | Medium | Yes |
| 5 | **Live Quota Monitoring** | Real-time premium request usage | Low | Yes |
| 6 | **Mid-Session Model Switching** | No restart needed | Low | Yes |
| 7 | **Custom Tool Injection** | Agent calls TracePilot analytics | Medium | Yes |
| 8 | **A/B Testing Arena** | Same prompt, different models, compare | High | Yes |
| 9 | **Session Resume from TracePilot** | Resume any past session | Low | Yes |
| 10 | **Hook-Based Audit Logging** | Every tool call logged with full context | Medium | Yes |

---

## Part 1: What Has Changed Since the Last Report

The previous report ([copilot-sdk-deep-dive.md](copilot-sdk-deep-dive.md)) was based on SDK v0.1.x analysis from 2026-03-19. Since then:

### SDK Changes (v0.1.x → v0.2.1+)

> **Note**: The official SDK is in **public preview** — not yet GA. APIs may change. All TracePilot SDK features should ship behind feature flags until the SDK reaches GA.

| Change | Impact on TracePilot |
|--------|---------------------|
| **WASM transport mode** (TypeScript only) — CLI runs as in-process WebAssembly module | **High** — Eliminates sidecar process overhead entirely. _R&D only for now_ — running in Tauri's webview has unresolved challenges (auth, filesystem access, trust boundaries). Currently TypeScript-only; long-term consideration. |
| **System prompt `customize` mode** — Section-level overrides (replace/remove/append/prepend/transform) for 10 named sections | **Medium** — Enables TracePilot to surgically inject context (e.g., append to `custom_instructions`) without replacing entire system prompt. Safer than `replace` mode. |
| **OpenTelemetry support** — `TelemetryConfig` with OTLP endpoint, W3C trace context propagation | **Medium** — Enables distributed tracing across TracePilot → SDK → CLI → API. Useful for performance debugging and session replay. |
| **Blob attachments** — Send base64 binary (images, screenshots) directly to sessions | **Low** — Could enable screenshot-based debugging workflows. |
| **New session RPCs** — `session.rpc.skills.*`, `session.rpc.mcp.*`, `session.rpc.extensions.*`, `session.rpc.plugins.list()`, `session.rpc.ui.elicitation(...)` | **High** — Live management of skills, MCP servers, and extensions within active sessions. TracePilot's existing Skills and MCP management pages could be enhanced with runtime control. |
| **UI Elicitation API** — `session.ui.confirm()`, `session.ui.select()`, `session.ui.input()` | **Medium** — Enables structured user input requests from TracePilot UI during sessions. |
| **`autoRestart` removed** — No longer auto-restarts CLI on crash | **Low** — TracePilot must handle restart logic explicitly. |
| **`session.shutdown` event** (renamed from `session.end`) — Includes `usageStatistics`, `codeChanges`, `shutdownReason` | **High** — Richer session completion data. |
| **New event types** — `system.notification`, `session.remote_steerable_changed`, `session.background_tasks_changed`, `session.custom_agents_updated`, `session.extensions_loaded`, `session.mcp_servers_loaded`, `session.skills_loaded`, `session.tools_updated`, `command.queued`, `command.completed`, `exit_plan_mode.requested/completed` | **Medium** — More granular session state tracking. TracePilot's event parser should be updated. |
| **`reasoningEffort: "xhigh"`** — New tier beyond "high" | **Low** — Add to model config UI. |

### Community Rust SDK (New Discovery)

The `copilot-sdk` Rust crate (v0.1.17) at [copilot-community-sdk/copilot-sdk-rust](https://github.com/copilot-community-sdk/copilot-sdk-rust) was not evaluated in the previous report. Key facts:

- **Broad parity for core session operations** with official SDK: 47 session methods, 41 event types, 6 hooks, tool/permission/user-input handlers
- **Runtime management APIs (skills/mcp/extensions RPCs, UI elicitation) are unverified**
- **Pure Rust, tokio-based** — no FFI, no Node.js dependency
- **MIT license**, single author (Elias Bachaalany) with 2 contributors
- **22 runnable examples**, 86KB of E2E tests, snapshot conformance suite
- **Protocol v2/v3 negotiation** compatible with current CLI
- **Missing**: CLI bundling (auto-install), WASM transport
- **Risk**: Single-maintainer community project; could stagnate

### TracePilot Architecture Evolution

Since the last report, TracePilot has added:
- **AI Task Orchestrator** — Full task management with manifest, jobs, heartbeat-based health monitoring, file-based IPC (`status.json`/`result.json`/`heartbeat.json`), attribution system
- **Skills Management** — Skill listing, enable/disable, create custom skills
- **MCP Server Management** — MCP server listing, enable/disable, configuration
- **~139 Tauri commands** — Up from ~80 in previous analysis
- **Task DB** — SQLite-backed task persistence with CRUD, jobs, stats

---

## Part 2: Integration Strategy Evaluation

### 2.1 Option A — Node.js Sidecar (Official SDK)

**Approach**: Bundle a Node.js sidecar process with `@github/copilot-sdk`. Tauri spawns it at app launch (or lazily). Rust backend communicates with sidecar via stdin/stdout JSON IPC.

**Pros**:
- Official, supported SDK — upstream fixes and new features automatically
- 100% API coverage guaranteed
- Same TypeScript/Node.js ecosystem as Vue frontend
- Includes bundled CLI binary (`@github/copilot ^1.0.21` dependency)
- WASM transport future option (eliminate sidecar entirely)

**Cons**:
- +40-70 MB installer size (Node.js runtime + SDK + dependencies)
- 100-500ms cold start latency for sidecar process
- Extra process management complexity (spawn, monitor, restart). _Note: Tauri 2's `@tauri-apps/plugin-shell` sidecar plugin could mitigate this — provides first-class child process bundling and lifecycle management._
- IPC serialization overhead between Rust and Node.js
- Packaging complexity (must bundle Node.js or use pkg/nexe for standalone binary)
- Node.js not installed on all target systems; bundling required

### 2.2 Option B — Rust Native (Community SDK)

**Approach**: Add `copilot-sdk = "0.1"` to `crates/tracepilot-orchestrator/Cargo.toml`. Direct in-process integration with no sidecar.

**Pros**:
- **Zero additional processes** — no Node.js sidecar; runs in Tauri's Rust backend (note: CLI still runs as a separate process via stdio JSON-RPC)
- **No Rust↔Node IPC layer** — eliminates sidecar serialization boundary (SDK↔CLI JSON-RPC still exists)
- **Zero installer size increase** — compiles into existing binary
- **Full async/tokio** — matches TracePilot's existing async runtime
- **41 event types, 47 session methods** — comprehensive API
- **6 hooks** — same hook system as official SDK
- All 22 examples demonstrate real working patterns
- MIT license — no concerns
- `#![forbid(unsafe_code)]` — no unsafe Rust

**Cons**:
- **Single-maintainer risk** — project could be abandoned
- **No bundled CLI** — TracePilot must find/validate `copilot` on PATH (same as current)
- **No WASM transport** — stdio and TCP only
- **No `@github/copilot-sdk/extension` equivalent** — can't run as CLI child process (not needed for TracePilot)
- **Lag behind official SDK** — community crate may not immediately support new SDK features
- **Unproven at scale** — no known production users beyond examples/tests
- Protocol compatibility could break with CLI updates

### 2.3 Option C — Custom Rust JSON-RPC Client

**Approach**: Implement a minimal JSON-RPC 2.0 client in Rust that speaks the Copilot protocol directly, covering only the methods TracePilot needs.

**Pros**:
- Full control over implementation
- Minimal code surface area (only methods used)
- No external dependency risk

**Cons**:
- **Massive effort** — Protocol has 50+ methods, 44 event types, Content-Length framing, bidirectional messaging, broadcast model
- **Ongoing maintenance** — Must track protocol changes across CLI updates
- **No hook system** — Hooks require server-side callback invocation infrastructure
- **No tool registration** — Requires bidirectional RPC
- **Reinventing the wheel** — The community Rust SDK already did this correctly

**Verdict**: ❌ Not recommended. The community Rust SDK already provides this with better quality.

### 2.4 Option D — Hybrid Phased Approach (Recommended)

**Approach**: Start with the Rust community SDK for core features. Evaluate adding the Node.js sidecar for advanced features only if the Rust SDK proves insufficient.

```
Phase 0-1: Rust SDK (copilot-sdk crate)
═══════════════════════════════════════
- Session create/resume/list/delete
- Real-time event streaming
- Model switching, mode control
- Plan management
- Session abort, compaction
- Basic tool registration (Rust handlers)
- Quota/auth APIs

Phase 2+: Evaluate Node.js sidecar IF needed
═════════════════════════════════════════════
- Hook system with complex logic (cost guardrails)
- Custom agents with inference
- MCP server injection at session level
- System prompt customization (customize mode)
- WASM transport (future: eliminate sidecar)
```

**Why this works**:
1. The Rust SDK covers ~90% of TracePilot's immediate needs
2. Zero packaging/distribution overhead for Phase 0-1
3. Natural fallback: if Rust SDK breaks, TracePilot's existing CLI-spawn approach still works
4. Phase 2 decision point: by then, WASM transport may be viable (eliminating sidecar entirely)
5. If the Rust SDK maintainer is responsive, we can contribute fixes upstream

**Risk mitigation for community SDK dependency**:
- **Vendor-in the crate source** (it's MIT) — fork internally if maintainer disappears
- **Pin to specific version** — don't auto-update
- **Contribute upstream** — build relationship with maintainer, contribute protocol updates
- **Abstraction layer** — wrap SDK calls behind a `trait CopilotBridge` so we can swap implementations

### 2.5 Comparison Matrix

| Criterion | A: Node.js Sidecar | B: Rust Native | C: Custom JSON-RPC | D: Hybrid (Rec.) |
|-----------|--------------------:|---------------:|--------------------:|------------------:|
| **Installer size impact** | +40-70 MB | 0 MB | 0 MB | 0 MB (Phase 0-1) |
| **Cold start latency** | 100-500ms | 0ms | 0ms | 0ms |
| **API coverage** | 100% | ~95% | 30-50% | 95-100% |
| **Maintenance burden** | Low (upstream) | Medium (community) | Very High | Medium |
| **IPC overhead** | Medium | None | None | None |
| **Process management** | Complex | None | None | None |
| **Hook system** | Full | Full | None | Full |
| **Tool registration** | Full | Full | None | Full |
| **WASM transport future** | ✅ Ready | ❌ Not available | ❌ Not available | ✅ Phase 2+ |
| **Risk of SDK abandonment** | Very Low | Medium | N/A | Medium (mitigated) |
| **Implementation effort** | High (sidecar infra) | Low (add crate) | Very High | Low → Medium |
| **Packaging complexity** | High | None | None | None |

---

## Part 3: What the SDK Enables for TracePilot

### 3.1 Improvements to Existing Features

| Existing Feature | Current Approach | SDK Enhancement |
|-----------------|-----------------|-----------------|
| **Session Launcher** | CLI-spawn via `process::spawn_detached_terminal()` — spawns terminal, no return value, no error handling, PID is terminal wrapper not Copilot | `client.create_session(config)` — typed config, error handling, real session ID, event stream. Session ID known immediately (not discovered via filesystem scan). |
| **Active Session Detection** | Lock-file polling (`inuse.*.lock`) with 24h stale threshold, filesystem mtime checks | `client.list_sessions()` — real-time, filterable by repo/branch, includes metadata (summary, start time, context). No stale lock false positives. |
| **Task Orchestrator** | File-based IPC (`status.json`/`result.json`/`heartbeat.json`), session UUID discovered via filesystem time-scan after launch | SDK creates session directly → session ID known instantly. Event callbacks replace file polling. Health via `client.ping()` not heartbeat file mtime. |
| **Config Injector (Runtime)** | Edits YAML/JSON config files on disk, requires session restart for changes to take effect | `session.rpc.model.switchTo()`, `session.rpc.mode.set()` — mid-session changes without restart. Runtime MCP/skills/extensions management via new v0.2.0 RPCs. |
| **Session Detail View** | Parse `events.jsonl` after session ends (or periodic reload) | For live sessions: push-based event stream with <10ms latency. `session.on(type, handler)` provides typed events. |
| **Cost Tracking** | Parse `assistant.usage` from JSONL files retrospectively | For live sessions: real-time `assistant.usage` events + `client.getQuota()` for live premium request tracking. `session.shutdown.usageStatistics` for session totals. |
| **Orchestrator Health Check** | `heartbeat.json` file mtime within 120s timeout | `client.ping()` with actual response time. `client.getState()` returns connection state enum. |
| **Skills Management** | File-based skill listing from CLI install directory | `session.rpc.skills.list()`, `session.rpc.skills.enable/disable/reload()` — runtime skill management within live sessions. |

### 3.2 New Features Only Possible with SDK

| Feature | Description | SDK Methods Used |
|---------|-------------|-----------------|
| **Session Steering** | Send messages to active sessions from TracePilot UI. Inject context mid-turn (`immediate` mode) or queue for next turn (`enqueue`). | `session.send({ prompt, mode })` |
| **Mid-Session Model Switch** | Change model without restarting. Dropdown in live session dashboard. | `session.rpc.model.switchTo(modelId, { reasoningEffort })` |
| **Cost Guardrails** | Hook-based budget enforcement: deny tool calls when session cost exceeds threshold. | `hooks.onPreToolUse` → `permissionDecision: "deny"` |
| **Custom Tool Injection** | Register TracePilot tools (analytics queries, cost reports) that agents can invoke during sessions. | `defineTool()` + `SessionConfig.tools` |
| **Session Resume** | Resume any past session from TracePilot's session list with new config (different model, additional tools). | `client.resume_session(id, config)` |
| **Plan Editor** | Read/write session plan from TracePilot UI. Agent follows updated plan. | `session.rpc.plan.read/update/delete()` |
| **Workspace Browser** | Browse and read files in session workspace from TracePilot. | `session.rpc.workspace.listFiles/readFile()` |
| **A/B Testing** | Run same prompt with different models in parallel worktrees. Compare token usage, time, quality. | Multiple `client.create_session()` with different models |
| **Fleet Orchestration** | Launch parallel sub-tasks from a single session. | `session.rpc.fleet.start()` |
| **Custom Agent Studio** | Define specialized agents (security auditor, test writer) from TracePilot UI, inject into sessions. | `SessionConfig.customAgents` + `session.rpc.agent.select()` |
| **Live MCP Management** | Enable/disable MCP servers in running sessions without restart. | `session.rpc.mcp.list/enable/disable/reload()` |
| **UI Elicitation** | Present structured forms to users during sessions (confirm, select, input). | `session.ui.confirm/select/input()` |

### 3.3 SDK Event Coverage vs File-Watching

The SDK provides **44 event types** vs TracePilot's current **37 known JSONL event types**. New events in the SDK not currently parsed by TracePilot:

| New SDK Event | Description | Value for TracePilot |
|---------------|-------------|---------------------|
| `session.remote_steerable_changed` | Session can/can't be steered remotely | **High** — indicator for steering UI availability |
| `session.background_tasks_changed` | Background tasks updated | **Medium** — task orchestrator awareness |
| `session.custom_agents_updated` | Custom agents updated | **Medium** — agent studio sync |
| `session.extensions_loaded` | Extensions loaded | **Low** — extension status tracking |
| `session.mcp_servers_loaded` | MCP servers loaded | **Medium** — MCP management sync |
| `session.mcp_server_status_changed` | MCP server status change | **Medium** — live MCP health |
| `session.skills_loaded` | Skills loaded | **Low** — skills management sync |
| `session.tools_updated` | Tools updated | **Medium** — tool registry awareness |
| `command.queued` / `command.completed` | Slash command lifecycle | **Low** — command tracking |
| `exit_plan_mode.requested/completed` | Plan mode exit lifecycle | **Low** — mode tracking |
| `tool.execution_partial_result` | Streaming tool output | **High** — live tool output in dashboard |
| `tool.execution_progress` | Tool progress notification | **Medium** — progress bars for long tools |
| `elicitation.requested/completed` | UI form lifecycle | **Medium** — elicitation flow tracking |
| `user_input.requested/completed` | User input lifecycle | **Medium** — input flow tracking |

**Critical data gap remains**: `assistant.usage` events (per-LLM-call token counts, cost multipliers, quota snapshots) are **ephemeral in the SDK** — not returned by `getMessages()`. However, the standalone CLI _does_ write them to `events.jsonl`. TracePilot MUST capture these during live sessions via SDK event callbacks for real-time display AND continue parsing JSONL for historical analytics. The dual pipeline is non-negotiable.

---

## Part 4: The Hybrid Data Pipeline

### 4.1 When to Use SDK Events vs JSONL Files

```
┌─────────────────────────────────────────────────────────────┐
│                    TracePilot Data Sources                    │
├────────────────────────┬────────────────────────────────────┤
│   SDK Event Stream     │   JSONL File Parsing               │
│   (Live Sessions)      │   (Historical Sessions)            │
├────────────────────────┼────────────────────────────────────┤
│ ✅ Real-time events    │ ✅ Persisted event history          │
│ ✅ <10ms latency       │    (ephemeral events need live      │
│ ✅ Typed callbacks     │    capture; not all types in JSONL) │
│ ✅ Bidirectional       │ ✅ assistant.usage in CLI JSONL     │
│ ❌ No history API      │ ❌ Polling-based (latency)         │
│ ❌ Usage events ephm.  │ ❌ Read-only (no control)          │
│ ❌ Requires CLI server │ ❌ No steering/injection           │
├────────────────────────┴────────────────────────────────────┤
│                    BOTH feed into:                            │
│              tracepilot-core → tracepilot-indexer             │
│              (analysis)        (SQLite persistence)           │
└─────────────────────────────────────────────────────────────┘
```

**Decision matrix**:

| Data Need | Use SDK | Use JSONL | Why |
|-----------|---------|-----------|-----|
| Display live session events | ✅ | | Push-based, real-time |
| Token usage analytics (historical) | | ✅ | `assistant.usage` written to CLI's JSONL (not SDK `getMessages()`) |
| Token usage (live session) | ✅ | | Capture ephemeral `assistant.usage` events |
| Cross-session trends | | ✅ | SQLite aggregation over all sessions |
| Session creation/control | ✅ | | API, not possible via files |
| Model comparison (historical) | | ✅ | Need all sessions, not just live |
| Active session list | ✅ | | `listSessions()` is authoritative |
| Completed session list | | ✅ | Filesystem scan + index |
| Tool call audit log | ✅ + ✅ | ✅ | SDK hooks for live; JSONL for history |
| Session steering | ✅ | | Not possible via files |

### 4.2 Event Bridge Architecture

```
SDK Session Events                    JSONL Files
      │                                    │
      ▼                                    ▼
┌─────────────┐                    ┌──────────────┐
│ Event Bridge │                    │ File Watcher │
│ (in-process) │                    │ (existing)   │
└──────┬──────┘                    └──────┬───────┘
       │                                  │
       ▼                                  ▼
┌──────────────────────────────────────────────┐
│            Unified Event Pipeline             │
│                                               │
│  ┌──────────────┐    ┌─────────────────────┐ │
│  │ tracepilot-  │    │ tracepilot-indexer   │ │
│  │ core         │───►│ (SQLite)            │ │
│  │ (analysis)   │    │                     │ │
│  └──────────────┘    └─────────────────────┘ │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│           Tauri Event Bus → Vue Frontend      │
│                                               │
│  ┌──────────────┐    ┌─────────────────────┐ │
│  │ Live Session │    │ Historical Session   │ │
│  │ Dashboard    │    │ Viewer               │ │
│  └──────────────┘    └─────────────────────┘ │
└──────────────────────────────────────────────┘
```

### 4.3 Graceful Degradation

TracePilot MUST work without the SDK active. Degradation states:

| State | Condition | Available Features |
|-------|-----------|-------------------|
| 🟢 **Full** | SDK connected, CLI server responsive | All features including orchestration |
| 🟡 **Degraded** | SDK unavailable or CLI not found | All existing features (session viewing, analytics, search). Orchestration falls back to CLI-spawn. |
| 🔴 **Offline** | No sessions available | Settings, templates, cached data |

**Implementation**: A `CopilotBridge` trait abstracts the SDK connection:

```rust
/// Errors that can occur across the bridge boundary.
#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
    #[error("SDK not connected")]
    NotConnected,
    #[error("Authentication expired")]
    AuthExpired,
    #[error("Protocol mismatch: expected {expected}, got {got}")]
    ProtocolMismatch { expected: u32, got: u32 },
    #[error("Session not found: {0}")]
    SessionNotFound(String),
    #[error("Operation timed out after {0:?}")]
    Timeout(Duration),
    #[error("Capability not supported: {0}")]
    UnsupportedCapability(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("SDK error: {0}")]
    Sdk(Box<dyn std::error::Error + Send + Sync>),
}

/// Connection lifecycle states.
#[derive(Debug, Clone, PartialEq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected { cli_version: String, protocol: u32 },
    Reconnecting { attempt: u32, next_retry: Instant },
    Failed { reason: String },
}

#[async_trait]
pub trait CopilotBridge: Send + Sync {
    // Session lifecycle
    async fn create_session(&self, config: SessionConfig) -> Result<String, BridgeError>;
    async fn list_sessions(&self, filter: Option<SessionFilter>) -> Result<Vec<SessionMetadata>, BridgeError>;
    async fn send_message(&self, session_id: &str, msg: &str, mode: MessageMode) -> Result<(), BridgeError>;
    async fn abort_session(&self, session_id: &str) -> Result<(), BridgeError>;
    async fn switch_model(&self, session_id: &str, model: &str) -> Result<(), BridgeError>;

    // Observability
    async fn get_quota(&self) -> Result<QuotaInfo, BridgeError>;
    async fn get_auth_status(&self) -> Result<AuthStatus, BridgeError>;

    // Event subscriptions (with backpressure)
    async fn subscribe_events(&self, session_id: &str) -> Result<EventStream, BridgeError>;

    // Connection management
    fn connection_state(&self) -> ConnectionState;
    async fn reconnect(&self) -> Result<(), BridgeError>;
    fn on_connection_state_changed(&self, callback: impl Fn(ConnectionState) + Send + Sync + 'static);

    // Capability discovery (critical for unstable APIs)
    fn capabilities(&self) -> BridgeCapabilities;
}

/// Feature flags for what this bridge implementation supports.
pub struct BridgeCapabilities {
    pub supports_hooks: bool,
    pub supports_mcp_management: bool,
    pub supports_skills_management: bool,
    pub supports_ui_elicitation: bool,
    pub supports_session_fs: bool,
    pub supports_custom_agents: bool,
}

// Implementation 1: Rust SDK (via dedicated actor task)
pub struct RustSdkBridge { handle: BridgeActorHandle }

// Implementation 2: Fallback (CLI-spawn, read-only where possible)
pub struct FallbackBridge { /* existing launcher.rs logic */ }
```

**State management**: Rather than `Arc<Mutex<Option<Client>>>`, use a dedicated async actor task that owns the client lifecycle, session registry, event fan-out, and retry state. Expose commands via `tokio::sync::mpsc` channels. This avoids mutex contention from concurrent Tauri commands and simplifies reconnection logic.

---

## Part 5: Integration Points in TracePilot

Specific files and functions where SDK integration would be made:

| Integration Point | File | Current Behavior | SDK Change |
|-------------------|------|-----------------|------------|
| **Session launch** | `crates/tracepilot-orchestrator/src/launcher.rs:60` | `launch_session()` → `spawn_detached_terminal()` | Call `client.create_session(config)` instead. Keep CLI-spawn as fallback. |
| **Process spawn** | `crates/tracepilot-orchestrator/src/process.rs:347` | Platform-specific terminal spawning (WMI/osascript/gnome-terminal) | SDK manages CLI process internally (stdio transport). No terminal window needed. |
| **Session discovery** | `crates/tracepilot-core/src/session/discovery.rs:85` | Lock-file polling (`inuse.*.lock`) | `client.list_sessions()` for live sessions. Keep filesystem scan for completed sessions. |
| **Task orchestrator launch** | `crates/tracepilot-orchestrator/src/task_orchestrator/launcher.rs:109` | Spawns CLI in terminal with manifest prompt | `client.create_session()` with prompt, get session ID directly. |
| **Task IPC** | `crates/tracepilot-orchestrator/src/task_ipc/protocol.rs` | File-based: `status.json`, `result.json`, `heartbeat.json` | SDK event callbacks for status updates. `session.on("session.idle")` replaces heartbeat polling. |
| **Health monitoring** | `crates/tracepilot-orchestrator/src/task_recovery/health.rs:44` | `heartbeat.json` mtime within 120s | `client.ping()` for connection health. Event stream heartbeat for session health. |
| **Session UUID discovery** | `crates/tracepilot-orchestrator/src/task_orchestrator/launcher.rs:282` | Filesystem time-based scan after launch | SDK returns session ID from `create_session()` directly. |
| **Tauri commands** | `crates/tracepilot-tauri-bindings/src/commands/orchestration.rs:196` | `launch_session` delegates to `launcher::launch_session` | Add new commands: `sdk_create_session`, `sdk_send_message`, `sdk_switch_model`, `sdk_get_quota`, etc. |
| **Frontend polling** | `apps/desktop/src/stores/orchestrator.ts:25-26` | 5s fast / 15s slow polling loop | SDK event stream → Tauri events → Vue reactive updates. Polling only as fallback. |
| **Shared state** | `crates/tracepilot-tauri-bindings/src/lib.rs:55` | `SharedOrchestratorState: Arc<Mutex<Option<OrchestratorHandle>>>` | Add `BridgeActorHandle` to Tauri managed state. Actor pattern (channels) preferred over `Arc<Mutex<Option<Client>>>` to avoid contention. |

---

## Part 6: Implementation Roadmap

### Phase 0 — Foundation

**Goal**: Add Rust SDK dependency, build abstraction layer, verify compatibility, establish security baseline.

| Task | Description | Effort |
|------|-------------|--------|
| **Add `copilot-sdk` crate** | Add to `tracepilot-orchestrator/Cargo.toml` with pinned version | Small |
| **Gauge maintainer responsiveness** | Open issue/PR on community repo. Set 30-day abandon threshold → trigger vendor-in. | Small |
| **`CopilotBridge` trait** | Define abstraction trait with `BridgeError` taxonomy, `ConnectionState`, capability discovery (see expanded trait in §4.3) | Medium |
| **`RustSdkBridge` impl** | Implement trait using `copilot_sdk::Client` | Medium |
| **`FallbackBridge` impl** | Wrap existing `launcher.rs` logic behind trait | Small |
| **Connection manager (actor)** | Dedicated async task owns client lifecycle, event fan-out, retry state. Expose commands via channels, not shared mutex. | Medium |
| **Capability detection** | Probe CLI availability, SDK feature support, and protocol version at startup | Small |
| **Deny-by-default permission handler** | No SDK session starts without explicit permission policy. `approveAll` only behind dev/debug flag. | Medium |
| **Tauri state integration** | Add `SharedSdkClient` to Tauri managed state (actor handle, not raw mutex) | Small |
| **CLI compatibility matrix** | Test against CLI N, N-1, N-2 on Windows/macOS/Linux. Document supported versions. | Medium |
| **Contract + integration tests** | SDK connects to installed CLI, basic create/list works. Parity tests ported from community crate. | Medium |
| **sessionFs evaluation** | Evaluate whether SDK's sessionFs can let TracePilot own event persistence for SDK-launched sessions | Small |

**Deliverable**: SDK connected behind abstraction, compatibility matrix documented, permission baseline enforced. No user-facing changes yet.

**Exit criteria**: Bridge connects to CLI versions N/N-1/N-2, all contract tests pass, permission handler denies by default.

### Phase 1 — Core SDK Integration

**Goal**: Replace CLI-spawn with SDK session creation. Add real-time event streaming.

| Task | Description | Effort |
|------|-------------|--------|
| **Programmatic session launch** | `create_session()` replaces `spawn_detached_terminal()` in `launcher.rs` | Medium |
| **SDK event bridge** | Forward SDK events to Tauri event bus → Vue frontend | Medium |
| **Live session dashboard** | New Vue component showing real-time session events (token counter, tool calls, streaming output) | Medium |
| **Session resume** | Add "Resume" button to session list, calls `resume_session()` | Small |
| **Quota dashboard** | Widget showing premium request usage from `get_quota()` | Small |
| **Update `known-events.ts`** | Add new SDK event types to `packages/types/src/known-events.ts` and Rust `KNOWN_EVENT_TYPES` | Small |
| **Frontend event store** | New Pinia store for live SDK events with reactive state | Medium |
| **Bridge conformance tests** | Run identical test suite against `RustSdkBridge` and `FallbackBridge` | Medium |
| **Event deduplication** | Stable event IDs + idempotent ingestion for hybrid SDK+JSONL pipeline | Small |

**Deliverable**: Sessions launch via SDK, live event dashboard visible, quota shown. All behind feature flag.

**Exit criteria**: Zero crash-free regression, <100ms event delivery latency, <1% event loss rate.

### Phase 2 — Active Orchestration

**Goal**: Enable bidirectional control of sessions from TracePilot UI.

| Task | Description | Effort |
|------|-------------|--------|
| **Task orchestrator SDK integration** | Replace file-based IPC with SDK event callbacks for task orchestrator. `session.on("session.idle")` replaces heartbeat polling. | Large |
| **Session steering panel** | UI for sending messages to active sessions (immediate + enqueue modes) | Medium |
| **Model switcher** | Dropdown in live session view to switch models mid-session | Small |
| **Mode control** | Toggle interactive/plan mode from TracePilot | Small |
| **Plan editor** | Read/write session plan via `session.rpc.plan` | Medium |
| **Cost guardrails** | Hook-based budget enforcement (onPreToolUse deny above threshold). Requires hook system validation first. | Medium |
| **Audit logging hook** | Log every tool call to TracePilot's analytics DB | Medium |
| **Runtime skills management** | Enable/disable skills in live sessions via `session.rpc.skills.*` | Small |
| **Runtime MCP management** | Enable/disable MCP servers in live sessions via `session.rpc.mcp.*` | Small |

**Deliverable**: Full bidirectional control of live sessions from TracePilot dashboard.

**Exit criteria**: Reconnect success rate >99%, steering round-trip <500ms, hook timeout handling graceful.

### Phase 3 — Advanced Features (Exploratory)

**Goal**: Custom tools, agents, and A/B testing. _Exploratory — committed only after Phase 2 validation._

| Task | Description | Effort |
|------|-------------|--------|
| **Custom tool injection** | Register TracePilot tools (analytics, cost, session queries) in sessions | Medium |
| **Custom Agent Studio** | UI for defining agents (name, prompt, tools, MCP servers), inject at session creation | Large |
| **A/B Testing Arena** | Run same prompt across models/configs in parallel worktrees, compare results | Large |
| **System prompt customizer** | UI for `customize` mode section overrides | Medium |
| **Workspace browser** | Browse/read session workspace files from TracePilot | Small |
| **Session comparison (live)** | Side-by-side live session monitoring with real-time event comparison | Large |

**Deliverable**: Agent studio, A/B testing, custom tools available.

### Phase 4 — Power Features (Exploratory)

**Goal**: Fleet orchestration, advanced automation. _Exploratory — scope depends on user demand and SDK maturity._

| Task | Description | Effort |
|------|-------------|--------|
| **Fleet mode UI** | Launch fleet sub-tasks from TracePilot, monitor parallel execution | Large |
| **Batch operations** | Launch N sessions across N repos with configurable templates | Large |
| **BYOK management UI** | Configure and test BYOK providers (OpenAI, Anthropic, Azure, Ollama) | Medium |
| **OpenTelemetry integration** | Distributed tracing from TracePilot → SDK → CLI → API | Medium |
| **Self-orchestrating agents** | Agents that spawn helper sessions via TracePilot custom tools | Large |
| **Session replay (enhanced)** | Replay with SDK event timing for accurate performance analysis | Medium |

**Deliverable**: Full fleet orchestration, BYOK, and distributed tracing.

---

## Part 7: Risk Analysis & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Community Rust SDK abandoned** | High | High | Gauge maintainer responsiveness before committing (Phase 0 task). Set 30-day no-response threshold → trigger vendor-in. Maintain internal fork. Alternatively, build minimal custom JSON-RPC client (~500 lines for 5-8 core methods). |
| **SDK protocol breaking changes** | Medium | High | Protocol version negotiation (v2/v3) with graceful downgrade. Decision matrix: unknown protocol → fall back to CLI-spawn with user notification. Test against CLI N/N-1/N-2 in CI. |
| **CLI auto-update breaks SDK** | Medium | Medium | CLI compatibility matrix tested per release. TracePilot displays SDK connection status with "degraded mode" indicator. Cannot ship `COPILOT_AUTO_UPDATE=false` as default (degrades user CLI experience elsewhere). |
| **Rust SDK missing features** | Medium | Medium | Broad parity verified for core operations. Runtime management APIs (skills/mcp/extensions) and UI elicitation still unverified. For missing features, fall back to Node.js sidecar or contribute upstream. |
| **Performance overhead** | Low | Low | SDK adds <5ms per RPC call. Event streaming is push-based (no polling). |
| **Security vulnerabilities in SDK** | Low | High | Deny-by-default permissions (Phase 0). `shell.exec` blocked in bridge layer. Path allowlists for workspace operations. Audit logging via hooks. Never ship `approveAll`. Content redaction before persistence. |
| **Concurrent session conflicts** | Medium | Medium | Application-level session locking. TracePilot as read-only observer for TUI sessions, exclusive writer for SDK-created sessions. Session ownership model required (see §8.3). |
| **Official SDK is public preview** | High | Medium | All SDK features behind feature flag until GA. No hard dependency on preview-only APIs. Maintain fallback for every SDK-powered feature. |
| **Memory pressure (long-running)** | Low | Medium | Define event buffer limits. Implement backpressure in event bridge. Monitor RSS in soak tests. |
| **ToS/licensing compliance** | Low | High | Verify programmatic SDK access from third-party desktop app complies with GitHub Copilot ToS before Phase 1 ships to users. |
| **WASM transport not available in Rust** | Certain | Low | Not needed for Phase 0-3. If needed, evaluate Node.js sidecar or Tauri webview JS bridge. |

---

## Part 8: Consolidated Review Feedback

> Reviewed by: **Claude Opus 4.6**, **GPT 5.4**, **GPT 5.3 Codex**
> Reviews conducted: 2026-04-12

### 8.1 Consensus Findings

All three reviewers **agree on Option D** (Hybrid Phased) as the right directional choice, but flagged it as **not yet production-ready** without significant hardening. Key consensus points:

1. **`assistant.usage` persistence contradiction (CRITICAL)** — The report simultaneously claimed `assistant.usage` is "ephemeral — not in JSONL after session end" (§3.3) and "assistant.usage (persisted!)" in the JSONL column of §4.1. All three reviewers flagged this. **Resolution**: The SDK docs describe `assistant.usage` as ephemeral (not returned by `getMessages()`). The standalone CLI's `events.jsonl` _does_ empirically include it. Both statements were partially true but misleadingly framed. The report has been corrected to distinguish SDK persistence from CLI file persistence.

2. **Rust SDK "full parity" is overstated** — Appendix C marks runtime `rpc.skills.*`, `rpc.mcp.*`, `rpc.extensions.*`, and UI elicitation as "⚠️ Unclear." The executive summary's "full parity" claim contradicts this. **Resolution**: Downgraded to "broad parity for core session operations" with advanced/runtime-management parity still requiring verification.

3. **Phase 1 is overloaded** — All three reviewers independently flagged that "Task orchestrator SDK integration" (rated Large) should NOT be in Phase 1. **Resolution**: Moved to Phase 2. Phase 1 now focuses on session launch + event bridge + live dashboard + quota — the minimum viable SDK integration.

4. **`CopilotBridge` trait is too thin** — Missing: error taxonomy (`BridgeError` enum), reconnection semantics, event subscription/backpressure model, capability discovery, authentication lifecycle, connection state machine. **Resolution**: Expanded trait definition in §4.3 with these additions and architectural notes.

5. **Security is underspecified** — `shell.exec` attack surface, `approveAll` anti-pattern, tool trust boundaries, secret redaction, MCP trust model, and session steering authorization all need concrete policies. **Resolution**: Added security policy requirements to Phase 0 deliverables and expanded §7 risk table.

6. **Testing strategy is absent** — The report mentioned "integration tests" in Phase 0 but provided no concrete testing plan. **Resolution**: Added testing requirements per phase in §6, with contract tests, fault injection, bridge conformance, and security test categories.

7. **Single-maintainer risk underestimated** — Community Rust SDK has 1 primary author, last commit 3+ weeks before report date, 3 contributors total. If abandoned, vendoring means TracePilot becomes the maintainer of a 47-method SDK. **Resolution**: Upgraded risk to High likelihood, added concrete "abandon threshold" (no maintainer response in 30 days → trigger vendor-in), and added Phase 0 task to gauge maintainer responsiveness.

8. **SDK preview maturity missing from analysis** — The official SDK is in public preview, not GA. The report treated it as stable infrastructure. **Resolution**: Added preview maturity as a first-class constraint in §2 and §7.

### 8.2 Key Disagreements & Resolutions

| Topic | Opus 4.6 | GPT 5.4 | Codex 5.3 | Resolution |
|-------|----------|---------|-----------|------------|
| **Option C (custom JSON-RPC)** | Should be reconsidered — minimal 5-8 method client is ~500 lines, no dependency risk | Dismissed it properly — too much reinvention | Protocol-generated Rust client as alternative | **Keep dismissed but add as contingency** — if community SDK abandoned AND no official Rust SDK materializes, a minimal custom client covering only TracePilot's needs is the escape hatch |
| **Official Node SDK first?** | Not recommended — keep Rust-first | "More viable than report suggests" — sessionFs alone may justify earlier evaluation | Viable as dual-adapter from day 1 | **Keep Rust-first for Phase 0-1**, but add sessionFs evaluation to Phase 0 as a decision gate for whether Node is needed earlier |
| **`Arc<Mutex>` vs alternatives** | `Arc<RwLock>` if reads > writes, or check if Client is `Clone + Send + Sync` | Actor-based ownership via channels preferred | Actor/task ownership + channels preferred | **Adopt actor pattern** — dedicated async manager task owns client lifecycle, exposes commands via channels. `Arc<Mutex>` only for MVP prototype |
| **Phase 3-4 commitment level** | Mark as "exploratory, not committed" | Same | Same | **Unanimous** — Phases 3-4 relabeled as "Exploratory" |
| **Permission architecture timing** | Keep in Phase 2 | Move to Phase 0 (minimum permission arch) | Move earlier | **Moved to Phase 0** — deny-by-default permission handler is a prerequisite, not a nice-to-have |

### 8.3 Notable Unique Findings per Reviewer

**Opus 4.6** (deepest codebase investigation, 14 tool calls):
- Discovered `copilot-sdk-supercharged` (v1.0.15) — a second community Rust crate not evaluated in the report. Should be acknowledged and compared.
- Tauri 2's `@tauri-apps/plugin-shell` sidecar plugin was not evaluated for Option A — it eliminates much of the "process management complexity" cited as a con.
- Official Rust SDK is plausible given Go/Python/.NET/Java support already exists — add decision trigger: "If GitHub releases an official Rust SDK, re-evaluate immediately."
- `which` dependency listed as "already in TracePilot" is NOT in `Cargo.lock` — factual error corrected.
- Actual Tauri command count is 139, not "~135" — corrected.

**GPT 5.4** (most thorough strategy critique, 20 tool calls):
- **`sessionFs`** is a major omission — SDK's session-scoped filesystem support could fundamentally reshape the SDK/JSONL split for SDK-launched sessions. TracePilot should evaluate whether sessionFs lets it own event persistence/indexing directly.
- **Session ownership model** needs design — can TracePilot steer a session started externally? What if user resumes in terminal AND UI? Who owns permission prompts?
- **CLI coexistence** (bundled vs installed) — how to avoid mixed session formats, prefer installed vs bundled, migrate/index both.
- **BYOK secret storage** — needs OS keychain, rotation, masking, export restrictions (not just a UI).
- **Version ownership strategy** — 3 moving versions (CLI, Rust SDK, official SDK) creates schema/behavior divergence. Need clear matrix.
- **"Zero IPC overhead" is misleading** — Rust SDK still uses JSON-RPC to CLI process; it removes the Rust↔Node boundary, not the SDK↔CLI boundary. Corrected in report.

**Codex 5.3** (most actionable structural recommendations):
- **Observability SLOs** — latency/error budgets for the event bridge (e.g., max event delivery latency, acceptable loss rate).
- **UX failure modes** — what the user sees when steering fails, hooks time out, reconnect occurs. Report had no UX error design.
- **Data governance** — retention policy for live-captured events, especially sensitive prompts/files/tool outputs.
- **Feature-tiered rollout** — read-only SDK integration first (list/observe), control plane second. Reduces blast radius.
- **Phase 0.5 compatibility lab** — matrix-test CLI N/N-1/N-2 across OSes before user-facing rollout.
- **Phase exit criteria** — crash-free hours, event loss rate, reconnect success rate per phase.

### 8.4 Improvements Applied to This Report

Based on consolidated feedback, the following corrections and additions were made:

1. ✅ Fixed `assistant.usage` contradiction — §3.3 and §4.1 now consistently distinguish SDK ephemeral behavior from CLI JSONL persistence
2. ✅ Fixed SDK version — v0.2.1 stable (not v0.2.2); v0.2.2-preview noted separately
3. ✅ Added Java to official SDK language list
4. ✅ Downgraded "full parity" → "broad parity for core operations"
5. ✅ Fixed "Zero IPC overhead" → "No Rust↔Node IPC layer" (SDK still uses JSON-RPC to CLI)
6. ✅ Fixed "Full event history (all types)" → "Persisted event history (ephemeral events require live capture)"
7. ✅ Fixed Tauri command count (~135 → 139)
8. ✅ Fixed `which` dependency claim
9. ✅ Moved Task Orchestrator SDK integration from Phase 1 → Phase 2
10. ✅ Moved permission architecture from Phase 2 → Phase 0
11. ✅ Expanded `CopilotBridge` trait with error types, capability discovery, event subscriptions
12. ✅ Added SDK preview maturity as constraint in §2 and §7
13. ✅ Added `copilot-sdk-supercharged` crate acknowledgment in Appendix C
14. ✅ Added sessionFs discussion in §4.1
15. ✅ Added Tauri sidecar plugin note in §2.1
16. ✅ Relabeled Phases 3-4 as "Exploratory"
17. ✅ Upgraded single-maintainer risk to High likelihood with concrete abandon threshold
18. ✅ Added decision trigger for official Rust SDK
19. ✅ Added testing requirements per phase
20. ✅ Added security policy requirements to Phase 0

---

## Appendix A: Complete SDK API Reference

### Server-Scoped Methods (CopilotClient)

| Method | Parameters | Returns | Stability |
|--------|-----------|---------|-----------|
| `ping` | `message?` | `{ message, timestamp, protocolVersion }` | 🟢 Public |
| `start` | — | void | 🟢 Public |
| `stop` | — | `Error[]` | 🟢 Public |
| `forceStop` | — | void | 🟢 Public |
| `getState` | — | `ConnectionState` | 🟢 Public |
| `getStatus` | — | `{ version, protocolVersion }` | 🟢 Public |
| `getAuthStatus` | — | `{ isAuthenticated, authType?, login?, host? }` | 🟢 Public |
| `listModels` | — | `ModelInfo[]` | 🟢 Public |
| `getQuota` | — | `{ quotaSnapshots }` | 🟢 Public |
| `createSession` | `SessionConfig` | `Session` | 🟢 Public |
| `resumeSession` | `sessionId, ResumeConfig` | `Session` | 🟢 Public |
| `listSessions` | `filter?` | `SessionMetadata[]` | 🟢 Public |
| `deleteSession` | `sessionId` | void | 🟢 Public |
| `getSessionMetadata` | `sessionId` | `SessionMetadata?` | 🟢 Public |
| `getLastSessionId` | — | `string?` | 🟡 Observed |
| `getForegroundSessionId` | — | `string?` | 🟡 Observed |
| `setForegroundSessionId` | `sessionId` | void | 🟡 Observed |
| `toolsList` | `model?` | `ToolInfo[]` | 🟡 Observed |

### Session-Scoped Methods (CopilotSession)

| Method | Parameters | Returns | Stability |
|--------|-----------|---------|-----------|
| `send` | `prompt, attachments?, mode?` | `messageId` | 🟢 Public |
| `sendAndWait` | `prompt, timeout?` | `AssistantMessage?` | 🟢 Public |
| `abort` | — | void | 🟢 Public |
| `disconnect` | — | void | 🟢 Public |
| `on(handler)` | `EventHandler` | unsubscribe fn | 🟢 Public |
| `on(type, handler)` | `EventType, TypedHandler` | unsubscribe fn | 🟢 Public |
| `getMessages` | — | `SessionEvent[]` | 🟡 Observed |
| `log` | `level, message, ephemeral?` | void | 🟢 Public |
| `rpc.model.getCurrent` | — | `{ modelId, reasoningEffort? }` | 🟡 Observed |
| `rpc.model.switchTo` | `modelId, effort?` | void | 🟢 Public |
| `rpc.mode.get` | — | `{ mode }` | 🟡 Observed |
| `rpc.mode.set` | `mode` | void | 🟡 Observed |
| `rpc.plan.read` | — | `{ content }` | 🟡 Observed |
| `rpc.plan.update` | `content` | void | 🟡 Observed |
| `rpc.plan.delete` | — | void | 🟡 Observed |
| `rpc.workspace.listFiles` | — | `{ files }` | 🟡 Observed |
| `rpc.workspace.readFile` | `path` | `{ content }` | 🟡 Observed |
| `rpc.workspace.createFile` | `path, content` | void | 🟡 Observed |
| `rpc.fleet.start` | `prompt?` | void | 🔴 Experimental |
| `rpc.agent.list` | — | `Agent[]` | 🟡 Observed |
| `rpc.agent.getCurrent` | — | `Agent?` | 🟡 Observed |
| `rpc.agent.select` | `name` | void | 🟡 Observed |
| `rpc.agent.deselect` | — | void | 🟡 Observed |
| `rpc.compaction.compact` | — | `{ success, tokensRemoved }` | 🟡 Observed |
| `rpc.shell.exec` | `command, cwd?, timeout?` | `{ processId }` | 🔴 Experimental |
| `rpc.shell.kill` | `pid` | void | 🔴 Experimental |
| `rpc.skills.list` | — | `SkillInfo[]` | 🟡 Observed |
| `rpc.skills.enable` | `name` | void | 🟡 Observed |
| `rpc.skills.disable` | `name` | void | 🟡 Observed |
| `rpc.skills.reload` | — | void | 🟡 Observed |
| `rpc.mcp.list` | — | `McpServerInfo[]` | 🟡 Observed |
| `rpc.mcp.enable` | `serverName` | void | 🟡 Observed |
| `rpc.mcp.disable` | `serverName` | void | 🟡 Observed |
| `rpc.mcp.reload` | — | void | 🟡 Observed |
| `rpc.extensions.list` | — | `ExtensionInfo[]` | 🟡 Observed |
| `rpc.extensions.enable` | `id` | void | 🟡 Observed |
| `rpc.extensions.disable` | `id` | void | 🟡 Observed |
| `rpc.extensions.reload` | — | void | 🟡 Observed |
| `rpc.plugins.list` | — | `PluginInfo[]` | 🟡 Observed |
| `rpc.ui.elicitation` | `message, schema` | `{ action, content? }` | 🟡 Observed |

---

## Appendix B: Event Type Mapping — SDK ↔ TracePilot

| SDK Event Type | TracePilot `SessionEventType` | Status |
|---------------|------------------------------|--------|
| `session.start` | `SessionStart` | ✅ Mapped |
| `session.resume` | `SessionResume` | ✅ Mapped |
| `session.idle` | — | ❌ Not mapped (ephemeral) |
| `session.error` | `SessionError` | ✅ Mapped |
| `session.shutdown` | `SessionShutdown` | ✅ Mapped |
| `session.title_changed` | — | ❌ Not mapped |
| `session.context_changed` | — | ❌ Not mapped |
| `session.compaction_start` | `SessionCompactionStart` | ✅ Mapped |
| `session.compaction_complete` | `SessionCompactionComplete` | ✅ Mapped |
| `session.task_complete` | `SessionTaskComplete` | ✅ Mapped |
| `session.model_change` | `SessionModelChange` | ✅ Mapped |
| `session.mode_changed` | `SessionModeChanged` | ✅ Mapped |
| `session.plan_changed` | `SessionPlanChanged` | ✅ Mapped |
| `session.workspace_file_changed` | — | ❌ Not mapped |
| `session.handoff` | `SessionHandoff` | ✅ Mapped |
| `session.truncation` | `SessionTruncation` | ✅ Mapped |
| `session.snapshot_rewind` | — | ❌ Not mapped |
| `session.remote_steerable_changed` | `SessionRemoteSteerableChanged` | ✅ Mapped |
| `session.warning` | `SessionWarning` | ✅ Mapped |
| `session.info` | — | ❌ Not mapped |
| `session.usage_info` | `SessionUsageInfo` | ✅ Mapped |
| `session.background_tasks_changed` | — | ❌ Not mapped |
| `session.custom_agents_updated` | — | ❌ Not mapped |
| `session.extensions_loaded` | — | ❌ Not mapped |
| `session.mcp_servers_loaded` | — | ❌ Not mapped |
| `session.mcp_server_status_changed` | — | ❌ Not mapped |
| `session.skills_loaded` | — | ❌ Not mapped |
| `session.tools_updated` | — | ❌ Not mapped |
| `assistant.turn_start` | `AssistantTurnStart` | ✅ Mapped |
| `assistant.turn_end` | `AssistantTurnEnd` | ✅ Mapped |
| `assistant.intent` | — | ❌ Not mapped |
| `assistant.reasoning` | `AssistantReasoning` | ✅ Mapped |
| `assistant.reasoning_delta` | — | ❌ Not mapped (ephemeral) |
| `assistant.message` | `AssistantMessage` | ✅ Mapped |
| `assistant.message_delta` | — | ❌ Not mapped (ephemeral) |
| `assistant.streaming_delta` | — | ❌ Not mapped (ephemeral) |
| `assistant.usage` | `AssistantUsage` | ✅ Mapped |
| `abort` | `Abort` | ✅ Mapped |
| `user.message` | `UserMessage` | ✅ Mapped |
| `pending_messages.modified` | — | ❌ Not mapped |
| `tool.execution_start` | `ToolExecutionStart` | ✅ Mapped |
| `tool.execution_complete` | `ToolExecutionComplete` | ✅ Mapped |
| `tool.execution_partial_result` | — | ❌ Not mapped |
| `tool.execution_progress` | — | ❌ Not mapped |
| `tool.user_requested` | `ToolUserRequested` | ✅ Mapped |
| `skill.invoked` | `SkillInvoked` | ✅ Mapped |
| `subagent.started` | `SubagentStarted` | ✅ Mapped |
| `subagent.completed` | `SubagentCompleted` | ✅ Mapped |
| `subagent.failed` | `SubagentFailed` | ✅ Mapped |
| `subagent.selected` | `SubagentSelected` | ✅ Mapped |
| `subagent.deselected` | `SubagentDeselected` | ✅ Mapped |
| `system.message` | `SystemMessage` | ✅ Mapped |
| `system.notification` | `SystemNotification` | ✅ Mapped |
| `hook.start` | `HookStart` | ✅ Mapped |
| `hook.end` | `HookEnd` | ✅ Mapped |
| `external_tool.requested` | — | ❌ Not mapped |
| `external_tool.completed` | — | ❌ Not mapped |
| `permission.requested` | — | ❌ Not mapped |
| `permission.completed` | — | ❌ Not mapped |
| `command.queued` | — | ❌ Not mapped |
| `command.completed` | — | ❌ Not mapped |
| `exit_plan_mode.requested` | — | ❌ Not mapped |
| `exit_plan_mode.completed` | — | ❌ Not mapped |

**Coverage**: 27/44 SDK events mapped (61%). The 17 unmapped events are mostly new v0.2.0 events and ephemeral streaming events.

---

## Appendix C: Community Rust SDK Evaluation

### Overview

| Property | Value |
|----------|-------|
| **Crate** | `copilot-sdk` v0.1.17 |
| **Repository** | [copilot-community-sdk/copilot-sdk-rust](https://github.com/copilot-community-sdk/copilot-sdk-rust) |
| **License** | MIT |
| **Author** | Elias Bachaalany (`0xeb`) |
| **Contributors** | 3 (0xeb, pjperez, febbyRG) |
| **Last Commit** | 2026-03-19 ("feat: full feature parity with official Copilot SDKs") |
| **Rust Version** | 1.85+ (pinned in `rust-toolchain.toml`) |
| **Async Runtime** | tokio 1.x (rt-multi-thread, net, process, sync, io-util, time) |
| **Protocol Version** | 3 (min: 2) |
| **Safety** | `#![forbid(unsafe_code)]` |

### API Completeness

| Feature Area | Methods | Status |
|--------------|---------|--------|
| **Client lifecycle** | `start`, `stop`, `force_stop`, `ping`, `state` | ✅ Complete |
| **Session CRUD** | `create_session`, `resume_session`, `list_sessions`, `delete_session` | ✅ Complete |
| **Session messaging** | `send`, `send_and_collect`, `send_and_wait`, `abort` | ✅ Complete |
| **Event streaming** | 41 event types, `subscribe()` + `on()` callbacks | ✅ Complete |
| **Model control** | `get_model`, `set_model` | ✅ Complete |
| **Mode control** | `get_mode`, `set_mode` (Interactive/Plan/Autopilot) | ✅ Complete |
| **Plan management** | `read_plan`, `update_plan`, `delete_plan` | ✅ Complete |
| **Agent management** | `list_agents`, `select_agent`, `deselect_agent`, `get_current_agent` | ✅ Complete |
| **Tool system** | `register_tool`, `register_tool_with_handler`, `invoke_tool` | ✅ Complete |
| **Hook system** | All 6 hooks (onSessionStart, onPreToolUse, etc.) | ✅ Complete |
| **Permission handling** | `register_permission_handler`, `handle_permission_request` | ✅ Complete |
| **Shell operations** | `shell_exec`, `shell_kill` | ✅ Complete |
| **Workspace** | `workspace_list_files`, `workspace_read_file`, `workspace_create_file` | ✅ Complete |
| **Fleet mode** | `start_fleet` | ✅ Complete |
| **Auth/Status** | `get_auth_status`, `get_quota`, `get_status` | ✅ Complete |
| **Compaction** | `compact` | ✅ Complete |
| **BYOK** | `ProviderConfig` in session config | ✅ Complete |
| **OpenTelemetry** | `TelemetryConfig` in client options | ✅ Complete |
| **MCP servers** | `McpServerConfig` in session config | ✅ Complete |
| **Custom agents** | `CustomAgentConfig` in session config | ✅ Complete |
| **Infinite sessions** | `InfiniteSessionConfig` | ✅ Complete |
| **CLI bundling** | Auto-install CLI | ❌ Missing (planned) |
| **WASM transport** | In-process WASM module | ❌ Missing (TypeScript only) |
| **Runtime skills/MCP/extensions RPCs** | `rpc.skills.*`, `rpc.mcp.*`, `rpc.extensions.*` | ⚠️ Unclear — not explicitly listed |
| **UI Elicitation** | `session.ui.elicitation()` | ⚠️ Unclear — not explicitly listed |

### Dependencies (Runtime)

| Crate | Version | Purpose |
|-------|---------|---------|
| `tokio` | 1 | Async runtime |
| `serde` | 1 | Serialization |
| `serde_json` | 1 | JSON handling |
| `thiserror` | 2 | Error derive |
| `chrono` | 0.4 | DateTime |
| `tracing` | 0.1 | Structured logging |
| `which` | 7 | Executable path resolution |
| `schemars` | 0.8 | Optional — JSON Schema derivation |

**Size impact**: Minimal — most dependencies already used by TracePilot (`tokio`, `serde`, `serde_json`, `thiserror`, `chrono` are all in `Cargo.lock`). New dependencies: `which` (executable path resolution), `schemars` (optional JSON Schema).

### Test Infrastructure

- **137+ unit tests** across all modules
- **86 KB of E2E tests** (feature-gated: `e2e`)
- **15 KB parity tests** (verify behavior matches official SDK)
- **17 KB snapshot conformance tests** (feature-gated: `snapshots`)
- **CI**: fmt, clippy (`-D warnings`), test, doc, package
- **Attribution header enforcement** in tests

### Assessment for TracePilot

**Recommendation: ✅ Use as primary SDK integration path (with caveats)**

**Strengths**:
- No additional sidecar process/packaging overhead
- Same async runtime as TracePilot (tokio)
- Minimal new dependencies (most already in `Cargo.lock`)
- Broad parity for core session operations covering Phase 0-1 needs
- Well-tested with E2E and conformance suites
- `#![forbid(unsafe_code)]` — no unsafe Rust concerns

**Concerns**:
- Single-maintainer project (High risk) — gauge responsiveness before committing. Set 30-day abandon threshold → trigger vendor-in (MIT license).
- Runtime management APIs (skills/MCP/extensions RPCs, UI elicitation) are **unverified** — Phase 2 features may require official SDK or contributions upstream.
- No production use data available
- Protocol changes in CLI updates could break compatibility
- Advanced parity (v0.2.0+ features) still requires empirical verification

### Alternative Community Crate: `copilot-sdk-supercharged`

A second community Rust crate (`copilot-sdk-supercharged` v1.0.15 on crates.io) was identified during review but not deeply evaluated. It should be compared against `copilot-sdk` during Phase 0 evaluation for:
- API completeness and ergonomics
- Maintenance activity and contributor base
- Test coverage and CI infrastructure
- Dependency footprint

### Decision Triggers

- **If GitHub releases an official Rust SDK**: Re-evaluate immediately — this would eliminate single-maintainer risk and likely provide better parity.
- **If community crate maintainer unresponsive for 30 days**: Trigger vendor-in and evaluate minimal custom JSON-RPC client (~500 lines for core 5-8 methods) as alternative.

---

*End of report. See [copilot-sdk-deep-dive.md](copilot-sdk-deep-dive.md) for the 2026-03-19 predecessor report.*
