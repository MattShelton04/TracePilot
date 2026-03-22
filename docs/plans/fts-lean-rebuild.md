# FTS Lean Rebuild Plan

> Single-DB deep search, always-on, zero bloat.
>
> **Reviewed by**: Claude Opus 4.6, GPT 5.4, Codex 5.3, Gemini 3 Pro — feedback consolidated below.

---

## Problem Statement

The current `Matt/Search_Feature_Prototype_Enablement` branch adds 19,628 lines across 101 files with 15 commits (9 of which are fixes-on-fixes). The core ideas are sound — deep FTS across session content, command palette, search dashboard — but the implementation accumulated significant technical debt through iterative patching:

- **Separate `search.db`**: Duplicated session metadata, two connections to manage, complex Phase 1/Phase 2 orchestration, separate semaphore newtype — all unnecessary for a single-user desktop app
- **Feature flag complexity**: Code paths that skip indexing when disabled, "enable in settings" prompts, rebuild-on-enable triggers — removing the flag simplifies everything
- **Dead code**: ~300 lines of unused `_with_search` reindex functions, phantom content types in schema CHECK constraints, no-op helper functions
- **Monolithic frontend**: `SessionSearchView.vue` is 1,789 lines in one file, CSS alone is 1,023 lines
- **FTS sanitizer fragility**: Naive parenthesis handling, no NEAR() inner sanitization, leading-NOT edge cases
- **Concurrent indexing bug**: Ctrl+R during indexing spawns unbounded parallel tasks — Phase 2 queues indefinitely via `acquire_owned().await`, analytics views spawn 3 new `spawn_blocking` threads per reload with no guard

This plan rebuilds the feature lean on a fresh branch off `main`, merging FTS into the existing `index.db`.

---

## Architecture Decisions

### 1. Single Database (`index.db`)

**Decision**: Merge all FTS content into `index.db`. Drop the separate `search.db`.

**Rationale for single-user desktop app**:
- Cross-table JOINs (search results ↔ session metadata/analytics) without denormalization
- One file to manage (backup, factory reset, migration)
- One connection, one WAL, one page cache
- `sessions` table already has `events_mtime` and `events_size` columns (Migration 3) — no new columns needed for incremental detection
- "Rebuild search" = `DROP` + `CREATE` the FTS tables within `index.db` (atomic, no file deletion)

**Tradeoff**: DB grows from ~14 MB to ~150 MB. Acceptable — we benchmarked FTS queries at <3ms even at 246K rows.

### 2. Always-On (No Feature Flag)

**Decision**: Remove the `sessionSearch` feature flag. Deep search is always enabled.

**Rationale**: Every user benefits from search. The feature flag added 3 code paths (disabled/enabling/enabled) that complicated every Tauri command. The ~150 MB DB size is acceptable for a development tool.

**Impact**: Remove `sessionSearch` from `FeaturesConfig`, `WizardStepFeatures`, `SettingsDataStorage`, and all Tauri command guards.

### 3. Two-Phase Indexing with Proper Guards

**Decision**: Keep Phase 1 (session metadata) → Phase 2 (FTS content extraction) architecture, but:
- Both phases write to the **same `index.db`**
- Phase 2 uses **`try_acquire_owned()`** (not `acquire_owned().await`) — skip if busy, catch up next cycle
- Store a `CancellationToken` that is signaled on webview reload to abort in-flight Phase 2 work
- Analytics queries get a shared semaphore guard to prevent Ctrl+R accumulation

### 4. Replace Old FTS Tables

**Decision**: Migration 6 drops `sessions_fts`, `conversation_fts`, and their triggers. Replaces with:
- `search_content` — one row per content chunk (typed, timestamped, turn-linked)
- `search_fts` — FTS5 virtual table backed by `search_content`
- New triggers to keep FTS in sync with content table
- New `sessions_fts` — lightweight session-level FTS (summary, repo, branch) for the sessions toolbar quick filter

---

## Schema Design (Migration 6)

> **Review fix (Opus/GPT/Codex):** Back-populate `sessions_fts` after recreation. Guard `ALTER TABLE` for idempotency. Use consistent timestamp format.

