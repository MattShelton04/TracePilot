# Copilot CLI Integration & Session Orchestration — Research Report

> **TracePilot v0.2.0** | Report generated: 2026-03-19
> 
> This report details the inner workings of GitHub Copilot CLI, identifies all injection/modification points, and proposes features that would transform TracePilot from a passive session viewer into an active Copilot session orchestrator.
>
> **Multi-model review completed**: Claude Opus 4.6, GPT 5.4, GPT 5.3 Codex, Gemini 3 Pro. See [Part 6](#part-6-consolidated-review-feedback--revised-recommendations) for consolidated feedback.

---

## Table of Contents

- [Executive Summary & Key Ideas](#executive-summary--key-ideas)
- [Part 1: Copilot CLI Architecture Deep Dive](#part-1-copilot-cli-architecture-deep-dive)
  - [1.1 Installation & Package Structure](#11-installation--package-structure)
  - [1.2 Version Management & Auto-Update](#12-version-management--auto-update)
  - [1.3 Session Lifecycle](#13-session-lifecycle)
  - [1.4 Agent Definitions & Model Configuration](#14-agent-definitions--model-configuration)
  - [1.5 Extension System](#15-extension-system)
  - [1.6 Skills System](#16-skills-system)
  - [1.7 The Copilot SDK (Programmatic API)](#17-the-copilot-sdk-programmatic-api)
  - [1.8 Configuration Files](#18-configuration-files)
  - [1.9 Environment Variables](#19-environment-variables)
  - [1.10 Schemas & API Surface](#110-schemas--api-surface)
- [Part 2: Injection Points & Modification Catalogue](#part-2-injection-points--modification-catalogue)
  - [2.1 Agent Definition Injection (YAML)](#21-agent-definition-injection-yaml)
  - [2.2 Config.json Injection](#22-configjson-injection)
  - [2.3 Extension-Based Injection (Runtime)](#23-extension-based-injection-runtime)
  - [2.4 Skill Injection](#24-skill-injection)
  - [2.5 MCP Server Injection](#25-mcp-server-injection)
  - [2.6 Environment Variable Injection](#26-environment-variable-injection)
  - [2.7 Custom Instructions Injection](#27-custom-instructions-injection)
  - [2.8 Live Session Event Injection](#28-live-session-event-injection)
- [Part 3: Feature Proposals](#part-3-feature-proposals)
  - [3.1 Session Launcher — One-Click Session Spawning](#31-session-launcher--one-click-session-spawning)
  - [3.2 Multi-Session Dashboard — Real-Time Monitoring](#32-multi-session-dashboard--real-time-monitoring)
  - [3.3 Git Worktree Integration — Zero-Copy Parallel Sessions](#33-git-worktree-integration--zero-copy-parallel-sessions)
  - [3.4 Configuration Injector Page](#34-configuration-injector-page)
  - [3.5 Extension Manager](#35-extension-manager)
  - [3.6 Live Session Interaction](#36-live-session-interaction)
  - [3.7 Session Templates & Presets](#37-session-templates--presets)
  - [3.8 Batch Operations & Automation](#38-batch-operations--automation)
  - [3.9 Session Forking & Branching](#39-session-forking--branching)
  - [3.10 Health-Based Auto-Intervention](#310-health-based-auto-intervention)
  - [3.11 Cost Governor & Budget Controls](#311-cost-governor--budget-controls)
  - [3.12 Cross-Session Knowledge Sharing](#312-cross-session-knowledge-sharing)
  - [3.13 Session Recipes & Playbooks](#313-session-recipes--playbooks)
  - [3.14 Git Integration Hub](#314-git-integration-hub)
  - [3.15 Plugin Marketplace Browser](#315-plugin-marketplace-browser)
- [Part 4: Integration with Existing TracePilot](#part-4-integration-with-existing-tracepilot)
- [Part 5: Implementation Priority & Roadmap](#part-5-implementation-priority--roadmap)
- [Part 6: Consolidated Review Feedback & Revised Recommendations](#part-6-consolidated-review-feedback--revised-recommendations)
  - [6.1 Consensus Findings](#61-consensus-findings-all-4-reviewers-agree)
  - [6.2 Revised Feasibility Ratings](#62-revised-feasibility-ratings)
  - [6.3 Revised Implementation Roadmap](#63-revised-implementation-roadmap)
  - [6.4 New Ideas from Reviewers](#64-new-ideas-from-reviewers)
  - [6.5 Security Model](#65-critical-additions-to-the-security-model)
  - [6.6 Revised Top 10 Features](#66-revised-top-10-features-post-review)

---

## Executive Summary & Key Ideas

### 🏆 Top 10 Most Impactful Ideas (Revised Post-Review)

> Reviewed by Claude Opus 4.6, GPT 5.4, GPT 5.3 Codex, and Gemini 3 Pro. See [Part 6](#part-6-consolidated-review-feedback--revised-recommendations) for full analysis.

| # | Feature | Priority | Feasibility | Why It's Exciting |
|---|---------|----------|-------------|-------------------|
| 1 | **Configuration Injector** | 🔴 Tier 1 | ✅ Easy | Modify agent models, prompts, reasoning effort, and config.json from a GUI with diff preview + backup. Upgrade explore agents to Opus 4.6 with one click. |
| 2 | **Git Worktree Integration** | 🔴 Tier 1 | 🟡 Easy-Med | Create git worktrees for isolated parallel sessions. Zero-copy repo clones. All reviewers rate this as the killer feature. |
| 3 | **Session Launcher (CLI-spawn)** | 🔴 Tier 1 | 🟡 Easy-Med | Spawn new Copilot CLI sessions from TracePilot with pre-configured settings. "Dry run" preview of exact command. One-click session creation. |
| 4 | **Active Session Discovery** | 🔴 Tier 1 | ✅ Easy | Poll `inuse.*.lock` + `workspace.yaml` for real-time session status. Foundation for mission control dashboard. |
| 5 | **Session Templates** | 🟠 Tier 2 | ✅ Easy | Save/load session configurations as reusable presets. "Bug Fix" template, "Feature Build" template, etc. |
| 6 | **Multi-Session Dashboard** | 🟠 Tier 2 | 🟡 Medium | Lock-file polling + events.jsonl tail. "Mission control" for all active sessions. No sidecar needed. |
| 7 | **Extension Manager** | 🟠 Tier 2 | 🟡 Easy-Med | Create, deploy, validate, and manage extensions. Template library for common patterns (auto-lint, context injection). |
| 8 | **Cost Tracking + Budgets** | 🟠 Tier 2 | ✅ Easy | Budget display from existing analytics + quota API. Emotional safety net enables experimentation. |
| 9 | **A/B Testing Arena** | 🟡 Tier 3-4 | 🔴 Hard | Run same task with multiple models/prompts in parallel worktrees. Compare outcomes side by side. Novel differentiator. |
| 10 | **Batch Operations** | 🟡 Tier 3-4 | 🔴 Hard | Fleet management: run tasks across repos simultaneously. Combines launcher + worktrees + monitoring. |

### Key Technical Discoveries

1. **The Copilot SDK (`@github/copilot/sdk`) is a full programmatic API** — TracePilot can spawn, resume, and control sessions programmatically via `CopilotClient`.
2. **Agent definition YAML files are directly editable** — Change the model for `explore`, `task`, `code-review`, `research`, `configure-copilot` agents. Currently explore uses Haiku 4.5 but can be upgraded to Opus 4.6 by editing one line.
3. **The Extension System provides runtime injection** — Custom tools, hooks (onPreToolUse, onPostToolUse, onSessionStart, etc.), and event listeners can be injected without modifying core files.
4. **`COPILOT_AUTO_UPDATE=false` prevents overwriting** — Agent definition changes persist when auto-update is disabled.
5. **ACP mode (`copilot --acp`) enables server-mode control** — Copilot can run as a background server that TracePilot connects to programmatically.
6. **config.json controls global defaults** — Model, reasoning effort, trusted folders, and other settings are all modifiable.

---

## Part 1: Copilot CLI Architecture Deep Dive

### 1.1 Installation & Package Structure

Copilot CLI is installed at `~/.copilot/` with the following structure:

```
~/.copilot/
├── config.json                  ← Global user configuration
├── command-history-state.json   ← CLI prompt history (37 KB)
├── ide/                         ← IDE connection lock files (named pipes)
├── logs/                        ← Process logs (~162 files)
├── pkg/                         ← Package installations
│   ├── universal/               ← Cross-platform packages
│   │   ├── 0.0.410/ ... 1.0.7/  ← Historical versions
│   │   └── 1.0.8/              ← ★ CURRENT active version
│   └── win32-x64/              ← Legacy platform-specific
├── restart/                     ← Restart coordination signals
├── session-state/               ← 135 sessions (~655 MB)
├── skills/                      ← Skill definitions (e.g., playwright-cli)
└── tracepilot/                  ← TracePilot's own data
```

The active package (1.0.8) at `pkg/universal/1.0.8/` contains:

| Component | Size | Purpose |
|-----------|------|---------|
| `app.js` | 16.7 MB | Main bundled application |
| `index.js` | 4.7 KB | Loader/bootstrap script |
| `definitions/` | — | Agent YAML definitions (5 agents) |
| `copilot-sdk/` | — | Extension SDK with docs |
| `sdk/` | ~14 MB | Full SDK (client + session + types) |
| `schemas/` | ~336 KB | API + session-events JSON schemas |
| `prebuilds/` | — | Native binaries (pty, keytar, conpty) |
| `ripgrep/` | ~5.4 MB | Bundled ripgrep binaries |
| `tree-sitter*.wasm` | — | 18 WASM tree-sitter parsers |
| `changelog.json` | 259 KB | Full version history |

### 1.2 Version Management & Auto-Update

The loader (`index.js`) resolves the active version:
1. Scans multiple `pkg/` directories for versions with `app.js`
2. Sorts by semver descending
3. Imports the **newest** version

**Auto-update** is enabled by default. When Copilot detects a new version:
- Downloads to `pkg/tmp/`
- Extracts to `pkg/universal/{version}/`
- Creates `.extraction-complete` marker
- Restarts loader to pick up new version

**Disabling auto-update**: Set `COPILOT_AUTO_UPDATE=false` or use `--no-auto-update` flag. This is critical for persisting injected changes.

### 1.3 Session Lifecycle

```
Session Creation → events.jsonl created → workspace.yaml written
     ↓
Active Session → inuse.{PID}.lock held → events appended
     ↓
Context Compaction → checkpoint created → history summarized
     ↓
Session End → session.shutdown event → lock released
```

**Per-session directory** (`~/.copilot/session-state/{UUID}/`):

| File | Always Present | Purpose |
|------|----------------|---------|
| `events.jsonl` | ✅ | Main event log (all messages, tool calls) |
| `workspace.yaml` | ✅ | Session metadata (cwd, repo, branch, timestamps) |
| `vscode.metadata.json` | ✅ | IDE metadata (usually `{}`) |
| `checkpoints/` | ✅ | Compaction checkpoints with summaries |
| `files/` | ✅ | Agent-generated artifacts |
| `research/` | ✅ | Research output (currently unused) |
| `rewind-snapshots/` | ✅ | File state snapshots per user message |
| `session.db` | 57% | SQLite todos/tasks database |
| `plan.md` | 42% | Agent working plan |
| `inuse.{PID}.lock` | Active only | PID lock for session ownership |

**Key metrics across 135 sessions**:
- Total data: **655 MB** (96.7% is events.jsonl)
- Events per session: **379–2,544**
- 18 distinct event types observed
- 4 sessions currently active (locked)

### 1.4 Agent Definitions & Model Configuration

The 5 built-in agents are defined in `pkg/universal/1.0.8/definitions/`:

| Agent | File | Current Model | Purpose |
|-------|------|---------------|---------|
| **explore** | `explore.agent.yaml` | `claude-haiku-4.5` | Fast codebase search (read-only) |
| **task** | `task.agent.yaml` | `claude-haiku-4.5` | Build/test/lint execution |
| **code-review** | `code-review.agent.yaml` | `claude-sonnet-4.5` | High-signal code review |
| **research** | `research.agent.yaml` | `claude-sonnet-4.6` | Deep investigation with GitHub tools |
| **configure-copilot** | `configure-copilot.agent.yaml` | `claude-haiku-4.5` | MCP server management |

**YAML structure** (using explore as example):
```yaml
name: explore
displayName: Explore Agent
description: >
  Fast codebase exploration and answering questions...
model: claude-haiku-4.5              # ★ THE KEY FIELD TO MODIFY
tools:
  - grep
  - glob
  - view
  - bash
  # ... 50+ tools including GitHub MCP, Bluebird code intelligence
promptParts:
  includeAISafety: true
  includeToolInstructions: true
  includeParallelToolCalling: true
  includeCustomAgentInstructions: false
  includeEnvironmentContext: false
prompt: |
  You are an exploration agent specialized in rapid codebase analysis...
  {{cwd}} template variables are resolved at runtime.
```

### 1.5 Extension System

Extensions are the **officially supported** way to add custom behavior:

```
┌─────────────────────┐    JSON-RPC / stdio    ┌──────────────────────┐
│   Copilot CLI        │ ◄────────────────────► │  Extension Process   │
│   (parent process)   │                        │  (forked child)      │
└─────────────────────┘                        └──────────────────────┘
```

**Discovery locations**:
- Project: `.github/extensions/{name}/extension.mjs`
- User-global: `~/.copilot/extensions/{name}/extension.mjs` (via `extensions_manage` tool)

**Available hooks**:

| Hook | Fires When | Can Modify |
|------|-----------|------------|
| `onUserPromptSubmitted` | User sends message | Prompt text, add context |
| `onPreToolUse` | Before tool executes | Args, permission (allow/deny/ask), add context |
| `onPostToolUse` | After tool executes | Result, add context |
| `onSessionStart` | Session starts/resumes | Add initial context |
| `onSessionEnd` | Session ends | Cleanup, summary |
| `onErrorOccurred` | Error occurs | Retry/skip/abort strategy |

**Session object methods**:
- `session.send({ prompt, attachments })` — Send messages programmatically
- `session.sendAndWait({ prompt }, timeout)` — Send and block until response
- `session.log(message, { level, ephemeral })` — Log to timeline
- `session.on(eventType, handler)` — Subscribe to events
- `session.workspacePath` — Session workspace directory
- `session.rpc` — Full RPC access to all session APIs

### 1.6 Skills System

Skills are custom capabilities at `~/.copilot/skills/{name}/`:
```
skills/{name}/
├── SKILL.md              ← YAML frontmatter + description
└── references/           ← Supporting documentation
```

Currently installed: `playwright-cli` (7.7 KB SKILL.md + 7 reference docs).

Skills are discovered automatically and presented to the agent as available capabilities.

### 1.7 The Copilot SDK (Programmatic API)

This is the **most powerful integration point**. Located at `pkg/universal/1.0.8/sdk/`:

```typescript
import { CopilotClient, approveAll } from "@github/copilot/sdk";

// Spawn or connect to Copilot CLI
const client = new CopilotClient({
  cwd: "/path/to/repo",         // Working directory
  logLevel: "info",             // Logging
  // cliUrl: "localhost:3000",  // OR connect to existing server
});

// Create a new session
const session = await client.createSession({
  model: "claude-opus-4.6",
  reasoningEffort: "high",
  workingDirectory: "/path/to/repo",
  onPermissionRequest: approveAll,
  tools: [/* custom tools */],
  hooks: { onSessionStart: async () => ({ additionalContext: "..." }) },
  customAgents: [/* agent configs */],
  mcpServers: { /* server configs */ },
  systemMessage: { mode: "append", content: "Extra instructions..." },
});

// Send messages
const response = await session.sendAndWait({ prompt: "Fix all tests" });

// Subscribe to events
session.on("assistant.message", (event) => {
  console.log(event.data.content);
});

// Resume existing sessions
const resumed = await client.resumeSession("uuid", { onPermissionRequest: approveAll });

// List/manage sessions
const sessions = await client.listSessions({ repository: "owner/repo" });
await client.deleteSession("uuid");
```

**Key `SessionConfig` options**:
- `model` — Session model
- `reasoningEffort` — "low" | "medium" | "high" | "xhigh"
- `workingDirectory` — Session CWD
- `tools` — Custom tools array
- `hooks` — Lifecycle hooks
- `systemMessage` — Append or replace system prompt
- `availableTools` / `excludedTools` — Tool filtering
- `customAgents` — Custom agent definitions
- `mcpServers` — MCP server configs
- `skillDirectories` / `disabledSkills` — Skill management
- `infiniteSessions` — Compaction thresholds
- `provider` — BYOK (Bring Your Own Key) for custom API endpoints

**`CopilotClient` capabilities**:
- `createSession(config)` → `CopilotSession`
- `resumeSession(id, config)` → `CopilotSession`
- `listSessions(filter?)` → `SessionMetadata[]`
- `getLastSessionId()` → `string`
- `deleteSession(id)` → `void`
- `listModels()` → `ModelInfo[]`
- `ping()` → health check
- `getStatus()` → version/protocol info
- `getAuthStatus()` → auth info
- `getForegroundSessionId()` / `setForegroundSessionId()` — TUI control
- `on(handler)` — Session lifecycle events

### 1.8 Configuration Files

**`~/.copilot/config.json`** — Master user config:
```json
{
  "banner": "never",
  "trusted_folders": ["C:\\git"],
  "last_logged_in_user": { "host": "https://github.com", "login": "MattShelton04" },
  "logged_in_users": [{ "host": "https://github.com", "login": "MattShelton04" }],
  "show_reasoning": true,
  "render_markdown": true,
  "asked_setup_terminals": ["windows-terminal"],
  "firstLaunchAt": "2026-03-11T00:00:00.000Z",
  "model": "claude-opus-4.6",
  "reasoning_effort": "high"
}
```

**`~/.copilot/tracepilot/config.toml`** — TracePilot config:
```toml
version = 1
[paths]
sessionStateDir = 'C:\Users\mattt\.copilot\session-state'
indexDbPath = 'C:\Users\mattt\.copilot\tracepilot\index.db'
[general]
autoIndexOnLaunch = true
```

### 1.9 Environment Variables

| Variable | Effect | Injection Potential |
|----------|--------|-------------------|
| `COPILOT_MODEL` | Override default model | 🟢 High — set per-session |
| `COPILOT_AUTO_UPDATE` | `false` disables updates | 🟢 High — preserve injected changes |
| `COPILOT_ALLOW_ALL` | Auto-approve all tools | 🟡 Medium — for automation |
| `COPILOT_HOME` | Override `~/.copilot` dir | 🟡 Medium — for isolation |
| `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` | Additional instruction dirs | 🟢 High — inject context |
| `COPILOT_EDITOR` | Editor for plan editing | 🟡 Low — cosmetic |
| `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` | Auth token override | 🟢 High — for multi-account |
| `GH_HOST` | GitHub Enterprise host | 🟡 Medium — enterprise |
| `USE_BUILTIN_RIPGREP` | Use system ripgrep | 🟢 Low — minor |
| `COPILOT_SDK_PATH` | Points to bundled SDK | 🟡 Medium — SDK override |

### 1.10 Schemas & API Surface

**`schemas/api.schema.json`** (52 KB) — Full JSON-RPC API:
- `ping` — Health check
- `models.list` — Available models with capabilities
- `tools.list` — Available tools
- `account.getQuota` — Premium request quota
- `session.model.getCurrent` / `session.model.switchTo` — Model management

**`schemas/session-events.schema.json`** (284 KB) — All event types with full data schemas.

**Available models** (as of 1.0.8):
`claude-opus-4.6`, `claude-opus-4.6-fast`, `claude-opus-4.5`, `claude-sonnet-4.6`, `claude-sonnet-4.5`, `claude-sonnet-4`, `claude-haiku-4.5`, `gemini-3-pro-preview`, `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.2`, `gpt-5.1-codex-max`, `gpt-5.1-codex`, `gpt-5.1`, `gpt-5.4-mini`, `gpt-5.1-codex-mini`, `gpt-5-mini`, `gpt-4.1`

---

## Part 2: Injection Points & Modification Catalogue

### 2.1 Agent Definition Injection (YAML)

**Location**: `~/.copilot/pkg/universal/{version}/definitions/*.agent.yaml`

**What can be modified**:
- `model` — Change which LLM powers each subagent
- `tools` — Add/remove available tools
- `prompt` — Modify or extend system prompts
- `promptParts` — Toggle prompt features

**Example — Upgrade explore to Opus 4.6**:
```yaml
# In explore.agent.yaml, line 7:
# Before:
model: claude-haiku-4.5
# After:
model: claude-opus-4.6
```

**Persistence**: Survives restarts but **overwritten on CLI update**. Use `COPILOT_AUTO_UPDATE=false` to protect.

**Risk**: Low. Copilot reads these at startup. Invalid YAML will cause the agent to fail gracefully.

**TracePilot integration**: Build a GUI editor that reads/writes these YAML files with validation and backup/restore.

### 2.2 Config.json Injection

**Location**: `~/.copilot/config.json`

**Modifiable fields**:

| Field | Type | Effect |
|-------|------|--------|
| `model` | string | Default conversation model |
| `reasoning_effort` | string | "low" / "medium" / "high" |
| `show_reasoning` | boolean | Display reasoning blocks |
| `render_markdown` | boolean | Render markdown in terminal |
| `trusted_folders` | string[] | Auto-trust directories |
| `banner` | string | Banner display preference |

**TracePilot integration**: Read and write this file from a Settings page. Changes take effect on next session start.

### 2.3 Extension-Based Injection (Runtime)

**Location**: `.github/extensions/{name}/extension.mjs` (per-project) or user-level

This is the **most powerful runtime injection mechanism**:

**What can be injected**:
1. **Custom tools** — Add tools the agent can call
2. **Prompt modification** — Rewrite/augment user prompts via `onUserPromptSubmitted`
3. **Context injection** — Add hidden context to every message via `additionalContext`
4. **Tool interception** — Block, modify args, or modify results via `onPreToolUse`/`onPostToolUse`
5. **Error handling** — Custom retry logic via `onErrorOccurred`
6. **Event monitoring** — Subscribe to all session events in real-time
7. **Programmatic messages** — Send messages to the session via `session.send()`
8. **Permission control** — Auto-approve or deny tool execution

**Example — TracePilot monitoring extension**:
```javascript
import { joinSession } from "@github/copilot-sdk/extension";

const session = await joinSession({
  hooks: {
    onSessionStart: async (input) => {
      // Notify TracePilot that a session started
      await fetch("http://localhost:TRACEPILOT_PORT/api/session-started", {
        method: "POST",
        body: JSON.stringify({ source: input.source, cwd: input.cwd })
      });
      return { additionalContext: "TracePilot is monitoring this session." };
    },
    onPreToolUse: async (input) => {
      // Log tool usage to TracePilot in real-time
      await fetch("http://localhost:TRACEPILOT_PORT/api/tool-used", {
        method: "POST",
        body: JSON.stringify({ tool: input.toolName, args: input.toolArgs })
      });
    },
  },
  tools: [],
});

// Stream all events to TracePilot
session.on((event) => {
  fetch("http://localhost:TRACEPILOT_PORT/api/event", {
    method: "POST",
    body: JSON.stringify(event)
  }).catch(() => {});
});
```

### 2.4 Skill Injection

**Location**: `~/.copilot/skills/{name}/SKILL.md`

**What can be injected**: Custom capabilities with YAML frontmatter defining name, description, and allowed tools, plus a markdown body with detailed instructions and reference docs.

**TracePilot integration**: Create a skill editor that generates `SKILL.md` files with proper frontmatter.

### 2.5 MCP Server Injection

**Location**: `~/.copilot/mcp-config.json` (user) or `.mcp.json` / `.vscode/mcp.json` (project)

**What can be injected**: Custom tool servers (local stdio or remote HTTP/SSE).

**TracePilot integration**: MCP server management UI — add/remove/configure servers, test connectivity.

### 2.6 Environment Variable Injection

When spawning sessions via the SDK, env vars can be set per-process:

```typescript
const client = new CopilotClient({
  env: {
    COPILOT_MODEL: "claude-opus-4.6",
    COPILOT_AUTO_UPDATE: "false",
    COPILOT_CUSTOM_INSTRUCTIONS_DIRS: "/path/to/instructions",
  }
});
```

### 2.7 Custom Instructions Injection

**Location**: `.github/copilot-instructions.md` (per-project) or via `COPILOT_CUSTOM_INSTRUCTIONS_DIRS`

Custom instructions are injected into every conversation in the specified repo. This is the simplest form of behavior modification.

### 2.8 Live Session Event Injection

Via the SDK, you can inject events/messages into a **running** session:

```typescript
// Send a message as if the user typed it
await session.send({ prompt: "Also remember to update the tests." });

// Send with file attachments
await session.send({
  prompt: "Review this changed file",
  attachments: [{ type: "file", path: "./src/changed.ts" }]
});

// Log to the session timeline
await session.log("TracePilot: Budget 80% consumed", { level: "warning" });
```

This enables TracePilot to **actively guide** running sessions.

---

## Part 3: Feature Proposals

### 3.1 Session Launcher — One-Click Session Spawning

**Description**: A new view in TracePilot that lets users launch Copilot CLI sessions with pre-configured settings, directly from the desktop app.

**How it works**:
1. TracePilot uses the Copilot SDK to spawn sessions programmatically
2. User selects: repo, branch, model, reasoning effort, initial prompt
3. TracePilot calls `CopilotClient.createSession()` with the configuration
4. The session opens in a new terminal window (or runs headless for automation)

**Implementation approach**:

**Option A — SDK Integration (Recommended)**:
- TracePilot ships with or references the Copilot SDK (`@github/copilot/sdk`)
- A Node.js sidecar process manages SDK interactions
- Tauri spawns the sidecar, which uses `CopilotClient` to create/manage sessions
- Events stream back to the Tauri app via IPC

**Option B — CLI Process Spawning**:
- TracePilot spawns `copilot.exe` with flags: `--model`, `--agent`, `-p "prompt"`, `--allow-all`
- For headless operation: `copilot -p "task" --allow-all --output-format json -s`
- Simpler but less control than SDK

**Option C — ACP Server Mode**:
- Start Copilot in ACP server mode: `copilot --acp`
- TracePilot connects as a client
- Full bidirectional control

**UI mockup**:
```
┌─────────────────────────────────────────┐
│  🚀 Launch New Session                  │
├─────────────────────────────────────────┤
│  Repository: [TracePilot ▾]             │
│  Branch:     [feature/new-feature ▾]    │
│  Model:      [claude-opus-4.6 ▾]       │
│  Reasoning:  [high ▾]                   │
│  Template:   [Bug Fix ▾]               │
│  Prompt:     [Fix failing tests in...] │
│                                         │
│  ☑ Auto-approve all tools               │
│  ☑ Create git worktree                  │
│  ☑ Monitor in real-time                 │
│                                         │
│  [Launch Session] [Launch Headless]     │
└─────────────────────────────────────────┘
```

**What needs updating in TracePilot**:
- New Tauri command: `launch_session` (spawns copilot process or SDK client)
- New Tauri command: `list_running_sessions` (check for inuse.*.lock files)
- New Vue view: `SessionLauncherView.vue`
- New Pinia store: `sessionLauncher` (manages spawned sessions)
- Config: Store last-used settings, favorite configs

### 3.2 Multi-Session Dashboard — Real-Time Monitoring

**Description**: A dashboard showing all active Copilot CLI sessions with real-time status updates, token counters, and the ability to interact with them.

**How it works**:
1. TracePilot discovers active sessions via `inuse.*.lock` files
2. Optionally connects to running sessions via SDK `resumeSession()`
3. Subscribes to events for real-time updates
4. Aggregates status across all sessions

**Dashboard layout**:
```
┌─────────────────────────────────────────────────────────┐
│  📊 Active Sessions (4)                    [Refresh]    │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│ Session  │ Repo     │ Status   │ Tokens   │ Actions     │
├──────────┼──────────┼──────────┼──────────┼─────────────┤
│ #a3f2... │ TracePlt │ 🟢 Working│ 45K/8K  │ [View][Msg] │
│ #b7c1... │ Backend  │ 🟡 Idle  │ 12K/2K  │ [View][Msg] │
│ #d9e4... │ Frontend │ 🔴 Error │ 89K/15K │ [View][Fix] │
│ #f1a8... │ Infra    │ 🟢 Working│ 23K/5K  │ [View][Msg] │
└──────────┴──────────┴──────────┴──────────┴─────────────┘
```

**What needs updating in TracePilot**:
- New Tauri command: `get_active_sessions` (scan for lock files + read workspace.yaml)
- New Tauri command: `connect_to_session` (SDK resume for monitoring)
- New Vue view: `ActiveSessionsDashboardView.vue`
- Tauri events: `session-event` (real-time streaming from SDK to frontend)
- New store: `activeSessions`

### 3.3 Git Worktree Integration — Zero-Copy Parallel Sessions

**Description**: Automatically create git worktrees when launching parallel sessions, so each session works on an isolated copy without conflicts.

**How it works**:
1. User requests new session for repo X on branch Y
2. TracePilot runs `git worktree add ../TracePilot-worktree-{uuid} -b {branch}`
3. Session is launched with `workingDirectory` set to the worktree
4. When session ends, worktree can be cleaned up or merged

**Benefits**:
- **Zero-copy** — worktrees share the `.git` directory (no duplicate clones)
- **Parallel development** — 5 sessions on 5 branches simultaneously
- **Isolation** — no file conflicts between sessions
- **Instant creation** — worktrees are created in milliseconds

**Implementation**:
```typescript
// In Tauri command:
async fn create_worktree(repo_path: &str, branch: &str, session_id: &str) -> Result<String> {
    let worktree_path = format!("{}-worktree-{}", repo_path, &session_id[..8]);
    Command::new("git")
        .args(["worktree", "add", &worktree_path, "-b", branch])
        .current_dir(repo_path)
        .output()?;
    Ok(worktree_path)
}
```

**What needs updating in TracePilot**:
- New Tauri commands: `create_worktree`, `list_worktrees`, `remove_worktree`, `merge_worktree`
- Integration with Session Launcher — checkbox to auto-create worktree
- Worktree management UI in settings or a dedicated view
- Cleanup logic when sessions end

### 3.4 Configuration Injector Page

**Description**: A comprehensive settings page in TracePilot that lets users view and modify all Copilot CLI configuration — agent models, prompts, global config, extension management, and environment variables.

**Sections**:

#### 3.4.1 Agent Model Override
```
┌─────────────────────────────────────────────────┐
│  🤖 Agent Configuration                        │
├─────────────────────────────────────────────────┤
│  Agent          │ Current Model      │ Override │
│  ─────────────  │ ──────────────     │ ──────── │
│  explore        │ claude-haiku-4.5   │ [▾ opus] │
│  task           │ claude-haiku-4.5   │ [▾ ···]  │
│  code-review    │ claude-sonnet-4.5  │ [▾ ···]  │
│  research       │ claude-sonnet-4.6  │ [▾ ···]  │
│  configure-cop. │ claude-haiku-4.5   │ [▾ ···]  │
│                                                  │
│  [Apply Changes] [Reset to Defaults] [Backup]   │
│                                                  │
│  ⚠ Changes overwritten on CLI update.           │
│  ☑ Disable auto-update (COPILOT_AUTO_UPDATE)    │
└─────────────────────────────────────────────────┘
```

#### 3.4.2 Global Configuration Editor
```
┌─────────────────────────────────────────────────┐
│  ⚙ Global Configuration (~/.copilot/config.json)│
├─────────────────────────────────────────────────┤
│  Default Model:     [claude-opus-4.6 ▾]        │
│  Reasoning Effort:  [high ▾]                    │
│  Show Reasoning:    [✓]                         │
│  Render Markdown:   [✓]                         │
│  Trusted Folders:   C:\git [+ Add]              │
│                                                  │
│  [Save] [Reset]                                 │
└─────────────────────────────────────────────────┘
```

#### 3.4.3 Agent Prompt Editor
A code editor (Monaco/CodeMirror) for editing agent system prompts with YAML syntax highlighting and live preview.

#### 3.4.4 Environment Variable Manager
Manage env vars that are set when spawning sessions.

**What needs updating in TracePilot**:
- New Tauri commands: `read_agent_definitions`, `write_agent_definition`, `read_copilot_config`, `write_copilot_config`, `backup_agent_definitions`, `restore_agent_definitions`
- New Vue view: `ConfigInjectorView.vue` (with tabs for each section)
- Type definitions for agent YAML schema
- File watcher for detecting external changes

### 3.5 Extension Manager

**Description**: Create, deploy, and manage Copilot CLI extensions from within TracePilot.

**Features**:
1. **Extension Gallery** — Browse installed extensions (project + user-level)
2. **Template Library** — One-click deploy common extension patterns:
   - Auto-lint after edits
   - Context injection (team standards, coding guidelines)
   - Tool blocking (prevent dangerous commands)
   - Event logging to TracePilot
   - Custom tool addition
3. **Extension Editor** — Write/edit extensions with syntax highlighting
4. **Extension Status** — Show which extensions are loaded/failed/active

**Template examples**:

```javascript
// Template: "Team Standards Injector"
import { joinSession } from "@github/copilot-sdk/extension";
await joinSession({
  hooks: {
    onUserPromptSubmitted: async () => ({
      additionalContext: `
        Follow these team standards:
        - Use TypeScript strict mode
        - Write tests for all new code
        - Use conventional commits
        - Prefer composition over inheritance
      `
    }),
  },
});
```

```javascript
// Template: "TracePilot Real-Time Monitor"  
import { joinSession } from "@github/copilot-sdk/extension";
const session = await joinSession({
  hooks: {
    onPostToolUse: async (input) => {
      // Stream tool results to TracePilot
      await fetch("http://localhost:13742/api/tool-complete", {
        method: "POST",
        body: JSON.stringify({ tool: input.toolName, success: input.toolResult.resultType === "success" })
      }).catch(() => {});
    }
  }
});
session.on((event) => {
  fetch("http://localhost:13742/api/event", { method: "POST", body: JSON.stringify(event) }).catch(() => {});
});
```

**What needs updating in TracePilot**:
- New Tauri commands: `list_extensions`, `create_extension`, `delete_extension`, `read_extension`, `write_extension`
- New Vue view: `ExtensionManagerView.vue`
- Extension template library (JSON/YAML config → `.mjs` generator)

### 3.6 Live Session Interaction

**Description**: Send messages to running sessions, inject context, switch models — all from the TracePilot GUI.

**How it works**:
1. TracePilot connects to a running session via SDK
2. User can type messages in a chat-like interface within TracePilot
3. Messages are sent via `session.send()`
4. Responses stream back in real-time

**Use cases**:
- "Hey, also update the README" — inject additional instructions
- "Switch to opus 4.6" — upgrade model mid-session
- "Stop what you're doing and focus on tests" — redirect priorities
- Inject file context: "Also look at this file" with attachment

**What needs updating in TracePilot**:
- New Tauri commands: `send_message_to_session`, `set_session_model`, `abort_session`
- Enhanced session detail view with "Interact" tab
- Real-time event streaming (Tauri events from SDK → frontend)

### 3.7 Session Templates & Presets

**Description**: Save and load complete session configurations as reusable templates.

**Template structure**:
```json
{
  "name": "Bug Fix Template",
  "description": "Optimized for fixing bugs with thorough testing",
  "model": "claude-opus-4.6",
  "reasoningEffort": "high",
  "systemMessage": {
    "mode": "append",
    "content": "Always write regression tests. Run tests before and after changes."
  },
  "tools": ["grep", "glob", "view", "edit", "bash", "create"],
  "hooks": {
    "onPostToolUse": "auto-lint"
  },
  "extensions": ["auto-lint", "team-standards"],
  "envVars": {
    "COPILOT_ALLOW_ALL": "true"
  }
}
```

**Built-in templates**:
- 🐛 **Bug Fix** — Opus 4.6, high reasoning, auto-test
- 🚀 **Feature Build** — Opus 4.6, high reasoning, plan-first
- 🔍 **Code Review** — Sonnet 4.5, code-review agent, no file writes
- 📝 **Documentation** — Sonnet 4.6, doc-focused instructions
- 🧪 **Test Writing** — Opus 4.6, test-focused instructions
- ⚡ **Quick Fix** — Haiku 4.5, fast turnaround, minimal reasoning
- 🔧 **Tech Debt** — Opus 4.6, refactoring-focused
- 🔄 **Dependency Update** — Opus 4.6, batch-mode ready

**What needs updating in TracePilot**:
- Template storage: `~/.copilot/tracepilot/templates/` directory
- New Tauri commands: `list_templates`, `save_template`, `load_template`, `delete_template`
- Template picker in Session Launcher
- Template editor in settings

### 3.8 Batch Operations & Automation

**Description**: Run the same task across multiple repos/branches simultaneously. The "fleet management" aspect of TracePilot.

**Use cases**:
- Update dependencies across 10 repos
- Apply a security patch to all services
- Run code reviews on all open PRs
- Generate documentation for all packages

**How it works**:
1. User defines a task (prompt + config)
2. Selects target repos/branches
3. TracePilot creates worktrees + sessions for each
4. Sessions run in parallel (headless mode)
5. Results aggregated in a dashboard

**What needs updating in TracePilot**:
- New Vue view: `BatchOperationsView.vue`
- New store: `batchOperations`
- Job queue system (SQLite-backed)
- Progress tracking per-task
- Result aggregation and reporting

### 3.9 Session Forking & Branching

**Description**: Create a new session that inherits the conversation history and context of an existing session, but diverges from a specific point.

**How it works**:
1. User selects a point in an existing session's conversation
2. TracePilot copies events.jsonl up to that point to a new session directory
3. Creates new workspace.yaml with updated metadata
4. Launches new session with `--resume` pointing to the forked state

**Use cases**:
- "Try a different approach from turn 5"
- "Fork this session to also handle the frontend changes"
- A/B testing different approaches to the same problem

### 3.10 Health-Based Auto-Intervention

**Description**: TracePilot already computes health scores. Extend this to automatically intervene when a session's health deteriorates.

**Interventions**:
- **Rate limit approaching**: Pause session, notify user, suggest model downgrade
- **Repeated errors**: Inject debugging context or switch model
- **Stalled session**: Send a nudge message
- **High token usage**: Switch to cheaper model or enable more aggressive compaction

**Implementation**: Extension-based — deploy a TracePilot monitoring extension that watches for health indicators and takes action.

### 3.11 Cost Governor & Budget Controls

**Description**: Set per-session and global budgets for premium requests and token usage.

**Features**:
- **Per-session budget**: "Max 50 premium requests for this session"
- **Global daily budget**: "Max 200 premium requests per day across all sessions"
- **Model-aware pricing**: Factor in different costs per model
- **Alerts**: Warning at 80%, pause at 100%
- **Auto-downgrade**: Switch to cheaper model when budget is low

**Implementation**: Combine SDK event monitoring (track `session.shutdown` metrics) with extension hooks (inject warnings, potentially pause).

### 3.12 Cross-Session Knowledge Sharing

**Description**: When one session learns something valuable, share it with other sessions working on the same or related repos.

**How it works**:
1. Monitor `store_memory` tool calls across sessions
2. Build a shared knowledge base in TracePilot's index
3. When a new session starts, inject relevant memories as `additionalContext`

**Implementation**: Extension + TracePilot API. The extension hooks into `onPostToolUse` for `store_memory` and sends the fact to TracePilot. TracePilot stores it in its index. The `onSessionStart` hook queries TracePilot for relevant facts and injects them.

### 3.13 Session Recipes & Playbooks

**Description**: Multi-step automated workflows that chain multiple session actions.

**Example recipe — "Full PR Workflow"**:
```yaml
name: Full PR Workflow
steps:
  - create_worktree: { branch: "feature/{input.name}" }
  - launch_session:
      template: "feature-build"
      prompt: "{input.description}"
  - wait_for_idle: {}
  - launch_session:
      template: "code-review"
      prompt: "Review all changes made"
  - wait_for_idle: {}
  - send_message: "Create a PR with a detailed description"
```

### 3.14 Git Integration Hub

**Description**: Deep git integration that ties sessions to git history.

**Features**:
- See which sessions modified which files/branches
- "Continue from commit X" — launch session at specific git state
- Branch comparison tied to session analytics
- PR creation from session results

### 3.15 Plugin Marketplace Browser

**Description**: Browse Copilot CLI plugin marketplaces from within TracePilot.

Copilot CLI has built-in plugin management:
```bash
copilot plugin install <source>
copilot plugin list
copilot plugin marketplace browse
```

TracePilot could provide a visual browser for discovering and installing plugins.

---

## Part 4: Integration with Existing TracePilot

### Files That Would Need Changes

#### New Files (Creation)
| File | Purpose |
|------|---------|
| `apps/desktop/src/views/SessionLauncherView.vue` | Session spawning UI |
| `apps/desktop/src/views/ActiveSessionsView.vue` | Live session dashboard |
| `apps/desktop/src/views/ConfigInjectorView.vue` | Configuration injection |
| `apps/desktop/src/views/ExtensionManagerView.vue` | Extension management |
| `apps/desktop/src/views/BatchOperationsView.vue` | Batch task runner |
| `apps/desktop/src/stores/sessionLauncher.ts` | Launcher state |
| `apps/desktop/src/stores/activeSessions.ts` | Active session state |
| `apps/desktop/src/stores/configInjector.ts` | Config injection state |

#### Modified Files
| File | Change |
|------|--------|
| `apps/desktop/src/router.ts` | Add routes for new views |
| `apps/desktop/src/components/AppSidebar.vue` | Add nav items for new views |
| `crates/tracepilot-tauri-bindings/src/lib.rs` | New Tauri commands |
| `apps/desktop/src-tauri/build.rs` | Register new commands |
| `packages/client/src/index.ts` | New client methods |
| `packages/types/src/index.ts` | New type definitions |

#### New Rust Modules
| Module | Purpose |
|--------|---------|
| `crates/tracepilot-core/src/injector/` | Config reading/writing, YAML parsing |
| `crates/tracepilot-core/src/launcher/` | Session spawning, worktree management |
| `crates/tracepilot-core/src/monitor/` | Active session monitoring |

### Sidebar Navigation (Updated)

```
📊 Dashboard (existing)
📋 Sessions (existing)
📈 Analytics (existing)
🔧 Tools (existing)
💻 Code Impact (existing)
🤖 Models (existing)
─── New ───────────────
🚀 Launch Session
📡 Active Sessions
⚙️ Config Injector
🧩 Extensions
📦 Batch Operations
🌿 Worktrees
⚕️ Health (existing)
⚙️ Settings (existing)
```

---

## Part 5: Implementation Priority & Roadmap

### Tier 1 — Quick Wins (Low effort, high value)
1. **Configuration Injector** — Read/write agent YAML + config.json. Pure file I/O, no SDK needed.
2. **Session Templates** — JSON template storage + picker UI.
3. **Cost Governor** — Extend existing analytics with budget tracking.

### Tier 2 — Core Features (Medium effort, high value)
4. **Session Launcher** — Spawn copilot processes with configuration.
5. **Git Worktree Integration** — `git worktree` commands via Tauri.
6. **Extension Manager** — File CRUD + template library.

### Tier 3 — Advanced Features (Higher effort, transformative value)
7. **Multi-Session Dashboard** — SDK integration for real-time monitoring.
8. **Live Session Interaction** — SDK-based message sending + event streaming.
9. **Batch Operations** — Combines launcher + worktrees + monitoring.

### Tier 4 — Future Vision
10. **Cross-Session Knowledge** — Shared memory/context system.
11. **Session Forking** — Event log manipulation + session creation.
12. **Session Recipes** — Multi-step automation DSL.
13. **Health Auto-Intervention** — Automated session management.

---

## Appendix A: Quick Reference — All Injection Points

| Injection Point | Location | What It Controls | Persistence | Risk |
|----------------|----------|-----------------|-------------|------|
| Agent YAML model | `pkg/universal/{v}/definitions/*.agent.yaml` | Subagent model selection | Until update | Low |
| Agent YAML prompt | Same | Subagent system prompt | Until update | Low |
| Agent YAML tools | Same | Available tools per agent | Until update | Low |
| config.json model | `~/.copilot/config.json` | Default conversation model | Permanent | None |
| config.json reasoning | Same | Reasoning effort level | Permanent | None |
| config.json trusted | Same | Auto-trusted directories | Permanent | None |
| Extension hooks | `.github/extensions/*/extension.mjs` | Runtime behavior injection | Permanent | Low |
| Extension tools | Same | Custom tool registration | Permanent | Low |
| Skills | `~/.copilot/skills/*/SKILL.md` | Custom capability definitions | Permanent | None |
| MCP servers | `~/.copilot/mcp-config.json` | Custom tool servers | Permanent | Low |
| Custom instructions | `.github/copilot-instructions.md` | Per-repo context injection | Permanent | None |
| ENV: COPILOT_MODEL | Environment | Model override | Per-session | None |
| ENV: COPILOT_AUTO_UPDATE | Environment | Prevent overwrites | Per-session | None |
| ENV: COPILOT_CUSTOM_INSTRUCTIONS_DIRS | Environment | Extra instruction paths | Per-session | None |
| SDK: systemMessage | `createSession()` config | System prompt append/replace | Per-session | None |
| SDK: session.send() | Runtime | Inject messages into session | Immediate | Low |
| SDK: session.setModel() | Runtime | Change model mid-session | Immediate | None |
| SDK: session.log() | Runtime | Add timeline entries | Immediate | None |

## Appendix B: Available Models (1.0.8)

| Model | Tier | Best For |
|-------|------|----------|
| `claude-opus-4.6` | Premium | Complex reasoning, architecture |
| `claude-opus-4.6-fast` | Premium | Fast premium reasoning |
| `claude-opus-4.5` | Premium | Balanced premium |
| `claude-sonnet-4.6` | Standard | Code review, research |
| `claude-sonnet-4.5` | Standard | General development |
| `claude-sonnet-4` | Standard | Balanced |
| `claude-haiku-4.5` | Fast | Exploration, quick tasks |
| `gemini-3-pro-preview` | Standard | Alternative perspective |
| `gpt-5.4` | Standard | Latest GPT |
| `gpt-5.3-codex` | Standard | Code-focused GPT |
| `gpt-5.2-codex` | Standard | Code-focused GPT |
| `gpt-5.2` | Standard | General GPT |
| `gpt-5.1-codex-max` | Standard | Max code GPT |
| `gpt-5.1-codex` | Standard | Code-focused GPT |
| `gpt-5.1` | Standard | General GPT |
| `gpt-5.4-mini` | Fast | Quick GPT |
| `gpt-5.1-codex-mini` | Fast | Quick code GPT |
| `gpt-5-mini` | Fast | Minimal GPT |
| `gpt-4.1` | Fast | Legacy fast |

---

## Part 6: Consolidated Review Feedback & Revised Recommendations

> This section synthesizes feedback from four independent model reviews:
> - **Claude Opus 4.6** — Technical accuracy, feasibility calibration, risk analysis
> - **GPT 5.4** — UX/product strategy, competitive analysis, novel ideas
> - **GPT 5.3 Codex** — Implementation-level code feasibility, data flow, testing
> - **Gemini 3 Pro** — Strategic assessment, innovation gaps, security, scalability
>
> Full reviews are in `docs/reviews/`.

### 6.1 Consensus Findings (All 4 Reviewers Agree)

1. **The "orchestrator" direction is correct** — but the identity should be **"fleet manager / mission control"**, not "better chat UI." TracePilot should manage a *team* of agents, not replicate the single-session terminal experience.

2. **Git Worktree Integration is the killer feature** — Every reviewer rated it high priority. It solves the #1 pain point (repo locking) and enables all parallel workflows.

3. **Live Session Interaction (§3.6) is overscoped and underrated in difficulty** — Opus rates it Hard (report said Medium). GPT says "the UX can get weird fast." Gemini says "don't reinvent the wheel." All agree: defer this to Tier 4.

4. **The Node.js sidecar is high-risk and should be deferred** — All reviewers agree: start with CLI-spawn + file I/O for Phase 1-2. Only add the SDK sidecar when there's a proven need for features it uniquely enables.

5. **Security is a critical gap** — The original report was too casual about `COPILOT_ALLOW_ALL`. Auto-approve creates RCE vectors. Every reviewer flagged this independently.

6. **SDK API instability is the biggest long-term risk** — The Copilot SDK is an internal, undocumented API. Build an abstraction/adapter layer to survive API changes.

### 6.2 Revised Feasibility Ratings

| Feature | Original | Opus | Codex | Consensus |
|---------|----------|------|-------|-----------|
| Config Injector | Easy | Easy | Easy | **Easy** ✅ |
| Session Templates | Easy | Easy | Easy | **Easy** ✅ |
| Session Launcher (CLI) | Medium | Medium | Easy-Med | **Easy-Medium** |
| Git Worktrees (basic) | Medium | Easy-Med | Easy-Med | **Easy-Medium** |
| Extension Manager (CRUD) | Easy | Easy-Med | Easy-Med | **Easy-Medium** |
| Multi-Session Dashboard (polling) | Medium | Medium | Medium | **Medium** |
| Cost Governor (tracking only) | Easy | Easy | Easy | **Easy** |
| Cost Governor (enforcement) | Easy | Medium | Medium | **Medium** |
| Session Launcher (SDK) | Medium | Hard | Hard | **Hard** |
| Batch Operations | Medium | Hard | Hard | **Hard** |
| Live Session Interaction | Medium | Hard | Hard | **Hard** |
| Session Forking | — | Hard | Hard | **Hard** |
| Cross-Session Knowledge | Medium | Med-Hard | Medium | **Medium-Hard** |

### 6.3 Revised Implementation Roadmap

Based on all reviewer feedback, the recommended phased approach:

#### Tier 1 — Quick Wins (No sidecar, pure file I/O + CLI)
| Feature | What Ships | Effort |
|---------|-----------|--------|
| **Configuration Injector** | Read/write agent YAML + config.json with diff preview, backup, validation | Easy |
| **Session Launcher (CLI-spawn)** | Launch `copilot.exe` with model/prompt/flags, "dry run" preview | Easy-Med |
| **Git Worktree Integration** | `git worktree add/list/remove` for isolated parallel sessions | Easy-Med |
| **Active Session Discovery** | Poll `inuse.*.lock` + `workspace.yaml` for dashboard table | Easy |

#### Tier 2 — Core UX
| Feature | What Ships | Effort |
|---------|-----------|--------|
| **Session Templates** | JSON preset storage + picker in launcher | Easy |
| **Multi-Session Dashboard** | Lock-file polling + `events.jsonl` tail (no SDK) | Medium |
| **Extension Manager** | CRUD + template library for common patterns | Easy-Med |
| **Cost Tracking** | Budget display from existing analytics, quota API integration | Easy-Med |

#### Tier 3 — Sidecar Foundation (only if needed)
| Feature | What Ships | Effort |
|---------|-----------|--------|
| **Node.js Sidecar** | Optional, lazy-started, JSON-RPC over stdio | Hard |
| **Real-Time Event Streaming** | SDK subscriptions for live session monitoring | Medium |
| **Cost Enforcement** | Auto-pause/downgrade via SDK | Medium |

#### Tier 4 — Advanced/Vision
| Feature | What Ships | Effort |
|---------|-----------|--------|
| **Live Session Interaction** | Chat interface to running sessions via SDK | Hard |
| **Batch Operations** | Multi-repo parallel task execution with queue | Hard |
| **A/B Testing Arena** | Same task, multiple models/prompts, compare results | Hard |
| **Cross-Session Knowledge** | Scoped memory sharing between sessions | Med-Hard |
| **CI/CD Integration** | Headless mode, GitHub Actions, PR comments | Hard |
| **Session Recipes/Playbooks** | Multi-step automation DSL | Hard |

### 6.4 New Ideas from Reviewers

#### From GPT 5.4 — UX & Product
- **Four-area navigation** instead of many sidebar items: Sessions, Launch, Automation, Admin
- **Session state badges**: running / waiting for input / blocked on approval / stalled / rate-limited / finished
- **"Why is this enabled?"** explanations for every advanced feature
- **Onboarding flow**: Import → Launch → Watch → Improve
- **Session replay debugging**: step-through replay with counterfactual branching
- **A/B prompt testing**: run same task with different prompts, compare outcomes
- **Session quality benchmarking**: score sessions and learn which configs work best
- **Template sharing marketplace**: community-contributed session templates

#### From Gemini 3 Pro — Strategy & Innovation
- **A/B Testing Arena**: Run same task in 3 worktrees with 3 models, present results for user to pick winner
- **Predictive Success Modeling**: "This prompt has 12% success rate with Haiku. Upgrade to Opus?"
- **Self-Healing Sessions**: Auto-inject "stop and reflect" when sessions loop on errors
- **"The Librarian"**: Dedicated agent for curating the `store_memory` database
- **CI/CD is the end game**: Expose `tracepilot run-batch` for GitHub Actions
- **Concurrency Queue**: Default max 2 concurrent sessions to prevent laptop meltdown
- **Docker/DevContainer sandboxing**: Required for safe headless batch operations

#### From Opus — Architecture & Safety
- **Diff preview** before writing modified config/YAML
- **Dry-run mode** for session launcher (show exact command before executing)
- **Session registry** in SQLite for tracking TracePilot-spawned sessions across restarts
- **File-based IPC** instead of HTTP for extension↔TracePilot communication
- **Checkpoint-based forking** instead of event-log slicing
- **Knowledge scoping** by repository to prevent context pollution
- **Adapter pattern** for SDK to survive API changes

#### From Codex — Implementation
- **No sidecar for Phase 1-2**: Just spawn `copilot.exe` + monitor `events.jsonl`
- **Dual-path ingestion**: Live path (stdout/events stream) + Durable path (incremental index)
- **Single writer task + channel** for database writes under load
- **Ring buffers** for per-session event logs in memory
- **Mock CLI for testing**: Fake `copilot.exe` that emits scripted events
- **`serde_yaml` with `#[serde(flatten)]`** for forward-compatible YAML parsing
- **`which` crate** for reliable executable resolution on Windows

### 6.5 Critical Additions to the Security Model

Based on unanimous reviewer concern, the following security measures are now **required** for any orchestration feature:

1. **Never default to auto-approve** — Use tool-category allowlists instead of global `COPILOT_ALLOW_ALL`
2. **Audit logging** — Every auto-approved tool execution logged with full args
3. **Credential isolation** — Consider per-session token scoping for batch operations
4. **Sandbox support** — Container/DevContainer option for headless sessions
5. **Kill switch** — Immediate process termination from TracePilot dashboard
6. **Cross-session memory scoping** — Tag memories by repo, prevent leakage between unrelated projects
7. **Config backup before every write** — Timestamped `.bak` files with one-click restore
8. **Extension validation** — Syntax check, import verification, dry-run before deployment

### 6.6 Revised Top 10 Features (Post-Review)

| # | Feature | Priority | Why |
|---|---------|----------|-----|
| 1 | **Configuration Injector** | 🔴 Tier 1 | Immediate value, no risk, pure file I/O. Upgrade explore to Opus with one click. |
| 2 | **Git Worktree Integration** | 🔴 Tier 1 | Killer feature per all reviewers. Solves repo-locking, enables parallelism. |
| 3 | **Session Launcher (CLI-spawn)** | 🔴 Tier 1 | Extends existing `resume_session_in_terminal`. One-click session creation. |
| 4 | **Active Session Discovery** | 🔴 Tier 1 | Simple lock-file scanning. Foundation for dashboard. |
| 5 | **Session Templates** | 🟠 Tier 2 | High adoption after launcher ships. Reduces cognitive load. |
| 6 | **Multi-Session Dashboard** | 🟠 Tier 2 | Polling-based (no sidecar). "Mission control" identity. |
| 7 | **Extension Manager** | 🟠 Tier 2 | Template library for common patterns. Huge power-user value. |
| 8 | **Cost Tracking + Budgets** | 🟠 Tier 2 | Emotional safety net. People experiment more with guardrails. |
| 9 | **A/B Testing Arena** | 🟡 Tier 3-4 | Novel differentiator. Same task × multiple models × compare. |
| 10 | **Batch Operations** | 🟡 Tier 3-4 | Fleet management. Combines launcher + worktrees + monitoring. |

---

## Addendum: Copilot SDK Deep Dive

> **Added 2026-03-19** — After the initial report was completed, a comprehensive deep dive into the official Copilot SDK source code was conducted. The SDK provides a **full programmatic JSON-RPC API** that fundamentally changes TracePilot's integration approach from file-system-based interaction to proper API-driven orchestration.
>
> The complete SDK analysis — including architecture diagrams, full API reference, implementation strategy, code examples, and revised feature roadmap — is documented in the companion report:
>
> **📄 [Copilot SDK Deep Dive — TracePilot Integration Analysis](copilot-sdk-deep-dive.md)**
>
> Key implications:
> - The SDK provides **50+ JSON-RPC methods** for session lifecycle, model control, tool injection, hooks, and real-time events
> - **File-watching is no longer the primary approach** — SDK provides streaming events via callbacks
> - **Custom tools** can be registered that give the agent access to TracePilot's own analytics
> - **6 hooks** enable intercepting/modifying every stage of session execution
> - **Fleet mode** (`session.fleet.start`) provides built-in multi-agent orchestration
> - **BYOK support** means TracePilot can configure any LLM provider programmatically
> - **Multi-client architecture** allows multiple TracePilot instances to share session management
>
> This addendum supersedes several recommendations in Parts 3-5 of this report. The SDK-based approaches are strictly superior to the file-system approaches originally proposed.
