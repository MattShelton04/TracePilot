# TracePilot — Research & Implementation Plan

## Executive Summary

GitHub Copilot CLI stores rich session data in `~/.copilot/session-state/{UUID}/` folders containing event logs, SQLite databases, YAML metadata, markdown plans, checkpoints, and rewind snapshots. This data is currently only accessible via the CLI's `--resume` picker (which shows a limited list) and the `/chronicle` experimental command. There is a significant opportunity to build a web-based application that provides comprehensive visualization, search, and audit capabilities over this data.

This report documents the complete session-state architecture (reverse-engineered from live data and source artifacts), proposes a feature set, and outlines an implementation plan for **TracePilot**, the selected working name for this project.

---

## Part 1: Session-State Architecture (Reverse-Engineered)

### 1.1 Directory Layout

```
~/.copilot/
├── config.json                          # Global CLI config (model, user, settings)
├── command-history-state.json           # Command history across sessions
├── session-state/
│   ├── {UUID}/                          # One folder per session
│   │   ├── workspace.yaml              # Session metadata (ALWAYS present)
│   │   ├── events.jsonl                # Event log (69% of sessions)
│   │   ├── session.db                  # SQLite database (47% of sessions)
│   │   ├── plan.md                     # Plan mode artifact (32% of sessions)
│   │   ├── vscode.metadata.json        # VS Code integration (65% of sessions)
│   │   ├── checkpoints/               # Compaction summaries (ALWAYS present)
│   │   │   ├── index.md               # Checkpoint listing
│   │   │   └── 001-{slug}.md          # Individual checkpoint
│   │   ├── files/                     # Session artifacts (ALWAYS present)
│   │   ├── research/                  # Research artifacts (84% of sessions)
│   │   └── rewind-snapshots/          # Rewind state (61% of sessions)
│   │       └── index.json             # Snapshot index with git state
│   └── ...
├── logs/                               # Process logs
└── pkg/                                # CLI binary/packages
```

**Observed stats from 74 sessions:**
| File/Dir | Presence |
|---|---|
| workspace.yaml | 74/74 (100%) |
| checkpoints/ | 74/74 (100%) |
| files/ | 74/74 (100%) |
| research/ | 62/74 (84%) |
| events.jsonl | 51/74 (69%) |
| vscode.metadata.json | 48/74 (65%) |
| rewind-snapshots/ | 45/74 (61%) |
| session.db | 35/74 (47%) |
| plan.md | 24/74 (32%) |

### 1.2 workspace.yaml — Session Metadata

The primary metadata file. Always present. Key fields:

```yaml
id: c86fe369-c858-4d91-81da-203c5e276e33
cwd: C:\git\Portify
git_root: C:\git\Portify
repository: MattShelton04/Portify        # GitHub owner/repo
host_type: github
branch: Matt/Playwright_CLI_Setup
summary: "Playwright Usability Review And Documentation"   # AI-generated title
summary_count: 2                         # Number of times summary was updated
created_at: 2026-03-12T05:43:25.270Z
updated_at: 2026-03-12T06:52:57.136Z
```

**Notes:**
- `summary` is AI-generated from the first user message, may be updated during session
- Not all sessions have `summary` (short-lived or abandoned sessions may lack it)
- `repository` and `git_root` are only present when session started inside a git repo

### 1.3 events.jsonl — The Event Log

**Line-delimited JSON**, one event per line. This is the richest data source. Every event shares a common envelope:

```json
{
  "type": "event.type.name",
  "data": { /* event-specific payload */ },
  "id": "uuid",
  "timestamp": "ISO-8601",
  "parentId": "uuid-of-parent-event | null"
}
```

#### 1.3.1 Complete Event Type Catalog (17 types observed)

| Event Type | Count (example session) | Description |
|---|---|---|
| `session.start` | 1 | Session initialization with context |
| `session.shutdown` | 1 | Session end with comprehensive metrics |
| `session.compaction_start` | 2 | Context window compaction begins |
| `session.compaction_complete` | 2 | Compaction done, includes summary text |
| `session.plan_changed` | 3 | Plan mode operations |
| `session.model_change` | 1 | Model switch during session |
| `session.info` | 1 | Informational messages |
| `user.message` | 2 | User prompts (content + attachments) |
| `assistant.message` | 594 | AI responses (content + tool calls) |
| `assistant.turn_start` | 483 | Turn boundary marker |
| `assistant.turn_end` | 483 | Turn boundary marker |
| `tool.execution_start` | 905 | Tool invocation with args |
| `tool.execution_complete` | 905 | Tool result with success/failure |
| `subagent.started` | 11 | Subagent launch |
| `subagent.completed` | 11 | Subagent completion |
| `skill.invoked` | 2 | Skill activation |
| `system.notification` | 9 | System-level notifications |

#### 1.3.2 Key Event Schemas

**`session.start`**
```json
{
  "sessionId": "uuid",
  "version": 1,
  "producer": "copilot-agent",
  "copilotVersion": "1.0.4",
  "startTime": "ISO-8601",
  "context": {
    "cwd": "C:\\git\\Project",
    "gitRoot": "C:\\git\\Project",
    "branch": "main",
    "headCommit": "sha",
    "repository": "owner/repo",
    "hostType": "github",
    "baseCommit": "sha"
  },
  "alreadyInUse": false
}
```

**`session.shutdown`** — Richest metrics event:
```json
{
  "shutdownType": "routine",
  "totalPremiumRequests": 4,
  "totalApiDurationMs": 4219984,
  "sessionStartTime": 1773294205269,
  "codeChanges": {
    "linesAdded": 919,
    "linesRemoved": 100,
    "filesModified": ["path1.ts", "path2.cs", ...]
  },
  "modelMetrics": {
    "claude-opus-4.6": {
      "requests": { "count": 275, "cost": 3 },
      "usage": { "inputTokens": 20743119, "outputTokens": 61953, "cacheReadTokens": 20496348 }
    },
    "claude-haiku-4.5": { ... },
    "gpt-5.4": { ... }
  },
  "currentModel": "gpt-5.4"
}
```

**`user.message`**
```json
{
  "content": "original user text",
  "transformedContent": "system-decorated version with datetime/reminders",
  "source": "user",
  "attachments": [],
  "interactionId": "uuid"
}
```