```sql
-- ═══ Drop old FTS ═══
DROP TRIGGER IF EXISTS sessions_ai;
DROP TRIGGER IF EXISTS sessions_au;
DROP TRIGGER IF EXISTS sessions_ad;
DROP TABLE IF EXISTS sessions_fts;
DROP TABLE IF EXISTS conversation_fts;

-- ═══ Deep search content table ═══
CREATE TABLE IF NOT EXISTS search_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK(content_type IN (
        'user_message', 'assistant_message', 'reasoning',
        'tool_call', 'tool_error', 'error',
        'compaction_summary', 'system_message', 'subagent', 'checkpoint'
    )),
    turn_number INTEGER,
    event_index INTEGER,
    timestamp_unix INTEGER,
    tool_name TEXT,
    content TEXT NOT NULL,
    metadata_json TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_search_content_session ON search_content(session_id);
-- Note: idx_search_content_type OMITTED per review — rarely used standalone,
-- costs write throughput during 246K inserts. Add later if needed.
CREATE INDEX IF NOT EXISTS idx_search_content_timestamp ON search_content(timestamp_unix);

-- ═══ FTS5 virtual table (content-sync) ═══
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
    content,
    content='search_content',
    content_rowid='id',
    tokenize='unicode61'
);

-- Sync triggers
CREATE TRIGGER IF NOT EXISTS search_content_ai AFTER INSERT ON search_content BEGIN
    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS search_content_au AFTER UPDATE ON search_content BEGIN
    INSERT INTO search_fts(search_fts, rowid, content) VALUES ('delete', old.id, old.content);
    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS search_content_ad AFTER DELETE ON search_content BEGIN
    INSERT INTO search_fts(search_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

-- ═══ Lightweight session-level FTS (for toolbar quick search) ═══
CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
    id, summary, repository, branch,
    content='sessions',
    content_rowid='rowid',
    tokenize='unicode61'
);

-- CRITICAL: Back-populate sessions_fts from existing sessions
-- Without this, toolbar search breaks until sessions are next modified.
INSERT INTO sessions_fts(rowid, id, summary, repository, branch)
    SELECT rowid, id, summary, repository, branch FROM sessions;

-- Sync triggers for sessions_fts
CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
    INSERT INTO sessions_fts(rowid, id, summary, repository, branch)
    VALUES (new.rowid, new.id, new.summary, new.repository, new.branch);
END;

CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
    INSERT INTO sessions_fts(sessions_fts, rowid, id, summary, repository, branch)
    VALUES ('delete', old.rowid, old.id, old.summary, old.repository, old.branch);
    INSERT INTO sessions_fts(rowid, id, summary, repository, branch)
    VALUES (new.rowid, new.id, new.summary, new.repository, new.branch);
END;

CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
    INSERT INTO sessions_fts(sessions_fts, rowid, id, summary, repository, branch)
    VALUES ('delete', old.rowid, old.id, old.summary, old.repository, old.branch);
END;

-- ═══ Track content indexing state ═══
-- Guard for idempotency (SQLite 3.35+, bundled via rusqlite)
-- If column already exists, this is a no-op.
-- Implementation note: use Rust column-existence check before ALTER
-- since ALTER TABLE ADD COLUMN IF NOT EXISTS isn't universally supported.
ALTER TABLE sessions ADD COLUMN search_indexed_at TEXT;
-- Also add extractor version for forced reindex on logic changes:
ALTER TABLE sessions ADD COLUMN search_extractor_version INTEGER DEFAULT 0;

-- Schema version
INSERT INTO schema_version (version) VALUES (6);
```

### Key Design Notes

