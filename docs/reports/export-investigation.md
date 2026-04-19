# Export Feature Investigation Report

## Overview

Empirical investigation of the TracePilot export feature using a real 2.8MB session
(`129abc86-d548-4e57-a870-77ff9af27e2d`, 1259 events, 196 turns, 258 tool calls) against
all toggles/flags. The spike binary is at
`crates/tracepilot-export/examples/spike_real_session.rs`.

---

## Architecture

```
SessionArchive (builder.rs)
  ↓  apply_content_filters (content_filter.rs)
  ↓  apply_redaction (redaction/mod.rs)
  ↓  Renderer (render/json.rs | markdown.rs | csv.rs)
  ↓  Vec<ExportFile>
```

**Formats:** JSON (lossless `.tpx.json`), Markdown (human-readable), CSV (multi-file tabular)

**Sections:** Conversation, Events, Todos, Plan, Checkpoints, RewindSnapshots, Metrics,
Incidents, Health, CustomTables, ParseDiagnostics

---

## Empirical Findings (15-check spike, real session)

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | JSON full export | ✅ | 4501KB, 10/11 sections (no custom_tables in this session) |
| 2 | Markdown full export | ✅ | 12,192 lines, all sections rendered |
| 3 | CSV full export | ✅ | 5 files: summary, conversation, tools, events, model-metrics |
| 4 | Section filter: conversation only | ✅ | Events/plan/todos excluded |
| 5 | Section filter: plan + todos only | ✅ | Conversation/events excluded |
| 6 | includeToolDetails=false | ✅ | Args stripped, summaries kept |
| 7 | includeSubagentInternals=false | ✅ | 258 tool calls → 0 subagent children |
| 8 | includeFullToolResults size | ✅ | Truncated=1313KB vs full=1672KB (+359KB) |
| 9 | anonymizePaths=true | ❌ **BUG** | `system_messages` field not redacted (see Bug 3) |
| 10 | stripPii=true | ✅ | OK |
| 11 | Minimal export (no sections) | ✅ | Metadata-only, 0 available_sections |
| 12 | Preview (512KB cap) | ✅ | Cap respected |
| 13 | Analytics CSV preset | ✅ | 3 files (summary, events, model-metrics) |
| 14 | Plan heading demotion | ✅ | `##{line}` produces correct h3/h4 nesting |
| 15 | rewind_snapshots present | ✅ | 16 snapshots in JSON; **NOT rendered in Markdown** (Bug 2) |

---

## Confirmed Bugs

### Bug 1 — `get_session_sections` hardcodes has_health / has_incidents / has_custom_tables

**File:** `crates/tracepilot-tauri-bindings/src/commands/export_import.rs:251-254`

```rust
has_health: false,        // HARDCODED — should be true when events exist
has_incidents: false,     // HARDCODED — should scan events.jsonl
has_custom_tables: false, // HARDCODED — should query session.db
```

**Impact:** The UI's "Export" tab shows "(empty)" badges for Health, Incidents, and Custom
Tables sections even when the data exists, misleading users about what will be included.

**Fix:** Determine these dynamically:
- `has_health` = `has_events` (health is always computable from events)
- `has_incidents` = quick scan of events.jsonl for `session.error` / `session.warning` /
  `session.compaction_complete` / `session.truncation` event types
- `has_custom_tables` = query session.db for table names excluding `todos` / `todo_deps`

---

### Bug 2 — Markdown renderer silently drops `rewind_snapshots` and `custom_tables`

**File:** `crates/tracepilot-export/src/render/markdown.rs:63-99`

`render_session()` calls dedicated `write_*` functions for all sections **except**
`rewind_snapshots` and `custom_tables`. When these sections are included in an export,
the data is loaded into the archive and goes into the JSON output correctly, but the
Markdown renderer silently discards them.

**Impact:** Users exporting a Markdown backup lose rewind snapshot metadata and any custom
SQL table data, with no indication that content was omitted.

**Fix:** Add `write_rewind_snapshots()` and `write_custom_tables()` functions to
`markdown.rs` and call them from `render_session`.

---

### Bug 3 — Redaction engine does not redact `ConversationTurn.system_messages`

**File:** `crates/tracepilot-export/src/redaction/mod.rs:167-202`

The `redact_turn()` function redacts `user_message`, `transformed_user_message`,
`assistant_messages`, `reasoning_texts`, tool call fields, and attachments — but it
**does not iterate over `turn.system_messages`**.

The `system_messages` field (`Vec<String>`, added as part of Wave-16) contains the
GitHub Copilot system prompt injected before each turn, which includes:

```
* Current working directory: C:\git\TracePilot
* Git repository root: C:\git\TracePilot
* Git repository: MattShelton04/TracePilot
```

**Impact (confirmed by spike):** With `anonymize_paths=true`, real filesystem paths remain
visible in all exported formats (JSON, Markdown, CSV) in every turn that has a system
prompt. This defeats the purpose of path anonymization.

**Fix:** Add `for msg in &mut turn.system_messages { redact_string(msg, patterns, stats); }`
to `redact_turn()`.

---

## Missing Features

### Feature 1 — Export from Session List (UX)

Currently export requires navigating to a separate Export tab and selecting a session.
Users should be able to right-click (or use an action button) on a session in the list
to trigger a quick export.

**Approach:** Add an export action to `SessionListItem.vue` and the session context menu.
A "quick export" should use the last-used preset or the "Team Report" preset as default.

---

### Feature 2 — Raw Zip Export

No option to export the entire session folder as a raw zip for archiving or migration
purposes. This is the highest-fidelity backup option.

**Approach:**
1. New Tauri command `export_session_folder_zip(session_id, dest_path)` that zips the
   session directory (using the `zip` crate already in the workspace, or adding it)
2. New TypeScript client function `exportSessionFolderZip`
3. UI option in `ExportTab.vue` — new "Raw Zip" format radio button

---

### Feature 3 — User Story Presets

The five existing built-in presets are technically complete but don't map well to
common user stories. Missing presets:

| Preset | Format | Sections | Options |
|--------|--------|----------|---------|
| **Minimal Team Log** | Markdown | Conversation, Todos, Plan | No tool details, no subagent internals |
| **Full-Fidelity Backup** | Markdown | All sections | Full tool results, full subagent internals |

**File:** `apps/desktop/src/composables/useExportConfig.ts`

---

## Implementation Plan

### Phase 1 — Bug Fixes (high priority)

1. **Fix Bug 3** (redaction gap): Add `system_messages` to `redact_turn()` + test
2. **Fix Bug 1** (`get_session_sections`): Dynamically detect `has_health`, `has_incidents`,
   `has_custom_tables` + test
3. **Fix Bug 2** (Markdown renderer): Add `write_rewind_snapshots`, `write_custom_tables` + test

### Phase 2 — Integration Tests

Add integration tests to confirm:
- Each section toggle includes/excludes correctly
- `anonymize_paths` covers `system_messages`
- `has_incidents` and `has_health` are correctly determined
- Markdown renders all 11 section types

### Phase 3 — UX Improvements

- Export button from session list view
- Raw zip export option (new Tauri command + UI)
- User story presets in `useExportConfig.ts`

---

## Success Criteria

1. Spike binary passes 15/15 checks
2. All existing 176 tests continue to pass
3. New integration tests (minimum 10) cover each flag/toggle
4. `anonymize_paths` confirmed to redact `system_messages` in spike
5. Markdown export renders all 11 sections
6. UI shows correct availability badges for all sections