**`assistant.message`**
```json
{
  "messageId": "uuid",
  "content": "assistant text response",
  "toolRequests": [
    {
      "toolCallId": "id",
      "name": "powershell",
      "arguments": { "command": "...", "mode": "sync" },
      "type": "function"
    }
  ],
  "interactionId": "uuid",
  "reasoningOpaque": "encrypted-reasoning",
  "reasoningText": "visible-reasoning (when present)",
  "outputTokens": 207
}
```

**`tool.execution_start`**
```json
{
  "toolCallId": "id",
  "toolName": "powershell",
  "arguments": { "command": "npm run build", "mode": "sync" }
}
```

**`tool.execution_complete`**
```json
{
  "toolCallId": "id",
  "model": "claude-opus-4.6",
  "interactionId": "uuid",
  "success": true,
  "result": { "content": "...", "detailedContent": "..." },
  "toolTelemetry": {}
}
```

**`session.compaction_complete`**
```json
{
  "success": true,
  "preCompactionTokens": 104405,
  "preCompactionMessagesLength": 361,
  "summaryContent": "<overview>...</overview><history>...</history>",
  "checkpointNumber": 1,
  "checkpointPath": "...\\checkpoints\\001-slug.md",
  "compactionTokensUsed": { "input": N, "output": N, "cachedInput": N },
  "requestId": "uuid"
}
```

**`subagent.started`**
```json
{
  "toolCallId": "id",
  "agentName": "explore",
  "agentDisplayName": "Explore Agent",
  "agentDescription": "Fast codebase exploration..."
}
```

#### 1.3.3 Event Hierarchy

Events form a **tree structure** via `parentId`:
```
session.start (parentId: null)
  └─ user.message
       └─ assistant.turn_start
            └─ assistant.message (with toolRequests)
                 ├─ tool.execution_start
                 │    └─ tool.execution_complete
                 ├─ subagent.started
                 │    └─ subagent.completed
                 └─ ...
            └─ assistant.turn_end
       └─ assistant.turn_start (next turn)
            └─ ...
  └─ user.message (next interaction)
       └─ ...
  └─ session.shutdown
```

### 1.4 session.db — SQLite Database

Per-session SQLite database with standard tables:

```sql
CREATE TABLE todos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','done','blocked')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE todo_deps (
    todo_id TEXT NOT NULL,
    depends_on TEXT NOT NULL,
    PRIMARY KEY (todo_id, depends_on),
    FOREIGN KEY (todo_id) REFERENCES todos(id),
    FOREIGN KEY (depends_on) REFERENCES todos(id)
);
```

Sessions may also create **custom tables** (e.g., a `bugs` table for bug tracking):
```sql
CREATE TABLE bugs (
    id TEXT PRIMARY KEY,
    user_story TEXT,
    severity TEXT CHECK(severity IN ('critical','major','minor','cosmetic')),
    title TEXT NOT NULL,
    description TEXT,
    steps_to_reproduce TEXT,
    expected TEXT,
    actual TEXT,
    status TEXT DEFAULT 'open' CHECK(status IN ('open','fixed','wontfix')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolution TEXT
);
```

### 1.5 Checkpoints

Markdown files created during context compaction:
- `checkpoints/index.md` — chronological listing
- `checkpoints/001-{slug}.md` — full summary with `<overview>`, `<history>`, and context

### 1.6 Rewind Snapshots

`rewind-snapshots/index.json` stores snapshots per user message:
```json
{
  "version": 1,
  "snapshots": [
    {
      "snapshotId": "uuid",
      "eventId": "uuid",
      "userMessage": "full user prompt text",
      "timestamp": "ISO-8601",
      "fileCount": 0,
      "gitCommit": "sha",
      "gitBranch": "branch-name",
      "backupHashes": [],
      "files": {}
    }
  ],
  "filePathMap": {}
}
```

### 1.7 Global State

| File | Purpose |
|---|---|
| `~/.copilot/config.json` | User preferences: model, reasoning_effort, trusted_folders, login |
| `~/.copilot/command-history-state.json` | Cross-session command history |
| `~/.copilot/logs/` | Process logs |

---

## Part 2: Proposed Application — "TracePilot"

### 2.1 Target Users & Use Cases

| User | Use Case |
|---|---|
| Individual developer | Browse past sessions, find where work was done, resume |
| Team lead | Audit what Copilot did, review code change quality |
| Power user | Analyze token usage, model performance, optimize workflows |
| Developer (self) | Debug sessions, understand what went wrong |

### 2.2 Feature Set

#### Tier 1: Session Browser (MVP)
1. **Session List Dashboard** — Sortable/filterable table of all sessions
   - Summary/title, repository, branch, created/updated dates
   - Quick stats: event count, lines changed, files modified, duration
   - Status indicators (has plan, has checkpoints, is active)
   - Search by summary text, repository, branch
   - Sort by date, duration, code changes

2. **Session Detail View** — Deep dive into a single session
   - Metadata header (repo, branch, model, duration, code stats)
   - Conversation timeline (user messages ↔ assistant responses)
   - Collapsible tool executions with command/output
   - Plan.md viewer (rendered markdown)
   - Todo list from session.db
   - Checkpoint summaries

3. **Session Resume Helper** — Generate resume commands
   - One-click `copilot --resume={id}` copy
   - Session state summary to help decide what to resume

#### Tier 2: Visualization & Analytics
4. **Event Timeline Visualization**
   - Interactive timeline showing event flow (Gantt-chart style)
   - Color-coded by event type (user, assistant, tool, subagent)
   - Zoom into specific time ranges
   - Show parallelism (concurrent tool calls, subagents)

5. **Token & Cost Analytics**
   - Per-session token usage breakdown by model
   - Historical trends across sessions
   - Cost estimation dashboard
   - Model usage comparison charts
   - Cache hit ratios

6. **Code Change Analytics**
   - Files modified per session, with diff links
   - Lines added/removed trends
   - Which repos get the most Copilot activity
   - Hot files (most frequently modified by Copilot)

7. **Tool Usage Analysis**
   - Most-used tools (powershell, edit, grep, etc.)
   - Tool success/failure rates
   - Average tool execution duration
   - Tool call patterns over time

#### Tier 3: Advanced Features
8. **Session Search**
   - Full-text search across all session events
   - Search user messages, assistant responses, tool outputs
   - Filter by date range, repository, model

9. **Session Comparison**
   - Compare two sessions side-by-side
   - Identify similar sessions (same repo/branch)
   - Track session chains (resumed sessions)

10. **Export & Sharing**
    - Export session as markdown report
    - Export session analytics as JSON/CSV
    - Generate shareable session summaries