- **`search_content` rows have `ON DELETE CASCADE`** from `sessions` — when a session is deleted during reindex, all its search content is automatically cleaned up
- **`search_fts` only indexes `content`** — filtering by `content_type`, `session_id`, `tool_name` etc. happens via JOIN with `search_content` (more efficient than indexing metadata in FTS5)
- **`sessions_fts` recreated with `unicode61` tokenizer** and **back-populated** from existing sessions (critical fix from review)
- **`search_indexed_at`** on the `sessions` table tracks when each session's content was last indexed
- **`search_extractor_version`** enables forced reindex when extraction logic changes (e.g., new content types added) — compare against a `CURRENT_EXTRACTOR_VERSION` constant in Rust
- **Timestamps**: Both `events_mtime` and `search_indexed_at` use RFC 3339 UTC format from Rust (`chrono::Utc::now().to_rfc3339()`). Do NOT use SQLite's `datetime('now')` which produces a different format.
- **`ALTER TABLE` idempotency**: In Rust, check `PRAGMA table_info(sessions)` for column existence before running ALTER. If column exists, skip.
- **`conversation_fts` references in `session_writer.rs`** must be removed — the old writer still does DELETE/INSERT on `conversation_fts` which will be dropped (critical fix from GPT review)

---

## Content Extraction (What Gets Indexed)

| Content Type | Source Event(s) | What's Indexed | Size Cap |
|---|---|---|---|
| `user_message` | `user.message` | User prompt text | 50 KB |
| `assistant_message` | `assistant.message` | AI response text | 50 KB |
| `reasoning` | `assistant.message` (reasoningText), `assistant.reasoning` | Chain-of-thought | 50 KB |
| `tool_call` | `tool.execution_start` | Tool name + arguments | 10 KB (args) |
| `tool_error` | `tool.execution_complete` (error) | Error message | 5 KB |
| `error` | `session.error` | Session-level error | 5 KB |
| `compaction_summary` | `session.compaction_complete` | Context summary | 50 KB |
| `system_message` | `system.message` | System/developer prompt | 50 KB |
| `subagent` | `subagent.started` | Agent name + description | 50 KB |
| `checkpoint` | Checkpoint files in session dir | Checkpoint plan content | 50 KB |

**Not indexed**: Tool results (~75% of content by size, mostly raw file contents).

---

## Indexing Pipeline

### Phase 1: Session Metadata (Blocking — Loading Screen)

```
App Launch → Loading Screen → reindex_sessions()
  ├─ Discover all sessions in session-state dir
  ├─ For each session:
  │   ├─ Compare events_mtime + events_size → needs_reindex()?
  │   ├─ If yes: parse events.jsonl → upsert sessions + analytics tables
  │   └─ Emit indexing-progress { current, total }
  ├─ Emit indexing-finished
  └─ Loading screen dismisses → app is usable
```

### Phase 2: FTS Content Extraction (Background — Non-Blocking)

> **Review fix (Opus/Gemini):** Parse outside transaction, write inside. Per-session transaction safety.

```
After Phase 1 completes:
  ├─ try_acquire search_permit (skip if busy — don't queue!)
  ├─ For each session where needs_content_reindex() == true:
  │   ├─ OUTSIDE TRANSACTION: Parse events.jsonl → extract content rows into Vec
  │   ├─ BEGIN TRANSACTION
  │   │   ├─ DELETE FROM search_content WHERE session_id = ?
  │   │   ├─ INSERT INTO search_content (batch)
  │   │   ├─ UPDATE sessions SET search_indexed_at = ?, search_extractor_version = ?
  │   │   └─ COMMIT
  │   ├─ Check CancellationToken — abort if webview reloaded
  │   └─ Emit search-indexing-progress { current, total } (throttled: every 5 sessions or 500ms)
  ├─ PRAGMA optimize
  ├─ Emit search-indexing-finished
  └─ Search is now fully available
```

**Key**: Parsing (CPU-bound) happens OUTSIDE the transaction. The DB lock is held only for the brief write phase. This prevents UI/analytics freezes during Phase 2.

### Incremental Detection

> **Review fix (all 4 models):** Check both mtime AND size. Use consistent timestamp format. Add extractor version.

A session needs content re-indexing when:
```rust
const CURRENT_EXTRACTOR_VERSION: i32 = 1;  // bump when extraction logic changes

fn needs_content_reindex(session: &SessionRow) -> bool {
    // Never indexed
    session.search_indexed_at.is_none()
    // Events file changed (mtime or size)
    || session.search_indexed_at.as_deref() < session.events_mtime.as_deref()
    || session.events_size_changed_since_index()  // compare stored vs current
    // Extraction logic changed (new content types, etc.)
    || session.search_extractor_version < CURRENT_EXTRACTOR_VERSION
}
```

