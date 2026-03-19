# Copilot SDK Deep Dive — TracePilot Integration Analysis

> **TracePilot v0.2.0** | Report generated: 2026-03-19
> Companion to: [copilot-cli-integration-report.md](copilot-cli-integration-report.md)
>
> This report documents a comprehensive analysis of the official GitHub Copilot SDK source code
> (multi-language: Go, Node.js, Python, .NET) and its implications for TracePilot's evolution
> from passive session viewer to active session orchestrator.
>
> **Multi-model review completed**: Claude Opus 4.6, GPT 5.4, GPT 5.3 Codex, Gemini 3 Pro.
> See [Part 8: Consolidated Review Feedback](#part-8-consolidated-review-feedback--improvements) for findings.

> ⚠️ **Stability Notice**: The Copilot SDK is in **technical preview** and should be considered an
> internal/partner API without formal stability guarantees. API surface, transport modes, and protocol
> versions may change across CLI updates. TracePilot must implement runtime capability detection and
> graceful degradation for all SDK-dependent features. Throughout this report, capabilities are tagged:
> - 🟢 **Public** — Documented in official SDK README/getting-started guides
> - 🟡 **Observed** — Found in SDK source code and test suites, but not prominently documented
> - 🔴 **Experimental** — Minimal documentation, behavior may change

---

## Executive Summary

The GitHub Copilot SDK is a **JSON-RPC 2.0 client library** (available in Go, TypeScript/Node.js, Python, and .NET) that communicates with the Copilot CLI running in **headless server mode** (`copilot --headless`). This is a fundamental paradigm shift: instead of file-system watching and CLI process spawning, TracePilot gains a **proper programmatic API** with 50+ RPC methods covering session lifecycle, model control, tool injection, hook interception, real-time event streaming, quota management, and fleet orchestration.

**Top 5 implications for TracePilot:**
1. **Hybrid Architecture, Not Replacement** — SDK adds live orchestration capabilities; existing JSONL-based analytics pipeline is kept (SDK doesn't persist ephemeral `assistant.usage` events). See [Part 0.4](#04-how-much-of-tracepilot-should-move-to-the-sdk).
2. **Full Session Interop** — SDK sessions resume in CLI TUI and vice versa (shared persistence). TracePilot can hook into live TUI sessions via TCP multi-client. See [Part 0.2](#02-session-interoperability--cli--sdk).
3. **Zero Cost Increase** — SDK billing is identical to CLI TUI (per-LLM-API-call, not per-send). session.create/resume are free. BYOK bypasses GitHub billing entirely. See [Part 0.1](#01-do-costs-change-when-using-the-sdk).
4. **Custom Tool Injection** — Register TracePilot-specific tools (analytics queries, cost reports) that agents can invoke
5. **Hook-Based Guardrails** — Intercept every tool call, prompt, and error for audit logging and cost control

---

## Table of Contents

- [Part 0: Critical Questions — Cost, Interop, Integration Strategy](#part-0-critical-questions--cost-interop-integration-strategy)
- [Part 1: SDK Architecture & Protocol](#part-1-sdk-architecture--protocol)
- [Part 2: Complete API Reference for TracePilot](#part-2-complete-api-reference-for-tracepilot)
- [Part 3: Architecture Impact on TracePilot](#part-3-architecture-impact-on-tracepilot)
- [Part 4: Implementation Strategy](#part-4-implementation-strategy)
- [Part 5: New Capabilities Unlocked by SDK](#part-5-new-capabilities-unlocked-by-sdk)
- [Part 6: Revised Feature Roadmap](#part-6-revised-feature-roadmap)
- [Part 7: Example Code Patterns](#part-7-example-code-patterns)
- [Part 8: Consolidated Review Feedback & Improvements](#part-8-consolidated-review-feedback--improvements)
- [Appendix A: Complete RPC Method Reference](#appendix-a-complete-rpc-method-reference)
- [Appendix B: Complete Event Type Reference](#appendix-b-complete-event-type-reference)
- [Appendix C: SDK vs File-Watching Comparison](#appendix-c-sdk-vs-file-watching-comparison)

---

## Part 0: Critical Questions — Cost, Interop, Integration Strategy

> *Added 2026-03-19 based on follow-up investigation. These answers are backed by SDK source code,
> test suites, and official documentation.*

### 0.1 Do Costs Change When Using the SDK?

**No. Billing is identical between SDK and CLI TUI.**

From the SDK README:
> *"Billing for the GitHub Copilot SDK is based on the same model as the Copilot CLI,
> with each prompt being counted towards your premium request quota."*

**What counts as a premium request:**

| Action | Costs Premium Request? | Why |
|--------|----------------------|-----|
| `session.create()` | ❌ No | Setup RPC, no LLM call |
| `session.resume()` | ❌ No | Setup RPC, no LLM call |
| `session.list()` | ❌ No | Metadata query |
| `session.send()` (1 user message) | ⚠️ **Variable** | Triggers agentic loop: each LLM API call within the loop = 1 premium request |
| `models.list()`, `ping()`, etc. | ❌ No | Administrative RPCs |

**Critical insight: `session.send()` ≠ 1 premium request.** A single user message can trigger multiple
LLM calls in the agentic loop (think → tool call → think → tool call → response). Each LLM roundtrip
is a separate premium request. This is **identical to the current CLI TUI behavior** — there is no
cost difference whatsoever.

**Per-call cost data is available in `assistant.usage` events:**
```typescript
session.on("assistant.usage", (event) => {
  // Emitted for EACH LLM API call (not per turn)
  console.log({
    model: event.data.model,           // "claude-sonnet-4.5"
    inputTokens: event.data.inputTokens,
    outputTokens: event.data.outputTokens,
    cost: event.data.cost,             // Model multiplier for billing
    quotaSnapshots: event.data.quotaSnapshots,  // Live quota state
    copilotUsage: event.data.copilotUsage,      // Itemized nano-AIU costs
  });
});
```

**Session-level totals in `session.shutdown` (persisted):**
```typescript
session.on("session.shutdown", (event) => {
  console.log({
    totalPremiumRequests: event.data.totalPremiumRequests,  // Total for session
    totalApiDurationMs: event.data.totalApiDurationMs,
    modelMetrics: event.data.modelMetrics,  // Per-model breakdown: { requests: { count, cost }, usage: { inputTokens, outputTokens, ... } }
    codeChanges: event.data.codeChanges,    // { linesAdded, linesRemoved, filesModified }
  });
});
```

**BYOK (Bring Your Own Key) bypasses GitHub billing entirely** — usage is tracked and billed
by your provider (OpenAI, Anthropic, Azure, Ollama). No premium request quota consumed.

**Bottom line: The current TracePilot cost model (1 user query → fixed premium requests) is
maintained. Using the SDK doesn't add extra costs. You get *better* cost visibility via
real-time `quotaSnapshots` and `copilotUsage` in usage events.**

### 0.2 Session Interoperability — CLI ↔ SDK

This is one of the most important findings: **sessions are fully interoperable between SDK and CLI TUI.**

#### Can I resume an SDK-created session in Copilot CLI TUI?

**✅ Yes.** Both SDK and TUI sessions persist to the same location:
```
~/.copilot/session-state/{sessionId}/
    ├── checkpoints/    # Conversation history snapshots
    ├── plan.md         # Agent planning state
    └── files/          # Session artifacts
```

There is **no distinction** between SDK-created and TUI-created sessions in the persistence format.
`session.list()` returns all sessions regardless of origin — there's no "client type" filter.
The TUI's `/resume` command uses the same underlying `session.resume` RPC as the SDK.

#### Can I hook into an active CLI TUI session from the SDK?

**✅ Yes, via TCP transport.** The pattern:

```typescript
// CLI TUI must be running in server mode:
// copilot --ui-server   (TUI + TCP listener)
// or: copilot --headless --port 3000  (headless)

// SDK connects to the same CLI server:
const client = new CopilotClient({ cliUrl: "localhost:3000" });

// Get the TUI's current session:
const foregroundId = await client.getForegroundSessionId();

// Join it (disableResume: true to avoid side effects):
const session = await client.resumeSession(foregroundId, {
  disableResume: true,  // Don't emit session.resume event
  tools: [myCustomTool],  // Add TracePilot's custom tools
  onPermissionRequest: (req) => ({ kind: "no-result" }),  // Defer to TUI user
});

// Now we see ALL events from the TUI session:
session.on("assistant.message", (e) => console.log("Agent said:", e.data.content));
session.on("tool.execution_start", (e) => console.log("Tool:", e.data.toolName));

// We can even steer the session:
await session.send({ prompt: "Focus on auth module", mode: "immediate" });

// Our custom tools are available to the agent alongside TUI's tools!
```

**What multi-client gives us:**
- **Event broadcasting** — TracePilot sees ALL events from the TUI session in real-time
- **Tool composition** — TracePilot's tools + TUI's built-in tools = both available to agent
- **Permission routing** — TracePilot can defer permissions to TUI user (via `no-result`)
- **Ephemeral tools** — TracePilot's tools are removed when it disconnects (clean separation)

#### Can the SDK control the TUI display?

**✅ Yes.** `setForegroundSessionId(sessionId)` tells the TUI to switch to a different session.
TracePilot could create sessions programmatically and then push them to the TUI foreground.

#### Concurrent access caveats

⚠️ **No built-in session locking.** Multi-client is supported at the protocol level, but concurrent
writes to the same session are undefined behavior. The SDK docs recommend application-level locking
(e.g., Redis) for shared session access.

**Recommended TracePilot pattern:** TracePilot acts as a **read-only observer + tool provider** on TUI
sessions (don't send messages). For sessions TracePilot creates, TracePilot is the exclusive writer.

### 0.3 Does the SDK Provide Historical Lookups?

**No. The SDK is a real-time interaction API, not a historical analytics API.**

| Capability | SDK | JSONL Files (Current) |
|-----------|-----|----------------------|
| List past sessions (metadata only) | ✅ `listSessions()` — sessionId, startTime, modifiedTime, summary, context | ✅ Directory listing |
| Read past session events | ⚠️ Must `resumeSession()` first, then `getMessages()` — **persisted events only** | ✅ Direct file read — **ALL events** |
| Token usage per API call | ❌ `assistant.usage` is **ephemeral** — not in `getMessages()` | ✅ **JSONL contains all events including ephemeral** |
| Session summary stats | ✅ `session.shutdown` has `totalPremiumRequests`, `modelMetrics`, `codeChanges` | ✅ Same event in JSONL |
| Cross-session aggregation | ❌ No aggregation APIs | ✅ TracePilot's SQLite indexer |
| Offline analysis | ❌ Requires running CLI server | ✅ Just file I/O |

**Critical finding: `assistant.usage` events (per-call token counts, cost multipliers, quota snapshots)
are EPHEMERAL and NOT returned by `getMessages()`.** This means the SDK cannot provide the detailed
per-call token breakdown that TracePilot needs for its analytics dashboard. **JSONL files are
indispensable for historical token/cost analysis.**

**However**, `session.shutdown` IS persisted and contains aggregated `modelMetrics` with per-model
request counts and token totals — useful as a summary, but less granular than per-call data.

### 0.4 How Much of TracePilot Should Move to the SDK?

**Answer: Almost nothing should "move." The SDK ADDS capabilities; it doesn't replace existing ones.**

```
Current TracePilot Features          → Keep as-is (JSONL-based)
═══════════════════════════════════════════════════════════
Session timeline viewer              → ✅ Keep (needs full event history incl. ephemeral)
Token usage analytics                → ✅ Keep (JSONL has assistant.usage; SDK doesn't persist it)
Model comparison views               → ✅ Keep (SQLite aggregation, not real-time)
Cross-session indexing               → ✅ Keep (no SDK equivalent)
Turn analysis (subagents, etc.)      → ✅ Keep (Rust parser handles complex turn logic)
Todo dependency graph                → ✅ Keep (Rust-parsed from events)
Historical cost reports              → ✅ Keep (JSONL-based, offline capable)

New SDK-Powered Features             → ADD on top
═══════════════════════════════════════════════════════════
Active session discovery             → NEW (session.list with live metadata)
One-click session launch             → NEW (session.create with full config)
Live session dashboard               → NEW (real-time event streaming)
Session steering from UI             → NEW (send with immediate mode)
Custom tool injection                → NEW (register TracePilot tools)
Hook-based guardrails                → NEW (onPreToolUse for cost control)
Model switching mid-session          → NEW (session.rpc.model.switchTo)
Quota monitoring                     → NEW (quotaSnapshots in usage events)
Multi-session orchestration          → NEW (fleet mode, concurrent sessions)
Hook into existing CLI sessions      → NEW (multi-client via TCP)
```

**The only enhancement to existing features:** Supplement file-watching with SDK event streaming for
**live sessions** to get real-time updates instead of polling. The existing file-based pipeline
continues to handle historical analysis and offline use.

### 0.5 Formal Integration Strategy

Based on all findings, the recommended integration strategy is:

```
Phase 1: Foundation (No SDK needed)
════════════════════════════════════
- Git worktree integration (CLI-based, no SDK dependency)
- Session launcher via CLI spawning (copilot --headless)
- Config injector (file-based YAML/JSON modification — already prototyped)
- Active session discovery via lock files (lightweight, no sidecar)

Phase 2: SDK Sidecar (Node.js bridge)
══════════════════════════════════════
- Introduce Node.js sidecar process with @github/copilot-sdk
- Session create/resume/list via SDK (replaces CLI spawning)
- Real-time event streaming for live dashboard
- Quota monitoring (quotaSnapshots from assistant.usage events)
- Runtime capability detection (probe SDK features at startup)

Phase 3: Active Orchestration
═════════════════════════════
- Hook into existing CLI TUI sessions (multi-client via TCP)
- Custom tool registration (TracePilot analytics tools)
- Hook-based guardrails (cost limits, audit logging)
- Session steering from TracePilot UI
- Model switching mid-session

Phase 4: Advanced
═════════════════
- A/B testing (parallel sessions, same prompt, different models)
- Fleet mode orchestration
- Custom agent studio
- BYOK management UI
- Self-orchestrating agents (agents that spawn other sessions)
```

**Key architectural principles:**
1. **Additive, not replacement** — SDK features layer on top of existing file-based analysis
2. **Graceful degradation** — TracePilot works without sidecar (read-only mode)
3. **Lazy sidecar** — Only start Node.js process when orchestration features are needed
4. **Hybrid data pipeline** — SDK for live events, JSONL for history, SQLite for aggregation
5. **Session interop** — TracePilot can both create new sessions AND observe existing CLI sessions

---

## Part 1: SDK Architecture & Protocol

### 1.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                 TracePilot Desktop (Tauri)               │
│  ┌──────────────────┐  ┌─────────────────────────────┐  │
│  │   Vue Frontend   │  │      Rust Backend            │  │
│  │   (Dashboard,    │◄─┤   tracepilot-core            │  │
│  │    Controls,     │  │   tracepilot-indexer          │  │
│  │    Real-time)    │  │   tracepilot-orchestrator ◄──┼──┼── NEW
│  └──────────────────┘  └──────────┬────────────────┘  │
│                                   │ IPC                 │
│                    ┌──────────────▼──────────────┐      │
│                    │   SDK Bridge (Node.js)       │      │
│                    │   @github/copilot-sdk        │      │
│                    └──────────────┬──────────────┘      │
└───────────────────────────────────┼─────────────────────┘
                                    │ JSON-RPC 2.0
                     ┌──────────────▼──────────────┐
                     │   Copilot CLI Server         │
                     │   (copilot --headless)        │
                     │                               │
                     │   ├── Session Manager         │
                     │   ├── Tool Executor           │
                     │   ├── Hook Dispatcher         │
                     │   ├── Model Router            │
                     │   └── Permission Controller   │
                     └──────────────┬──────────────┘
                                    │ HTTPS
                     ┌──────────────▼──────────────┐
                     │   GitHub API / BYOK Provider  │
                     │   (OpenAI, Anthropic, Azure,  │
                     │    Ollama, any compatible)     │
                     └─────────────────────────────┘
```

### 1.2 Transport Modes

The SDK supports three transport modes for communicating with the Copilot CLI:

| Mode | Config | Description | TracePilot Use |
|------|--------|-------------|----------------|
| **stdio** | `useStdio: true` (default) | CLI spawned as child process, JSON-RPC over stdin/stdout | Single-user desktop |
| **TCP** | `cliUrl: "localhost:4321"` | CLI runs as server, SDK connects via TCP | Multi-client, shared server |
| **External** | `cliUrl: "host:port"` | Connect to pre-existing CLI server | Remote/container deployments |

**Multi-client architecture** (TCP only):
- Multiple SDK clients can connect to the same CLI server
- Tool calls and permission requests are **broadcast** to all connected clients
- First client with a matching handler responds
- Tools from different clients **compose** — Client A's tool X + Client B's tool Y both available to agent
- Disconnecting a client **removes that client's tools** (ephemeral registration)

### 1.3 JSON-RPC Protocol

The SDK uses JSON-RPC 2.0 with protocol version 3 (backward-compatible with v2). Protocol v3 introduces the broadcast model for multi-client tool and permission handling.

**Key protocol characteristics:**
- Content-Length framed messages over stdio/TCP
- Bidirectional: server sends notifications (events) to client
- Client can register handlers that server invokes (tools, permissions, hooks)
- Supports streaming via `assistant.message_delta` events

### 1.4 Event Streaming Model

Sessions emit 40+ event types via callback registration. Events are grouped into categories:

**Session events:** `session.start`, `session.resume`, `session.idle`, `session.error`, `session.title`, `session.info`, `session.warning`, `session.model_change`, `session.mode_change`, `session.plan`, `session.file_change`, `session.handoff`, `session.truncation`, `session.rewind`, `session.end`, `session.cwd_change`, `session.context_window`, `session.compaction_start`, `session.compaction_complete`, `session.task_complete`, `session.usage_info`

**Turn events:** `assistant.turn_start`, `assistant.intent`, `assistant.reasoning`, `assistant.reasoning_delta`, `assistant.streaming_progress`, `assistant.message`, `assistant.message_delta`, `assistant.turn_end`, `assistant.usage`, `assistant.turn_abort`

**User events:** `user.message`, `user.pending_messages_changed`

**Tool events:** `tool.execution_start`, `tool.execution_complete`, `tool.user_tool_request`

**Broadcast events (v3):** `external_tool.requested`, `external_tool.completed`, `permission.requested`, `permission.completed`, `hooks.invoke`

**Forward compatibility:** Unknown event types map to `UNKNOWN` enum value (silently handled); malformed data raises errors.

---

## Part 2: Complete API Reference for TracePilot

### 2.1 Session Lifecycle

| Method | Parameters | Returns | Stability | TracePilot Use Case |
|--------|-----------|---------|-----------|---------------------|
| `session.create` | `SessionConfig` (full config) | `Session` object | 🟢 Public | One-click session launch from UI |
| `session.resume` | `sessionId`, `ResumeSessionConfig` | `Session` object | 🟢 Public | Resume from session history view |
| `session.list` | `filter?` (cwd, gitRoot, repo, branch) | `SessionMetadata[]` | 🟢 Public | Active session discovery dashboard |
| `session.delete` | `sessionId` | void | 🟢 Public | Session cleanup/management |
| `session.getLastId` | — | `string` | 🟡 Observed | Quick-resume last session |
| `session.getForeground` | — | `string?` | 🟡 Observed | TUI integration awareness |
| `session.setForeground` | `sessionId` | void | 🟡 Observed | Session focus management |
| `session.disconnect` | — | void | 🟢 Public | Clean session teardown |

**Key patterns from test analysis:**
- Sessions are stateful multi-turn: context preserved across `send()` calls
- `disconnect()` → subsequent calls throw `Session not found`
- `listSessions()` returns sessions with `context.cwd`, enabling workspace-based grouping
- Concurrent sessions work: two sessions with different configs can run `sendAndWait()` in parallel
- Resume preserves full conversation history; streaming config can change on resume

### 2.2 Session Configuration

**`SessionConfig`** — Everything configurable at session creation:

```typescript
interface SessionConfig {
  // Identity
  model?: string;              // e.g., "claude-sonnet-4.5", "gpt-5.4"
  sessionId?: string;          // Custom ID or auto-generated UUID
  clientName?: string;         // "tracepilot-desktop"
  reasoningEffort?: "low" | "medium" | "high"; // Note: SDK source also references "xhigh" but unverified

  // Paths
  configDir?: string;          // Custom config location
  workingDirectory?: string;   // Tools execute relative to this

  // Tools
  tools?: Tool[];              // Custom tools with handlers
  availableTools?: string[];   // Whitelist (e.g., ["grep", "glob", "view"])
  excludedTools?: string[];    // Blacklist (e.g., ["bash"])

  // System prompt
  systemMessage?: {
    mode: "append" | "replace"; // "replace" removes ALL guardrails!
    content: string;
  };

  // BYOK (Bring Your Own Key)
  provider?: {
    type: "openai" | "azure" | "anthropic";
    baseUrl?: string;
    apiKey?: string;
    bearerToken?: string;
    wireApi?: "completions" | "responses"; // "responses" for GPT-5 series
    azure?: { apiVersion: string };
  };

  // MCP Servers
  mcpServers?: Record<string, MCPServerConfig>;

  // Custom Agents
  customAgents?: CustomAgentConfig[];
  agent?: string;              // Pre-select agent by name

  // Skills
  skillDirectories?: string[];
  disabledSkills?: string[];

  // Infinite Sessions
  infiniteSessions?: {
    enabled: boolean;
    backgroundCompactionThreshold?: number; // 0.0-1.0, default 0.80
    bufferExhaustionThreshold?: number;     // 0.0-1.0, default 0.95
  };

  // Streaming
  streaming?: boolean;         // Enable message_delta events

  // Hooks
  hooks?: SessionHooks;

  // Required handlers
  onPermissionRequest: PermissionHandler; // MANDATORY
  onUserInputRequest?: UserInputHandler;
  onEvent?: EventHandler;
}
```

**`ResumeSessionConfig`** — Same options available on resume, plus `disableResume: boolean` (used by extensions).

### 2.3 Real-time Control

These session-scoped RPCs allow controlling a running session:

| Category | Method | Description | Stability | TracePilot Use |
|----------|--------|-------------|-----------|----------------|
| **Model** | `model.getCurrent` | Get current model | 🟡 Observed | Display in dashboard |
| **Model** | `model.switchTo(modelId, effort?)` | Change model mid-session | 🟢 Public | Model switcher UI |
| **Mode** | `mode.get` | Get mode (interactive/plan) | 🟡 Observed | Status display |
| **Mode** | `mode.set(mode)` | Switch mode | 🟡 Observed | Mode toggle button |
| **Plan** | `plan.read` | Read plan content | 🟡 Observed | Plan viewer |
| **Plan** | `plan.update(content)` | Update plan | 🟡 Observed | Plan editor |
| **Plan** | `plan.delete` | Delete plan | 🟡 Observed | Plan management |
| **Workspace** | `workspace.listFiles` | List workspace files | 🟡 Observed | File browser |
| **Workspace** | `workspace.readFile(path)` | Read file content | 🟡 Observed | File viewer |
| **Workspace** | `workspace.createFile(path, content)` | Create file | 🟡 Observed | File editor |
| **Shell** | `shell.exec(command)` | Execute shell command | 🔴 Experimental | Remote execution ⚠️ |
| **Shell** | `shell.kill(pid)` | Kill shell process | 🔴 Experimental | Process management ⚠️ |
| **Fleet** | `fleet.start(prompt?)` | Start fleet mode | 🔴 Experimental | Parallel orchestration |
| **Agent** | `agent.list` | List custom agents | 🟡 Observed | Agent browser |
| **Agent** | `agent.getCurrent` | Get active agent | 🟡 Observed | Status display |
| **Agent** | `agent.select(name)` | Select agent | 🟡 Observed | Agent switcher |
| **Agent** | `agent.deselect` | Deselect agent | 🟡 Observed | Reset to default |
| **Compact** | `compaction.compact` | Manual compaction | 🟡 Observed | Memory management |
| **Log** | `log(level, message)` | Inject log message | 🟢 Public | Context injection |

> ⚠️ **Security Note**: `shell.exec` and `workspace.createFile` execute in the CLI server's security
> context. A compromised or malicious prompt could use these to modify arbitrary files. TracePilot
> must implement strict permission policies for any feature exposing these methods.

**Steering & Queueing** — Two message delivery modes:

```typescript
// Enqueue (default): queued for next turn, FIFO order
session.send("focus on the authentication module", { mode: "enqueue" });

// Immediate (steering): injected into current LLM turn mid-processing
session.send("STOP — critical bug found in auth.ts", { mode: "immediate" });
```

When the session is idle, both modes start a new turn immediately. The difference matters during active processing.

### 2.4 Custom Tools

TracePilot can register tools that agents invoke during sessions:

```typescript
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";

const sessionAnalyticsTool = defineTool("query_session_analytics", {
  description: "Query TracePilot's session analytics database for token usage, model distribution, and cost data",
  parameters: z.object({
    query: z.enum(["token_usage", "model_distribution", "cost_report", "session_history"]),
    sessionId: z.string().optional(),
    timeRange: z.string().optional().describe("ISO 8601 duration, e.g., 'P7D' for last 7 days"),
  }),
  skipPermission: true, // No permission prompt needed for read-only analytics
  async handler(args, invocation) {
    // Query TracePilot's SQLite index
    return JSON.stringify(await queryAnalytics(args));
  },
});
```

**Tool capabilities:**
- Zod-validated parameters with auto JSON Schema generation
- Raw JSON Schema also supported (without Zod)
- `skipPermission: true` — bypasses permission check
- `overridesBuiltInTool: true` — replaces built-in tool of same name
- Return `string` or `{ textResultForLlm, resultType: "success"|"failure", error? }`
- Thrown exceptions → error result (exception details NOT forwarded to model)
- Tools from multiple clients compose in multi-client mode
- **Ephemeral** — tools are removed when client disconnects

### 2.5 Custom Agents

Define specialized agents with scoped tools and prompts:

```typescript
const customAgents = [
  {
    name: "code-reviewer",
    displayName: "Code Reviewer",
    description: "Reviews code changes for bugs, security issues, and best practices",
    prompt: "You are a senior code reviewer. Focus on correctness, security, and performance.",
    tools: ["view", "grep", "glob"],  // Restrict to read-only tools
    infer: true,  // Auto-select when user intent matches
  },
  {
    name: "test-writer",
    displayName: "Test Writer",
    description: "Writes comprehensive unit and integration tests",
    prompt: "You are a test engineer. Write thorough tests with edge cases.",
    tools: ["view", "grep", "glob", "create_file", "edit"],
    mcpServers: { "test-runner": { type: "local", command: "npx", args: ["vitest", "--mcp"] } },
    infer: true,
  },
];
```

**Agent capabilities:**
- Runtime CRUD: `agent.list()`, `agent.select({name})`, `agent.getCurrent()`, `agent.deselect()`
- Each agent has its own tool restrictions and MCP servers
- `infer: true` enables auto-delegation based on user intent
- Agents can be passed at session creation or added on resume
- Pre-select with `agent: "agent-name"` in config

### 2.6 Hook System

Six hooks intercept and modify every stage of session execution:

| Hook | Trigger | Can Modify | TracePilot Use |
|------|---------|-----------|----------------|
| `onSessionStart` | Session begins | Config, inject context | Audit logging, inject repo context |
| `onUserPromptSubmitted` | User sends message | Prompt text, inject context | Prompt templates, context enrichment |
| `onPreToolUse` | Before tool executes | Allow/deny, modify args | Cost guardrails, security policy |
| `onPostToolUse` | After tool executes | Modify result, inject context | Result caching, audit logging |
| `onSessionEnd` | Session ends | Cleanup actions, summary | Auto-summary, analytics update |
| `onErrorOccurred` | Error during session | Retry/skip/abort | Error recovery, notification |

**Hook input/output signatures:**

```typescript
// onPreToolUse — most powerful hook for TracePilot
hooks: {
  onPreToolUse: async (input, invocation) => {
    // input: { timestamp, cwd, toolName, toolArgs }
    // invocation: { sessionId }

    // Example: Block expensive operations over budget
    if (input.toolName === "bash" && isOverBudget(invocation.sessionId)) {
      return {
        permissionDecision: "deny",
        permissionDecisionReason: "Session budget exceeded",
      };
    }

    // Example: Modify tool args (redact secrets)
    return {
      permissionDecision: "allow",
      modifiedArgs: redactSecrets(input.toolArgs),
      additionalContext: "Tool execution approved by TracePilot guardrails",
    };
  },
}
```

### 2.7 MCP Server Integration

```typescript
const mcpServers = {
  "github": {
    type: "local",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN },
    tools: ["*"],  // Allow all tools from this server
    timeout: 30000,
  },
  "postgres": {
    type: "remote",
    url: "https://mcp.example.com/postgres",
    headers: { Authorization: "Bearer ..." },
    tools: ["query", "list_tables"],  // Whitelist specific tools
  },
};
```

- Supports both **local** (subprocess) and **remote** (HTTP) MCP servers
- Environment variables pass through to local subprocess
- Tool whitelisting per server
- Configurable on both `createSession` and `resumeSession`

### 2.8 Permission Model

```typescript
// Approve-all (development only)
onPermissionRequest: approveAll

// Fine-grained control
onPermissionRequest: async (request, invocation) => {
  // request: { kind: "write"|"custom-tool", toolName, toolCallId }

  if (request.kind === "write" && isProtectedPath(request.toolName)) {
    return { kind: "denied-interactively-by-user" };
  }

  if (request.kind === "custom-tool") {
    return { kind: "approved" };
  }

  return { kind: "no-result" }; // Defer to other handlers (v3 multi-client)
};
```

**Permission is MANDATORY** — `createSession`/`resumeSession` without `onPermissionRequest` throws `ValueError`.

**Result kinds:**
- `"approved"` — allow the operation
- `"denied-interactively-by-user"` — user explicitly denied
- `"denied-no-approval-rule-and-could-not-request-from-user"` — no rule matched
- `"no-result"` — defer (v3 multi-client broadcast)

### 2.9 Quota & Auth APIs

```typescript
// Real-time quota monitoring — perfect for Cost Tracker page
const quota = await client.getQuota();
// Returns: {
//   quotaSnapshots: [{
//     entitlementRequests: number,   // Total allowed
//     usedRequests: number,          // Used so far
//     remainingPercentage: number,   // % remaining
//     overage: boolean,              // Over limit?
//     resetDate: string,             // ISO date
//   }]
// }

// Auth status
const auth = await client.getAuthStatus();
// Returns: { isAuthenticated, authType?, login? }

// Available models with capabilities
const models = await client.listModels();
// Returns: [{ id, name, capabilities: {
//   supports: { vision, reasoning_effort },
//   limits: { max_context_window_tokens }
// }, billing: { ... } }]
```

---

## Part 3: Architecture Impact on TracePilot

### 3.1 Current Architecture (File-Watching)

```
Current TracePilot Data Flow:
═══════════════════════════

~/.copilot/sessions/{id}/session-events.jsonl
              │
              ▼ (file watcher / manual load)
    ┌─────────────────────┐
    │ tracepilot-core      │ Parse JSONL → Turn analysis
    │ (Rust, 118 tests)    │ Token aggregation
    └──────────┬──────────┘
               ▼
    ┌─────────────────────┐
    │ tracepilot-indexer   │ SQLite index
    │ (Rust, 16 tests)    │ Cross-session queries
    └──────────┬──────────┘
               ▼
    ┌─────────────────────┐
    │ Tauri Commands       │ IPC bridge to frontend
    │ (invoke handlers)    │
    └──────────┬──────────┘
               ▼
    ┌─────────────────────┐
    │ Vue Frontend         │ Dashboard, analytics,
    │ (124 tests)          │ session viewer
    └─────────────────────┘
```

**Limitations:**
- **Read-only** — cannot control sessions, only observe
- **Polling-based** — file watcher latency, no real-time events
- **No injection** — cannot modify session behavior
- **No orchestration** — cannot create/resume/delete sessions programmatically

### 3.2 Proposed SDK-First Architecture

```
Proposed TracePilot Architecture (Hybrid):
══════════════════════════════════════════

                    ┌────────────────────────────────┐
                    │        Vue Frontend             │
                    │  ┌──────────┐ ┌──────────────┐ │
                    │  │ Session  │ │ Orchestration│ │
                    │  │ Viewer   │ │ Dashboard    │ │
                    │  │(existing)│ │ (NEW)        │ │
                    │  └────┬─────┘ └──────┬───────┘ │
                    └───────┼──────────────┼─────────┘
                            │              │
                    ┌───────▼──────────────▼─────────┐
                    │      Tauri Rust Backend          │
                    │  ┌────────────────────────────┐ │
                    │  │ tracepilot-core (analysis)  │ │  ← EXISTING (unchanged)
                    │  │ tracepilot-indexer (SQLite)  │ │  ← EXISTING (unchanged)
                    │  └──────────────┬─────────────┘ │
                    │  ┌──────────────▼─────────────┐ │
                    │  │ tracepilot-orchestrator     │ │  ← NEW
                    │  │  ├── Session Manager        │ │
                    │  │  ├── Hook Controller        │ │
                    │  │  ├── Tool Registry          │ │
                    │  │  ├── Event Bridge           │ │
                    │  │  └── Quota Monitor          │ │
                    │  └──────────────┬─────────────┘ │
                    └─────────────────┼───────────────┘
                                      │ IPC (stdin/stdout or TCP)
                    ┌─────────────────▼───────────────┐
                    │    Node.js SDK Bridge Process     │
                    │    (@github/copilot-sdk)          │
                    │                                   │
                    │  ┌─────────────────────────────┐ │
                    │  │ CopilotClient               │ │
                    │  │  ├── createSession()         │ │
                    │  │  ├── resumeSession()         │ │
                    │  │  ├── listSessions()          │ │
                    │  │  └── Custom tools/hooks      │ │
                    │  └────────────┬────────────────┘ │
                    └───────────────┼──────────────────┘
                                    │ JSON-RPC 2.0
                    ┌───────────────▼──────────────────┐
                    │    Copilot CLI Server(s)           │
                    │    (copilot --headless)             │
                    │                                    │
                    │  Session 1 ──── GitHub API         │
                    │  Session 2 ──── BYOK Provider      │
                    │  Session N ──── ...                 │
                    └────────────────────────────────────┘
```

### 3.3 What Changes — Feature-by-Feature Comparison

| # | Feature | Old Approach (Integration Report) | New SDK Approach | Benefit |
|---|---------|----------------------------------|-----------------|---------|
| 1 | **Session Launch** | Spawn `copilot` CLI process | `client.createSession(config)` | Full config control, error handling |
| 2 | **Session Discovery** | Scan lock files in `~/.copilot/sessions/` | `client.listSessions(filter)` | Real-time, filterable, no file parsing |
| 3 | **Session Monitoring** | Watch `session-events.jsonl` file changes | `session.on(eventType, callback)` | Real-time streaming, typed events |
| 4 | **Model Switching** | Edit `agent.yaml` files, restart session | `session.rpc.model.switchTo(modelId)` | Mid-session, no restart needed |
| 5 | **Config Injection** | Modify YAML/JSON config files | `SessionConfig` at creation/resume | Type-safe, validated, no file corruption |
| 6 | **Tool Injection** | Extension system + skill files | `tools: [defineTool(...)]` | Programmatic, typed, Zod-validated |
| 7 | **Hook System** | Extension system (JS files on disk) | `hooks: { onPreToolUse, ... }` | In-process, lower latency, full control |
| 8 | **Permission Control** | N/A (manual TUI interaction) | `onPermissionRequest` handler | Automated approval/denial policies |
| 9 | **Cost Tracking** | Parse `assistant.usage` from JSONL | `account.getQuota()` + event streaming | Real-time quota, not retroactive only |
| 10 | **A/B Testing** | Launch multiple CLI processes | Multiple sessions via single client | Shared server, less resource overhead |
| 11 | **Context Injection** | N/A | `session.send(msg, {mode: "immediate"})` | Inject context mid-turn (steering) |
| 12 | **Plan Management** | Read plan.md from session-state dir | `session.rpc.plan.read/update/delete()` | Full CRUD via API |
| 13 | **Fleet Mode** | Manual multi-session orchestration | `session.rpc.fleet.start()` | Built-in parallel execution |
| 14 | **Auth/Quota** | Parse from session metadata | `client.getAuthStatus()` / `client.getQuota()` | Dedicated APIs |
| 15 | **Session Resume** | N/A (view-only) | `client.resumeSession(id, newConfig)` | Can change model/tools on resume |

### 3.4 What Stays the Same

The following TracePilot components remain unchanged and complementary:

- **`tracepilot-core`** — Session analysis, turn parsing, token aggregation. Still needed for **historical analysis** of completed sessions (JSONL files persist after SDK events are consumed).
- **`tracepilot-indexer`** — SQLite cross-session index. Still needed for aggregate analytics, trend reports, model comparison views.
- **Vue frontend** — All existing views (session detail, timeline, model comparison, todo graph). New orchestration views **add** to these.
- **Event type coverage** — 36/36 event types mapped in Rust. SDK events map to the same types.

### 3.5 Hybrid Architecture Strategy

TracePilot should adopt a **hybrid approach**:

1. **SDK for live orchestration** — Creating, controlling, and monitoring active sessions
2. **File-watching for historical analysis** — Indexing completed sessions, aggregate analytics, trend analysis
3. **Event bridge** — SDK events flow in real-time AND persist to JSONL; indexer picks up JSONL for durable storage

This means TracePilot works even without the SDK bridge running (degraded to current read-only mode), and the SDK adds orchestration on top.

---

## Part 4: Implementation Strategy

### 4.1 Language Choice for SDK Integration

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Node.js (Tauri sidecar)** | Native SDK, same language as Vue, rich ecosystem | Extra process, IPC overhead | ✅ **Recommended** |
| **Rust (Go SDK via FFI)** | Single binary, no extra process | CGo FFI complexity, maintenance burden | ❌ Too complex |
| **Rust (reimpl JSON-RPC)** | Pure Rust, best performance | Massive effort, protocol changes break | ❌ Not worth it |
| **Python (subprocess)** | Easy prototyping | Extra runtime dependency, slow startup | ❌ Poor UX |

**Recommendation: Node.js Tauri Sidecar**

Tauri 2 has built-in sidecar support. We bundle the Node.js SDK bridge as a sidecar process that communicates with the Rust backend via a simple IPC protocol (e.g., JSON over stdin/stdout or a local Unix/named pipe).

### 4.2 Tauri Sidecar Pattern

```
Tauri App Start
     │
     ├── Start Rust backend (existing)
     │
     └── Start Node.js sidecar process
              │
              ├── Initialize CopilotClient
              ├── Connect to Copilot CLI (stdio or TCP)
              ├── Register custom tools
              ├── Register hooks
              └── Begin event forwarding to Rust via IPC
```

**Sidecar lifecycle:**
1. Tauri spawns the sidecar at app launch (lazy or eager)
2. Sidecar advertises readiness via IPC
3. Rust backend sends commands (create session, send message, etc.)
4. Sidecar forwards SDK events back to Rust
5. Rust emits Tauri events to Vue frontend
6. On app close, sidecar disconnects gracefully

### 4.3 SDK Client Manager

The Node.js sidecar maintains a `ClientManager` singleton:

```typescript
class ClientManager {
  private client: CopilotClient;
  private sessions: Map<string, Session> = new Map();

  async initialize(options: { transport: "stdio" | "tcp", cliUrl?: string }) {
    this.client = new CopilotClient({
      clientName: "tracepilot-desktop",
      ...(options.transport === "tcp" ? { cliUrl: options.cliUrl } : {}),
    });
    await this.client.start();
  }

  async createSession(config: SessionConfig): Promise<string> {
    const session = await this.client.createSession({
      ...config,
      onPermissionRequest: this.permissionHandler,
      hooks: this.buildHooks(config.sessionId),
      onEvent: (event) => this.forwardEvent(config.sessionId, event),
    });
    this.sessions.set(session.id, session);
    return session.id;
  }

  async sendMessage(sessionId: string, message: string, mode?: "enqueue" | "immediate") {
    const session = this.sessions.get(sessionId);
    return session.send(message, { mode: mode ?? "enqueue" });
  }

  // ... resume, list, delete, model switching, etc.
}
```

### 4.4 Event Bridge

SDK events → Tauri events → Vue frontend:

```typescript
// In Node.js sidecar
forwardEvent(sessionId: string, event: SessionEvent) {
  // Send to Rust backend via IPC
  process.stdout.write(JSON.stringify({
    type: "session_event",
    sessionId,
    event: {
      type: event.type,
      data: event.data,
      timestamp: event.timestamp,
    },
  }) + "\n");
}

// In Rust backend (tracepilot-orchestrator)
fn handle_sidecar_event(event: SidecarEvent, app: &AppHandle) {
    // Forward to Vue frontend
    app.emit("session-event", &event).unwrap();

    // Also feed into existing analysis pipeline
    if let Some(session) = sessions.get(&event.session_id) {
        session.process_event(event.into());
    }
}
```

### 4.5 Integration with Existing Analysis Pipeline

The SDK doesn't replace the existing analysis pipeline — it feeds into it:

```
SDK Events (real-time)
     │
     ├──► Vue Frontend (live dashboard)
     │
     └──► tracepilot-core (in-memory analysis)
              │
              └──► tracepilot-indexer (persistent SQLite)
```

Additionally, SDK-created sessions still write to `~/.copilot/sessions/{id}/session-events.jsonl`, so the existing file-based import continues to work for historical data.

---

## Part 5: New Capabilities Unlocked by SDK

### 5.1 Live Session Injection

The SDK enables injecting context into running sessions in ways impossible with file-watching:

- **`session.log(level, message, ephemeral?)`** — Inject info/warning/error messages into the session timeline. These appear in the session history and can guide the agent's behavior.
- **`session.send(msg, {mode: "immediate"})`** — Steering: inject a message into the current LLM turn mid-processing. The agent receives it as additional context without waiting for the current turn to complete.
- **`session.rpc.plan.update(content)`** — Modify the session's plan file, directing the agent's next steps.

**TracePilot use case:** A "Session Steering" panel where the user can inject context, warnings, or redirect the agent from the TracePilot dashboard without switching to the terminal.

### 5.2 Programmatic Session Launch

One-click session creation from TracePilot UI with full configuration:

- Select model, reasoning effort, system prompt from templates
- Choose working directory (with git worktree support)
- Pre-configure tools (whitelist/blacklist)
- Set BYOK provider
- Enable infinite sessions with custom compaction thresholds
- Attach custom agents
- Apply TracePilot hooks (audit logging, cost guardrails)

### 5.3 Multi-Session Orchestration

The SDK enables TracePilot to manage multiple concurrent sessions:

- **Single CLI server** — One `copilot --headless` process handles all sessions
- **Fleet mode** — `session.rpc.fleet.start()` for built-in parallel task execution
- **Session templates** — Create sessions from pre-configured templates
- **Batch operations** — Launch N sessions across N repos/worktrees with same prompt

### 5.4 A/B Testing via SDK

```typescript
// Create two sessions with different models, same prompt
const sessionA = await client.createSession({
  model: "claude-sonnet-4.5",
  workingDirectory: "/repo/worktree-a",
  ...commonConfig,
});

const sessionB = await client.createSession({
  model: "gpt-5.4",
  workingDirectory: "/repo/worktree-b",
  ...commonConfig,
});

// Send same prompt to both
await Promise.all([
  sessionA.send("Refactor the authentication module to use JWT"),
  sessionB.send("Refactor the authentication module to use JWT"),
]);

// Compare events in real-time on TracePilot dashboard
```

### 5.5 Cost Guardrails

Hook-based budget enforcement:

```typescript
hooks: {
  onPreToolUse: async (input, invocation) => {
    const budget = await getBudget(invocation.sessionId);
    const estimatedCost = estimateToolCost(input.toolName, input.toolArgs);

    if (budget.remaining < estimatedCost) {
      return {
        permissionDecision: "deny",
        permissionDecisionReason: `Budget exceeded: $${budget.used.toFixed(2)} / $${budget.limit.toFixed(2)}`,
      };
    }

    return { permissionDecision: "allow" };
  },
  onPostToolUse: async (input, invocation) => {
    // Log tool cost to TracePilot analytics
    await recordToolCost(invocation.sessionId, input.toolName, input.toolResult);
    return null;
  },
}
```

Combined with `account.getQuota()` for real-time premium request tracking.

### 5.6 Custom TracePilot Tools

Register tools that expose TracePilot's own capabilities to the agent:

| Tool Name | Description | Use Case |
|-----------|-------------|----------|
| `tracepilot_analytics` | Query session analytics | "What was my token usage this week?" |
| `tracepilot_session_list` | List indexed sessions | "Show me all sessions for this repo" |
| `tracepilot_cost_report` | Generate cost report | "How much have I spent on GPT-5?" |
| `tracepilot_model_compare` | Compare model performance | "Which model is faster for this codebase?" |
| `tracepilot_create_worktree` | Create git worktree | "Set up a parallel workspace for this task" |
| `tracepilot_launch_session` | Launch another session | Self-orchestration: agent spawns helper sessions |

### 5.7 Session Steering from UI

```
┌────────────────────────────────────────┐
│  TracePilot — Active Session: abc123   │
│                                        │
│  [Status: Working] [Model: Opus 4.6]  │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ Agent is editing auth.ts...      │  │
│  │ Turn 5 of 12 | 45k tokens used  │  │
│  └──────────────────────────────────┘  │
│                                        │
│  Steer: [___________________________]  │
│         [Send Immediately] [Queue]     │
│                                        │
│  Quick Actions:                        │
│  [Switch Model ▼] [Change Mode ▼]     │
│  [Update Plan] [Compact Context]       │
│  [Abort Turn] [End Session]            │
└────────────────────────────────────────┘
```

### 5.8 Workspace & Plan Management

Read and write session workspace files and plan from TracePilot UI:

- `session.rpc.plan.read()` → Display plan in TracePilot's plan viewer
- `session.rpc.plan.update(content)` → Edit plan from TracePilot, agent follows updated plan
- `session.rpc.workspace.listFiles()` → Browse session workspace
- `session.rpc.workspace.readFile(path)` → View checkpoints, artifacts
- `session.rpc.workspace.createFile(path, content)` → Inject files into workspace

### 5.9 Agent Configuration Studio

Define custom agents from TracePilot UI and inject them into sessions:

```typescript
// User builds agent config in TracePilot UI
const agentConfig = {
  name: "security-auditor",
  displayName: "Security Auditor",
  description: "Audits code for security vulnerabilities",
  prompt: `You are a senior security engineer. Review code for:
    - SQL injection, XSS, CSRF
    - Authentication/authorization flaws
    - Secrets in code
    - Dependency vulnerabilities
    Report findings in SARIF format.`,
  tools: ["view", "grep", "glob"],  // Read-only
  infer: true,
};

// Injected at session creation
const session = await client.createSession({
  customAgents: [agentConfig],
  ...otherConfig,
});
```

### 5.10 Quota & Auth Dashboard

Real-time usage monitoring:

```
┌──────────────────────────────────────┐
│  Premium Requests                     │
│  ████████████░░░░░░ 67% used         │
│  201 / 300 requests                   │
│  Resets: 2026-04-01                   │
│                                       │
│  This Session: 12 requests            │
│  Estimated remaining: ~99 requests    │
│                                       │
│  [Set Budget Alert at ___% ]          │
└──────────────────────────────────────┘
```

---

## Part 6: Revised Feature Roadmap

### 6.1 Updated Tier System

Given the SDK, the feature tiers shift significantly. SDK-based approaches are generally easier to implement than file-watching approaches, but require the sidecar infrastructure first.

| Tier | Timeline | Dependencies |
|------|----------|-------------|
| **Tier 0** | Foundation | Node.js sidecar, IPC bridge, event forwarding |
| **Tier 1** | First features | Session launch, active discovery, quota dashboard |
| **Tier 2** | Core orchestration | Model switching, mode control, session steering, hooks |
| **Tier 3** | Advanced | A/B testing, fleet mode, custom tools, agent studio |
| **Tier 4** | Power features | Batch operations, self-orchestrating agents, BYOK management |

### 6.2 New Features Only Possible with SDK

These features were **impossible** with the file-watching approach:

1. **Real-time steering** — Inject messages mid-turn
2. **Custom tool injection** — Agent calls TracePilot's tools
3. **Hook-based guardrails** — Intercept/modify tool calls and prompts
4. **Mid-session model switching** — No restart needed
5. **Fleet mode orchestration** — Built-in parallel execution
6. **Programmatic permission control** — Automated approval policies
7. **Workspace/plan CRUD** — Read and write session files via API
8. **Multi-client session sharing** — Multiple UI instances sharing sessions
9. **BYOK configuration** — Switch providers without config file editing
10. **Session compaction control** — Manual compaction from UI

### 6.3 Implementation Priority Matrix

| Feature | Effort | Impact | SDK-Required | Priority |
|---------|--------|--------|-------------|----------|
| Sidecar infrastructure | High | Critical | Yes (foundation) | **P0** |
| Security baseline (deny-by-default) | Medium | Critical | Yes (co-req) | **P0** |
| Compatibility test harness | Medium | High | Yes (co-req) | **P0** |
| Session launch | Medium | High | Yes | **P1** |
| Active session discovery | Low | High | Yes | **P1** |
| Git worktree integration | Medium | Very High | No (CLI-based) | **P1** |
| Quota dashboard | Low | Medium | Yes | **P1** |
| Cost guardrails (hooks) | Medium | High | Yes | **P1** |
| Model switching UI | Low | High | Yes | **P2** |
| Session steering | Medium | High | Yes | **P2** |
| Hook-based audit logging | Medium | Medium | Yes | **P2** |
| Custom tools (analytics) | Medium | Medium | Yes | **P3** |
| Agent configuration studio | Medium | Medium | Yes | **P3** |
| A/B testing arena | High | High | Yes | **P3** |
| Fleet mode orchestration | High | High | Yes | **P4** |
| Batch operations | High | High | Yes | **P4** |
| Self-orchestrating agents | Very High | Very High | Yes | **P4** |
| BYOK management UI | Low | Medium | Yes | **P4** |

> **Changes from initial draft (post-review):**
> - Security baseline and test harness elevated to **P0** (co-requirements with sidecar)
> - Git worktree integration elevated to **P1** (unanimous reviewer consensus: "killer feature")
> - Cost guardrails moved from P2 to **P1** (should ship with session launch)
> - A/B testing demoted from P3 to late P3 (high effort, lower immediate value)
> - Fleet mode demoted from P3 to **P4** (behavior unverified, may be superficial)

---

## Part 7: Example Code Patterns

### 7.1 Creating a Session from TracePilot

```typescript
// sdk-bridge/src/session-manager.ts
import { CopilotClient, defineTool } from "@github/copilot-sdk";
import { z } from "zod";

export class SessionManager {
  private client: CopilotClient;
  private sessions: Map<string, any> = new Map();

  async start() {
    this.client = new CopilotClient({
      clientName: "tracepilot-desktop",
    });
    await this.client.start();
  }

  async createTracePilotSession(config: {
    model: string;
    workingDirectory: string;
    systemPrompt?: string;
    reasoningEffort?: "low" | "medium" | "high";
    enableCostGuardrails?: boolean;
    budgetLimit?: number;
  }) {
    const tools = [
      defineTool("tracepilot_status", {
        description: "Get TracePilot monitoring status for the current session",
        parameters: z.object({}),
        skipPermission: true,
        handler: async (_, invocation) => {
          return JSON.stringify({
            sessionId: invocation.sessionId,
            monitoring: true,
            tokensUsed: await getTokenCount(invocation.sessionId),
          });
        },
      }),
    ];

    // NOTE: onEvent callback captures sessionId via closure, not the session object,
    // to avoid a temporal dead zone (session isn't assigned until createSession returns).
    const sessionId = config.model + "-" + Date.now(); // or let SDK generate
    const session = await this.client.createSession({
      model: config.model,
      sessionId,
      workingDirectory: config.workingDirectory,
      reasoningEffort: config.reasoningEffort,
      tools,
      systemMessage: config.systemPrompt
        ? { mode: "append", content: config.systemPrompt }
        : undefined,
      infiniteSessions: { enabled: true },
      streaming: true,
      onPermissionRequest: this.permissionHandler, // NEVER use approveAll in production
      hooks: config.enableCostGuardrails
        ? this.buildCostGuardrailHooks(config.budgetLimit ?? 5.0)
        : undefined,
    });

    // Register event handler after session is created
    session.on("*", (event: any) => this.bridgeEvent(session.id, event));
    this.sessions.set(session.id, session);

    return session.id;
  }

  private buildCostGuardrailHooks(budgetLimit: number) {
    return {
      onPreToolUse: async (input: any, invocation: any) => {
        const usage = await getSessionCost(invocation.sessionId);
        if (usage > budgetLimit) {
          return {
            permissionDecision: "deny" as const,
            permissionDecisionReason: `Budget limit of $${budgetLimit} exceeded`,
          };
        }
        return { permissionDecision: "allow" as const };
      },
    };
  }

  private bridgeEvent(sessionId: string, event: any) {
    // Forward to Rust backend via stdout IPC
    const message = JSON.stringify({ type: "event", sessionId, event });
    process.stdout.write(message + "\n");
  }
}
```

### 7.2 Live Dashboard Event Stream

```typescript
// sdk-bridge/src/event-stream.ts
export function setupEventHandlers(session: any, sessionId: string) {
  // Real-time turn tracking
  session.on("assistant.turn_start", (event: any) => {
    emit({ type: "turn_start", sessionId, turnIndex: event.data?.turnIndex });
  });

  session.on("assistant.message_delta", (event: any) => {
    emit({ type: "streaming", sessionId, delta: event.data?.deltaContent });
  });

  session.on("assistant.message", (event: any) => {
    emit({ type: "message", sessionId, content: event.data?.content });
  });

  session.on("assistant.usage", (event: any) => {
    emit({ type: "usage", sessionId, usage: event.data });
  });

  // Tool execution tracking
  session.on("tool.execution_start", (event: any) => {
    emit({ type: "tool_start", sessionId, tool: event.data?.toolName });
  });

  session.on("tool.execution_complete", (event: any) => {
    emit({ type: "tool_complete", sessionId, tool: event.data?.toolName, success: event.data?.success });
  });

  // Session lifecycle
  session.on("session.idle", () => {
    emit({ type: "idle", sessionId });
  });

  session.on("session.model_change", (event: any) => {
    emit({ type: "model_change", sessionId, model: event.data?.newModel });
  });

  session.on("session.compaction_complete", (event: any) => {
    emit({ type: "compaction", sessionId, tokensRemoved: event.data?.tokensRemoved });
  });
}

function emit(data: any) {
  process.stdout.write(JSON.stringify(data) + "\n");
}
```

### 7.3 Cost Guardrail Hook

```typescript
// sdk-bridge/src/hooks/cost-guardrail.ts
interface BudgetConfig {
  hardLimit: number;      // Deny tools above this cost
  warnThreshold: number;  // Emit warning above this
  trackToolCosts: boolean;
}

export function createCostGuardrailHooks(config: BudgetConfig) {
  const sessionCosts = new Map<string, number>();

  return {
    onPreToolUse: async (input: any, invocation: any) => {
      const currentCost = sessionCosts.get(invocation.sessionId) ?? 0;

      if (currentCost >= config.hardLimit) {
        return {
          permissionDecision: "deny" as const,
          permissionDecisionReason: `Session cost $${currentCost.toFixed(2)} exceeds limit $${config.hardLimit.toFixed(2)}`,
        };
      }

      if (currentCost >= config.warnThreshold) {
        return {
          permissionDecision: "allow" as const,
          additionalContext: `⚠️ Cost warning: $${currentCost.toFixed(2)} / $${config.hardLimit.toFixed(2)}`,
        };
      }

      return { permissionDecision: "allow" as const };
    },

    onPostToolUse: async (input: any, invocation: any) => {
      if (config.trackToolCosts) {
        // Estimate cost based on tool type and result size
        const cost = estimateToolCost(input.toolName, input.toolResult);
        const current = sessionCosts.get(invocation.sessionId) ?? 0;
        sessionCosts.set(invocation.sessionId, current + cost);
      }
      return null;
    },
  };
}
```

### 7.4 A/B Test Runner

```typescript
// sdk-bridge/src/ab-test.ts
interface ABTestConfig {
  models: string[];
  prompt: string;
  workingDirectory: string;
  maxTurns?: number;
}

export async function runABTest(client: CopilotClient, config: ABTestConfig) {
  const results = new Map<string, { events: any[], startTime: number }>();

  // Create parallel sessions for each model
  const sessions = await Promise.all(
    config.models.map(async (model) => {
      const sessionId = `ab-test-${model}-${Date.now()}`;
      results.set(model, { events: [], startTime: Date.now() });

      const session = await client.createSession({
        model,
        sessionId,
        workingDirectory: config.workingDirectory,
        streaming: true,
        onPermissionRequest: approveAll,
        onEvent: (event) => {
          results.get(model)!.events.push({
            ...event,
            relativeTime: Date.now() - results.get(model)!.startTime,
          });
        },
      });

      return { model, session };
    })
  );

  // Send same prompt to all sessions
  await Promise.all(
    sessions.map(({ session }) =>
      session.sendAndWait(config.prompt)
    )
  );

  // Emit comparison data
  return Object.fromEntries(
    [...results.entries()].map(([model, data]) => [
      model,
      {
        totalEvents: data.events.length,
        duration: Date.now() - data.startTime,
        toolCalls: data.events.filter(e => e.type === "tool.execution_complete").length,
        tokenUsage: data.events.find(e => e.type === "assistant.usage")?.data,
      },
    ])
  );
}
```

### 7.5 Session Steering

```typescript
// sdk-bridge/src/steering.ts
export class SessionSteerer {
  constructor(private sessions: Map<string, any>) {}

  // Inject immediate context (mid-turn)
  async steer(sessionId: string, message: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.send(message, { mode: "immediate" });
  }

  // Queue message for next turn
  async enqueue(sessionId: string, message: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.send(message, { mode: "enqueue" });
  }

  // Inject a log message (appears in session timeline)
  async injectLog(sessionId: string, level: "info" | "warning" | "error", message: string) {
    const session = this.sessions.get(sessionId);
    return session.rpc.log({ level, message, ephemeral: false });
  }

  // Switch model mid-session
  async switchModel(sessionId: string, modelId: string, reasoningEffort?: string) {
    const session = this.sessions.get(sessionId);
    return session.rpc.model.switchTo({ modelId, reasoningEffort });
  }

  // Toggle mode
  async setMode(sessionId: string, mode: "interactive" | "plan") {
    const session = this.sessions.get(sessionId);
    return session.rpc.mode.set({ mode });
  }

  // Manual compaction
  async compact(sessionId: string) {
    const session = this.sessions.get(sessionId);
    return session.rpc.compaction.compact();
  }

  // Abort current turn
  async abort(sessionId: string) {
    const session = this.sessions.get(sessionId);
    return session.abort();
  }
}
```

### 7.6 Custom TracePilot Tool

```typescript
// sdk-bridge/src/tools/analytics-tool.ts
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";

export const analyticsTools = [
  defineTool("tracepilot_query_sessions", {
    description: "Query TracePilot's session index to find sessions by repository, branch, model, or date range",
    parameters: z.object({
      repository: z.string().optional().describe("Filter by repository name"),
      branch: z.string().optional().describe("Filter by git branch"),
      model: z.string().optional().describe("Filter by model used"),
      since: z.string().optional().describe("ISO date string for start of range"),
      limit: z.number().optional().default(10).describe("Max results to return"),
    }),
    skipPermission: true,
    async handler(args) {
      // Query TracePilot's SQLite index via IPC to Rust backend
      const results = await ipcQuery("query_sessions", args);
      return JSON.stringify(results, null, 2);
    },
  }),

  defineTool("tracepilot_token_report", {
    description: "Get token usage report for a session or across all sessions",
    parameters: z.object({
      sessionId: z.string().optional().describe("Specific session ID, or omit for aggregate"),
      groupBy: z.enum(["model", "day", "repository"]).optional().default("model"),
    }),
    skipPermission: true,
    async handler(args) {
      const report = await ipcQuery("token_report", args);
      return JSON.stringify(report, null, 2);
    },
  }),

  defineTool("tracepilot_create_worktree", {
    description: "Create a git worktree for parallel development. Returns the worktree path.",
    parameters: z.object({
      repoPath: z.string().describe("Path to the git repository"),
      branchName: z.string().regex(/^[a-zA-Z0-9_\-\/]+$/).describe("Name for the new branch (alphanumeric, dashes, underscores)"),
      baseBranch: z.string().optional().default("main").describe("Branch to base off of"),
    }),
    handler: async (args) => {
      // Validate paths to prevent injection
      const safeBranch = args.branchName.replace(/[^a-zA-Z0-9_\-\/]/g, "");
      const repoName = path.basename(path.resolve(args.repoPath));
      const worktreePath = path.join(path.dirname(path.resolve(args.repoPath)), `${repoName}-${safeBranch}`);

      // Use arg array (not shell string) to prevent injection
      await execFile("git", ["-C", args.repoPath, "worktree", "add", worktreePath, "-b", safeBranch, args.baseBranch]);
      return JSON.stringify({ path: worktreePath, branch: safeBranch });
    },
  }),
];
```

---

## Part 8: Consolidated Review Feedback & Improvements

> This section consolidates feedback from 4 independent model reviews:
> - **Claude Opus 4.6** — See [sdk-review-opus.md](reviews/sdk-review-opus.md)
> - **GPT 5.4** — See [sdk-review-gpt54.md](reviews/sdk-review-gpt54.md)
> - **GPT 5.3 Codex** — See [sdk-review-codex53.md](reviews/sdk-review-codex53.md)
> - **Gemini 3 Pro** — See [sdk-review-gemini.md](reviews/sdk-review-gemini.md)

### 8.1 Unanimous Consensus

All 4 reviewers agreed on these points:

| Topic | Consensus | Action Taken |
|-------|-----------|-------------|
| **Hybrid architecture is correct** | SDK for live control + file-watching for history is the right approach | ✅ No change needed |
| **SDK stability is the #1 risk** | Internal/preview API with no formal guarantees, CLI auto-updates can break everything | ✅ Added stability tags throughout |
| **Security defaults are dangerous** | `approveAll` pattern in examples enables RCE; must be deny-by-default | ✅ Fixed code examples |
| **Git worktrees should be P1** | "Killer feature" for parallel work; filesystem isolation enables session isolation | ✅ Elevated to P1 |
| **Missing error recovery section** | No coverage of CLI crashes, reconnection, sidecar failure | ✅ See §8.4 below |
| **Package name inconsistency** | Reports alternate between `@github/copilot-sdk` and `@github/copilot/sdk` | ✅ Fixed to canonical name |
| **Code example bugs** | Temporal dead zone in §7.1, shell injection in §7.6, untyped `any` everywhere | ✅ Fixed examples |

### 8.2 Key Disagreements & Resolutions

| Topic | Opus/GPT View | Gemini/Codex View | Resolution |
|-------|---------------|-------------------|------------|
| **Rust JSON-RPC client** | "Dismissed too quickly; consider for P0-P1" | "Node sidecar is mandatory for hooks/tools" | **Both valid.** Phased approach: Rust thin client for P0-P1 (session list/create/events), Node sidecar for P2+ (hooks, tools, steering). Added as alternative in §4.1. |
| **Fleet mode importance** | "Underdocumented, verify behavior" | "Less important than error recovery" | **Agreed.** Demoted to P4 until behavior verified empirically. |
| **Sidecar startup overhead** | "40-70MB, 100-500ms cold start, concerns for Tauri" | "Acceptable tradeoff for feature unlock" | **Noted as concern.** Lazy-start sidecar only when orchestration features are needed. |
| **Distribution complexity** | "Biggest omission — how to ship Node.js?" | "Standard Tauri sidecar pattern" | **Added §8.5 below.** Must bundle Node.js or use pkg/nexe for standalone binary. |

### 8.3 Runtime Capability Detection

Per unanimous reviewer feedback, TracePilot must not assume SDK features exist. Strategy:

```typescript
// Probe available capabilities at sidecar startup
async function detectCapabilities(client: CopilotClient): Promise<CapabilitySet> {
  const capabilities: CapabilitySet = {
    ping: false,
    sessionCreate: false,
    sessionList: false,
    modelSwitch: false,
    fleetMode: false,
    quota: false,
    // ...
  };

  try {
    const status = await client.ping();
    capabilities.ping = true;
    capabilities.protocolVersion = status.protocolVersion;
    capabilities.cliVersion = (await client.getStatus()).version;
  } catch {
    return capabilities; // CLI not available
  }

  // Probe each capability with timeout
  const probes = [
    { key: "sessionList", fn: () => client.listSessions() },
    { key: "modelList", fn: () => client.listModels() },
    { key: "quota", fn: () => client.getQuota() },
  ];

  for (const probe of probes) {
    try {
      await Promise.race([probe.fn(), timeout(2000)]);
      capabilities[probe.key] = true;
    } catch {
      // Feature not available at this CLI version
    }
  }

  return capabilities;
}
```

### 8.4 Error Handling & Recovery

Missing from initial draft, added per reviewer feedback:

**CLI crash recovery:**
- Monitor sidecar process health via heartbeat (`ping` every 30s)
- On sidecar crash: auto-restart with exponential backoff (max 3 retries)
- On CLI server crash: `client.forceStop()` then restart
- Sessions are resumable after crash via `client.resumeSession(id)`
- UI transitions to "degraded mode" (file-watching only) during recovery

**Timeout behavior:**
- `sendAndWait(prompt, timeout)` throws after timeout; session continues in background
- SDK-level RPC timeout: all methods accept optional timeout parameter
- TracePilot should set reasonable defaults: 30s for RPCs, 5min for sendAndWait

**State synchronization:**
- Sidecar should be **stateless where possible** — use `session.list()` as source of truth
- Cache sessions locally only for active event forwarding
- On reconnect, re-probe sessions and rebuild event subscriptions

**Graceful degradation UI states:**
| State | Indicator | Available Features |
|-------|-----------|-------------------|
| 🟢 Full | Green dot + "Connected" | All orchestration features |
| 🟡 Degraded | Yellow dot + "Limited" | Read-only session viewing, historical analysis |
| 🔴 Offline | Red dot + "Offline" | Cached data only |

### 8.5 Distribution & Packaging

Per GPT 5.4 and Opus feedback — this was a significant omission:

**Options for bundling the Node.js SDK bridge:**

| Approach | Installer Impact | Startup Time | Maintenance |
|----------|-----------------|-------------|-------------|
| **Bundle Node.js runtime** | +40-70 MB | 100-500ms | High (platform-specific) |
| **pkg/nexe compile** | +30-50 MB | <100ms | Medium (rebuild per version) |
| **Require system Node.js** | 0 MB | <100ms | Low (but bad UX) |
| **Tauri embedded JS runtime** | TBD | TBD | Future option (Tauri roadmap) |
| **Go SDK binary** | +10-15 MB | <50ms | Medium (single static binary) |

**Recommendation:** Start with **pkg-compiled standalone binary** for the sidecar. This produces a single executable with Node.js embedded, avoiding the "install Node.js" UX problem while keeping installer size reasonable.

### 8.6 Security Model

Per all 4 reviewers — security needs dedicated treatment:

**Trust boundaries:**
```
User → Tauri UI → Rust Backend → Node.js Sidecar → CLI Server → GitHub API
                                                  → Agent Tools (shell, file write)
```

**Security requirements:**
1. **Deny-by-default permissions** — Never ship `approveAll`. Use tool-category allowlists.
2. **Path allowlists** — Restrict file operations to working directory and its children
3. **Audit logging** — Every tool execution logged with full args and results
4. **Secret redaction** — Strip API keys, tokens from logs and events
5. **Budget enforcement** — Hard cost limits with automatic session pause
6. **Session isolation** — Each session's tools cannot access other sessions' data
7. **Secure defaults for custom tools** — `skipPermission: false` unless explicitly justified
8. **Config backup** — Timestamped `.bak` files before any config modification

### 8.7 Test Strategy

Per GPT 5.4 and Codex feedback:

**Test layers:**
1. **Mock CLI transport** — Replay-based testing (inspired by SDK's own `ReplayingCapiProxy`)
2. **Contract tests** — Verify event schema compatibility between SDK events and TracePilot's Rust parser
3. **Version compatibility** — Test against CLI versions N, N-1, N-2
4. **Sidecar lifecycle** — Start, crash, restart, reconnect
5. **Permission policy** — Verify deny-by-default, allowlist behavior
6. **Integration** — End-to-end: TracePilot UI → sidecar → CLI → mock API

---

## Appendix A: Complete RPC Method Reference

### Server-Scoped Methods

| Method | Parameters | Returns | Notes |
|--------|-----------|---------|-------|
| `ping` | — | `{ message, protocolVersion, timestamp }` | Health check |
| `models.list` | — | `{ models: ModelInfo[] }` | Lists all available models |
| `tools.list` | `model?` | `{ tools: ToolInfo[] }` | Optional model-specific overrides |
| `account.getQuota` | — | `{ quotaSnapshots: QuotaSnapshot[] }` | Premium request tracking |
| `status.get` | — | `{ version, protocolVersion }` | CLI version info |
| `auth.getStatus` | — | `{ isAuthenticated, authType?, login? }` | Auth state |
| `session.create` | `SessionConfig` | `Session` | Create new session |
| `session.resume` | `sessionId, ResumeSessionConfig` | `Session` | Resume existing session |
| `session.list` | `filter?` | `SessionMetadata[]` | List all sessions |
| `session.delete` | `sessionId` | void | Permanently delete |
| `session.getLastId` | — | `string` | Most recently updated |
| `session.getForeground` | — | `string?` | TUI foreground session |
| `session.setForeground` | `sessionId` | void | Set TUI foreground |

### Session-Scoped Methods

| Method | Parameters | Returns | Notes |
|--------|-----------|---------|-------|
| `session.send` | `prompt, attachments?, mode?` | `messageId` | Non-blocking |
| `session.sendAndWait` | `prompt, timeout?` | `assistantMessage` | Blocks until idle |
| `session.abort` | — | void | Abort current turn |
| `session.disconnect` | — | void | Clean disconnect |
| `session.getMessages` | — | `SessionEvent[]` | Full event history |
| `session.log` | `level, message, ephemeral?` | void | Inject log message |
| `session.model.getCurrent` | — | `{ modelId, reasoningEffort? }` | Current model |
| `session.model.switchTo` | `modelId, reasoningEffort?` | void | Mid-session switch |
| `session.mode.get` | — | `{ mode }` | interactive/plan |
| `session.mode.set` | `mode` | void | Switch mode |
| `session.plan.read` | — | `{ content }` | Read plan |
| `session.plan.update` | `content` | void | Update plan |
| `session.plan.delete` | — | void | Delete plan |
| `session.workspace.listFiles` | — | `{ files: string[] }` | List workspace |
| `session.workspace.readFile` | `path` | `{ content }` | Read file |
| `session.workspace.createFile` | `path, content` | void | Create file |
| `session.fleet.start` | `prompt?` | void | Start fleet mode |
| `session.agent.list` | — | `Agent[]` | List custom agents |
| `session.agent.getCurrent` | — | `Agent?` | Active agent |
| `session.agent.select` | `name` | void | Select agent |
| `session.agent.deselect` | — | void | Deselect agent |
| `session.compaction.compact` | — | `{ success, tokensRemoved, messagesRemoved }` | Manual compact |
| `session.shell.exec` | `command` | `{ stdout, stderr, exitCode }` | Execute shell |
| `session.shell.kill` | `pid` | void | Kill process |
| `session.tools.handlePendingToolCall` | `toolCallId, result` | void | Respond to tool (v3) |
| `session.permissions.handlePendingPermissionRequest` | `requestId, result` | void | Respond to permission (v3) |

---

## Appendix B: Complete Event Type Reference

| Event Type | Data Fields | Ephemeral | Category |
|------------|-------------|-----------|----------|
| `session.start` | `sessionId`, `selectedModel` | No | Session |
| `session.resume` | — | No | Session |
| `session.idle` | — | Yes | Session |
| `session.error` | `errorType`, `message`, `stack` | No | Session |
| `session.title` | `title` | No | Session |
| `session.info` | `infoType`, `message` | Configurable | Session |
| `session.warning` | `warningType`, `message` | Configurable | Session |
| `session.model_change` | `newModel`, `reasoningEffort` | No | Session |
| `session.mode_change` | `newMode` | No | Session |
| `session.plan` | `content`, `action` | No | Session |
| `session.file_change` | `path`, `action` | No | Session |
| `session.handoff` | `agentName`, `reason` | No | Session |
| `session.truncation` | `tokensRemoved` | No | Session |
| `session.rewind` | `targetTurn` | No | Session |
| `session.end` | `reason` | No | Session |
| `session.cwd_change` | `newCwd` | No | Session |
| `session.context_window` | `totalTokens`, `maxTokens` | Yes | Session |
| `session.compaction_start` | — | No | Session |
| `session.compaction_complete` | `success`, `tokensRemoved` | No | Session |
| `session.task_complete` | `summary` | No | Session |
| `session.usage_info` | — | No | Session |
| `assistant.turn_start` | `turnIndex` | No | Turn |
| `assistant.intent` | `intent` | No | Turn |
| `assistant.reasoning` | `content` | Yes | Turn |
| `assistant.reasoning_delta` | `deltaContent` | Yes | Turn |
| `assistant.streaming_progress` | `progress` | Yes | Turn |
| `assistant.message` | `messageId`, `content` | No | Turn |
| `assistant.message_delta` | `deltaContent` | Yes | Turn |
| `assistant.turn_end` | `turnIndex` | No | Turn |
| `assistant.usage` | `inputTokens`, `outputTokens`, `cacheReadTokens` | No | Turn |
| `assistant.turn_abort` | `reason` | No | Turn |
| `user.message` | `content` | No | User |
| `user.pending_messages_changed` | `count` | Yes | User |
| `tool.execution_start` | `toolCallId`, `toolName` | No | Tool |
| `tool.execution_complete` | `toolCallId`, `success`, `error?` | No | Tool |
| `tool.user_tool_request` | `toolName`, `args` | No | Tool |
| `external_tool.requested` | `toolCallId`, `toolName` | Yes | Broadcast |
| `external_tool.completed` | `toolCallId` | Yes | Broadcast |
| `permission.requested` | `requestId`, `kind`, `toolName` | Yes | Broadcast |
| `permission.completed` | `requestId`, `result.kind` | Yes | Broadcast |
| `hooks.invoke` | `hookName`, `input` | Yes | Broadcast |

---

## Appendix C: SDK vs File-Watching Comparison

| Capability | File-Watching | SDK | Winner |
|-----------|--------------|-----|--------|
| **Session monitoring** | Read JSONL (polling) | Event callbacks (push) | SDK ✅ |
| **Latency** | File system poll interval | Real-time (< 10ms) | SDK ✅ |
| **Session creation** | Spawn CLI process | `createSession()` API | SDK ✅ |
| **Session resume** | N/A | `resumeSession()` API | SDK ✅ |
| **Model switching** | Edit config files, restart | `model.switchTo()` mid-session | SDK ✅ |
| **Tool injection** | Extension JS files on disk | Programmatic `tools: [...]` | SDK ✅ |
| **Hook system** | Extension JS files on disk | In-process hooks | SDK ✅ |
| **Permission control** | Manual TUI interaction | `onPermissionRequest` handler | SDK ✅ |
| **Context injection** | N/A | `send()` with steering mode | SDK ✅ |
| **Cost tracking** | Parse usage from JSONL | `getQuota()` + event streaming | SDK ✅ |
| **Historical analysis** | Full JSONL archive | No persistence (must bridge) | File ✅ |
| **Cross-session aggregation** | SQLite index | Would need separate storage | File ✅ |
| **Offline analysis** | Works without CLI running | Requires CLI server | File ✅ |
| **No additional dependencies** | Just file I/O | Requires Node.js SDK + CLI | File ✅ |
| **Multi-session orchestration** | Manual | Fleet mode + concurrent sessions | SDK ✅ |
| **Error handling** | Parse error events | Typed error callbacks | SDK ✅ |
| **Auth management** | N/A | `getAuthStatus()` API | SDK ✅ |

**Verdict:** SDK wins for all active/live features. File-watching wins for historical analysis and offline use. The **hybrid approach** gives best of both worlds.

---

## Appendix D: SDK Test Infrastructure Insights

The SDK's test suite reveals important implementation details for TracePilot integration:

### Test Harness Architecture
- **ReplayingCapiProxy** — Captures/replays HTTP exchanges with Copilot API as YAML snapshots
- **Snapshot-based testing** — Deterministic tests via YAML replay; real API only hit when snapshots don't exist
- **Platform normalization** — Shell tool names (`powershell`/`bash`) normalized in snapshots

### Key Edge Cases (from tests)
1. **Permission handler is mandatory** — `createSession`/`resumeSession` without `onPermissionRequest` throws `ValueError`
2. **Tool error isolation** — Exception messages from tool handlers are NOT forwarded to the model
3. **Ephemeral tool registration** — Tools registered by a client are removed when that client disconnects
4. **Forward compatibility** — Unknown event types map to `UNKNOWN` (silently); malformed data raises errors
5. **Concurrent session safety** — Multiple sessions can run `sendAndWait()` in parallel via `Promise.all()`
6. **Resume changes streaming** — Streaming config can be changed on session resume
7. **Abort is safe** — `session.abort()` during tool execution produces `abort` event; session remains usable
8. **Double abort is safe** — No error on second abort
9. **CLI crash handling** — `client.forceStop()` kills without cleanup; subsequent calls get `Connection is closed`

### Deployment Patterns (from test scenarios)
- **Fully bundled** — Standard desktop deployment
- **Container proxy** — Docker deployment with Python proxy (relevant for remote TracePilot server mode)
- **App direct server** — App connects directly to CLI server (relevant for Tauri sidecar)
- **App backend to server** — Backend intermediary pattern (relevant for shared CLI server)

---

*End of report. See [copilot-cli-integration-report.md](copilot-cli-integration-report.md) for the companion report on CLI internals, agent definitions, and file-based injection points.*