11. **Real-time Monitoring**
    - Watch active sessions via file system watchers
    - Live-updating event stream
    - Active session dashboard

### 2.3 Non-Goals (for now)
- Modifying session state (read-only tool)
- Cloud sync or multi-machine support
- Direct integration with Copilot CLI process

---

## Part 3: Implementation Plan

### 3.1 Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend** | React + TypeScript | Rich component ecosystem, great for data-heavy UIs |
| **UI Framework** | Tailwind CSS + shadcn/ui | Fast, beautiful, accessible components |
| **Data Viz** | Recharts + custom timeline | Recharts for charts, custom D3/canvas for timeline |
| **Backend** | Node.js + Express (or Fastify) | JavaScript ecosystem, easy SQLite/YAML/JSONL parsing |
| **Database** | Read directly from session files + optional SQLite index | No separate DB needed; index for fast search |
| **File Parsing** | js-yaml, better-sqlite3, readline | Native parsing of all session file formats |
| **Desktop (optional)** | Electron or Tauri | For native file system access without server |

**Alternative: Single SPA (no backend)**
- Could run entirely in the browser if we load session data via a lightweight local file server
- Tauri would be ideal: Rust backend for file I/O, web frontend for UI

### 3.2 Architecture

```
┌─────────────────────────────────────────────────┐
│                 Frontend (React)                 │
│  ┌──────────┐ ┌───────────┐ ┌────────────────┐  │
│  │ Session   │ │  Session  │ │   Analytics    │  │
│  │ Browser   │ │  Detail   │ │   Dashboard    │  │
│  └────┬─────┘ └─────┬─────┘ └──────┬─────────┘  │
│       └──────────────┼──────────────┘            │
│                      │ API calls                 │
├──────────────────────┼───────────────────────────┤
│                Backend (Node.js)                 │
│  ┌───────────────────┼───────────────────────┐   │
│  │            Session Service                │   │
│  │  ┌──────────┐ ┌────────┐ ┌────────────┐  │   │
│  │  │ YAML     │ │ JSONL  │ │ SQLite     │  │   │
│  │  │ Parser   │ │ Parser │ │ Reader     │  │   │
│  │  └──────────┘ └────────┘ └────────────┘  │   │
│  └───────────────────┼───────────────────────┘   │
│                      │ File I/O                   │
├──────────────────────┼───────────────────────────┤
│        ~/.copilot/session-state/                  │
│        (read-only file system access)             │
└───────────────────────────────────────────────────┘
```

### 3.3 Data Ingestion Pipeline

1. **Session Discovery** — Scan `~/.copilot/session-state/` for UUID directories
2. **Metadata Loading** — Parse `workspace.yaml` for each session (fast, small files)
3. **Event Indexing** — Parse `events.jsonl` on-demand or build search index
4. **DB Reading** — Open `session.db` read-only for todo/custom table data
5. **Checkpoint Loading** — Parse checkpoint markdown files
6. **Snapshot Loading** — Parse `rewind-snapshots/index.json`

**Performance considerations:**
- workspace.yaml files are tiny (<1KB) — scan all instantly for the session list
- events.jsonl can be large (the example session has 3,416 events) — lazy-load, stream, or pre-index
- session.db should be opened read-only (`SQLITE_OPEN_READONLY`)
- Consider building a local index/cache database for cross-session search

### 3.4 Implementation Phases

#### Phase 1: Core Data Layer + Session List (Foundation)
- Set up project scaffolding (monorepo with frontend + backend)
- Implement session discovery and workspace.yaml parsing
- Build REST API: `GET /sessions`, `GET /sessions/:id`
- Build session list UI with sort/filter
- Basic session detail page (metadata only)

#### Phase 2: Event Log Viewer
- Implement events.jsonl streaming parser
- Build conversation timeline component
- Render user messages, assistant responses, tool calls
- Collapsible tool execution panels with syntax highlighting
- Event type filtering

#### Phase 3: Session Detail Enrichment
- Integrate session.db reader (todos, custom tables)
- Render plan.md (markdown viewer)
- Show checkpoint summaries
- Show rewind snapshots with git state
- Add code change file listing

#### Phase 4: Analytics Dashboard
- Parse shutdown events for metrics across all sessions
- Build token usage charts (per model, per session)
- Build code change charts (lines over time, files modified)
- Tool usage frequency analysis
- Session duration and activity patterns

#### Phase 5: Search & Advanced Features
- Build full-text search index across events
- Search user messages, assistant content, tool outputs
- Session comparison view
- Export functionality (markdown, JSON, CSV)
- Real-time file watcher for active sessions

### 3.5 Key API Endpoints

```
GET  /api/sessions                    # List all sessions (metadata from workspace.yaml)
GET  /api/sessions/:id                # Full session detail
GET  /api/sessions/:id/events         # Paginated event stream
GET  /api/sessions/:id/events/stats   # Event type counts, timeline bounds
GET  /api/sessions/:id/todos          # Todos from session.db
GET  /api/sessions/:id/plan           # Plan.md content
GET  /api/sessions/:id/checkpoints    # Checkpoint summaries
GET  /api/sessions/:id/snapshots      # Rewind snapshots
GET  /api/sessions/:id/metrics        # Shutdown metrics (tokens, code changes)
GET  /api/analytics/overview          # Cross-session aggregate analytics
GET  /api/analytics/tokens            # Token usage trends
GET  /api/analytics/models            # Model usage breakdown
GET  /api/search?q=...&repo=...       # Full-text search across sessions
```

### 3.6 Frontend Component Tree

```
<App>
├── <Sidebar>
│   ├── <SessionList>
│   │   ├── <SessionFilter>  (search, repo, date range)
│   │   └── <SessionCard>*   (summary, stats, quick actions)
│   └── <AnalyticsNav>
├── <MainPanel>
│   ├── <SessionDetail>
│   │   ├── <MetadataHeader>  (repo, branch, model, duration, stats)
│   │   ├── <TabBar>  [Conversation | Plan | Todos | Checkpoints | Metrics]
│   │   ├── <ConversationTimeline>
│   │   │   ├── <UserMessage>
│   │   │   ├── <AssistantMessage>
│   │   │   │   └── <ToolExecution>*  (collapsible, syntax highlighted)
│   │   │   ├── <SubagentBlock>
│   │   │   └── <CompactionMarker>
│   │   ├── <PlanViewer>  (rendered markdown)
│   │   ├── <TodoList>  (from session.db, with status/deps)
│   │   ├── <CheckpointList>
│   │   └── <MetricsPanel>  (token charts, code stats)
│   └── <AnalyticsDashboard>
│       ├── <TokenUsageChart>
│       ├── <CodeChangeChart>
│       ├── <ModelUsageChart>
│       ├── <ToolFrequencyChart>
│       └── <SessionActivityHeatmap>
└── <SearchPanel>  (full-text search overlay)
```