Both `events_mtime` and `search_indexed_at` MUST use the same format: RFC 3339 UTC from Rust's `chrono::Utc::now().to_rfc3339()`. Never use SQLite's `datetime('now')`.

**Active sessions**: If `events.jsonl` is being actively written, Phase 2 indexes the current content. The next cycle will re-index if the file has changed. No special handling needed — the incremental check naturally catches updates.

### Rebuild Search

User clicks "Rebuild Search Index" in settings:
```sql
DELETE FROM search_content;
UPDATE sessions SET search_indexed_at = NULL;
-- Then run Phase 2 for all sessions
```

No file deletion, no DB recreation — just clear and repopulate within the same `index.db`.

---

## Fixing the Ctrl+R Concurrent Indexing Bug

### Root Cause

When user presses Ctrl+R (webview reload) during indexing:
1. All JS state is destroyed (Pinia stores, module variables, event listeners)
2. All Tokio tasks **continue running** in the Rust backend
3. New page load calls `reindex_sessions()` again → potentially spawns duplicate work

### Specific Bugs

| Bug | Current Behavior | Fix |
|---|---|---|
| Phase 2 queues indefinitely | `acquire_owned().await` — waits for previous Phase 2 | Use `try_acquire_owned()` — skip if busy |
| Analytics spawn accumulation | 3 new `spawn_blocking` per Ctrl+R, no guard | Add per-command `AtomicBool` busy flag |
| `indexingPromise` reset on reload | Module-level JS variable = `null` after reload | Deduplicate on Rust side via semaphore (already works for Phase 1) |
| No task cancellation on reload | Old Tokio tasks run to completion | Add `CancellationToken` signaled on `on_page_load` hook |

### Implementation

**1. `CancellationToken` for background tasks:**
```rust
// Managed state: Arc<Mutex<CancellationToken>>
// On webview page_load event → swap in fresh token, cancel the old one
// Phase 2 captures a clone BEFORE starting, checks is_cancelled() at batch boundaries
// Note: register on_page_load in the Tauri plugin builder setup
```

**2. Analytics query guard (per-command `AtomicBool`):**
```rust
// Each analytics command (get_analytics, get_tool_analysis, get_code_impact)
// checks a shared AtomicBool. If already running, return Err("BUSY").
// Frontend shows "Loading..." state, not duplicate computation.
// AtomicBool is preferred over semaphore for simplicity — these are read-only queries.
static ANALYTICS_BUSY: AtomicBool = AtomicBool::new(false);
if ANALYTICS_BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
    return Err("BUSY".to_string());
}
// ... do work ...
ANALYTICS_BUSY.store(false, Ordering::SeqCst);
// Note: wrap in a Drop guard for panic safety
```

**3. Phase 2 non-blocking acquire:**
```rust
let _permit = match search_permit.try_acquire_owned() {
    Ok(p) => p,
    Err(_) => {
        tracing::info!("Search indexing already in progress, skipping");
        return;
    }
};
```

**4. Frontend status on mount (Gemini):**
```rust
// New Tauri command: get_indexing_status() -> { phase1_running, phase2_running, progress }
// Called by search store on init — provides current state even after Ctrl+R
// Without this, a user who refreshes mid-indexing sees no progress until the next event
```

---

## Frontend Architecture

### Components to Build (from scratch, informed by prototypes)

```
apps/desktop/src/
├── views/
│   └── SessionSearchView.vue          # Main search page (container only, ~200 lines)
├── components/search/
│   ├── SearchHero.vue                 # Search bar + syntax hints (~150 lines)
│   ├── SearchResults.vue              # Results list + pagination (~200 lines)
│   ├── SearchResultCard.vue           # Individual result card (~100 lines)
│   ├── SearchFilters.vue              # Filter sidebar (~200 lines)
│   ├── SearchFacets.vue               # Facet counts sidebar (~100 lines)
│   ├── SearchPalette.vue              # Ctrl+K command palette (~400 lines)
│   └── SearchIndexingBanner.vue       # Progress indicator (~80 lines)
├── stores/
│   └── search.ts                      # Search Pinia store (~250 lines)
```

**Total: ~1,680 lines** across 9 files vs. current 2,864 lines in 3 files.

