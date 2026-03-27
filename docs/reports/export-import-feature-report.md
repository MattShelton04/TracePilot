# TracePilot Export & Import — Feature Report & Implementation Plan

> **Author:** Copilot (Claude Opus 4.6) · **Date:** 2026-03-27  
> **Status:** Draft — reviewed by Opus 4.6, GPT 5.4, and Codex 5.3  
> **Scope:** Full export/import pipeline for TracePilot sessions

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Session Data Landscape](#3-session-data-landscape)
4. [User Stories](#4-user-stories)
5. [Export Formats & Use Cases](#5-export-formats--use-cases)
6. [Import Design](#6-import-design)
7. [Architecture & Implementation Plan](#7-architecture--implementation-plan)
8. [Schema Versioning Strategy](#8-schema-versioning-strategy)
9. [Redaction & Privacy Pipeline](#9-redaction--privacy-pipeline)
10. [UI/UX Design](#10-uiux-design)
11. [Implementation Phases](#11-implementation-phases)
12. [Testing Strategy](#12-testing-strategy)
13. [Open Questions & Risks](#13-open-questions--risks)
14. [Appendix: HTML Prototypes](#14-appendix-html-prototypes)
15. [Appendix: Consolidated Review Feedback](#15-appendix-consolidated-review-feedback)
16. [Appendix: Revisions from Review](#16-appendix-revisions-from-review)

---

## 1. Executive Summary

TracePilot currently has a **placeholder** export feature — the Rust `tracepilot-export` crate contains stubs, the frontend `ExportView.vue` renders mock data, and the feature is gated behind an experimental flag (`exportView: false`). No import capability exists.

This report proposes a **comprehensive, extensible export/import system** that:

- Exports sessions to **JSON** (machine-readable interchange), **Markdown** (human-readable sharing), and **CSV** (tabular analysis). HTML export is a future option for sharing with non-TracePilot users.
- Imports sessions from the **TracePilot Interchange Format** (`.tpx.json`) for cross-system portability
- Gives users **granular control** over what data sections to include
- Supports **schema versioning** for forward/backward compatibility
- Provides a **redaction pipeline** for sanitizing sensitive paths and content
- Is built on a **core schema → format translator** architecture for maintainability

### Key Design Principles

| Principle | Rationale |
|-----------|-----------|
| **Core schema first** | A single canonical `SessionArchive` Rust struct; format renderers translate from it |
| **Selective export** | Users choose exactly which sections to include (conversation, events, metrics, etc.) |
| **Schema versioned** | Every export file carries a major.minor version; importers can migrate across versions |
| **Lossless interchange** | JSON format preserves full fidelity; Markdown/CSV are lossy but human-friendly. HTML is deferred. |
| **Extensible** | New sections, event types, and formats added without breaking existing exports |
| **Readable code** | Separate modules per format; shared traits; comprehensive tests |
| **Security-first import** | Strict validation, path traversal protection, size limits, atomic writes |

---

## 2. Current State Analysis

### 2.1 Rust Crate: `tracepilot-export`

| File | Status | Description |
|------|--------|-------------|
| `lib.rs` | 🔴 Placeholder | `export_session()` returns `bail!("not yet implemented")` |
| `json.rs` | 🟡 Minimal | `render_json()` serializes `SessionSummary` only — no turns/events/todos |
| `markdown.rs` | 🔴 Placeholder | Returns static stub string |
| *(no csv.rs)* | 🔴 Missing | CSV format declared in enum but no module exists |
| *(no html.rs)* | 🔴 Missing | HTML mentioned in roadmap but not in code |

**Dependencies:** `tracepilot-core` (models, parsing), `serde`, `serde_json`, `chrono`, `thiserror`, `anyhow`  
**Tests:** None

### 2.2 Frontend: `ExportView.vue`

- Complete UI layout with session selector, format picker, section toggles, and live preview
- All preview content is **mock/hardcoded** — no backend calls
- File download uses Blob URL instead of Tauri save dialog
- Feature-gated behind `exportView: false` in preferences store
- Stub banner warns users this is a prototype

### 2.3 TypeScript Types: `@tracepilot/types`

```typescript
interface ExportConfig {
  sessionIds: string[];
  format: 'json' | 'csv' | 'markdown';
  includeConversation: boolean;
  includeEvents: boolean;
  includeMetrics: boolean;
  includeTodos: boolean;
  destination: string;
}

interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
  sessionsExported: number;
}
```

**Gap:** Missing fields for checkpoints, plan, raw data, rewind snapshots, tool calls, redaction options, and import types.

### 2.4 Tauri Commands

- No export/import Tauri commands exist
- `export_logs` exists (for app logs, not session data)
- All session data is accessible via existing `get_session_*` commands

---

## 3. Session Data Landscape

A complete session consists of the following data segments, all of which must be considered for export:

### 3.1 On-Disk Structure

```
~/.copilot/session-state/<uuid>/
├── workspace.yaml          # Session identity & metadata
├── events.jsonl            # Full event stream (line-delimited JSON)
├── session.db              # SQLite: todos, todo_deps, custom tables
├── plan.md                 # Agent plan document
├── checkpoints/
│   ├── index.md            # Checkpoint table-of-contents
│   └── checkpoint-*.md     # Individual checkpoint files
├── rewind-snapshots/
│   └── index.json          # Rewind snapshot index
└── files/                  # Session artifacts (user-generated)
```

### 3.2 Data Segments (Exportable Sections)

| # | Segment | Source | Size Impact | Human-Readable Value | Machine Value |
|---|---------|--------|-------------|---------------------|---------------|
| 1 | **Metadata** | `workspace.yaml` + `session.start` | Tiny | ★★★ Context | ★★★ Identity |
| 2 | **Conversation** | `events.jsonl` → turn reconstruction | Medium–Large | ★★★ Primary content | ★★★ Full dialogue |
| 3 | **Tool Calls** | Embedded in conversation turns | Medium | ★★☆ Actions taken | ★★★ Execution trace |
| 4 | **Reasoning** | `assistant.reasoning` events | Small–Medium | ★★★ Chain-of-thought | ★★☆ Debug info |
| 5 | **Events (Raw)** | `events.jsonl` (all 36+ types) | Large | ★☆☆ Technical | ★★★ Full fidelity |
| 6 | **Metrics** | `session.shutdown` events | Small | ★★☆ Cost/usage | ★★★ Analytics |
| 7 | **Todos** | `session.db` → todos + todo_deps | Small | ★★★ Task tracking | ★★★ Structured |
| 8 | **Plan** | `plan.md` | Small | ★★★ Strategy doc | ★★☆ Context |
| 9 | **Checkpoints** | `checkpoints/` directory | Small–Medium | ★★☆ Progress markers | ★★☆ State history |
| 10 | **Rewind Snapshots** | `rewind-snapshots/index.json` | Small | ★☆☆ Restore points | ★★☆ Git state |
| 11 | **Incidents** | Extracted from events | Small | ★★☆ Error audit | ★★★ Reliability |
| 12 | **Health** | Computed from metrics + diagnostics | Tiny | ★★☆ Quality signal | ★★☆ Scoring |
| 13 | **Custom DB Tables** | `session.db` (non-standard tables) | Variable | ★☆☆ Agent-specific | ★★☆ Extensible |
| 14 | **Session Events** | Compactions, truncations, errors | Small | ★★☆ Context pressure | ★★★ Debug |
| 15 | **Attachments** | `user.message` data.selections | Variable | ★☆☆ Referenced files | ★★☆ Context |
| 16 | **MCP Server Inventory** | `tool.execution_*` events | Tiny | ★☆☆ Server listing | ★★☆ Integration audit |
| 17 | **Parse Diagnostics** | Computed during parsing | Tiny | ★☆☆ Quality metadata | ★★☆ Trust signal |
| 18 | **Session Artifacts** | `files/` directory | Variable | ★☆☆ Generated files | ★★☆ Completeness |

### 3.3 Key Data Structures (from `tracepilot-core`)

**SessionSummary** — Identity, context, aggregated metrics:
- `id`, `summary`, `repository`, `branch`, `cwd`, `host_type`
- `created_at`, `updated_at`, `event_count`, `turn_count`
- `shutdown_metrics` → `ShutdownMetrics` (tokens, cost, code changes, model metrics, segments)

**ConversationTurn** — Reconstructed dialogue:
- `user_message`, `assistant_messages` (with agent attribution), `reasoning_texts`
- `tool_calls` → `Vec<TurnToolCall>` (name, args, result preview, timing, MCP info, subagent nesting)
- `session_events` → errors, compactions, truncations within each turn
- `timestamp`, `duration_ms`, `output_tokens`, `model`, `attachments`

**Event Types** — 36+ distinct types covering:
- Session lifecycle: start, shutdown, resume, compaction, truncation
- Conversation: user.message, assistant.message, turn_start/end, reasoning
- Tool execution: start/complete, user_requested
- Subagents: started/completed/failed/selected/deselected
- System: notifications, messages, skill invocations, hooks, abort
- Session management: plan_changed, model_change, mode_changed, context_changed

**Todos** — Structured task tracking with dependency graph  
**Checkpoints** — Numbered progress snapshots with markdown content  
**Rewind Snapshots** — Git-state-aware restore points  
**Health** — Computed score (0–1) with categorized flags  

---

## 4. User Stories

### 4.1 Export — Human-Readable Sharing

> **US-01:** As a developer, I want to export a session as Markdown so I can share it with my team on Slack/GitHub to show how Copilot helped solve a problem.

> **US-02:** As a tech lead, I want to export a session as a styled HTML report so I can attach it to a retrospective document without requiring TracePilot to view it.

> **US-03:** As a developer, I want to give the exported conversation to another AI (e.g., Copilot, ChatGPT) to summarize or analyze the approach taken.

> **US-04:** As a developer, I want to export only the conversation and plan (not raw events or tool call details) so the output is concise and readable.

### 4.2 Export — Machine-Readable Interchange

> **US-05:** As a developer, I want to export a session as JSON so I can import it into another TracePilot instance on a different machine.

> **US-06:** As a team, we want to share sessions between team members' TracePilot installations to build a shared knowledge base.

> **US-07:** As a developer, I want to export session metrics as CSV so I can create custom charts in a spreadsheet.

### 4.3 Export — Selective & Privacy-Aware

> **US-08:** As a developer, I want to choose which sections to include in my export (conversation, metrics, todos, etc.) so I don't share unnecessary data.

> **US-09:** As a developer working on a private repo, I want to redact file paths and repository names before sharing a session externally.

> **US-10:** As a developer, I want to preview the export before saving so I can verify the content and redactions are correct.

### 4.4 Export — Batch Operations

> **US-11:** As a tech lead, I want to export all sessions for a specific repository as a single archive so I can audit Copilot usage across the project.

> **US-12:** As a developer, I want to export multiple sessions at once, choosing a common format and options for all of them.

### 4.5 Import

> **US-13:** As a developer, I want to import a `.tpx.json` file from a colleague so I can view their session in my TracePilot instance.

> **US-14:** As a developer, I want TracePilot to validate imported files and warn me about version mismatches or missing data before importing.

> **US-15:** As a developer, I want imported sessions to appear alongside my local sessions, clearly marked as "imported" so I can distinguish them.

> **US-16:** As a developer, I want to import sessions even from older TracePilot versions, with automatic schema migration.

### 4.6 CLI Integration

> **US-17:** As a developer, I want to export sessions from the command line so I can script batch exports or integrate with CI/CD.

> **US-18:** As a developer, I want to pipe a Markdown export to stdout so I can use it with other CLI tools.

### 4.7 Archival & Debugging

> **US-19:** As a developer, I want to export a session to attach to a GitHub issue for debugging, with aggressive redaction and minimal data (conversation + errors only).

> **US-20:** As a developer, I want to export sessions and then delete the local copies to free disk space (archive workflow).

> **US-21:** As a developer, I want to copy a session as Markdown to my clipboard with one click so I can paste it into chat or a document instantly.

> **US-22:** As a developer, I want to import only selected sessions from a multi-session archive file, not all of them.

> **US-23:** As a developer, I want a dry-run/preview import that shows what would be imported without writing any files.

---

## 5. Export Formats & Use Cases

### 5.1 Format Matrix

| Format | Extension | Lossless | Use Case | Importable |
|--------|-----------|----------|----------|------------|
| **TracePilot Interchange** | `.tpx.json` | ✅ Yes | Cross-system transfer, backup, team sharing | ✅ Yes |
| **Markdown** | `.md` | ❌ Lossy | Human reading, team sharing, AI summarization | ❌ No |
| **HTML** | `.html` | ❌ Lossy | Self-contained reports, email, documentation | ❌ No |
| **CSV** | `.csv` | ❌ Lossy | Spreadsheet analysis, metrics charting | ❌ No |

### 5.2 TracePilot Interchange Format (`.tpx.json`)

The canonical export format. Preserves full fidelity for round-trip import/export.

```jsonc
{
  "tracepilot": {
    "schemaVersion": 1,
    "exportedAt": "2026-03-27T02:00:00Z",
    "exportedBy": "TracePilot v0.5.1",
    "sourceSystem": { "os": "windows", "hostname": "DESKTOP-ABC" }
  },
  "sessions": [
    {
      "metadata": { /* SessionSummary fields */ },
      "conversation": [ /* ConversationTurn[] */ ],
      "events": [ /* RawEvent[] — optional */ ],
      "todos": { "items": [ /* TodoItem[] */ ], "deps": [ /* TodoDep[] */ ] },
      "plan": "# Plan\n...",
      "checkpoints": [ /* CheckpointEntry[] */ ],
      "rewindSnapshots": { "version": 1, "snapshots": [ /* ... */ ] },
      "shutdownMetrics": { /* ShutdownMetrics */ },
      "incidents": [ /* SessionIncident[] */ ],
      "health": { "score": 0.85, "flags": [ /* ... */ ] },
      "customTables": [ /* CustomTableInfo[] */ ]
    }
  ],
  "exportOptions": {
    "includedSections": ["metadata", "conversation", "todos", "plan"],
    "redactionApplied": false,
    "redactionRules": []
  }
}
```

### 5.3 Markdown Format

Optimized for human reading and AI consumption:

```markdown
# Session: Implement authentication module
> **Repository:** github.com/user/project · **Branch:** feature/auth  
> **Date:** 2026-03-15 10:30 — 11:45 · **Model:** claude-sonnet-4  
> **Turns:** 12 · **Tokens:** 24,500 · **Cost:** $0.08

---

## Plan
Create JWT-based authentication with bcrypt password hashing...

## Conversation

### Turn 1
**User:** Implement authentication module  
**Assistant:** I'll create the auth module with JWT-based authentication...

<details><summary>🔧 Tool Calls (3)</summary>

| Tool | Target | Status | Duration |
|------|--------|--------|----------|
| `edit` | src/auth/auth.ts | ✅ | 120ms |
| `powershell` | npm test | ✅ | 3.4s |
| `grep` | "jwt" in src/ | ✅ | 45ms |

</details>

> 💭 *Reasoning: Need to check existing auth patterns before creating new ones...*

### Turn 2
...

## Todos
- [x] Create auth module
- [ ] Write unit tests

## Metrics
| Metric | Value |
|--------|-------|
| Total Tokens | 24,500 |
| Input Tokens | 18,200 |
| Output Tokens | 6,300 |
| Cache Hit Rate | 42% |
| API Duration | 12.3s |
| Premium Requests | 5 |
```

### 5.4 HTML Format *(Future — Deprioritized)*

> **Status:** Deferred to a future release. Imported sessions can be viewed directly in TracePilot's existing session detail UI, which provides a richer experience than a static HTML file. HTML export would only be useful for sharing with users who cannot install TracePilot — a niche case that doesn't justify the maintenance overhead of an embedded HTML template engine in the initial implementation.

Self-contained single-file HTML with:
- Embedded CSS (dark/light theme via `prefers-color-scheme`)
- Collapsible sections (conversation turns, tool calls)
- Syntax-highlighted code blocks
- Metrics dashboard summary at top
- Print-friendly styles
- No external dependencies (fully offline)

### 5.5 CSV Format

Multiple sheets/files for different data aspects:

**`session-metrics.csv`** — One row per session with summary metrics  
**`conversation.csv`** — Turn-level data (turn#, role, content, tokens, timestamp)  
**`tool-calls.csv`** — All tool calls (turn#, tool, args, success, duration)  
**`events.csv`** — Flat event list (type, timestamp, summary)  
**`todos.csv`** — Todo items with status  

---

## 6. Import Design

### 6.1 Import Sources

| Source | Format | Validation |
|--------|--------|------------|
| `.tpx.json` file | TracePilot Interchange | Schema version check, structural validation |
| Raw session directory | On-disk files | Detect workspace.yaml, parse normally |
| Clipboard / drag-and-drop | `.tpx.json` content | Same as file |

### 6.2 Import Pipeline

> **Revised based on review feedback:** Added atomic staging, security validation, and
> two import modes (native vs snapshot) per reviewer recommendations.

```
Input File (.tpx.json)
    ↓
1. Size-limit check (reject > 500MB before parsing)
    ↓
2. Stream-parse JSON envelope → validate schema version
    ↓
3. Schema migration (if version < current)
    ↓
4. Structural validation (required fields, type checks, max field lengths)
    ↓
5. Security validation:
   - Path traversal detection (reject any path containing ".." or absolute paths)
   - Content size limits per section (e.g., 50MB per section)
   - Filename sanitization for checkpoints
    ↓
6. Conflict detection (existing session ID?)
    ↓
7. User confirmation (preview + conflict resolution)
    ↓
8. Atomic staging write:
   - Write to temp directory within session-state/
   - Validate all files written correctly
   - Atomic rename to final session directory
   - Rollback temp dir on any failure
    ↓
9. Re-index imported session
    ↓
10. Emit "session-imported" event → UI refresh
```

**Two Import Modes:**

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Native import** | Complete, unredacted `.tpx.json` with raw events | Full session directory reconstruction; session is indistinguishable from local |
| **Snapshot import** | Partial, redacted, or events-missing `.tpx.json` | Read-only session with capability flags; missing sections show "Not available in import" |

### 6.3 Import Conflict Resolution

When importing a session with an ID that already exists:

| Strategy | Description |
|----------|-------------|
| **Skip** | Don't import, keep existing |
| **Replace** | Overwrite existing with imported data |
| **Duplicate** | Generate new UUID, import as separate session |
| **Merge** (future) | Combine data from both sources |

### 6.4 Imported Session Markers

Imported sessions are tagged in `workspace.yaml` with:

```yaml
imported_from:
  source_system: "TracePilot v0.5.1 / DESKTOP-ABC"
  imported_at: "2026-03-27T02:00:00Z"
  original_export_version: 1
```

This metadata is surfaced in the UI as an "Imported" badge.

---

## 7. Architecture & Implementation Plan

### 7.1 Core Architecture: Schema → Translators

```
                          ┌─────────────────────┐
                          │   ExportDocument     │  ← Canonical intermediate
                          │   (Rust struct)      │     representation
                          └──────────┬──────────┘
                                     │
            ┌────────────┬───────────┼───────────┬────────────┐
            ▼            ▼           ▼           ▼            ▼
    ┌──────────┐  ┌──────────┐  ┌────────┐  ┌────────┐  ┌──────────┐
    │ JSON     │  │ Markdown │  │  HTML  │  │  CSV   │  │ (Future) │
    │ Renderer │  │ Renderer │  │Renderer│  │Renderer│  │          │
    └──────────┘  └──────────┘  └────────┘  └────────┘  └──────────┘
```

**Key insight:** All renderers consume the same `ExportDocument`. Adding a new format means implementing one trait — no changes to data loading or the UI.

### 7.2 Rust Module Structure

```
crates/tracepilot-export/
├── Cargo.toml
└── src/
    ├── lib.rs              # Public API: export_session(), import_session()
    ├── document.rs         # ExportDocument + ExportSection structs
    ├── builder.rs          # Build ExportDocument from session directory
    ├── options.rs          # ExportOptions, ImportOptions, SectionFilter
    ├── schema.rs           # Schema version constants, migration logic
    │
    ├── render/             # Format-specific renderers
    │   ├── mod.rs          # ExportRenderer trait definition
    │   ├── json.rs         # JSON (.tpx.json) renderer
    │   ├── markdown.rs     # Markdown renderer
    │   ├── html.rs         # HTML renderer (embedded template)
    │   ├── csv.rs          # CSV renderer (multi-file)
    │   └── templates/      # HTML template assets
    │       └── report.html # Base HTML template
    │
    ├── import/             # Import pipeline
    │   ├── mod.rs          # Public import API
    │   ├── parser.rs       # Parse .tpx.json → ExportDocument
    │   ├── validator.rs    # Structural validation
    │   ├── migrator.rs     # Schema version migration
    │   └── writer.rs       # Write ExportDocument → session directory
    │
    ├── redaction/          # Privacy/redaction pipeline
    │   ├── mod.rs          # RedactionEngine
    │   ├── rules.rs        # Built-in + custom rules
    │   └── patterns.rs     # Path, content, secret patterns
    │
    └── error.rs            # ExportError enum
```

### 7.3 Core Types

> **Note (from review):** All three reviewers identified that the canonical intermediate type
> should be neutral (not export-specific) since it serves both export and import. Renamed from
> `ExportDocument` to `SessionArchive`. The schema version uses major/minor for robust
> forward/backward compatibility. Section selection uses an enum-set rather than boolean fields.

```rust
/// The canonical intermediate representation for export/import.
/// All format renderers consume this; the builder creates it from session data;
/// the importer parses it back. Neutral name reflects its dual role.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionArchive {
    pub header: ArchiveHeader,
    pub sessions: Vec<PortableSession>,
    pub export_options: ArchiveOptionsRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveHeader {
    /// Major version — increment for breaking changes (field renames, type changes).
    /// Minor version — increment for additive changes (new optional fields).
    pub schema_version: SchemaVersion,
    pub exported_at: DateTime<Utc>,
    pub exported_by: String,        // "TracePilot v0.5.1"
    pub source_system: Option<SourceSystem>,
    /// SHA-256 hash of the sessions array for integrity verification.
    pub content_hash: Option<String>,
    /// Minimum reader version required to import this file.
    pub minimum_reader_version: Option<SchemaVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaVersion {
    pub major: u32,
    pub minor: u32,
}

/// Dedicated export metadata — NOT reusing SessionSummary directly to avoid
/// coupling interchange schema to UI/list model evolution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableSession {
    /// Core identity & context — always included.
    pub metadata: PortableSessionMetadata,

    /// Which sections are present in this export (capabilities manifest).
    pub available_sections: Vec<SectionId>,

    /// Optional sections — included based on user selection.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation: Option<Vec<ConversationTurn>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<Vec<RawEvent>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub todos: Option<TodoExport>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoints: Option<Vec<CheckpointEntry>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub rewind_snapshots: Option<RewindIndex>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub shutdown_metrics: Option<ShutdownMetrics>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub incidents: Option<Vec<SessionIncident>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub health: Option<SessionHealth>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_tables: Option<Vec<CustomTableInfo>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub parse_diagnostics: Option<ParseDiagnosticsExport>,

    /// Extension point for future data without schema bump.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extensions: Option<serde_json::Value>,
}

/// Dedicated metadata struct for export — decoupled from SessionSummary to allow
/// independent evolution. Includes raw workspace fields not in SessionSummary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableSessionMetadata {
    pub id: String,
    pub summary: Option<String>,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub cwd: Option<String>,
    pub git_root: Option<String>,
    pub host_type: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub event_count: Option<usize>,
    pub turn_count: Option<usize>,
    pub summary_count: Option<u32>,
    /// Import provenance chain — tracks export/import lineage.
    pub lineage: Option<Vec<LineageEntry>>,
}

/// Section identifier enum — used instead of boolean flags for extensibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SectionId {
    Conversation,
    ToolCalls,
    Reasoning,
    Events,
    Metrics,
    Todos,
    Plan,
    Checkpoints,
    RewindSnapshots,
    Incidents,
    Health,
    CustomTables,
    Attachments,
    ParseDiagnostics,
}

/// User's export configuration — uses a set of SectionIds instead of booleans.
pub struct ExportOptions {
    pub format: ExportFormat,
    pub sections: HashSet<SectionId>,
    pub redaction: RedactionConfig,
    pub output: OutputTarget,
}

impl ExportOptions {
    /// Include all available sections.
    pub fn all_sections() -> HashSet<SectionId> { /* all variants */ }
    /// Minimal export: metadata only (no optional sections).
    pub fn minimal_sections() -> HashSet<SectionId> { HashSet::new() }
    /// Common sharing preset: conversation + plan + todos + metrics.
    pub fn sharing_preset() -> HashSet<SectionId> { /* subset */ }
}
```

### 7.4 Renderer Trait

```rust
/// Trait implemented by each format renderer.
///
/// The rendering pipeline: ExportDocument → render() → Vec<ExportFile>
/// Most formats produce a single file; CSV produces multiple.
pub trait ExportRenderer {
    /// The format this renderer produces.
    fn format(&self) -> ExportFormat;

    /// Render the document to one or more output files.
    fn render(&self, doc: &ExportDocument) -> Result<Vec<ExportFile>>;

    /// Return a human-readable format name for UI display.
    fn display_name(&self) -> &'static str;

    /// Return the primary file extension.
    fn extension(&self) -> &'static str;

    /// Return MIME type for the primary output.
    fn mime_type(&self) -> &'static str;
}

pub struct ExportFile {
    pub filename: String,
    pub content: Vec<u8>,
    pub mime_type: String,
}
```

### 7.5 Builder Pipeline

```rust
/// Build an ExportDocument from a session directory.
pub fn build_export_document(
    session_dir: &Path,
    options: &ExportOptions,
) -> Result<ExportDocument> {
    // 1. Always load metadata (workspace.yaml + session.start enrichment)
    let metadata = load_session_summary(session_dir)?;

    // 2. Conditionally load each section based on options.sections
    let conversation = if options.sections.conversation {
        Some(load_turns(session_dir)?)
    } else { None };

    let events = if options.sections.events {
        Some(load_raw_events(session_dir)?)
    } else { None };

    // ... etc for each section

    // 3. Apply redaction if configured
    let mut session = ExportedSession { metadata, conversation, events, ... };
    if options.redaction.enabled {
        redact_session(&mut session, &options.redaction)?;
    }

    // 4. Assemble document
    Ok(ExportDocument {
        header: build_header(),
        sessions: vec![session],
        export_options: record_options(options),
    })
}
```

### 7.6 Public API

```rust
// ── Export ──

/// Export one or more sessions to the specified format.
pub fn export_sessions(
    session_dirs: &[&Path],
    options: &ExportOptions,
) -> Result<Vec<ExportFile>> {
    let doc = build_export_document_batch(session_dirs, options)?;
    let renderer = create_renderer(options.format);
    renderer.render(&doc)
}

/// Generate a preview of the export (first N bytes) without writing to disk.
pub fn preview_export(
    session_dir: &Path,
    options: &ExportOptions,
    max_bytes: usize,
) -> Result<String> { ... }

// ── Import ──

/// Validate and preview what an import would contain.
pub fn preview_import(source: &Path) -> Result<ImportPreview> { ... }

/// Import sessions from a .tpx.json file.
pub fn import_sessions(
    source: &Path,
    target_session_dir: &Path,
    options: &ImportOptions,
) -> Result<ImportResult> { ... }
```

### 7.7 Tauri Command Registration

New commands to add to `tracepilot-tauri-bindings`:

```rust
// Export commands
export_session          // Export a single session
export_sessions_batch   // Export multiple sessions
preview_export          // Generate preview content
get_export_size_estimate // Estimate output size

// Import commands
preview_import          // Validate + preview import file
import_sessions         // Import from .tpx.json
validate_import_file    // Quick structural validation
```

### 7.8 Frontend Integration

Update `ExportView.vue` to:
1. Replace mock preview with `preview_export` Tauri command
2. Replace Blob download with Tauri `dialog.save` → `export_session`
3. Add import tab/section
4. Add batch export UI (select multiple sessions)
5. Add redaction preview

New types in `@tracepilot/types`:

```typescript
interface ExportConfig {
  sessionIds: string[];
  format: 'json' | 'markdown' | 'html' | 'csv';
  sections: SectionFilter;
  redaction: RedactionConfig;
}

interface SectionFilter {
  conversation: boolean;
  toolCalls: boolean;
  reasoning: boolean;
  events: boolean;
  metrics: boolean;
  todos: boolean;
  plan: boolean;
  checkpoints: boolean;
  rewindSnapshots: boolean;
  incidents: boolean;
  health: boolean;
  customTables: boolean;
  attachments: boolean;
}

interface RedactionConfig {
  enabled: boolean;
  anonymizePaths: boolean;
  redactPatterns: string[];    // Custom regex patterns
  presets: RedactionPreset[];  // 'paths' | 'secrets' | 'usernames'
}

interface ImportPreview {
  schemaVersion: number;
  sessionCount: number;
  sessions: ImportSessionPreview[];
  warnings: string[];
  conflicts: ImportConflict[];
}

interface ImportResult {
  success: boolean;
  sessionsImported: number;
  errors: string[];
  warnings: string[];
}
```

---

## 8. Schema Versioning Strategy

### 8.1 Version Policy

> **Revised based on review feedback:** All three reviewers identified that a single integer
> version is insufficient. Adopting major/minor with `minimumReaderVersion`.

- **Schema version** uses `{ major, minor }` starting at `{ 1, 0 }`
- **Minor bumps** for additive changes (new optional fields) — use `#[serde(default)]`
- **Major bumps** for breaking changes (field renames, type changes, removed fields)
- **`minimumReaderVersion`** in the header tells importers the minimum version they must support
- **Compatibility rules:**
  - **Same major, higher minor** → import with best-effort (warn about unknown fields)
  - **Higher major** → block import by default; allow read-only preview if forced
  - **Lower version** → migrate forward via migration chain
- **Unknown fields** are preserved via the `extensions` field (NOT `#[serde(flatten)]` which conflicts with `deny_unknown_fields`)

### 8.2 Version Detection

```rust
/// Read just the schema version from an export file without loading everything.
pub fn detect_schema_version(source: &Path) -> Result<u32> {
    // Parse only the header.schemaVersion field (streaming/partial parse)
}
```

### 8.3 Migration Chain

```rust
pub fn migrate_to_current(doc: Value, from_version: u32) -> Result<Value> {
    let mut current = doc;
    let mut version = from_version;

    while version < CURRENT_SCHEMA_VERSION {
        current = match version {
            1 => migrate_v1_to_v2(current)?,
            2 => migrate_v2_to_v3(current)?,
            // Each migration is a standalone function
            _ => return Err(ExportError::UnsupportedVersion(version)),
        };
        version += 1;
    }

    Ok(current)
}

/// Example: v1 → v2 migration
fn migrate_v1_to_v2(mut doc: Value) -> Result<Value> {
    // Add new field with default value
    if let Some(sessions) = doc["sessions"].as_array_mut() {
        for session in sessions {
            if session.get("health").is_none() {
                session["health"] = json!(null);
            }
        }
    }
    doc["tracepilot"]["schemaVersion"] = json!(2);
    Ok(doc)
}
```

### 8.4 Forward Compatibility

- Export files with a higher schema version than supported will emit a **warning** (not error)
- Unknown fields are preserved (serde `#[serde(flatten)]` or `deny_unknown_fields` selectively)
- The `extensions` field on `ExportedSession` allows experimental data without schema changes

---

## 9. Redaction & Privacy Pipeline

### 9.1 Redaction Rules

| Rule | Target | Example |
|------|--------|---------|
| **Path anonymization** | All file paths | `/Users/matt/project/src/auth.ts` → `[PROJECT]/src/auth.ts` |
| **Home directory** | User home paths | `/Users/matt/...` → `~/...` |
| **Repository name** | repo/branch fields | `github.com/corp/secret-repo` → `[REPOSITORY]` |
| **Secret patterns** | Regex-matched content | `sk-abc123...` → `[REDACTED]` |
| **Username** | Host/user references | `matt@laptop` → `[USER]@[HOST]` |
| **Custom regex** | User-defined patterns | Configurable |

### 9.2 Redaction Pipeline

```rust
pub fn redact_session(session: &mut ExportedSession, config: &RedactionConfig) -> Result<()> {
    let engine = RedactionEngine::new(config);

    // Redact metadata
    engine.redact_metadata(&mut session.metadata);

    // Redact conversation content
    if let Some(turns) = &mut session.conversation {
        for turn in turns {
            engine.redact_turn(turn);
        }
    }

    // Redact events
    if let Some(events) = &mut session.events {
        for event in events {
            engine.redact_event(event);
        }
    }

    // Redact plan
    if let Some(plan) = &mut session.plan {
        *plan = engine.redact_text(plan);
    }

    // ... etc
    Ok(())
}
```

### 9.3 Preview Mode

Before saving, users can preview what redaction will change:

```rust
pub struct RedactionPreview {
    pub total_redactions: usize,
    pub by_rule: HashMap<String, usize>,  // rule_name → count
    pub samples: Vec<RedactionSample>,     // First N redactions for review
}

pub struct RedactionSample {
    pub location: String,     // "Turn 3 > Tool Call > edit > path"
    pub original: String,     // "/Users/matt/project/src/auth.ts"
    pub redacted: String,     // "[PROJECT]/src/auth.ts"
}
```

---

## 10. UI/UX Design

### 10.1 Export View Redesign

The current single-session export view should be redesigned into a **unified Export & Import center**:

**Layout:** Two-column layout (same as current)
- **Left:** Configuration panel with tabs for Export / Import
- **Right:** Live preview panel

**Export Tab:**
1. **Session Selection** — Single session dropdown OR multi-select with checkboxes
2. **Format Selector** — Button group: JSON | Markdown | HTML | CSV
3. **Section Toggles** — Grouped switches with descriptions:
   - **Content** group: Conversation, Tool Calls, Reasoning, Plan
   - **Data** group: Events, Metrics, Todos, Checkpoints
   - **Technical** group: Rewind Snapshots, Incidents, Health, Custom Tables, Raw Data
4. **Privacy** section: Redaction toggles + custom patterns
5. **Preview** button → updates right panel
6. **Export** button → Tauri save dialog

**Import Tab:**
1. **File selector** — Drag-and-drop zone or file picker
2. **Validation status** — Schema version, session count, warnings
3. **Session preview** — List of sessions with metadata
4. **Conflict resolution** — If session IDs clash
5. **Import** button

### 10.2 Session Detail Integration

Add an "Export" action button to the session detail view header:
- Quick export dropdown: Markdown / JSON / HTML
- "Customize & Export…" opens the full Export view with the session pre-selected
- "Copy as Markdown" — one-click copy to clipboard

### 10.3 Batch Export from Session List

Add a batch action bar to SessionListView:
- Checkbox selection mode
- "Export Selected (N)" button → opens Export view with sessions pre-selected

---

## 11. Implementation Phases

### Phase A1: Core Types & JSON Export (Rust) — **Ship First**

> **Revised based on review feedback:** All three reviewers recommended splitting Phase A.
> JSON round-trip is the critical path and validates the architecture.

1. Define `SessionArchive`, `PortableSession`, `ExportOptions`, `SectionId` in `document.rs` + `options.rs`
2. Implement `builder.rs` — load session data into `SessionArchive` using existing `tracepilot-core` parsers
3. Define `ExportRenderer` trait in `render/mod.rs`
4. Implement `render/json.rs` — `.tpx.json` format with schema version header and content hash
5. Add `schema.rs` with version constants and compatibility checking
6. Integrate redaction config into builder from day one (even if only path anonymization works initially)
7. Write unit tests for JSON renderer (round-trip serialization, optional sections, schema header)
8. Write integration tests with real session fixture data

### Phase A2: Markdown & CSV Renderers (Rust)

1. Implement `render/markdown.rs` — human-readable conversation document with resume boundary markers
2. Implement `render/csv.rs` — multi-file tabular output with formula-injection hardening
3. Write unit + snapshot tests for each renderer

### Phase A3: HTML Renderer *(Future — Deprioritized)*

> **Deferred.** Imported sessions are best viewed in TracePilot's native session detail UI. HTML export may be added later if there's demand for sharing with non-TracePilot users.

1. Implement `render/html.rs` — self-contained styled report with embedded template
2. XSS-safe content rendering (escape all user-provided content)
3. Write unit + snapshot tests

### Phase B: Import Pipeline (Rust)

1. Implement `import/parser.rs` — stream-parse `.tpx.json` to `SessionArchive` with size limits
2. Implement `import/validator.rs` — structural validation with max field lengths
3. Implement `import/migrator.rs` — schema version migration chain (typed per-version structs)
4. Implement `import/writer.rs` — atomic staging write to session directory
5. Add conflict detection logic with UUID rewriting for "Duplicate" strategy
6. Support two import modes: native (full) and snapshot (read-only partial)
7. Write round-trip tests (export → import → compare)

### Phase C: Redaction Pipeline (Rust)

1. Define `RedactionConfig`, `RedactionRule`, `RedactionEngine` in `redaction/`
2. Implement **recursive** redaction through all JSON values (tool call args, result_content, attachments)
3. Implement deterministic pseudonymization (`[PATH_1]`, `[REPO_1]`) for analytic utility
4. Implement preview mode (diff-style output with sample redactions)
5. Default reasoning and raw events to OFF; default hostname to hashed
6. Write tests for each redaction rule type and regression corpus

### Phase D: Tauri Commands & Frontend

1. Define Tauri command signatures as contracts before implementation
2. Register export/import Tauri commands in bindings crate
3. Add commands to `build.rs` and `lib.rs`
4. Update `@tracepilot/types` with new interfaces (using `SectionId` enum)
5. Update `@tracepilot/client` with new API calls
6. Refactor `ExportView.vue` in-place (don't rewrite) to use real backend
7. Add import tab with drag-and-drop and validation preview
8. Add "Copy as Markdown" quick action to `SessionDetailView.vue`
9. Add batch export to `SessionListView.vue`
10. Add export presets ("Share with team", "Full backup", "Debug report")
11. Debounce preview generation (300ms) for large sessions
12. Remove feature flag gate (or default to `true`)

### Phase E: CLI Integration

1. Add `export` subcommand to CLI app
2. Add `import` subcommand
3. Support `--format`, `--sections`, `--redact`, `--output` flags
4. Support `--format=clipboard` shortcut for Markdown → clipboard
5. Support stdout output for piping

---

## 12. Testing Strategy

### 12.1 Unit Tests

| Module | Test Focus |
|--------|------------|
| `builder.rs` | Section loading, option filtering, empty sessions |
| `render/json.rs` | Round-trip serialization, schema version header, optional sections |
| `render/markdown.rs` | Heading structure, tool call tables, todo checkboxes, edge cases |
| `render/html.rs` | Valid HTML structure, embedded CSS, collapsible sections |
| `render/csv.rs` | CSV quoting, multi-file output, header correctness |
| `import/parser.rs` | Valid parsing, malformed input rejection, partial data |
| `import/migrator.rs` | Each version migration, chain migration, unknown version |
| `import/validator.rs` | Required fields, type validation, size limits |
| `import/writer.rs` | File creation, directory structure, overwrite safety |
| `redaction/` | Path patterns, secret detection, preview accuracy |

### 12.2 Integration Tests

- **Round-trip test:** Export session → Import → Compare all fields match
- **Cross-version test:** Export with v1 schema → Migrate to v2 → Import successfully
- **Large session test:** Export session with 5000+ events → verify performance and correctness
- **Redaction integrity test:** Export with redaction → verify no sensitive data leaks

### 12.3 Frontend Tests

- `ExportView.vue` component tests with mocked Tauri commands
- Import validation UI state tests
- Section toggle → preview update reactivity tests

---

## 13. Open Questions & Risks

### Open Questions

| # | Question | Options | Recommendation |
|---|----------|---------|----------------|
| 1 | Should batch exports produce a ZIP or multiple files? | ZIP / individual files / directory | **ZIP** for multi-session, single file for one session |
| 2 | Max export size limit? | No limit / 100MB / 500MB | **500MB** with warning at 100MB |
| 3 | Should HTML export include full tool call results? | Yes / No / Configurable | **Configurable** — default to truncated |
| 4 | Where do imported sessions live? | Same dir as native / separate `imported/` dir | **Same dir** with import metadata in workspace.yaml |
| 5 | Should markdown export include chain-of-thought? | Yes / No / Configurable | **Configurable** — default off (can be long) |
| 6 | Clipboard export (copy as markdown)? | Quick action / Full export | **Quick action** — metadata + conversation only |

### Risks

> **Expanded based on review feedback** — reviewers identified several additional risks.

| Risk | Impact | Mitigation |
|------|--------|------------|
| Session data shape evolves with Copilot CLI updates | Import breaks for older exports | Schema versioning + migration chain + `Unknown` catch-all |
| Large sessions (10K+ events) slow to export | Poor UX / OOM | Progress events + streaming render + sequential batch processing |
| Redaction misses sensitive data | Privacy leak | Conservative defaults + recursive redaction + preview mode + regression corpus |
| Import of malicious files | Security vulnerability | Strict validation + path traversal protection + size limits + atomic staging |
| HTML template maintenance | Becomes outdated | Embed template in binary via `include_str!`, version alongside crate |
| **XSS from imported content** | Desktop app vulnerability | Sanitize all imported markdown/HTML rendered in UI |
| **Memory pressure on batch export** | OOM crash | Process sessions sequentially, write each before loading next |
| **False fidelity on partial import** | User confusion | Capability flags + "snapshot" badge + missing section indicators |
| **Replace conflict on running session** | Data corruption | Block replace of sessions with active lock files |
| **CSV formula injection** | Spreadsheet attack vector | Prefix dangerous cells (`=`, `+`, `-`, `@`) with single quote |
| **Clock skew in timestamps** | Confusing lineage | UTC everywhere + source timezone offset in SourceSystem |
| **`.tpx.json` file detection** | Extension collision | Magic-byte header (`{"tracepilot":{"sch`) + optional MIME registration |

---

## 14. Appendix: HTML Prototypes

See companion files:
- `docs/reports/export-import-prototype.html` — Interactive UI prototype for the export/import view
- `docs/reports/export-html-report-prototype.html` — Prototype of what an HTML session export looks like

These prototypes demonstrate the proposed interactions and visual design.

---

## 15. Appendix: Consolidated Review Feedback

> Three independent AI reviewers analyzed this report. Their feedback has been consolidated
> below. Key improvements have already been incorporated into the main report (sections marked
> with "Revised based on review feedback").

### 15.1 Reviewer Summary

| Reviewer | Model | Score | Key Strengths Identified | Key Concerns |
|----------|-------|-------|-------------------------|--------------|
| **Opus 4.6** | Claude Opus 4.6 | 7.5/10 | Thorough data landscape, correct architecture pattern | ExportDocument identity crisis, memory management, Phase A too large |
| **GPT 5.4** | GPT-5.4 | 7/10 | Right architectural instincts, redaction as first-class | Schema boundary not clean, lossless fidelity overstated, import modes needed |
| **Codex 5.3** | GPT-5.3-Codex | 7.5/10 | Excellent modularity, clear product intent | Wire-shape ambiguity, security hardening gaps, scope overload |

### 15.2 Consensus Issues (Identified by All 3 Reviewers)

1. **Schema/Envelope Inconsistency** — Report used both `tracepilot.schemaVersion` and `header: ExportHeader` interchangeably. **Fixed:** Unified under `ArchiveHeader.schema_version`.

2. **Canonical Type Identity** — `ExportDocument` conflated export-specific and import-specific concerns. **Fixed:** Renamed to `SessionArchive` with neutral naming.

3. **SessionSummary Reuse** — Using the UI model as interchange metadata couples evolution. **Fixed:** Introduced `PortableSessionMetadata` as a dedicated export struct.

4. **SectionFilter Boolean Explosion** — 13+ booleans don't scale. **Fixed:** Replaced with `HashSet<SectionId>` enum-set pattern.

5. **Schema Versioning Needs Major/Minor** — Single integer insufficient for forward compatibility. **Fixed:** Adopted `SchemaVersion { major, minor }` + `minimumReaderVersion`.

6. **Import Security Hardening** — Path traversal, size limits, atomic writes were mentioned in risks but not in pipeline spec. **Fixed:** Added to import pipeline steps 1, 4, 5, 8.

7. **Redaction Depth Insufficient** — Tool call arguments, result_content, attachments need recursive treatment. **Fixed:** Noted in Phase C.

8. **Phase A Too Large** — All four renderers in one phase is unrealistic. **Fixed:** Split into A1 (JSON), A2 (Markdown+CSV), A3 (HTML).

### 15.3 Unique Insights by Reviewer

**Opus 4.6 (exclusive insights):**
- Session resume boundary markers needed in Markdown export (visual `--- Session Resumed ---` separators)
- Encrypted/opaque reasoning fields (`reasoning_opaque`, `encrypted_content`) must be explicitly excluded from export
- Export lineage chain for tracking re-exports across multiple systems
- `.tpx.json` magic-byte header for reliable file type detection
- Frontend preview debouncing (300ms) for performance with large sessions
- `PreviewMode` flag on builder to cap data loading for performant previews

**GPT 5.4 (exclusive insights):**
- Two import modes: **native** (full reconstruction) vs **snapshot** (read-only for partial/redacted files)
- CSV formula-injection hardening (prefix dangerous cell values)
- Capabilities manifest per imported session showing available sections
- "Not resumable / not native" badge for partial imports
- Conflict "Replace" needs atomic backup/rollback semantics
- UUID rewriting for "Duplicate" conflict strategy needs design for internal ID references

**Codex 5.3 (exclusive insights):**
- Deterministic pseudonymization tokens (`[PATH_1]`, `[REPO_1]`) to preserve analytic utility after redaction
- Per-session `import_report` output: imported/skipped/failed with reasons
- Freeze wire schema doc early with exact JSON examples matching Rust structs
- Snapshot tests for Markdown/HTML/CSV outputs (not just unit tests)
- Max field lengths to prevent pathological payloads during import
- System/developer prompts (`system.message`) should be explicit toggle in section filter

### 15.4 Recommendations Not Yet Incorporated

These suggestions are valuable but deferred for future consideration:

| Suggestion | Source | Reason for Deferral |
|-----------|--------|---------------------|
| Ed25519 signing for provenance verification | Opus | Complexity; design header to accommodate later |
| Typed migration structs per version (compile-time safety) | Opus | Good idea but adds significant boilerplate for v1 |
| Generate shared types from single source of truth (Rust → TS) | Codex | Architectural change beyond export scope |
| `session.db` schema/constraint/index preservation | GPT | `CustomTableInfo` with column names + rows is sufficient for v1 |
| Streaming parse/render for very large sessions | All 3 | Builder-level optimization; add in Phase A2 if needed |
| Session artifacts (`files/`) export | GPT + Codex | Binary file handling adds complexity; manifest-only for v1 |

---

## 16. Appendix: Revisions from Review

### Changes Made to This Report

| Section | Change | Triggered By |
|---------|--------|-------------|
| §1 Key Principles | Added "Security-first import" principle | All 3 reviewers |
| §3.2 Data Segments | Added MCP inventory, parse diagnostics, session artifacts | GPT, Codex |
| §4 User Stories | Added US-19 through US-23 (debugging, archival, clipboard, selective import, dry-run) | Opus, Codex |
| §6.2 Import Pipeline | Complete rewrite with security steps, atomic staging, two import modes | All 3 reviewers |
| §7.3 Core Types | Renamed to `SessionArchive`/`PortableSession`; `SectionId` enum; `SchemaVersion` major/minor; content hash; lineage | All 3 reviewers |
| §8.1 Version Policy | Major/minor versioning, `minimumReaderVersion`, compatibility rules | All 3 reviewers |
| §11 Implementation Phases | Split Phase A into A1/A2/A3; enhanced Phase B, C, D, E items | All 3 reviewers |
| §13 Risks | Added 7 new risks with mitigations | All 3 reviewers |