---

## Part 4: Data Insights & Visualization Opportunities

### 4.1 What's Already Rich Enough to Visualize

| Data Source | Visualization | Value |
|---|---|---|
| workspace.yaml (all sessions) | Session timeline, repo activity | Which projects, when, how often |
| session.shutdown metrics | Token/cost dashboard | Understand spending, optimize model choice |
| session.shutdown.modelMetrics | Model comparison charts | Cache hit rates, token efficiency |
| session.shutdown.codeChanges | Code productivity metrics | Lines/session, files/session trends |
| events.jsonl event types | Session flow diagram | See how the agent works, tool patterns |
| events.jsonl timestamps | Duration analysis | How long each phase takes |
| tool.execution_start/complete | Tool usage heatmap | Most used tools, failure rates |
| user.message content | Session search, topic clustering | Find past work by what you asked |
| session.compaction_complete | Context window analysis | When compaction happens, summary quality |
| subagent events | Subagent parallelism view | See concurrent work, agent types used |
| rewind-snapshots | Git state timeline | Track commits across session |

### 4.2 Cross-Session Analytics Opportunities

From the 41 sessions with shutdown metrics we analyzed:
- **Total lines added across all sessions: ~45,000+**
- **Models used: 7+** (opus-4.6, haiku-4.5, sonnet-4.6, sonnet-4.5, gpt-5.4, gpt-5.3-codex, gemini-3-pro, gpt-5-mini)
- **Session durations range from 11s to 20,860s (5.8 hours)**
- **Premium request counts: 0-18 per session**
- Repos worked on: primarily Portify, across multiple branches

### 4.3 Computed Metrics (Derived)

| Metric | Source | Formula |
|---|---|---|
| Session duration | start/shutdown timestamps | shutdown.timestamp - start.timestamp |
| Tokens per line of code | shutdown metrics | totalTokens / linesAdded |
| Tool call density | events count | toolCalls / sessionDuration |
| Interaction ratio | user vs assistant messages | userMessages / assistantMessages |
| Compaction frequency | compaction events | compactions / sessionDuration |
| Subagent utilization | subagent events | subagentTime / totalTime |
| Cache efficiency | model metrics | cacheReadTokens / totalInputTokens |

---

## Part 5: Open Questions & Decisions Needed

1. **Desktop app vs. web app?** Tauri (Rust+Web) gives native file access without a server. Pure web needs a local Express/Fastify server.

2. **Real-time watching?** Should we watch for file changes in active sessions, or only analyze completed sessions?

3. **Search indexing strategy?** Pre-build a search index on startup vs. search on-demand? For 74 sessions with 51 event files, pre-indexing is fast.

4. **Sensitive data handling?** events.jsonl contains user messages, code, and potentially secrets. Should there be redaction options?

5. **Session grouping?** Group by repository? By branch? By date? Support all with tabs?

6. **Multi-user support?** Scan only the current user's sessions, or support pointing at any directory?

---

## Part 6: Effort Estimation & Priority Matrix

| Feature | Priority | Complexity | Impact |
|---|---|---|---|
| Session list with metadata | P0 (MVP) | Low | High — immediate value for session discovery |
| Session detail / conversation view | P0 (MVP) | Medium | High — core use case |
| Resume command helper | P0 (MVP) | Low | High — solves the "find my session" problem |
| Token/cost analytics | P1 | Medium | High — understand spending |
| Code change analytics | P1 | Low | Medium — track productivity |
| Event timeline visualization | P1 | High | High — understand agent behavior |
| Full-text search | P2 | Medium | High — find past work |
| Tool usage analysis | P2 | Low | Medium — optimize workflows |
| Real-time monitoring | P3 | High | Medium — nice to have |
| Session comparison | P3 | High | Low — niche use case |
| Export/sharing | P3 | Low | Medium — useful but not critical |

---

## Appendix A: Sample Session Metadata (Real Data)

```yaml
# Large productive session
id: c86fe369-c858-4d91-81da-203c5e276e33
summary: "Playwright Usability Review And Documentation"
repository: MattShelton04/Portify
branch: Matt/Playwright_CLI_Setup
events: 3416 events across 17 types
duration: ~2 hours (05:43 → 07:51 UTC)
code: +919/-100 lines, 13 files
models: opus-4.6 (275 req), haiku-4.5 (77), gpt-5.4 (223), codex-5.3 (10), gemini (9)
premium_requests: 4
checkpoints: 2 compaction summaries
```

```yaml
# Quick bug fix session
id: f3b6913f-78f7-4463-a753-6bce9b1b0429
summary: "Prevent Claude Haiku Subagents"
repository: MattShelton04/Portify
branch: main
duration: ~38 seconds
code: +9/-1 lines, 1 file
models: gpt-5.4 (1 request)
premium_requests: 1
```

## Appendix B: All Observed Event Type Schemas

| Event Type | Top-Level Keys | Data Keys |
|---|---|---|
| `session.start` | type, data, id, timestamp, parentId | sessionId, version, producer, copilotVersion, startTime, context, alreadyInUse |
| `session.shutdown` | type, data, id, timestamp, parentId | shutdownType, totalPremiumRequests, totalApiDurationMs, sessionStartTime, codeChanges, modelMetrics, currentModel |
| `session.compaction_start` | type, data, id, timestamp, parentId | (empty) |
| `session.compaction_complete` | type, data, id, timestamp, parentId | success, preCompactionTokens, preCompactionMessagesLength, summaryContent, checkpointNumber, checkpointPath, compactionTokensUsed, requestId |
| `session.plan_changed` | type, data, id, timestamp, parentId | operation |
| `session.model_change` | type, data, id, timestamp, parentId | newModel, previousReasoningEffort, reasoningEffort |
| `session.info` | type, data, id, timestamp, parentId | infoType, message |
| `user.message` | type, data, id, timestamp, parentId | content, transformedContent, source, attachments, interactionId |
| `assistant.message` | type, data, id, timestamp, parentId | messageId, content, toolRequests, interactionId, reasoningOpaque, reasoningText, outputTokens |
| `assistant.turn_start` | type, data, id, timestamp, parentId | turnId, interactionId |
| `assistant.turn_end` | type, data, id, timestamp, parentId | turnId |
| `tool.execution_start` | type, data, id, timestamp, parentId | toolCallId, toolName, arguments |
| `tool.execution_complete` | type, data, id, timestamp, parentId | toolCallId, model, interactionId, success, result, toolTelemetry |
| `subagent.started` | type, data, id, timestamp, parentId | toolCallId, agentName, agentDisplayName, agentDescription |
| `subagent.completed` | type, data, id, timestamp, parentId | toolCallId, agentName, agentDisplayName |
| `skill.invoked` | type, data, id, timestamp, parentId | name, path, content, allowedTools |
| `system.notification` | type, data, id, timestamp, parentId | content, kind |