### Design Patterns to Port from Prototypes

| Pattern | Source Prototype | Priority |
|---|---|---|
| Hero search bar with syntax hint chips | `session-search-dashboard.html` | P0 |
| Content-type colored chips (indigo/green/violet/amber/rose) | All prototypes | P0 |
| Collapsible filter sidebar with CSS transition | `session-search-dashboard.html` | P0 |
| Turn highlighting with match badge | `session-search-context.html` | P1 |
| Cmd+K palette with category tabs + shimmer loading | `session-search-palette.html` | P0 |
| ← → match navigation within session | `session-search-context.html` | P1 |
| Staggered card entry animations | Current `SessionSearchView.vue` | P2 |

### Shared Constants

Extract `contentTypeConfig` (colors, labels, icons per content type) into `packages/types/src/search.ts` — currently duplicated between SearchView and SearchPalette.

### Search Indexing Observability

The user specifically wants clear feedback about indexing state. Implementation:

1. **Search page**: `SearchIndexingBanner.vue` shows progress bar when `store.searchIndexing` is true
2. **Sidebar**: Search nav item gets a subtle pulsing dot indicator during indexing
3. **Settings**: Data & Storage section shows indexing progress inline
4. **All three** consume from the Pinia search store's global event listeners (not local component listeners)

---

## Tauri Commands (Lean)

### Remove
- `SearchSemaphore` newtype → use a simple `Arc<Semaphore>` with a descriptive constant name
- Feature flag guards from all search commands

### Keep/Modify
- `reindex_sessions` → Phase 2 now writes to `index.db` instead of `search.db`
- `reindex_sessions_full` → same
- `search_sessions` → existing command, now uses the new `search_fts` table

### New/Replacement Commands

```rust
#[tauri::command]
pub async fn search_content(
    state: State<'_, SharedConfig>,
    query: String,
    filters: SearchFilters,  // struct, not 10 individual params
    page: usize,
    page_size: usize,
) -> Result<SearchResponse, String>

#[tauri::command]
pub async fn get_search_facets(
    state: State<'_, SharedConfig>,
) -> Result<SearchFacets, String>

#[tauri::command]
pub async fn rebuild_search_content(
    state: State<'_, SharedConfig>,
    app: AppHandle,
) -> Result<usize, String>
```

---

## FTS5 Query Sanitizer (Simplified)

The current sanitizer is 150 lines and fragile. Simplify to:

```rust
pub fn sanitize_fts_query(input: &str) -> String {
    // 1. Split input preserving quoted phrases
    // 2. Recognize operators: AND, OR, NOT (case-insensitive)
    // 3. Double-quote every non-operator token
    // 4. Strip leading NOT, trailing operators
    // 5. Handle prefix: word* → "word"*
    // 6. No NEAR() support (complexity not worth it)
    // 7. No parentheses support (strip all parens)
    // Result: safe for FTS5, handles 99% of user queries
}
```

Target: ~80 lines with comprehensive tests.

---

## Cleanup: What NOT to Carry Over

| Item | Reason |
|---|---|
| `search.db` / `search_db/` module | Replaced by single-DB approach |
| `SearchSemaphore` newtype | Replaced by simpler guard |
| `sessionSearch` feature flag | Always enabled |
| `WizardStepFeatures` search toggle | No feature flag |
| `reindex_incremental_with_search()` | Dead code |
| `reindex_all_with_search()` | Dead code |
| `config.search_db_path()` | No separate DB |
| Phase 2 `acquire_owned().await` | Bug — use `try_acquire_owned()` |
| `search_sessions` table | Replaced by `sessions.search_indexed_at` |
| 3 separate schema migrations | Single Migration 6 in index.db |

---

## What to Carry Over (Good Stuff)

