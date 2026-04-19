# Session File Explorer — Technical Analysis Report

**Purpose:** This report documents the GitHub Copilot session-state directory structure,
every file type contained within sessions, and the TracePilot codebase context needed to
design and implement a File Explorer UI.

**Data sources:**
- 5+ live sessions examined across multiple session directories
- TracePilot codebase: `apps/desktop/src/`, `crates/`, `packages/`

---

## Section 1: Session Directory Structure

### Top-Level Layout

```
~/.copilot/session-state/
└── <session-uuid>/                          # e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    ├── events.jsonl                          # ALWAYS present — primary event log
    ├── workspace.yaml                        # ALWAYS present — session metadata
    ├── vscode.metadata.json                  # ALWAYS present — VS Code extension metadata
    ├── session.db                            # ALWAYS present — SQLite state database
    ├── inuse.<pid>.lock                      # Present when session is ACTIVE
    ├── plan.md                               # Optional — agent-generated planning doc
    ├── checkpoints/
    │   ├── index.md                          # ALWAYS present (may be empty table)
    │   ├── 001-<slug>.md                     # Checkpoint files (numbered, slugged)
    │   ├── 002-<slug>.md
    │   └── ...
    ├── files/
    │   ├── <agent-output>.md                 # Agent-created output files
    │   └── ...
    ├── research/                             # Reserved directory (currently empty in practice)
    └── rewind-snapshots/
        ├── index.json                        # Snapshot registry
        └── backups/
            ├── <hash>-<timestamp>            # Binary backup files (no extension)
            └── ...
```

### Session Counts and Naming

| Metric | Value |
|--------|-------|
| Total session directories | varies by user |
| Naming convention | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (UUID v4) |
| Active sessions | Identified by `inuse.<pid>.lock` presence |
| `session.db` size range | 20 KB (minimal) – 61 KB (large sessions with custom tables) |
| `events.jsonl` size range | ~0 (empty) – 1.5 MB+ (long sessions) |

### Subdirectory Presence by Session

| File/Dir | Always Present | Notes |
|----------|---------------|-------|
| `events.jsonl` | ✅ | Core event log; may be very small for empty sessions |
| `workspace.yaml` | ✅ | Written at session start |
| `vscode.metadata.json` | ✅ | Often just `{}` |
| `session.db` | ✅ | Created at startup; always has `todos`/`todo_deps` tables |
| `inuse.<pid>.lock` | Only when running | Contains PID as plain text |
| `checkpoints/` | ✅ | Directory always exists; `index.md` always present |
| `files/` | ✅ | Directory always exists; contents vary |
| `research/` | ✅ | Directory always exists; typically empty |
| `rewind-snapshots/` | ✅ | Always present; `backups/` may be empty |
| `plan.md` | Optional | Only when agent uses the SQL `plan.md` feature |

---

## Section 2: File-by-File Analysis

### 2.1 `events.jsonl`

- **Format:** JSON Lines (one JSON object per line)
- **Contents:** Complete chronological log of everything that happened in the session —
  user messages, assistant responses, tool calls, sub-agent launches, model changes,
  compactions, shutdown.
- **Schema:** Each line has: `type` (string), `id` (UUID), `timestamp` (ISO 8601 UTC),
  `parentId` (UUID or null), `data` (object, varies by type).
- **UI Value:** The primary content of any session. Contains the full conversation,
  tool use timeline, and agent reasoning.
- **Display Priority:** 🔴 **HIGH**
- **Size concern:** Can reach 1.5 MB+. Use the existing `get_session_events` Tauri
  command (paginated, filterable by type) rather than reading raw JSONL in the UI.

### 2.2 `workspace.yaml`

- **Format:** YAML
- **Contents:** Session-level metadata written at start and updated as session progresses.
- **Schema:**
  ```yaml
  id: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  cwd: /path/to/repo
  git_root: /path/to/repo
  repository: owner/repo
  host_type: github
  branch: main
  summary: Surgical Tech Debt Fixes         # Human-readable session title
  summary_count: 0
  created_at: 2026-04-19T07:01:33.148Z
  updated_at: 2026-04-19T07:02:00.157Z
  ```
- **UI Value:** Provides context panel data — repo, branch, directory, session title,
  and timestamps. Already surfaced via `workspace.yaml` fields. These fields are
  already available via `get_session_detail`.
- **Display Priority:** 🟡 **MEDIUM** (data already accessible via existing API;
  raw YAML view useful for debugging/inspection)

### 2.3 `vscode.metadata.json`

- **Format:** JSON
- **Contents:** VS Code extension state metadata. Observed as `{}` in all examined
  sessions — the extension likely writes here for its own purposes. May contain
  extension-specific editor state in future.
- **Schema:** Currently always `{}`
- **UI Value:** Low value currently; may become relevant for editor integration context.
- **Display Priority:** 🟢 **LOW**