---

## Part 7: Multi-Model Review — Consolidated Findings

The plan was independently reviewed by **GPT-5.4**, **GPT-5.3-Codex**, **Claude Opus 4.6**, and **Gemini 3 Pro Preview**. Below is a synthesis of their feedback, organized by theme.

### 7.1 Universal Consensus (All 4 Models Agree)

**1. The MVP is too broad — narrow ruthlessly.**
All reviewers flagged Phases 4-5 (analytics, search, timeline) as premature. The core inspection/viewing tool must be solid before layering analytics.

**2. Build a local index database.**
A single aggregated SQLite database (`~/.copilot/tracepilot/index.db`) should pre-index metadata from workspace.yaml, shutdown metrics, event counts, and search tokens. At 74 sessions this isn't critical; at 1000+ it's mandatory. All models recommended SQLite + FTS5 for search.

**3. Serve conversation turns, not flat event streams.**
The API should return pre-grouped structures (user message → assistant turns → nested tool calls), not raw JSONL. This eliminates complex client-side tree reconstruction from `parentId` chains.

**4. Anomaly/health detection belongs at P0.**
Detecting failed tools, zombie sessions (no shutdown), retry storms, and parse errors is fundamental to a debugging/audit tool — not a P2 analytics feature.

**5. Virtual scrolling and lazy loading are non-negotiable.**
With sessions containing 3,000+ events and tool outputs that can be 100KB+, never send everything eagerly. Load visible turns only; expand tool output on demand.

**6. Privacy/secrets scanning is critical.**
Events contain code, user messages, env vars, and potentially API keys. At minimum: warn about sensitive content; block unreviewed exports; bind localhost server to 127.0.0.1 only.

### 7.2 Architecture Recommendations

| Approach | Verdict |
|---|---|
| **React + Express (original plan)** | Viable but over-engineered for a local tool |
| **Next.js (single app)** | ✅ Recommended for web MVP — server actions for file I/O, one codebase |
| **Tauri + React** | ✅ Best for desktop product — native FS access, small footprint |
| **Electron** | Heavier, only if broad package compat needed |
| **VS Code Extension** | Strong contender — users are already in code context — but restrictive UI |
| **TUI (terminal)** | Matches CLI aesthetic but terrible for complex visualizations |
| **DuckDB WASM (browser-only)** | Interesting — SQL over JSONL in-browser — but startup cost concerns |

**Recommended strategy:** Build a **Next.js web app** as MVP. Wrap in **Tauri** for desktop later. Consider **VS Code WebView** integration as a stretch goal.

### 7.3 Data Model — The Missing Semantic Layer

All reviewers identified a critical gap: the plan treats raw events as the data model. A **derived semantic layer** is needed:

```
Raw Events (events.jsonl)
    ↓ parse + group
Semantic Model
    ├── Session (metadata + health score + computed stats)
    ├── ConversationTurn (user message → assistant response → tool calls)
    │   ├── UserMessage (content, timestamp)
    │   ├── AssistantResponse (content, toolRequests, tokens)
    │   └── ToolTransaction[] (start + complete paired, duration, success)
    ├── SubagentRun (started + completed, agent type, duration)
    ├── Checkpoint (number, summary, token stats)
    ├── Chapter (auto-detected phase: exploration, implementation, validation, debugging)
    └── SessionHealth (score, anomalies: failures, retry storms, zombie status)
```

**Key derived entities:**

| Entity | Source | Purpose |
|---|---|---|
| `ConversationTurn` | Group by `interactionId` + `turnId` | Atomic unit of conversation |
| `ToolTransaction` | Pair `tool.execution_start` ↔ `tool.execution_complete` via `toolCallId` | Duration, success, paired view |
| `Chapter` | Classify consecutive tool types (read→edit→test) | Narrative phase detection |
| `SessionHealth` | Compute from failures, zombie status, compactions, todo completion | At-a-glance quality indicator |

### 7.4 UX Vision — "Tell the Story" (from Opus 4.6)

The most impactful review insight: shift from **"show all the data"** to **"tell the story of what happened."**

**Information hierarchy: Glance → Scan → Commit**

- **Glance (< 1s):** Session card shows: title, repo, health indicator (🟢🟡🔴), duration, lines changed, tiny activity sparkline
- **Scan (< 10s):** Session digest — computed 3-sentence summary from checkpoint overviews + shutdown metrics + todo completion
- **Commit (drill-down):** Full conversation timeline with chapters, collapsible tool calls, inline plan/todo/compaction markers

**"Chapters" instead of flat events.** Auto-detect phases:
- 🔍 **Exploration** — runs of grep/glob/view/explore calls
- 🔨 **Implementation** — runs of edit/create calls
- ✅ **Validation** — runs of test/build/lint calls
- 🐛 **Debugging** — failure → fix → retry cycles
- 📋 **Planning** — plan.md creation, todo management

**Time-scoped landing page:** Default to "This Week" with sections: Today / Yesterday / This Week / Older. Summary line: *"This week: 12 sessions, 3 repos, +2,847 lines."*

### 7.5 Visualization Specifications (from Gemini)

#### The Hierarchical Swimlane Timeline

```
Time ──────────────────────────────────────────────────►
                                                        
 User     ██ prompt 1 ██                    ██ prompt 2 ██
                                                        
 Agent    ████ thinking ████ ▓▓ edit ▓▓ ▓▓ test ▓▓      
                                                        
 Sub-1         ┌── explore ──┐                          
 Sub-2         ┌──── explore ────┐                      
 Sub-3              ┌─ explore ─┐                       
                                                        
 Context  ░░░░░░░░░░░░░░░░░░░░░░░▌compaction▐░░░░░░░░░░
```