| Item | Source | Why It's Good |
|---|---|---|
| Content extraction logic | `search_db/writer.rs` | Well-structured event → content row mapping |
| FTS snippet sanitization (sentinel markers) | `search_db/reader.rs:267-275` | Clever XSS prevention via `\x01MARK_OPEN\x01` |
| Query builder with parameterized filters | `search_db/reader.rs:278-456` | Dynamic SQL done correctly |
| Pinia search store | `stores/search.ts` | Clean composition API, stale-request cancellation |
| Content type color/label config | `SessionSearchView.vue` + `SearchPalette.vue` | Consistent design system |
| Search indexing events pattern | `search-indexing-started/progress/finished` | Good observability |
| Prototype design patterns | `docs/design/prototypes/` | Polished, production-close designs |
| Architecture documentation | `docs/search-indexing-architecture.md` | Accurate reference (update for single-DB) |
| Benchmarks and test data | `copilot-session-viewer-report.md` | Real performance numbers |

---

## Implementation Order

> **Review fix (Opus/GPT):** Ctrl+R fix moved to step 1. Tests written inline with each step, not as a separate phase.

### Phase A: Backend Foundation
1. **Fix Ctrl+R bug FIRST** — `CancellationToken` + `try_acquire` for Phase 2 + analytics `AtomicBool` guards + `get_indexing_status` command. **Tests**: cancellation mid-batch, try_acquire skip path, concurrent guard behavior.
2. **Migration 6** — Drop old FTS, create `search_content` + `search_fts` + new `sessions_fts` (back-populated!), add `search_indexed_at` + `search_extractor_version`. Remove `conversation_fts` references from `session_writer.rs`. **Tests**: fresh DB applies all migrations; v5→v6 migration with preexisting sessions; verify `sessions_fts` populated; verify Phase 1 no longer touches `conversation_fts`.
3. **Content writer** — Port extraction logic into `index_db/search_writer.rs`. Parse outside transaction, write inside. Per-session transaction (DELETE+INSERT+UPDATE). **Tests**: each event type → correct content row, truncation, tool name carrying, transaction rollback on error.
4. **Content reader** — Port query builder + simplified sanitizer into `index_db/search_reader.rs`. Add `ORDER BY rank` (BM25). Add `snippet()` or sentinel-based highlighting. **Tests**: sanitizer (20+ cases), query builder with all filter combos, snippet generation.
5. **Incremental detection** — `needs_content_reindex()` using `search_indexed_at` + `events_mtime` + `events_size` + `search_extractor_version`. **Tests**: new session, unchanged, mtime changed, size changed, version changed, timestamp format consistency.
6. **Phase 2 in lib.rs** — Single function `reindex_search_content()`, writes to `index.db`, checks cancellation token at batch boundaries, emits throttled progress events. **Tests**: end-to-end index + search with test data, cancellation mid-run.
7. **Tauri commands** — `search_content`, `get_search_facets`, `rebuild_search_content`, `get_indexing_status`. **Tests**: command returns correct data, rebuilds clears and repopulates.

### Phase B: Frontend
8. **Shared types** — Create `packages/types/src/search.ts` with `SearchContentType` union synced to SQL CHECK constraint. **No `tool_result`/`warning`/`plan` phantom types.**
9. **Search store** — Port `stores/search.ts`, remove search.db references, add global event listeners with proper cleanup on `$dispose`. Add `fetchIndexingStatus()` for mount-time state recovery. **Tests**: query debouncing, stale request cancellation, event listener lifecycle.
10. **Search components** — Build from scratch following prototype designs:
    - `SearchHero.vue` — search bar + syntax hints
    - `SearchResultCard.vue` — individual result with type-colored chip
    - `SearchResults.vue` — results list + pagination
    - `SearchFilters.vue` — filter sidebar
    - `SearchFacets.vue` — facet counts
    - `SearchIndexingBanner.vue` — progress indicator
    **Tests**: result card rendering per content type, filter state management.
11. **SessionSearchView.vue** — Thin container composing the above (~200 lines)
12. **SearchPalette.vue** — Port and clean up: extract shared constants, fix `indexOf` → use `v-for` index, remove feature flag guard. **Tests**: open/close, keyboard nav, ESC dismiss, search execution.
13. **Routing + sidebar** — Modify existing `/search` route, update nav item with indexing indicator dot
14. **Settings** — Remove feature flag toggle from `SettingsDataStorage.vue` and `SetupWizard.vue`. Keep "Rebuild Search" button in Data & Storage. Remove `WizardStepFeatures` search toggle.