### 2.4 `session.db`

- **Format:** SQLite 3
- **Contents:** Agent-managed relational state for the session. Always contains the
  built-in `todos`/`todo_deps` tables. Complex sessions add custom task-tracking tables.
- **Schema (always-present tables):**
  ```sql
  -- todos (standard task tracker)
  CREATE TABLE todos (
    id        TEXT PRIMARY KEY,
    title     TEXT NOT NULL,
    description TEXT,
    status    TEXT DEFAULT 'pending',   -- pending | in_progress | done | blocked
    created_at TEXT DEFAULT datetime('now'),
    updated_at TEXT DEFAULT datetime('now')
  );

  -- todo_deps (dependency graph)
  CREATE TABLE todo_deps (
    todo_id    TEXT NOT NULL,
    depends_on TEXT NOT NULL,
    PRIMARY KEY (todo_id, depends_on)
  );
  ```
- **Schema (observed custom tables in a session with complex agent work):**
  ```sql
  -- Custom tables created by the agent for PR review tracking:
  pr_reviews    (pr_number, model, agent_id, verdict, confidence, summary, risk, status)
  pr_adjudication (pr_number, agent_id, final_verdict, net_impact_score, risk_level,
                   status, confidence, required_changes, notes)
  pr_metadata   (pr_number, title, author, category, branch)
  merge_status  (pr_number, batch, merge_order, title, verdict, score, risk, status, notes)
  ```
- **UI Value:** The `todos` table is the agent's running task list — extremely useful
  for understanding session progress. Custom tables reveal structured data the agent
  built during complex tasks. Already partially surfaced via `get_session_todos`.
- **Display Priority:** 🔴 **HIGH** (todos), 🟡 **MEDIUM** (custom tables)

### 2.5 `inuse.<pid>.lock`

- **Format:** Plain text
- **Contents:** Single line: the PID of the process using this session (e.g., `29700`).
  File exists only when session is currently active.
- **Schema:** `<integer PID>\n`
- **UI Value:** Used to determine if a session is "live". The `isRunning` field in
  `SessionListItem` already exposes this information. The raw file adds the actual PID.
- **Display Priority:** 🟢 **LOW** (but PID value could be shown in the status chip)

### 2.6 `checkpoints/index.md`

- **Format:** Markdown
- **Contents:** A markdown table listing all checkpoints in chronological order.
- **Example:**
  ```markdown
  # Checkpoint History
  Checkpoints are listed in chronological order. Checkpoint 1 is the oldest.

  | # | Title | File |
  |---|-------|------|
  | 1 | Multi-model PR review discovery and batch 1 | 001-multi-model-pr-review-discover.md |
  | 2 | Multi-model PR review batches 1-2 | 002-multi-model-pr-review-batches.md |
  ```
- **UI Value:** Navigation index for checkpoints. Provides ordered list of all
  milestones in the session.
- **Display Priority:** 🟡 **MEDIUM** (use as navigation sidebar, not rendered content)

### 2.7 `checkpoints/<NNN>-<slug>.md`

- **Format:** Markdown with structured XML-like section tags
- **Contents:** A point-in-time snapshot of agent state and work done. Contains
  `<overview>`, `<history>`, and `<work_done>` sections.
- **Example excerpt:**
  ```markdown
  <overview>
  The user requested a comprehensive multi-model review of all 20 open non-dependabot PRs
  in the MattShelton04/TracePilot repository...
  </overview>
  <history>
  1. User requested review of all open non-dependabot PRs...
  </history>
  <work_done>
  ## Completed Review Results
  ### PR #410 (Add unit tests for formatLiveDuration)
  - **codex (91/100)**: Accept - Good tests...
  </work_done>
  ```
- **Schema:** Already parsed by `checkpointParser.ts` in the codebase:
  `overview`, `history`, `work_done` sections via `SECTION_DEFS`.
- **UI Value:** Rich session history — shows what the agent understood and accomplished
  at each milestone. Already rendered via `CheckpointContentView.vue`.
- **Display Priority:** 🔴 **HIGH**

### 2.8 `files/<name>.md`

- **Format:** Markdown (other types possible in future)
- **Contents:** Agent-created output files. These are documents the agent produced
  as deliverables — reports, analyses, summaries, etc.
- **Example:** `pr-review-report.md` — a full PR review summary with tables, scores,
  and recommendations across 20 PRs.
- **UI Value:** The most user-facing output of a session. These are the documents
  users explicitly asked the agent to produce.
- **Display Priority:** 🔴 **HIGH**

### 2.9 `plan.md` (root level, optional)

- **Format:** Markdown
- **Contents:** Agent's top-level planning document for the session. Updated
  progressively as work completes.