- **X-axis:** Non-linear time (compress idle periods >5s)
- **Y-axis:** Swimlanes — User, Agent, Subagent-N (dynamic), Context
- **Colors:** Blue (user), green (agent), purple (tools), red (failures)
- **Interactions:** Scroll-zoom, click-to-inspect, hover for details

#### Analytics Views (5 Priority Charts)

1. **Context Saturation Graph** (Area chart) — Token usage over event index, showing sawtooth pattern of growth + compaction
2. **Tool Latency Waterfall** (Histogram) — Duration by tool type on log scale, answers "why is the session slow?"
3. **Cognitive Loop Detector** (Sequence graph) — Detect edit→test→edit→test death spirals, highlight in red
4. **Cost-per-Change Scatter** — Lines changed vs. estimated cost, identifies expensive low-output sessions
5. **Session Skill Radar** — Radar chart of tool categories (Search, Edit, Shell, Reasoning), classifies session type

### 7.6 Technical Implementation Details (from Codex)

#### JSONL Streaming & Indexing
- Use `fs.createReadStream` + `readline` for streaming parse
- Track byte offsets per event for random access
- Tolerate partial last line (active sessions)
- Incremental tailing via inode + offset watermark

#### Index Database Schema
```sql
-- Aggregated index for cross-session queries
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    summary TEXT,
    cwd TEXT, repository TEXT, branch TEXT,
    created_at TEXT, updated_at TEXT,
    event_count INTEGER, duration_ms INTEGER,
    lines_added INTEGER, lines_removed INTEGER,
    files_modified INTEGER, total_tokens INTEGER,
    health_score REAL, has_plan BOOLEAN,
    has_shutdown BOOLEAN, compaction_count INTEGER
);

CREATE TABLE events (
    id TEXT PRIMARY KEY,
    session_id TEXT, type TEXT, timestamp TEXT,
    parent_id TEXT, offset_start INTEGER, offset_end INTEGER,
    event_seq INTEGER
);
CREATE INDEX idx_events_session_type ON events(session_id, type);
CREATE INDEX idx_events_session_ts ON events(session_id, timestamp);

CREATE VIRTUAL TABLE event_fts USING fts5(
    content, session_id, type,
    content_rowid='rowid'
);

CREATE TABLE ingest_watermarks (
    session_id TEXT PRIMARY KEY,
    file_mtime TEXT, last_offset INTEGER, last_event_id TEXT
);

CREATE TABLE ingest_errors (
    session_id TEXT, line_no INTEGER, raw TEXT, reason TEXT
);
```

#### Active Session Safety
- Open `session.db` as `file:path?mode=ro` with `busy_timeout=1000`
- For reliable reads, snapshot-copy to temp then query readonly
- Use `chokidar` for file watching with debounce; broadcast via SSE

#### API Pagination
- Use cursor-based pagination: `?cursor=<timestamp,id>&limit=50&types=tool.*`
- Never use offset-based pagination for event streams

### 7.7 Missing High-Value Features (Aggregated)

| Feature | Source | Impact |
|---|---|---|
| **Session lineage / resume chains** | GPT-5.4, Opus | Detect continuation via shared git commits |
| **Keyboard-first navigation** | Opus | `j/k` list nav, `/` search, `[/]` turn nav, `?` help |
| **Deep linking** | Opus | `localhost:3000/session/abc123#event-456` |
| **Custom table rendering** | Opus | Auto-detect & render `bugs`, `review_findings`, etc. from session.db |
| **Code Video player** | Gemini | Replay edit events in a Monaco editor |
| **Annotation layer** | Gemini | User comments on events, stored in sidecar `viewer-notes.json` |
| **"Session Forking"** | Gemini | Resume from any point — the "killer feature" |
| **Post-mortem generator** | Gemini | One-click Markdown export: Goal → Plan → Decisions → Result |
| **Secrets scanner** | All | Regex-based PII/secret detection before export |
| **Version-aware parsers** | GPT-5.4 | Graceful fallback for unknown event types across CLI versions |

### 7.8 Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Schema drift across CLI versions | High | Version-aware parsers, unknown-event fallback, `copilotVersion` field |
| Active session file locking | High | Read-only opens, snapshot-copy for SQLite, tolerate partial JSONL |
| Huge tool output payloads | High | Lazy-load on demand, virtual scroll, server-side truncation |
| Privacy leaks via export | High | Secrets scanner, review step before export, localhost-only binding |
| Over-engineering before validation | Medium | Strict MVP scope — session list + detail + health only |
| Performance at 1000+ sessions | Medium | Pre-built index DB, incremental updates, default time-scoped views |

---

## Part 8: Revised Implementation Plan (Post-Review)

### Phase 0: Project Setup
- Initialize Next.js project with TypeScript + Tailwind + shadcn/ui
- Set up monorepo structure (if backend separation needed later)
- Configure development tooling (ESLint, Prettier)

### Phase 1: Data Layer + Session List (MVP Core)
- Session discovery: scan `~/.copilot/session-state/` for UUID dirs
- Parse workspace.yaml for all sessions → build session index
- Parse shutdown events from events.jsonl → extract metrics
- Compute session health scores (zombie detection, failure rates)
- Build `<SessionList>` with time-scoped views (Today/Week/Month/All)
- Session cards: title, repo, branch, health 🟢🟡🔴, duration, code stats
- Search/filter by summary, repo, branch, date range
- Resume command helper (copy `copilot --resume={id}`)

### Phase 2: Session Detail + Conversation Viewer
- Build conversation turn parser (group events by interaction/turn)
- Build `<SessionDigest>` — 3-sentence computed summary
- Build `<ConversationTimeline>` — turn-based, not event-based
- Collapsible `<ToolExecution>` blocks with success/failure indicators
- Subagent blocks with type and duration
- Compaction markers inline in conversation
- Plan.md rendered markdown viewer
- Todo list from session.db with status visualization
- Checkpoint summaries viewer
- Custom table detection and rendering from session.db

### Phase 3: Health Intelligence + Search
- Anomaly detection: retry storms, death spirals, scope creep
- Session health dashboard with computed insights
- SQLite FTS5 index for full-text search across events
- Search by user messages, tool outputs, assistant content
- Keyboard navigation (j/k, /, Enter, Esc, [/])
- Deep linking to sessions and events