### Phase C: Integration & Polish
15. **Deep-linking** — Click search result → navigate to session + scroll to matching turn via `?turn=N`
16. **Keyboard navigation** — Ctrl+K opens palette, ↑↓ navigation, Enter to open
17. **Observability** — Global indexing banner, sidebar indicator, settings progress, `get_indexing_status` for mount-time recovery
18. **Post-rebuild cleanup** — `PRAGMA optimize` after Phase 2 completion

### Phase D: Documentation & Final Review
19. **Update `docs/search-indexing-architecture.md`** — Single-DB architecture, new schema, incremental model, Ctrl+R fix
20. **4-model code review** — Opus 4.6, GPT 5.4, Codex 5.3, Gemini
21. **Consolidate and fix review findings**

---

## Test Coverage Requirements

### Backend (Rust)

| Area | Tests | Description |
|---|---|---|
| FTS sanitizer | 20+ unit tests | Empty, single word, phrase, operators, prefix, special chars, SQL injection, unbalanced quotes, unicode |
| Content extraction | 10+ unit tests | Each event type → correct content row, truncation, tool name carrying |
| Incremental detection | 5+ unit tests | New session, unchanged, mtime changed, size changed, both changed |
| Migration 6 | 2+ integration tests | Fresh DB applies all migrations; existing DB migrates from v5 → v6 |
| Search query builder | 10+ unit tests | Basic query, content type filter, date range, tool name, repo, pagination, sort order |
| Snippet sanitization | 5+ unit tests | HTML escaping, mark tag insertion, nested marks, empty content |

### Frontend (TypeScript/Vue)

| Area | Tests | Description |
|---|---|---|
| Search store | 10+ unit tests | Query debouncing, filter changes trigger search, stale request cancellation, facet computation |
| SearchResultCard | 5+ unit tests | Renders all content types, truncation, click handler, snippet highlighting |
| SearchPalette | 8+ unit tests | Open/close, keyboard nav, category tabs, search execution, ESC dismiss |
| SearchFilters | 5+ unit tests | Content type toggles, repo dropdown, date range, clear all |

---

## Performance Targets

Based on benchmarks from the prototype phase (127 sessions, 246K content rows, 804 MB events.jsonl):

| Metric | Target | Measured |
|---|---|---|
| Phase 1 (metadata) duration | <15s | ~12s |
| Phase 2 (FTS content) duration | <60s | ~48s |
| Simple FTS query | <5ms | <3ms |
| Complex filtered query | <100ms | <80ms |
| DB size increase | <150 MB | ~135 MB |
| Per-session indexing | <500ms | ~380ms |

---

## Files to Create/Modify

### New Files (on fresh branch from main)
```
crates/tracepilot-indexer/src/index_db/search_writer.rs    # Content extraction
crates/tracepilot-indexer/src/index_db/search_reader.rs    # FTS queries + sanitizer
apps/desktop/src/views/SessionSearchView.vue               # Search page container
apps/desktop/src/components/search/SearchHero.vue           # Search bar
apps/desktop/src/components/search/SearchResults.vue        # Results list
apps/desktop/src/components/search/SearchResultCard.vue     # Result card
apps/desktop/src/components/search/SearchFilters.vue        # Filter sidebar
apps/desktop/src/components/search/SearchFacets.vue         # Facet counts
apps/desktop/src/components/search/SearchPalette.vue        # Ctrl+K palette
apps/desktop/src/components/search/SearchIndexingBanner.vue # Progress banner
apps/desktop/src/stores/search.ts                           # Pinia search store
packages/types/src/search.ts                                # Shared search types
```

### Modified Files
```
crates/tracepilot-indexer/src/index_db/migrations.rs       # Add Migration 6
crates/tracepilot-indexer/src/index_db/mod.rs              # Export search_writer/reader
crates/tracepilot-indexer/src/lib.rs                       # Add reindex_search_content()
crates/tracepilot-tauri-bindings/src/lib.rs                # New commands, fix Ctrl+R bug
crates/tracepilot-tauri-bindings/src/config.rs             # Remove search_db_path()
apps/desktop/src/router/index.ts                           # Add /search route
apps/desktop/src/components/layout/AppSidebar.vue          # Add search nav item
apps/desktop/src/components/settings/SettingsDataStorage.vue  # Remove flag, keep rebuild
apps/desktop/src/components/SetupWizard.vue                # Remove search toggle
packages/client/src/index.ts                               # Add search client functions
packages/types/src/index.ts                                # Add search types (or import from search.ts)
docs/search-indexing-architecture.md                       # Update for single-DB
```