- **Example:**
  ```markdown
  # PR Review Plan — TracePilot

  ## Overview
  Reviewing 20 open non-dependabot PRs in MattShelton04/TracePilot.
  AI-generated technical debt reduction PRs from Claude, Codex, Copilot, and human.

  ## Phase 1: Discovery ✅
  - 20 open PRs identified, all diffs fetched

  ## Phase 2: Multi-Agent Review
  - 4 review agents per PR (opus-4.6, gpt-5.4, codex-5.3, sonnet-4.5)
  ```
- **Schema:** Free-form markdown; no standard structure enforced.
- **UI Value:** High-level session overview. Helps users understand what the session
  was trying to achieve at a glance.
- **Display Priority:** 🔴 **HIGH** (when present — show prominently in session overview)

### 2.10 `rewind-snapshots/index.json`

- **Format:** JSON
- **Contents:** Registry of all rewind snapshots, mapping event IDs to point-in-time
  file system states.
- **Schema:**
  ```json
  {
    "version": 1,
    "snapshots": [
      {
        "snapshotId": "a47a9d74-e778-4f10-9256-b9bf385161a3",
        "eventId": "df21aa4d-2111-4ffa-a876-437763a6f0f1",
        "userMessage": "You are working in the TracePilot repo...",
        "timestamp": "2026-04-19T07:01:57.059Z",
        "fileCount": 0,
        "gitCommit": "ab45f19a6021083fc66c22b9c66afc6996047888",
        "gitBranch": "main",
        "backupHashes": [],
        "files": {}
      }
    ],
    "filePathMap": {}
  }
  ```
- **UI Value:** Enables a "time travel" view — correlating session events to the exact
  git state of the repository at that moment. The `userMessage` field contains the
  full original user prompt for each snapshot.
- **Display Priority:** 🟡 **MEDIUM**

### 2.11 `rewind-snapshots/backups/<hash>-<timestamp>`

- **Format:** Binary (likely zstd-compressed diff/patch)
- **Contents:** File system snapshots for rewind operations. Named by content hash.
- **UI Value:** Binary; not directly renderable. Value is in the index.json metadata.
- **Display Priority:** 🟢 **LOW** (expose hash/size as metadata only)

---

## Section 3: `events.jsonl` Deep Dive

### Unique Event Types

From analysis across multiple sessions, **11 distinct event types** are observed:

| Event Type | Description |
|-----------|-------------|
| `session.start` | Session initialization — CWD, git context, version info |
| `session.shutdown` | Session end — contains detailed metrics (tokens, duration, model usage) |
| `session.model_change` | Model was changed by user (e.g., `"newModel": "auto"`) |
| `session.compaction_start` | Context compaction — records token counts before compaction |
| `system.message` | System prompt — contains the full CLI system prompt text |
| `user.message` | User's input — `content` (raw) + `transformedContent` (with injected context) |
| `assistant.turn_start` | Beginning of an assistant response turn |
| `assistant.message` | Assistant's response — `content` (text) + `toolRequests` array |
| `assistant.turn_end` | End of an assistant turn — `data.turnId` |
| `tool.execution_start` | Tool call initiated — `toolCallId`, `toolName`, `arguments` |
| `tool.execution_complete` | Tool result — `toolCallId`, `success`, `result`, `toolTelemetry` |
| `subagent.started` | Sub-agent launched — `toolCallId`, `agentName`, `agentDisplayName` |

### Timestamp Format

ISO 8601 UTC: `"2026-04-19T07:01:33.173Z"`

Precision: milliseconds. All events carry consistent UTC timestamps.

### Event ID and Parent Linking

Every event has:
- `id`: UUID v4 (unique per event)
- `parentId`: UUID of parent event (or `null` for root events like `session.start`)

This creates a **tree structure** — tool executions are children of `assistant.message`
events; tool completions are children of tool starts. This enables conversation-turn
reconstruction.

### Example Events (Sanitized)

**`session.start`:**
```json
{
  "type": "session.start",
  "data": {
    "sessionId": "xxxxxxxx-...",
    "version": 1,
    "producer": "copilot-agent",
    "copilotVersion": "1.0.x",
    "startTime": "2026-01-01T00:00:00.000Z",
    "context": {
      "cwd": "C:\\git\\your-repo",
      "gitRoot": "C:\\git\\your-repo",
      "branch": "main",
      "headCommit": "abcdef12...",
      "repository": "owner/repo",
      "hostType": "github",
      "baseCommit": "abcdef12..."
    },
    "alreadyInUse": false,
    "remoteSteerable": false
  },
  "id": "a3c7de96-...",
  "timestamp": "2026-04-19T07:01:33.173Z",
  "parentId": null
}
```

**`user.message`:**
```json
{
  "type": "user.message",
  "data": {
    "content": "Find 3 independent pieces of suboptimal code...",
    "transformedContent": "<current_datetime>2026-04-19T17:01:56...</current_datetime>\n...",
    "attachments": [],
    "interactionId": "63a544fb-..."
  },
  "id": "df21aa4d-...",
  "timestamp": "2026-04-19T07:01:56.227Z",
  "parentId": "25d62c4b-..."
}
```