### Phase 4: Visualizations + Analytics
- Token usage charts (per model, per session, trends)
- Context saturation graph (growth + compaction sawtooth)
- Tool latency analysis
- Code change trends
- Session skill classification radar
- Cost-per-change analysis

### Phase 5: Advanced Features
- Session lineage detection (related sessions via git state)
- Hierarchical swimlane timeline visualization
- Real-time file watching for active sessions (chokidar + SSE)
- Export with secrets review (markdown post-mortem, CSV)
- Annotation layer (viewer-notes.json sidecar)
- Session comparison view

---

## Part 9: Form Factor Analysis

| Form Factor | Pros | Cons | Verdict |
|---|---|---|---|
| **Next.js Web App** | One codebase, rich viz libraries, easy iteration, server-side file I/O | Requires running local server, no native FS access from browser | ✅ **Best for MVP** |
| **Tauri Desktop App** | Native file access, small footprint (~5MB), cross-platform, no server needed | Rust backend adds complexity, smaller ecosystem | ✅ **Best for polished product** |
| **Electron** | Pure JS/TS, broad package compat, mature ecosystem | Heavy (~100MB+), memory hog | ⚠️ Viable but heavy |
| **VS Code Extension** | Already in dev context, can open files/diffs directly | Restrictive WebView UI, limited viz capabilities | 🔄 Good stretch goal |
| **TUI (terminal)** | Matches CLI aesthetic, zero-install feel | Terrible for charts/timelines, limited layout | ❌ Not suitable for primary viewer |
| **Static Site Generator** | Zero runtime, just HTML files | Can't handle live data or large event streams | ❌ Too limiting |

**Recommended path:** Start with **Next.js** → Wrap in **Tauri** for desktop distribution → Consider **VS Code WebView** integration for the session list/resume feature specifically.

---

## Part 10: Shared Architecture for Tauri + CLI

Supporting both a **desktop UI** and a **CLI/TUI-style interface** is realistic if the project is designed around a shared core instead of making the Tauri app the whole product.

### 10.1 Recommended Structure

```text
tracepilot/
├── apps/
│   ├── desktop/          # Tauri app
│   ├── web/              # optional browser shell or shared frontend package
│   └── cli/              # thin CLI wrapper
├── crates/
│   ├── core/             # session discovery, parsing, indexing, health logic
│   ├── indexer/          # incremental indexing + FTS + watcher support
│   └── export/           # markdown/json/csv export + redaction helpers
├── packages/
│   ├── ui/               # shared React components
│   └── types/            # shared TS types for frontend contracts
└── docs/
```

### 10.2 The Core Design Principle

Do **not** make the desktop app the backend. Instead:

- Put session parsing, indexing, and health/anomaly detection into a **shared core library**
- Keep the **desktop app** as a UI shell over that core
- Keep the **CLI** as another shell over the same core

This gives:

- one implementation of JSONL/YAML/SQLite parsing
- one implementation of derived models like `ConversationTurn`, `ToolTransaction`, and `SessionHealth`
- one search/indexing pipeline
- multiple frontends: desktop UI, CLI, maybe later a VS Code extension

### 10.3 What Should Live in Rust vs TypeScript

#### Recommended Rust responsibilities

Rust is a strong fit for:

- file system scanning of large session directories
- robust JSONL streaming and partial-line tolerance
- SQLite read-only access and index management
- file watching / incremental indexing
- export/redaction logic
- high-performance derived metrics

#### Recommended TypeScript responsibilities

TypeScript/React is a strong fit for:

- desktop UI
- timeline and analytics rendering
- filtering and interactions
- keyboard shortcuts
- markdown rendering
- user settings/preferences UX

### 10.4 Is the Tauri Backend \"All Rust\"?

Not necessarily.

In a Tauri app:

- the **native/backend command layer** is usually Rust
- the **UI** is usually HTML/CSS/JS/TS (for example React)
- the frontend calls Rust commands via Tauri IPC

So in practice, the app is often:

- **Rust for native capabilities**
- **TypeScript for product/UI logic**

You do **not** need to put all business logic in Rust, but if you want the CLI and desktop app to share the same engine cleanly, Rust is a very good place for the core.

### 10.5 Two Viable Implementation Strategies

#### Option A: Rust Core + Tauri Desktop + Rust CLI

This is the most coherent long-term architecture.

```text
Rust core crate
├── used by Tauri commands
└── used by a separate CLI binary
```

**Pros**
- maximum code sharing
- best performance
- easiest to support both desktop and CLI cleanly
- strongest file-system and SQLite story

**Cons**
- highest upfront complexity
- Rust learning curve
- slower product iteration at first

#### Option B: TypeScript Core + Tauri Desktop + Node CLI

This is faster for an MVP if you want to stay mostly in TS.

```text
TypeScript core package
├── used by frontend/server layer
├── called from Tauri shell
└── used by a CLI command
```

**Pros**
- fastest iteration
- one language for most of the product
- easier hiring/onboarding

**Cons**
- weaker sharing with native desktop concerns
- more awkward story for file watching / SQLite / packaging
- may eventually need rewriting performance-sensitive pieces

### 10.6 Recommended Hybrid Path

The best practical path is:

1. Start with a **shared TypeScript product model** and UI vocabulary
2. Put the **high-friction system layer** in Rust early:
   - session discovery
   - JSONL parsing
   - SQLite reads
   - indexing
   - file watching
3. Keep the **desktop UI** in React
4. Add a **thin CLI** that calls the same Rust core

That gives you a good balance of speed and long-term architecture.

### 10.7 What a CLI Version Could Do Well

A CLI interface is absolutely viable, but it should not try to replicate every visualization.

The CLI is best for:

- listing recent sessions
- filtering by repo, branch, date, health
- searching session text quickly
- showing a concise session digest
- printing resume commands
- exporting summaries
- opening a desktop detail view for a given session

Example commands:

```bash
tracepilot list --repo Portify --last 7d
tracepilot show c86fe369 --summary
tracepilot search "asset discovery"
tracepilot resume-command c86fe369
tracepilot export c86fe369 --markdown
tracepilot open c86fe369
```

### 10.8 What the Desktop App Should Own

The Tauri desktop app should own the experiences that benefit from rich UI:

- conversation replay
- collapsible tool output
- charts and analytics
- swimlane timeline
- related session exploration
- inline diff or code playback

### 10.9 Main Complexities of Tauri

The main Tauri-specific complexities are:

1. **Rust command design**
   - Need a clean IPC boundary between frontend and Rust
   - Large payloads should be paginated rather than returned in one giant response