### Removed (not carried over from old branch)
```
crates/tracepilot-indexer/src/search_db/              # Entire module
crates/tracepilot-tauri-bindings/src/config.rs        # search_db_path() method only
apps/desktop/src/components/wizard/WizardStepFeatures.vue  # Simplify or remove search toggle
```

---

## Risk Mitigations

| Risk | Mitigation |
|---|---|
| Migration 6 corrupts existing index.db | Test migration on copy of real DB before release; migration is idempotent (IF NOT EXISTS) |
| FTS content bloats index.db beyond expectations | Benchmark with real data; content caps per type limit growth |
| Phase 2 takes too long on first run | Progress banner gives clear feedback; "Search available after indexing" message |
| Ctrl+R fix introduces new race conditions | `CancellationToken` checked at batch boundaries (every 100 sessions); unit tests for guard logic |
| Single DB WAL contention during Phase 2 writes | `busy_timeout=5000` already set; Phase 2 commits per-session transactions (brief locks); parse outside transaction |

---

## Appendix: Consolidated Review Findings

### Critical (All 4 Models Agreed)

| # | Finding | Source | Resolution |
|---|---------|--------|------------|
| 1 | `sessions_fts` empty after Migration 6 (dropped + recreated without data) | Opus/GPT/Codex | Added `INSERT INTO sessions_fts` from `sessions` table after CREATE |
| 2 | `session_writer.rs` still writes to `conversation_fts` (will crash) | GPT | Plan step 2 now explicitly removes these references |
| 3 | Timestamp format mismatch (`events_mtime` RFC3339 vs `datetime('now')`) | Opus/Codex/GPT | All timestamps use `chrono::Utc::now().to_rfc3339()`, never `datetime('now')` |
| 4 | Incremental detection only checks mtime (not size) | Opus/Codex/GPT | `needs_content_reindex()` now checks mtime + size + extractor_version |

### High Priority

| # | Finding | Source | Resolution |
|---|---------|--------|------------|
| 5 | Ctrl+R fix should be step 1, not step 7 | Opus/GPT | Moved to Phase A step 1 |
| 6 | Tests as separate Phase D → tests never get written | Opus | Tests now inline with each implementation step |
| 7 | `ALTER TABLE ADD COLUMN` not idempotent on re-run | Opus/Codex | Rust checks `PRAGMA table_info` for column existence before ALTER |
| 8 | Per-session transactions needed (DELETE+INSERT+UPDATE atomic) | Opus | Phase 2 pipeline now wraps each session in BEGIN/COMMIT |
| 9 | Parsing inside transaction freezes UI | Gemini | Phase 2 pipeline: parse outside → write inside (brief lock) |
| 10 | Extractor versioning needed for forced reindex | GPT | Added `search_extractor_version` column + `CURRENT_EXTRACTOR_VERSION` constant |

### Medium Priority

| # | Finding | Source | Resolution |
|---|---------|--------|------------|
| 11 | Result ranking with BM25 | Gemini | `ORDER BY rank` added to search reader spec |
| 12 | `idx_search_content_type` costs write throughput | Opus | Index removed from Migration 6; filter via JOIN only |
| 13 | Frontend must fetch status on mount (not just events) | Gemini | Added `get_indexing_status` command + `fetchIndexingStatus()` in store |
| 14 | Event listener cleanup on store dispose | Opus | Explicit unlisten in `$dispose` hook |
| 15 | `PRAGMA optimize` after Phase 2 | Codex | Added to Phase C step 18 |
| 16 | Remove phantom TS types (`tool_result`, `warning`, `plan`) | Opus | Noted in Phase B step 8 |
| 17 | Snippet generation strategy not specified | Gemini | Plan specifies FTS5 `snippet()` + sentinel-based fallback |
| 18 | Dedicated writer connection for Phase 2 | Codex | Not needed in single-DB; `busy_timeout` handles contention |