**`assistant.message`:**
```json
{
  "type": "assistant.message",
  "data": {
    "messageId": "4194cb89-...",
    "content": "",
    "toolRequests": [
      {
        "toolCallId": "tooluse_abc123",
        "name": "report_intent",
        "arguments": { "intent": "Planning tech debt fixes" },
        "type": "function",
        "intentionSummary": "Planning tech debt fixes"
      }
    ],
    "interactionId": "63a544fb-...",
    "reasoningOpaque": "<base64-encrypted>",
    "reasoningText": "Let me start by understanding the task...",
    "outputTokens": 558,
    "requestId": "FB6B:2C0539:..."
  },
  "id": "e41e203a-...",
  "timestamp": "2026-04-19T07:02:04.899Z",
  "parentId": "ada4817b-..."
}
```

**`tool.execution_complete`:**
```json
{
  "type": "tool.execution_complete",
  "data": {
    "toolCallId": "tooluse_9GUclUeNE9uZW1WkHL7eo2",
    "model": "claude-sonnet-4.6",
    "interactionId": "63a544fb-...",
    "success": true,
    "result": {
      "content": "Intent logged",
      "detailedContent": "Planning tech debt fixes"
    },
    "toolTelemetry": {}
  },
  "id": "6a23c6b8-...",
  "timestamp": "2026-04-19T07:02:04.917Z",
  "parentId": "361ee191-..."
}
```

**`session.compaction_start`:**
```json
{
  "type": "session.compaction_start",
  "data": {
    "systemTokens": 10864,
    "conversationTokens": 78829,
    "toolDefinitionsTokens": 14385
  },
  "id": "a93da41f-...",
  "timestamp": "2026-04-19T07:10:42.166Z",
  "parentId": "bbf23dd9-..."
}
```

### Display Recommendations

- **Primary view:** Timeline (chronological list), grouped by conversation turn
  (user message → assistant response → tool calls)
- **Grouping:** By `interactionId` (present on user.message, assistant.message,
  tool.execution_complete) — this is the natural turn boundary
- **Filtering:** Dropdown for event type; date range slider; keyword search on
  content fields
- **Special handling:**
  - `assistant.message.reasoningText`: render as collapsible "thinking" block
    (matches `ReasoningBlock.vue` pattern in codebase)
  - `tool.execution_complete.result`: lazy-load large results via existing
    `get_tool_result` Tauri command
  - `system.message.data.content`: collapse to a summary (very long; rarely needed)
  - `session.compaction_start`: show as a visual marker/divider in the timeline

---

## Section 4: SQLite Database Analysis

### Database File

- **Name:** `session.db` (one per session directory)
- **Size range:** 20 KB (minimal — only todos) to 61 KB+ (rich multi-table sessions)
- **Format:** SQLite 3

### Always-Present Tables

| Table | Purpose | Row counts (typical) |
|-------|---------|----------------------|
| `todos` | Agent task tracker | 1–30 rows |
| `todo_deps` | Task dependency graph | 0–20 rows |

### Session-Specific Custom Tables (observed)

These are created by the agent at runtime based on task needs. Examples from a
PR-review session:

| Table | Description |
|-------|-------------|
| `pr_reviews` | Per-PR, per-model review results |
| `pr_adjudication` | Consolidated verdict per PR |
| `pr_metadata` | PR title/author/category index |
| `merge_status` | Merge sequencing and status tracking |

### Recommended Queries

```sql
-- Show active/pending todos with dependency status
SELECT
  t.*,
  CASE WHEN EXISTS (
    SELECT 1 FROM todo_deps d
    JOIN todos dep ON d.depends_on = dep.id
    WHERE d.todo_id = t.id AND dep.status != 'done'
  ) THEN 'blocked_by_dep' ELSE t.status END AS effective_status
FROM todos t
ORDER BY created_at;

-- Dependency graph
SELECT t.id, t.title, t.status, d.depends_on
FROM todos t
LEFT JOIN todo_deps d ON t.id = d.todo_id;

-- Summary by status
SELECT status, COUNT(*) FROM todos GROUP BY status;
```

### UI Recommendations

- **Todos table:** Render as a kanban-style board or status-grouped list with
  dependency visualization. Status badges using existing `StatusIcon.vue`.
- **Custom tables:** Expose in a "Database" tab with a table selector. Render
  each table as a `DataTable.vue` grid (already exists in `@tracepilot/ui`).
- **Custom SQL:** Offer an optional "raw query" text input for power users,
  with results shown in a data table.
- **Exportable:** Add CSV export for any table result.

---

## Section 5: YAML/JSON Config Files

### `workspace.yaml`

Already analyzed in Section 2.2. Key fields for display:

| Field | UI Display |
|-------|-----------|
| `summary` | Session title (H1 / page header) |
| `repository` | Linked badge (`MattShelton04/TracePilot`) |
| `branch` | Git branch chip |
| `cwd` | Monospace path display |
| `created_at` / `updated_at` | Relative timestamps |
| `summary_count` | Checkpoint/milestone count |

**Recommendation:** Don't display raw YAML. Parse it and show as a structured
`DefList.vue` metadata panel. The existing `SessionDetail` type already exposes
these fields; use the existing API rather than reading the file directly.

### `vscode.metadata.json`

Currently always `{}`. Display as a collapsible "raw JSON" section in an advanced
inspect panel. Use syntax-highlighted JSON viewer (needs a library — see Section 7.3).

### `rewind-snapshots/index.json`

**Recommendation:** Parse and show as a structured "Rewind History" list — each
snapshot as a row with timestamp, user message preview, git commit hash, and file count.
Do not display raw JSON to end users.

---

## Section 6: Markdown Files

### Files Found

| Location | Type | Description |
|----------|------|-------------|
| `plan.md` (root) | Agent-generated | Top-level session plan, updated progressively |
| `checkpoints/index.md` | Agent-generated | Checkpoint navigation table |
| `checkpoints/<NNN>-<slug>.md` | Agent-generated | Point-in-time state snapshots |
| `files/<name>.md` | Agent-created deliverables | Reports, analyses, output docs |

### Content Classification

All markdown files in a session are **agent-generated** (not user-authored). They
represent either:
- **Plans** (`plan.md`): structured work-breakdown docs with progress tracking
- **Snapshots** (checkpoints): structured state-of-work captures with `<section>` tags
- **Deliverables** (`files/`): user-requested output documents (reports, summaries)
- **Navigation indexes** (`checkpoints/index.md`): auto-maintained tables of contents

### Display Recommendation

- **Always use rendered view by default** — these are authored as markdown and benefit
  from formatted rendering. Use the existing `MarkdownContent.vue` component from
  `@tracepilot/ui`.
- **Provide raw toggle** — the `MarkdownContent.vue` component already has a `render`
  prop for switching to raw `pre-wrap` display.
- **Checkpoint files** — use the existing `CheckpointContentView.vue` component which
  already parses the `<overview>/<history>/<work_done>` sections and renders them
  as collapsible cards.
- **`files/` deliverables** — render with `MarkdownContent.vue` in a full-width panel,
  prioritized in the UI as the most valuable output.

---

## Section 7: TracePilot Codebase Context

### 7.1 Skills File Browser — Existing Implementation

The closest analog to a file browser UI already in the codebase:

**`SkillAssetsTree.vue`** — `apps/desktop/src/components/skills/SkillAssetsTree.vue`
- Renders a two-level tree: flat folders (from path segments) and files within them
- Displays file name, size (formatted), and a remove button per file
- Collapsible folders with toggle chevrons
- Supports "new file" inline input, "add asset" action, "view asset" click
- Props: `assets: SkillAsset[]`, `loading: boolean`
- Emits: `addAsset`, `removeAsset`, `viewAsset`, `newFile`

**The session file explorer should use `SkillAssetsTree.vue` as the structural
template** — it has the exact layout pattern (header, tree, item rows) needed.

#### Supporting Components
- **`SkillAssetPreviewModal.vue`** — modal for previewing a skill asset
- **`SkillEditorPreviewPane.vue`** — split-pane preview rendering

### 7.2 Existing Tauri Commands for Session Data

From `packages/client/src/sessions.ts`:

| Command | What It Returns |
|---------|----------------|
| `list_sessions` | Paginated session list with metadata |
| `get_session_detail` | Full session detail (hasPlan, hasCheckpoints, etc.) |
| `get_session_events` | Paginated+filterable events from events.jsonl |
| `get_session_turns` | Reconstructed conversation turns |
| `get_session_todos` | Todos from session.db |
| `get_session_checkpoints` | Checkpoint entries (title, file, content) |
| `get_session_plan` | Contents of plan.md |
| `get_session_sections` | Discovers which sections have data (for lazy loading) |
| `get_tool_result` | Lazy-load a specific tool call result by ID |
| `check_session_freshness` | Lightweight poll for events.jsonl changes |
| `get_session_incidents` | Errors, rate limits, compactions from index DB |
| `search_sessions` | Full-text session search |
| `resume_session_in_terminal` | Open terminal to resume session |

#### **Gap Analysis — Missing Commands for File Explorer**

The following operations have **no existing Tauri command** and will need new
backend support:

| Missing Operation | Rationale |
|------------------|-----------|
| `list_session_files(sessionId)` | List files in `files/` directory |
| `get_session_file(sessionId, name)` | Read a file from `files/` |
| `get_workspace_yaml(sessionId)` | Read workspace.yaml as structured data (partially covered by `get_session_detail`) |
| `query_session_db(sessionId, sql)` | Run SQL against session.db custom tables |
| `list_db_tables(sessionId)` | List all tables in session.db beyond todos |
| `get_rewind_snapshots(sessionId)` | Parse rewind-snapshots/index.json |
| `get_session_file_tree(sessionId)` | Complete directory listing including all subdirs |