2. **Packaging and signing**
   - Desktop distribution is more complex than a web app
   - Windows signing/notarization workflows can add friction

3. **Async and watcher lifecycle**
   - File watchers and background indexing need careful lifecycle management
   - The desktop app must stay responsive while indexing large session stores

4. **Frontend/backend contract drift**
   - Rust structs and TS types must stay in sync
   - Generate schemas or use a shared contract layer where possible

5. **Plugin and native capability decisions**
   - Decide early whether to use Tauri plugins for shell, opener, filesystem, store, notifications, etc.

### 10.10 Suggested Interface Boundary

Whether the shell is desktop or CLI, expose a stable core API conceptually like:

```text
list_sessions(filters)
get_session_summary(session_id)
get_session_turns(session_id, cursor)
get_session_metrics(session_id)
search_sessions(query, filters)
export_session(session_id, format)
watch_sessions()
```

The desktop app can call these through Tauri commands.
The CLI can call the same core functions directly.

### 10.11 Recommendation

If the goal is a serious long-term tool, the strongest architecture is:

- **Tauri desktop app for primary experience**
- **shared Rust core for parsing/indexing/search**
- **React/TypeScript frontend for the desktop UI**
- **thin CLI over the same Rust core**

If the goal is fastest possible MVP, start with:

- **Next.js or Vite web app**
- then migrate the system-heavy layer into Rust
- then wrap the mature UI in Tauri

### 10.12 Chosen Project Name

The selected working name for this project is **TracePilot**.

Why it fits:

- strong observability / audit feel
- still sounds aligned with agentic workflows
- works well for both desktop UI and CLI commands
- feels productizable without being overly generic

Suggested naming conventions:

- **Desktop app:** `TracePilot`
- **CLI binary:** `tracepilot`
- **Local app data:** `~/.copilot/tracepilot/`
- **Repository name:** `tracepilot`

---

## Part 11: Draft Monorepo Layout

This is a practical monorepo shape for building **TracePilot** next.

### 11.1 Recommended Repository Layout

```text
tracepilot/
├── apps/
│   ├── desktop/                    # Tauri app shell
│   │   ├── src/                    # React app
│   │   ├── src-tauri/              # Tauri/Rust entrypoint + commands
│   │   ├── package.json
│   │   └── tauri.conf.json
│   └── cli/                        # Thin CLI wrapper
│       ├── src/
│       ├── package.json
│       └── README.md
├── crates/
│   ├── tracepilot-core/            # Session discovery, parsers, derived models
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── session/
│   │   │   ├── parsing/
│   │   │   ├── models/
│   │   │   └── health/
│   │   └── Cargo.toml
│   ├── tracepilot-indexer/         # Incremental indexing, watchers, FTS sync
│   │   ├── src/
│   │   └── Cargo.toml
│   ├── tracepilot-export/          # Markdown/JSON/CSV export + redaction
│   │   ├── src/
│   │   └── Cargo.toml
│   └── tracepilot-tauri-bindings/  # Thin Tauri command layer over core
│       ├── src/
│       └── Cargo.toml
├── packages/
│   ├── ui/                         # Shared React UI components
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── charts/
│   │   │   ├── timeline/
│   │   │   └── index.ts
│   │   └── package.json
│   ├── types/                      # Shared TS API contracts / DTOs
│   │   ├── src/
│   │   └── package.json
│   ├── config/                     # Shared tsconfig/eslint/tailwind presets
│   │   ├── eslint/
│   │   ├── typescript/
│   │   └── package.json
│   └── client/                     # TS client wrapper for desktop/CLI UI calls
│       ├── src/
│       └── package.json
├── scripts/
│   ├── dev.ps1
│   ├── build.ps1
│   └── release.ps1
├── docs/
│   ├── architecture/
│   ├── decisions/
│   └── screenshots/
├── Cargo.toml
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

### 11.2 Responsibilities by Workspace

| Workspace | Responsibility |
|---|---|
| `apps/desktop` | Main Tauri desktop product |
| `apps/cli` | User-facing command-line experience |
| `crates/tracepilot-core` | Parsing `workspace.yaml`, `events.jsonl`, `session.db`; building session models |
| `crates/tracepilot-indexer` | Maintaining `~/.copilot/tracepilot/index.db` |
| `crates/tracepilot-export` | Safe export and redaction |
| `crates/tracepilot-tauri-bindings` | Tauri command handlers and IPC-facing wrappers |
| `packages/ui` | Shared UI kit for session cards, timeline blocks, charts |
| `packages/types` | Shared API contracts between UI and Rust boundary |
| `packages/client` | Frontend helper to call Tauri/backend commands consistently |

### 11.3 Suggested First Build Order

Build the monorepo in this order:

1. `crates/tracepilot-core`
   - session discovery
   - `workspace.yaml` parsing
   - `events.jsonl` parsing
   - derived models: `SessionSummary`, `ConversationTurn`, `ToolTransaction`

2. `crates/tracepilot-indexer`
   - create and maintain `~/.copilot/tracepilot/index.db`
   - index metadata, shutdown metrics, and FTS documents

3. `apps/cli`
   - `tracepilot list`
   - `tracepilot show`
   - `tracepilot search`
   - `tracepilot resume-command`

4. `apps/desktop`
   - session list
   - session detail
   - turn-based conversation view

### 11.4 Recommended Tooling

- **Package manager:** `pnpm`
- **Workspace orchestration:** `Turborepo` if helpful, optional at first
- **Rust workspace:** standard Cargo workspace
- **Frontend:** React + TypeScript + Vite inside Tauri
- **Testing:** Vitest for UI, Rust tests for parsing/indexing logic

### 11.5 Naming Conventions

Use these package names:

- `@tracepilot/desktop`
- `@tracepilot/cli`
- `@tracepilot/ui`
- `@tracepilot/types`
- `@tracepilot/client`

Use these Rust crate names:

- `tracepilot-core`
- `tracepilot-indexer`
- `tracepilot-export`
- `tracepilot-tauri-bindings`

### 11.6 Minimal First Milestone

The first shippable milestone for this monorepo should be:

- `tracepilot list` works from the CLI
- the desktop app shows all sessions from `workspace.yaml`
- clicking a session shows:
  - summary
  - repo/branch
  - created/updated times
  - shutdown metrics if available
  - first 20 conversation turns

That milestone proves the monorepo shape, the shared core, and the desktop + CLI dual-surface strategy before heavier analytics work begins.