### 7.3 Syntax Highlighting

**Current state:** No syntax highlighting library is installed in the project.

The `MarkdownContent.vue` component renders code blocks as `<pre><code>` with
`var(--canvas-inset)` background but **no language-based coloring**.

For the file explorer, syntax highlighting would benefit:
- JSON files (`vscode.metadata.json`, `rewind-snapshots/index.json`)
- YAML files (`workspace.yaml`)
- SQL queries in the database viewer
- Code blocks inside checkpoint and deliverable markdown files

**Recommended library:** `shiki` (tree-sitter based, supports all needed languages,
SSR-safe, theme-able with CSS variables). Alternative: `highlight.js` (smaller,
simpler integration, works with Vue's `v-html`).

### 7.4 Markdown Rendering

**`MarkdownContent.vue`** — `packages/ui/src/components/MarkdownContent.vue`

- **Library:** `markdown-it` (in `packages/ui/node_modules/markdown-it`)
- **Sanitization:** `DOMPurify` (in `packages/ui/node_modules/dompurify`)
- **Props:** `content: string`, `maxHeight?: string`, `render?: boolean` (default `true`)
- **Features:** Internal anchor navigation, external link intercept (emits
  `open-external`), `<pre><code>` blocks with mono font
- **Shared singleton:** Lazily initialized via `ensureMarkdownReady()` / `renderMarkdown()`

**Use this component directly** for all markdown rendering in the file explorer.
It is already used in `CheckpointContentView.vue`, `ChatViewMode.vue`,
`ReplayStepContent.vue`, and `AgentTreeDetailPanel.vue`.

### 7.5 Existing UI Components to Reuse

| Component | Location | Use in File Explorer |
|-----------|----------|---------------------|
| `MarkdownContent.vue` | `@tracepilot/ui` | Render .md files, checkpoints |
| `DataTable.vue` | `@tracepilot/ui` | SQLite table viewer |
| `ToolCallDetail.vue` | `@tracepilot/ui` | Tool call rendering in events viewer |
| `ReasoningBlock.vue` | `@tracepilot/ui` | Show `reasoningText` from assistant events |
| `DefList.vue` | `@tracepilot/ui` | Show workspace.yaml metadata |
| `CheckpointContentView.vue` | `apps/desktop/src/components/checkpoints/` | Render checkpoint files |
| `ExpandChevron.vue` | `@tracepilot/ui` | Collapsible sections |
| `TabNav.vue` | `@tracepilot/ui` | Switching between file types |
| `SearchInput.vue` | `@tracepilot/ui` | Filter events/files |
| `FilterSelect.vue` | `@tracepilot/ui` | Event type filter dropdown |

---

## Section 8: UI Design Recommendations

### 8.1 Events.jsonl Viewer

**Layout:** Three-panel split:
```
┌──────────────────────────────────────────────────────────┐
│  [All Events ▾]  [Type filter ▾]  [🔍 Search...]         │
│  ─────────────────────────────────────────────────────    │
│  TURN 1                                        07:01:56   │
│  ► 👤 User message                                        │
│  ► 🤖 Assistant (3 tool calls)                 07:02:04   │
│     ├─ 🔧 report_intent                        ✓ 0ms      │
│     ├─ 🔧 sql                                  ✓ 12ms     │
│     └─ 🔧 powershell                           ✓ 45ms     │
│  TURN 2                                        07:02:34   │
│  ► 🤖 Assistant (sub-agent launched)                      │
│     └─ 🚀 explore-agent started                           │
│                                                           │
│  ─── ⚡ COMPACTION (78,829 tokens) ───────────────────── │
└──────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- Group events by **conversation turn** (using `interactionId` linkage)
- Collapse tool calls under their parent assistant message by default
- Show `session.compaction_start` as a visual **divider** with token counts
- For `assistant.message.reasoningText`: render in a collapsible `ReasoningBlock`
  (grey background, italic text) — matches existing component
- For `tool.execution_complete.result`: show inline if small (<500 chars);
  "Load full result" button for large results (calls `get_tool_result`)
- `system.message`: collapse to one-line chip "System prompt — click to expand"
- Timestamps: relative ("2 min ago") with tooltip showing absolute ISO

**Filtering:**
- Event type multi-select (11 types)
- Date/time range
- Keyword search on `data.content`, `data.result.content`, `data.arguments`
- Toggle: show/hide tool events, show/hide system messages

**Grouping options:** By turn (default), by event type, flat chronological

### 8.2 SQLite Viewer

**Layout:** Two-panel:
```
┌────────────────┬──────────────────────────────────────────┐
│ TABLES         │  todos (19 rows)                          │
│ ──────────     │  ┌──────┬───────────┬────────┬───────────┐│
│ todos      19  │  │ id   │ title     │ status │ updated   ││
│ todo_deps   0  │  ├──────┼───────────┼────────┼───────────┤│
│ pr_reviews 80  │  │ t1   │ Explore…  │ done   │ 07:02:04  ││
│ pr_adjud…  20  │  │ t2   │ Baseline… │ done   │ 07:05:12  ││
│            │  │ t3   │ Fix 1     │ done   │ 07:08:45  ││
│ [Custom SQL]   │  └──────┴───────────┴────────┴───────────┘│
└────────────────┴──────────────────────────────────────────┘
```

- Left panel: table list with row counts
- Right panel: `DataTable.vue` with sortable columns
- `todos.status` column: render as colored status badge
- "Custom SQL" expandable textarea with "Run" button
- Export button (CSV)
- Todos table is auto-selected on load (highest value)

### 8.3 YAML/JSON Viewer

**For `workspace.yaml`:** Parse and display as a structured `DefList.vue` metadata card.
Do NOT show raw YAML as the primary view.

**For `vscode.metadata.json`:** Syntax-highlighted JSON tree (collapsible).
Since it's typically `{}`, show "No VS Code metadata" empty state.

**For `rewind-snapshots/index.json`:** Parse and render as a structured timeline list
(see Section 8.5 — Session Overview).

**Implementation pattern:**
```
[Parsed View]  [Raw YAML/JSON]     ← toggle tabs
```
Raw view: `<pre>` with monospace font and syntax highlighting via `shiki`/`highlight.js`.

### 8.4 Markdown Viewer

**For `plan.md` and `files/*.md`:**
```
┌──────────────────────────────────────────────────────────┐
│ 📄 pr-review-report.md              [Rendered] [Raw] [⎘] │
│ ─────────────────────────────────────────────────────    │
│ (rendered MarkdownContent.vue output)                     │
└──────────────────────────────────────────────────────────┘
```
- Default: rendered mode via `MarkdownContent.vue`
- Toggle: "Raw" button switches `render` prop to `false`
- Copy button: copies raw markdown text
- Full-width panel (these are important output documents)

**For checkpoint files:** Use existing `CheckpointContentView.vue` component directly.
It already handles the structured `<overview>/<history>/<work_done>` parsing.

### 8.5 Session Overview Panel

The top-level panel shown when a session is selected:

```
┌──────────────────────────────────────────────────────────┐
│ 🏃 LIVE  Surgical Tech Debt Fixes                        │
│ owner/repo  •  main  •  2026-01-01 17:01                 │
│ /path/to/repo                                            │
│ ─────────────────────────────────────────────────────    │
│ STATS                                                     │
│ 142 events  •  3 turns  •  7 checkpoints  •  1 file      │
│ ─────────────────────────────────────────────────────    │
│ PLAN    ← if plan.md exists                               │
│ ► (first 5 lines of plan.md)                             │
│ ─────────────────────────────────────────────────────    │
│ TABS                                                      │
│ [Events] [Todos] [Checkpoints] [Files] [Database] [Meta]  │
└──────────────────────────────────────────────────────────┘
```

**Metadata to show:**
- `summary` — session title (large, prominent)
- `isRunning` — animated "LIVE" badge (uses `inuse.*.lock`)
- `repository`, `branch` — linked chips
- `cwd` — monospace path
- `createdAt` / `updatedAt` — relative time
- Event count, turn count, checkpoint count, files count
- Preview of `plan.md` first 5 lines (if present)

**Navigation tabs:** Events · Todos · Checkpoints · Files · Database · Metadata

### 8.6 Session Selection Sidebar

```
┌────────────────────────────┐
│ 🔍 Search sessions...       │
│ ─────────────────────────  │
│ 🏃 Surgical Tech Debt       │  ← running (animated dot)
│    TracePilot  •  1h ago    │
│ ─────────────────────────  │
│ ✓ Audit AI-Generated PRs   │
│    TracePilot  •  7d ago    │
│ ✓ Print Exact String       │
│    EdwinDemo  •  7d ago     │
└────────────────────────────┘
```

- Use existing `SessionCard.vue` / `SessionList.vue` from `@tracepilot/ui`
- Filter by repository (reuse existing `FilterSelect.vue`)
- Show `isRunning` indicator prominently

---

## Section 9: Priority File Types for MVP

| Priority | File Type | Justification |
|----------|-----------|---------------|
| **1** | `events.jsonl` | Core session content — this IS the session. Already has `get_session_events` backend. |
| **2** | `session.db → todos` | Most frequently useful — shows what the agent was trying to do and whether it succeeded. `get_session_todos` already exists. |
| **3** | `files/*.md` | Highest user value — these are the deliverables the user requested. Need new `list_session_files` + `get_session_file` commands. |
| **4** | `plan.md` | Quick session summary. `get_session_plan` already exists. Just needs a viewer component. |
| **5** | `checkpoints/*.md` | Rich session history. `get_session_checkpoints` already exists + `CheckpointContentView.vue` already built. |
| **6** | `workspace.yaml` | Metadata already surfaced by `get_session_detail`. Low incremental value from raw file. |
| **7** | `session.db → custom tables` | High value for complex sessions but requires new `list_db_tables` + `query_session_db` commands. |
| **8** | `rewind-snapshots/index.json` | Interesting for debugging/replay but niche use case. |
| **9** | `vscode.metadata.json` | Currently always `{}`. Defer. |

---

## Section 10: Data Relationships

### How Files Relate Within a Session

```
workspace.yaml
    │
    ├── id ──────────────────── events.jsonl ─── id fields
    │                               │
    │                               ├── user.message.interactionId ──┐
    │                               │                                │
    │                               └── assistant.message.interactionId ──┤
    │                                                                │
    │                           tool.execution_complete.toolCallId ──┘
    │                               │
    │                               └── get_tool_result(sessionId, toolCallId)
    │
    ├── id ──────────────────── session.db (todos + custom tables)
    │                               │
    │                               └── todos.id referenced in
    │                                   assistant.message.toolRequests (sql tool calls)
    │
    ├── id ──────────────────── checkpoints/index.md ──── checkpoints/<file>.md
    │
    ├── id ──────────────────── files/<name>.md
    │                               │
    │                               └── Referenced by agent in events.jsonl
    │                                   via create_tool calls with file paths
    │
    └── id ──────────────────── rewind-snapshots/index.json
                                    │
                                    ├── snapshotId → eventId ← events.jsonl id
                                    ├── gitCommit ← matches workspace.yaml context.headCommit
                                    └── backupHashes → rewind-snapshots/backups/<hash>
```

### Cross-Reference Opportunities

| Cross-Reference | How |
|----------------|-----|
| events.jsonl ↔ checkpoints | Checkpoint files are created when agent calls the `store_memory`-type tool; the event `id` at creation time can be matched to `rewind-snapshots/index.json` `eventId` field |
| events.jsonl ↔ session.db | `sql` tool calls in `tool.execution_start` events show which queries populated which tables; `assistant.message.toolRequests[].arguments.query` contains the SQL |
| events.jsonl ↔ files/ | `create` tool calls reference file paths in `arguments.path` — link these to files in the `files/` directory |
| rewind-snapshots ↔ events | `snapshotId` → `eventId` field directly references the `user.message` event that triggered the snapshot |
| workspace.yaml ↔ index DB | Session `id` is the primary key across the TracePilot index database (used by `list_sessions` fast path) |

### Shared IDs and Linkage Fields

| Field | Present In | Meaning |
|-------|-----------|---------|
| Session UUID | workspace.yaml `id`, events.jsonl `data.sessionId`, session.db (implicit) | Uniquely identifies the session |
| `interactionId` | `user.message.data`, `assistant.message.data`, `tool.execution_complete.data` | Groups all events belonging to one conversation turn |
| `toolCallId` | `tool.execution_start.data`, `tool.execution_complete.data`, `assistant.message.data.toolRequests[].toolCallId` | Links tool start → complete → request |
| `parentId` | Every event | Tree-structure linking; child events point to parent |
| `eventId` | `rewind-snapshots/index.json` snapshots | Links snapshots to specific `events.jsonl` event IDs |
| `gitCommit` | `workspace.yaml` context, `rewind-snapshots` | Shared git state reference |

---

## Appendix: New Backend Commands Required

To fully implement the file explorer, the following Tauri commands need to be added to
`crates/tracepilot-tauri-bindings/src/commands/session.rs` (or a new
`session_files.rs` module):

```rust
// List files in a session's files/ directory
#[tauri::command]
pub async fn list_session_files(session_id: String) -> CmdResult<Vec<SessionFileEntry>>;

// Read a specific file from a session's files/ directory
#[tauri::command]
pub async fn get_session_file(session_id: String, name: String) -> CmdResult<String>;

// List all tables in session.db (beyond todos)
#[tauri::command]
pub async fn list_session_db_tables(session_id: String) -> CmdResult<Vec<DbTableInfo>>;

// Run a read-only SQL query against session.db
#[tauri::command]
pub async fn query_session_db(session_id: String, sql: String) -> CmdResult<DbQueryResult>;

// Parse and return rewind-snapshots/index.json
#[tauri::command]
pub async fn get_rewind_snapshots(session_id: String) -> CmdResult<Vec<RewindSnapshot>>;
```

Corresponding TypeScript client methods should be added to `packages/client/src/sessions.ts`.

---

*Report generated: 2026-04-19 | Analyst: GitHub Copilot CLI*
