# TracePilot FTS Deep Improvement Report

> **Generated**: 2026-03-25 · **Validated against**: 251 sessions, 177,734 search content rows, 155 MB index DB
> **Multi-model reviewed**: Claude Opus 4.6, GPT-5.4, GPT-5.3-Codex, Gemini 3 Pro

---

## Executive Summary

TracePilot's full-text search system is architecturally sound — a two-phase indexing pipeline (session metadata → deep content) with FTS5, faceted navigation, and a browse mode. However, **real-world data analysis reveals significant opportunities** to make search genuinely more useful for users investigating their Copilot sessions.

### Key Findings at a Glance

| Finding | Impact | Effort |
|---|---|---|
| **Results are flat & scattered** — 618 hits from one session for "error" | 🔴 Critical UX | Medium |
| **No session-level grouping** in results | 🔴 Critical UX | Medium |
| **No "search within session"** from session view (backend already supports it!) | 🔴 Critical UX | Low |
| **Tool results not indexed** — only arguments are searchable | 🟡 Major gap | Low-Medium |
| **70% tool_call dominance** skews relevance — no BM25/type weighting | 🟡 Relevance | Low |
| **94 of 251 sessions** have 0 search content rows | 🟡 Data quality | Low |
| **metadata_json underutilized** — only 222 of 177,734 rows use it | 🟡 Missed opportunity | Low |
| **No URL persistence** for search state | 🟡 UX gap | Low |
| **SessionSearchView.vue is a 1705-line monolith** — no component decomposition | 🟠 Maintainability | Medium |
| **Snippet context is limited** — 48 tokens, no surrounding-turn context | 🟠 UX | Medium |
| **No keyboard navigation** in results list (palette has it, full view doesn't) | 🟠 Accessibility | Low |
| **No aria-live, roles, or screen reader support** in search results | 🟠 Accessibility | Low |
| **No recent searches / search history** | 🟠 UX | Low |
| **No export/copy** of search results | 🟠 UX | Low |
| **5 separate queries per search** — facets not optimized via CTE | 🟠 Performance | Low |
| **Sidebar disappears under 900px** with no mobile fallback | 🟠 Responsive | Low |
| **No first-run/empty-index** guidance (shows "No results" with no context) | 🟠 Onboarding | Low |
| **sessions_fts quick search NOT sanitized** (unlike deep search) | 🟡 Security | Low |
| **`checkpoint` content type** defined but never populated | ⚪ Minor | Low |

---

## 1. Current Architecture Analysis

### 1.1 Schema (Migration 6 — "Deep FTS")

```
search_content (id, session_id, content_type, turn_number, event_index, 
                timestamp_unix, tool_name, content, metadata_json)
                ↓ (triggers sync)
search_fts USING fts5(content, tokenize='unicode61')
```

**Strengths:**
- Content-sync pattern with triggers is correct and efficient
- `unicode61` tokenizer handles international text
- Separate session-level FTS (`sessions_fts`) for toolbar quick search
- Proper indexes on `session_id`, `timestamp_unix`, `tool_name`, `content_type`

**Weaknesses:**
- FTS5 only indexes the `content` column — metadata fields (tool_name, content_type) are not in the FTS index, only used as filters via JOIN
- No column weights or BM25 tuning — with 70% of rows being `tool_call`, relevance ranking is skewed toward tool arguments
- No custom tokenizer for code (camelCase splitting, snake_case splitting)
- No FTS maintenance performed after bulk writes (`optimize`, `automerge` not called)

**Noteworthy strength:** The snippet generation uses `\x01MARK_OPEN\x01` / `\x01MARK_CLOSE\x01` sentinel markers to prevent HTML injection — a well-designed security pattern.

### 1.2 Content Extraction (search_writer.rs)

Currently indexed content types with **real data volumes**:

| Content Type | Rows | Avg Size | What's Indexed |
|---|---|---|---|
| `tool_call` | 124,975 (70.3%) | 291 bytes | Tool **arguments** only (flattened JSON) |
| `assistant_message` | 28,934 (16.3%) | 846 bytes | Assistant response text |
| `reasoning` | 18,377 (10.3%) | 857 bytes | Chain-of-thought text |
| `subagent` | 3,032 (1.7%) | 254 bytes | Agent name + description |
| `tool_error` | 1,306 (0.7%) | 89 bytes | Error messages |
| `user_message` | 844 (0.5%) | 646 bytes | User prompt text |
| `compaction_summary` | 222 (0.1%) | 9,892 bytes | Context compaction summaries |
| `error` | 44 (<0.1%) | 292 bytes | Session-level errors |
| `system_message` | **0** | — | **Not populated** |
| `checkpoint` | **0** | — | **Not populated** |

**Critical gap**: Tool call **results** (the actual output of `view`, `grep`, `powershell`, etc.) are NOT indexed. This means:
- You can find that a tool was *called* with certain arguments
- But you **cannot search** for content that was *returned* by tools
- This is the single largest missing data source — there are 124,975 tool calls, each with a result

### 1.3 Query Pipeline

```
User input → sanitize_fts_query() → FTS5 MATCH → JOIN filters → ORDER BY rank → snippet() → HTML sanitization
```

**Supported query features:**
- ✅ Boolean operators (AND, OR, NOT)
- ✅ Phrase search (`"exact phrase"`)
- ✅ Prefix search (`auth*`)
- ✅ Faceted navigation (content type, repository, tool name)
- ✅ Date range filtering (preset buttons + custom)
- ✅ Sort: relevance / newest / oldest
- ✅ Pagination (50 per page, max 200)

**Missing query features:**
- ❌ No NEAR operator support (explicitly stripped by sanitizer)
- ❌ No column-specific search (e.g., searching only in tool_name or session_summary)
- ❌ No negative filters from UI (e.g., "show everything EXCEPT tool_calls") — `SearchFilters` only has positive include lists
- ❌ No session-scoped search from the session view (backend supports it, but no UI exposes it)
- ❌ No saved searches / search history / recent searches
- ❌ No regex or literal mode — sanitizer strips punctuation-heavy queries, making code search (`src/foo.rs`, `foo::bar()`) weak
- ❌ No qualifier syntax (`type:tool_error repo:TracePilot tool:powershell`) — everything requires sidebar
- ❌ **`sessions_fts` quick search NOT sanitized** — unlike deep search which uses `sanitize_fts_query()`, the quick search in `session_reader.rs` passes user input directly to FTS5 MATCH

### 1.4 UI Analysis

**SessionSearchView.vue** (1705 lines — monolithic file needing decomposition):

Layout:
```
┌──────────────────────────────────────────┐
│ [Search Input] ______________ [Ctrl+K]   │
│ "phrase" exact  prefix*  AND/OR  NOT     │
│ [Filters ▼]              [Sort: ▾]      │
├──────────┬───────────────────────────────┤
│ Sidebar  │ Results (flat list)           │
│ ☑ Types  │ ┌─────────────────────┐      │
│ ☐ Repo   │ │ [repo] [branch] [time] [type] │
│ ☐ Tool   │ │ snippet text...              │
│ ☐ Date   │ │ session · turn · type [View] │
│          │ └─────────────────────┘      │
│          │ ┌─────────────────────┐      │
│          │ │ (next result...)           │
│          │ └─────────────────────┘      │
│          │  [< Prev] [1] [2] ... [Next >] │
└──────────┴───────────────────────────────┘
```

**What works well:**
- Clean, professional dark-theme design
- Content type color-coding with facet counts
- Expandable result cards with deep-link to session
- Browse mode presets (All Errors, User Messages, Tool Calls)
- Loading skeletons
- Search hints showing syntax
- Responsive filter sidebar (collapsible)
- Indexing progress banners
- Snippet sentinel markers prevent HTML injection (security strength)

**Issues identified by multi-model review:**
- **1705-line monolith** — no component decomposition (needs ResultCard.vue, SearchSidebar.vue extraction)
- **Facet sidebar CSS exists but template not fully rendered** — fetched facet data is partially unused
- **No rebuild search index button** exposed in UI (store action exists)
- **Result card `div`s lack `tabindex`, `role`, keyboard handlers** — not accessible
- **No `aria-live` region** for result count updates (screen readers won't announce changes)
- **No `role="feed"` or `role="list"`** on results container
- **Sidebar disappears under 900px** with no responsive fallback (no mobile filter alternative)
- **SearchPalette has fixed 620x500px dimensions** with no responsive media queries
- **TimeRangeFilter component exists** elsewhere but not used in search view
- **No first-run/empty-index guidance** — shows "No results found" with no context about indexing
- **Result cards too click-heavy** — expand requires click, session view requires another click
- **Inline filter pills not shown** — active filters are hidden in sidebar, not visible in results area

**SearchPalette.vue** — Command palette (Ctrl+Shift+F or from nav):
- Quick search overlay with grouped results by content type
- Keyboard navigation (↑/↓/Enter/Escape) — this should be ported to full search view
- Direct navigation to session on result selection
- Lightweight — only fetches 20 results

---

## 2. Detailed Improvement Proposals

### 2.1 🔴 Session-Grouped Results (Critical UX Improvement)

**Problem**: Search results are a flat list of individual content chunks. Searching for "error" returns 7,092 results scattered across sessions. The top session alone has 618 hits. Users must mentally group results and click "View in session" repeatedly to understand context.

**Real data**: For "error" query:
- Session `c533a91f` → 618 hits
- Session `01b724a3` → 524 hits
- Session `3e5e0480` → 386 hits
- *Users see an overwhelming flat list*

**Solution**: Default to **session-grouped results** with a segmented control for view modes.

> *Multi-model consensus*: All 4 reviewers agreed this is not just an improvement but a **requirement** to make search usable. Opus recommends defaulting to grouped (no toggle needed). GPT-5.4 suggests adding turn-level grouping too. Gemini notes users search for *context*, not just text strings.

**View mode segmented control:**
```
[ Sessions ]  [ Turns ]  [ Flat ]
```

- **Sessions** (default): One card per session with hit count, type breakdown, top preview matches. Paginate by sessions, not hits.
- **Turns**: Group matches by session + turn number — shows the conversation flow within a turn
- **Flat**: Current behavior, for power users who want raw result list

**Implementation:**

#### Backend (Rust)
```rust
pub struct GroupedSearchResult {
    pub session_id: String,
    pub session_summary: Option<String>,
    pub session_repository: Option<String>,
    pub session_branch: Option<String>,
    pub session_updated_at: Option<String>,
    pub session_turn_count: Option<i64>,
    pub hit_count: i64,
    pub content_type_breakdown: HashMap<String, i64>,  // Fixed: use HashMap, not GROUP_CONCAT
    pub top_results: Vec<SearchResult>,
}
```

Add a new query method:
```rust
pub fn query_grouped(
    &self,
    query: Option<&str>,
    filters: &SearchFilters,
    top_n_per_session: usize,
    page: usize,
    per_page: usize,
) -> Result<(Vec<GroupedSearchResult>, i64)> {
    // Step 1: CTE for hit set (reuse for aggregation + results)
    // WITH hits AS (
    //   SELECT sc.*, search_fts.rank
    //   FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid
    //   JOIN sessions s ON s.id = sc.session_id
    //   WHERE search_fts MATCH ?
    //   AND <filters>
    // )
    
    // Step 2: Aggregate per session from the CTE
    // SELECT session_id, COUNT(*) as hits,
    //        content_type, COUNT(*) as type_count  -- separate query or JSON aggregate
    // FROM hits GROUP BY session_id
    // ORDER BY MIN(rank)  -- best-hit rank, not just hit count
    // LIMIT ? OFFSET ?
    
    // Step 3: For top N sessions, window function for top results per session
    // SELECT *, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY rank) as rn
    // FROM hits WHERE session_id IN (?) AND rn <= top_n_per_session
}
```

> *Codex note*: Add composite index for grouped mode: `CREATE INDEX idx_sc_session_ts_type ON search_content(session_id, timestamp_unix, content_type);`

#### Frontend mockup

```
┌ TracePilot · main ──────────────────────────────────┐
│ "Implementing FTS search improvements" · 2h ago      │
│ 618 matches · 400 tool_call · 150 assistant · 68 err│
│                                                      │
│  [14:02] Tool: grep  "…race condition in auth…"     │
│  [14:03] Assistant    "…found a race condition…"     │
│  [14:05] Tool Error   "…git: 'pul' is not a git…"  │
│                                                      │
│  [Open Session]  [Filter to This Session]            │
└──────────────────────────────────────────────────────┘
```

> *Key design choices per multi-model feedback:*
> - Repo/branch info moves to the **session group header** (Gemini) — not repeated per result
> - Include **[Filter to This Session]** action (GPT-5.4) for drill-down
> - Order sessions by **best-hit rank**, not just hit count (GPT-5.4)
> - Paginate by sessions, not by individual hits (GPT-5.4)

#### Effort: Medium (~2-3 days)

---

### 2.2 🔴 Search Within Session (Critical UX)

**Problem**: When viewing a specific session, there's no way to search within it. Users must go to the global search, remember to set a session filter, and navigate back.

> *Multi-model consensus*: All 4 reviewers flagged this as critical. The backend already supports session-scoped search (`search.ts:29,154`, `search_reader.rs:365-367`). GPT-5.4 recommends placing this directly in `ConversationTab.vue` (which already supports `?turn` / `?event` scrolling).

**Solution**: Add a search bar inside the session conversation view that queries `search_content` filtered to that session.

**Implementation:**

1. **Place in `ConversationTab.vue`** — not a detached global-search clone. This view already supports turn/event scrolling + highlight.
2. **Reuse existing `search_content` command** with `session_id` filter (already supported!)
3. **Highlight matches in the conversation view** — scroll to and highlight the matching turn
4. **Add mini match rail** on the scrollbar/conversation gutter for density visualization

```vue
<!-- In ConversationTab header -->
<div class="session-search-bar" v-if="searchOpen">
  <input v-model="sessionQuery" placeholder="Search within this session..." />
  <div class="quick-scope-tabs">
    <button :class="{ active: scope === 'all' }">All</button>
    <button :class="{ active: scope === 'messages' }">Messages</button>
    <button :class="{ active: scope === 'tools' }">Tools</button>
    <button :class="{ active: scope === 'errors' }">Errors</button>
    <button :class="{ active: scope === 'reasoning' }">Reasoning</button>
  </div>
  <span v-if="sessionSearchResults.length">
    {{ currentMatch }} / {{ sessionSearchResults.length }} matches
  </span>
  <button @click="prevMatch">↑</button>
  <button @click="nextMatch">↓</button>
</div>
```

**Match rail in conversation gutter** (GPT-5.4 suggestion):
```
│ ░░░░░░░░░░░░░░░░░░░░░│
│ Turn 1                ││
│ Turn 2              ■ ││ ← match marker
│ Turn 3                ││
│ Turn 4              ■ ││ ← match marker
│ ...                   ││
│ Turn 47             ■ ││ ← match marker
│ ░░░░░░░░░░░░░░░░░░░░░│
```

#### Effort: Low-Medium (~1-2 days, backend already supports it)

---

### 2.3 🟡 Index Tool Results (Major Data Gap)

**Problem**: Tool call results (the actual output of `view`, `grep`, `powershell`, `edit`, etc.) are NOT indexed. Only arguments are searchable. This is the biggest missing data source.

**Real data impact**: 124,975 tool calls exist. Each has a `result` field in `ToolExecutionComplete` events that contains the actual output. For example:
- `view` tool: full file contents
- `grep` tool: matching lines with context
- `powershell` tool: complete command output
- `edit` tool: before/after content

Users searching for specific code snippets, error messages from commands, or file contents will get zero results today.

**Solution**: Add a new content type `tool_result` in the search extractor, with **selective per-tool indexing** (not blind flattening).

> *Multi-model consensus*: All 4 reviewers agreed this is important but warned against naive flattening. Opus estimates the realistic size increase at **100-200MB** (not 30-60MB). GPT-5.4 recommends tool-specific extraction strategies. Codex warns about index bloat at scale.

**Implementation:**

#### Schema (Migration 8) — CORRECTED per multi-model review

> ⚠️ **Critical fix**: The original migration approach (rename table + copy data) would break the `search_fts` content-sync relationship. Since `CURRENT_EXTRACTOR_VERSION` bump already forces re-indexing, the simplest and safest approach is drop-and-recreate:

```rust
pub(super) const MIGRATION_8: &str = r#"
-- Drop FTS and content tables (re-index will repopulate everything)
DROP TRIGGER IF EXISTS search_content_ai;
DROP TRIGGER IF EXISTS search_content_au;
DROP TRIGGER IF EXISTS search_content_ad;
DROP TABLE IF EXISTS search_fts;
DROP TABLE IF EXISTS search_content;

CREATE TABLE IF NOT EXISTS search_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK(content_type IN (
        'user_message', 'assistant_message', 'reasoning',
        'tool_call', 'tool_result', 'tool_error', 'error',
        'compaction_summary', 'system_message', 'subagent', 'checkpoint'
    )),
    turn_number INTEGER,
    event_index INTEGER,
    timestamp_unix INTEGER,
    tool_name TEXT,
    content TEXT NOT NULL CHECK(length(trim(content)) > 0),
    metadata_json TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_search_content_session ON search_content(session_id);
CREATE INDEX IF NOT EXISTS idx_search_content_timestamp ON search_content(timestamp_unix);
CREATE INDEX IF NOT EXISTS idx_search_content_tool ON search_content(tool_name);
CREATE INDEX IF NOT EXISTS idx_search_content_type_ts ON search_content(content_type, timestamp_unix);
CREATE INDEX IF NOT EXISTS idx_sc_session_ts_type ON search_content(session_id, timestamp_unix, content_type);

-- Recreate FTS
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
    content,
    content='search_content',
    content_rowid='id',
    tokenize='unicode61'
);

-- Recreate sync triggers
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

-- FTS maintenance settings
INSERT INTO search_fts(search_fts, rank) VALUES('automerge', 8);
"#;
```

#### Extractor (search_writer.rs) — Selective per-tool strategy
Add handling for `ToolExecutionComplete` result field with **tool-specific extraction** (GPT-5.4 recommendation):

```rust
TypedEventData::ToolExecutionComplete(d) => {
    // Existing: Index tool errors
    // ...
    
    // NEW: Index tool results with tool-specific strategy
    if let Some(ref result) = d.result {
        let tool_name = d.tool_call_id.as_ref()
            .and_then(|id| tool_names.get(id))
            .cloned();
        
        let result_text = match tool_name.as_deref() {
            // powershell/bash: index stdout + stderr summaries
            Some("powershell" | "bash") => extract_command_output(result),
            // grep/rg: index file paths + matched lines
            Some("grep" | "rg") => extract_grep_results(result),
            // view: index path + first 2KB preview only (full files are low search value)
            Some("view") => extract_view_preview(result, 2_000),
            // edit: index the file path + changes summary
            Some("edit") => extract_edit_summary(result),
            // Default: include top-level keys in indexed text
            _ => flatten_json_value_with_keys(result),
        };
        
        if !result_text.is_empty() {
            let truncated = truncate_utf8(&result_text, MAX_TOOL_RESULT_BYTES);
            rows.push(SearchContentRow {
                session_id: session_id.to_string(),
                content_type: "tool_result",
                turn_number: Some(current_turn),
                event_index: idx,
                timestamp_unix: ts_unix,
                tool_name,
                content: truncated.to_string(),
                metadata_json: None,
            });
        }
    }
}
```

> *Opus finding*: Current `flatten_json_value()` drops object keys entirely. For `{"path": "/src/main.rs", "stderr": "error"}`, keys "path" and "stderr" are lost. The new `flatten_json_value_with_keys()` should include top-level field names: `"path: /src/main.rs stderr: error"`.

#### Type & UI Updates
- Add `'tool_result'` to `SearchContentType` union in `packages/types/src/search.ts`
- Add to `CONTENT_TYPE_CONFIG`: `tool_result: { label: "Tool Result", color: "#22d3ee" }`
- Bump `CURRENT_EXTRACTOR_VERSION` to 2 (forces re-index)

**Realistic size estimate** (corrected per Opus review):
```rust
const MAX_TOOL_RESULT_BYTES: usize = 10_000;  // ~10KB per result (reduced from 15KB)
```

With selective extraction and reduced limits for `view` tools, realistic additional index size: **100-200MB**, pushing total DB to ~300-350MB. Consider:
- Per-content-type byte budgets and telemetry for average indexed bytes/session
- An index size indicator in settings
- Option to exclude certain content types from indexing

#### Effort: Low-Medium (~1-2 days)

---

### 2.4 🟡 Enrich metadata_json (Missed Opportunity)

**Problem**: Only 222 of 177,734 rows have `metadata_json` set (compaction summaries with checkpoint numbers). This field is underutilized and could carry structured context that enriches search results without bloating the FTS index.

**Solution**: Populate `metadata_json` with structured context for each content type:

```rust
// user_message:
metadata_json: Some(json!({
    "has_attachments": d.attachments.is_some(),
    "source": d.source,
}).to_string()),

// assistant_message:
metadata_json: Some(json!({
    "has_reasoning": d.reasoning_text.is_some(),
    "output_tokens": d.output_tokens,
    "model": current_model,  // track from session context
}).to_string()),

// tool_call:
metadata_json: Some(json!({
    "intention": intention_summary,  // from tool_requests
}).to_string()),

// tool_error:
metadata_json: Some(json!({
    "tool_call_id": d.tool_call_id,
    "exit_code": extract_exit_code(error),
}).to_string()),

// subagent:
metadata_json: Some(json!({
    "agent_type": d.agent_type,
    "agent_id": d.agent_id,
}).to_string()),
```

**UI benefit**: Display richer result cards:
- Show token count on assistant messages
- Show intention summary on tool calls (much more readable than raw args)
- Show agent type badge on subagent results
- Show model name on assistant messages

#### Effort: Low (~1 day)

---

### 2.5 🟡 URL State Persistence

**Problem**: Search state (query, filters, page) is not persisted in the URL. If users navigate away and come back, or share a link, the search is lost.

> *Multi-model consensus*: Gemini recommends implementing as a composable (`useSearchUrlSync`), not inside the Pinia store. Opus caught that Vue's native `watch` does NOT support a `debounce` option — use `watchDebounced` from `@vueuse/core`.

**Solution**: Create a composable that syncs search store state with Vue Router query params.

```typescript
// composables/useSearchUrlSync.ts
import { watchDebounced } from '@vueuse/core';  // NOT native Vue watch
import { useRoute, useRouter } from 'vue-router';
import { useSearchStore } from '@/stores/search';

export function useSearchUrlSync() {
  const route = useRoute();
  const router = useRouter();
  const store = useSearchStore();

  // On mount: read URL params into store
  if (route.query.q) store.query = route.query.q as string;
  if (route.query.types) store.contentTypes = (route.query.types as string).split(',');
  if (route.query.repo) store.repository = route.query.repo as string;
  // etc.

  // Watch store state → update URL (debounced)
  watchDebounced(
    () => ({
      q: store.query,
      types: store.contentTypes,
      repo: store.repository,
      page: store.page,
      sort: store.sortBy,
    }),
    (state) => {
      router.replace({
        query: {
          q: state.q || undefined,
          types: state.types.length ? state.types.join(',') : undefined,
          repo: state.repo || undefined,
          page: state.page > 1 ? String(state.page) : undefined,
          sort: state.sort !== 'relevance' ? state.sort : undefined,
        }
      });
    },
    { debounce: 300, deep: true }
  );
}
```

Use in `SessionSearchView.vue`:
```typescript
// In setup
useSearchUrlSync();
```

> ⚠️ **Beware URL/store sync loops** (Opus, GPT): The store watcher updates the URL, which can trigger route change watchers. Use `router.replace` (not `push`) and guard against re-entrancy.

#### Effort: Low (~0.5 day)

---

### 2.6 🟠 Contextual Snippets with Surrounding Turns

**Problem**: Current snippets are limited to FTS5's `snippet()` function with 48 tokens of context. For a tool call result, users see a fragment like `"…handling [error] boundaries and [error] handling…"` with no context about what question was asked or what the assistant was doing.

**Solution**: Enrich search results with **surrounding context** — the user message and assistant message from the same turn.

**Implementation:**

#### Backend
Add a new optional field to `SearchResult`:
```rust
pub struct SearchResult {
    // ... existing fields ...
    /// Optional surrounding context from the same turn
    pub turn_context: Option<TurnContext>,
}

pub struct TurnContext {
    pub user_message_preview: Option<String>,  // First 200 chars of user msg in same turn
    pub assistant_message_preview: Option<String>,  // First 200 chars of assistant msg
}
```

This can be fetched with a correlated subquery:
```sql
-- For each result, get the user message from the same turn
(SELECT SUBSTR(sc2.content, 1, 200)
 FROM search_content sc2
 WHERE sc2.session_id = sc.session_id
   AND sc2.turn_number = sc.turn_number
   AND sc2.content_type = 'user_message'
 LIMIT 1) as turn_user_preview
```

**Make this opt-in** (a `include_context: bool` parameter) since it adds query overhead.

#### Frontend
Show the context below the snippet in result cards:
```html
<div class="result-turn-context" v-if="result.turnContext?.userMessagePreview">
  <span class="context-label">User asked:</span>
  <span class="context-text">{{ result.turnContext.userMessagePreview }}</span>
</div>
```

#### Effort: Medium (~1-2 days)

---

### 2.7 🟠 Keyboard Navigation & Accessibility (A11y)

**Problem**: The SearchPalette has keyboard navigation (↑/↓/Enter) but the full search view does not. Power users expect to navigate results without reaching for the mouse. Additionally, the search view lacks essential accessibility features.

> *Multi-model consensus*: All 4 reviewers flagged accessibility. Gemini recommends porting `useKeyboardNavigation` from Palette. Opus provides concrete ARIA attributes. Gemini adds `role="feed"`, `aria-live`, `prefers-reduced-motion`.

**Solution**: Add keyboard navigation AND comprehensive a11y to SessionSearchView.

```typescript
const selectedResult = ref<number>(0);

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' && store.hasResults) {
    e.preventDefault();
    selectedResult.value = Math.min(selectedResult.value + 1, store.results.length - 1);
    scrollToResult(selectedResult.value);
  }
  if (e.key === 'ArrowUp' && store.hasResults) {
    e.preventDefault();
    selectedResult.value = Math.max(selectedResult.value - 1, 0);
    scrollToResult(selectedResult.value);
  }
  if (e.key === 'Enter' && store.hasResults) {
    const result = store.results[selectedResult.value];
    if (result) router.push(sessionLink(result.sessionId, result.turnNumber, result.eventIndex));
  }
}
```

**Accessibility additions:**

```vue
<!-- Results container -->
<div role="feed" aria-label="Search results" aria-busy="store.loading">

  <!-- Live region for result count announcements -->
  <div aria-live="polite" class="sr-only">
    Found {{ store.totalCount }} results
  </div>

  <!-- Result cards -->
  <article
    v-for="(result, idx) in store.results"
    :key="result.id"
    class="result-card"
    :class="{ 'keyboard-selected': idx === selectedResult }"
    role="article"
    :aria-selected="idx === selectedResult"
    :aria-label="`${result.contentType} result from ${result.sessionRepository || 'session'}`"
    tabindex="0"
    @keydown.enter="navigateToResult(result)"
  >
    <!-- ... result content ... -->
  </article>
</div>
```

**Additional a11y requirements:**
- `prefers-reduced-motion` media query — disable skeleton/progress animations
- Skip-to-results landmark navigation
- `v-html` snippet `<mark>` tags need `aria-label` or role for screen readers
- Filter checkboxes need proper `aria-checked` (especially if tri-state per Section 2.13)

```css
.result-card.keyboard-selected {
  border-color: var(--accent-emphasis);
  box-shadow: 0 0 0 2px var(--accent-emphasis);
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-loader,
  .indexing-progress-bar { animation: none; }
}
```

#### Effort: Low (~1 day including a11y)

---

### 2.8 🟠 Export / Copy Search Results

**Problem**: No way to export search results for external analysis or sharing.

**Solution**: Add export actions to the results summary bar.

Options:
1. **Copy snippet text** (on each result card — click to copy)
2. **Export page as JSON** (download current page results)
3. **Export all as CSV** (query all matching results)

> ⚠️ **GPT-5.4 correction**: Backend clamps `limit` to 200 (`search_reader.rs:123-127`). Export-all needs either: (a) a dedicated export endpoint with higher limits, (b) paginated fetching client-side, or (c) raising the limit for export-only queries.

```typescript
async function exportResults(format: 'json' | 'csv') {
  // Paginated fetch since backend caps at 200 per query
  const allResults: SearchResult[] = [];
  const maxExport = Math.min(store.totalCount, 10000);
  for (let offset = 0; offset < maxExport; offset += 200) {
    const page = await searchContent(store.query, {
      ...currentFilters,
      limit: 200,
      offset,
    });
    allResults.push(...page.results);
  }
  // Convert to format and trigger download
}
```

#### Effort: Low (~0.5-1 day)

---

### 2.9 🟡 Search Syntax Help Modal

**Problem**: Search hints are shown as small pills below the input. Users may not notice them or understand the full query syntax available.

**Solution**: Add a `?` help button that opens a modal with comprehensive syntax documentation:

```
┌─ Search Syntax Guide ──────────────────────────┐
│                                                 │
│ BASIC SEARCH                                    │
│   hello world    → matches both terms           │
│                                                 │
│ EXACT PHRASES                                   │
│   "file not found"  → exact sequence            │
│                                                 │
│ PREFIX MATCHING                                 │
│   auth*          → matches auth, authenticate   │
│                                                 │
│ BOOLEAN OPERATORS                               │
│   rust AND async → both terms required          │
│   error OR warning → either term                │
│   auth NOT jwt   → exclude jwt                  │
│                                                 │
│ COMBINING                                       │
│   "file not found" AND error                    │
│   auth* NOT "jwt token"                         │
│                                                 │
│ TIPS                                            │
│   • Use filters to narrow by content type, repo │
│   • Leave search empty to browse by filters     │
│   • Group by session to see context             │
│   • Ctrl+K to focus search from anywhere        │
└─────────────────────────────────────────────────┘
```

#### Effort: Low (~0.5 day)

---

### 2.10 🟠 Enhanced Browse Mode Presets & Recent Searches

**Problem**: Current browse presets are limited to 3 options (All Errors, User Messages, Tool Calls). More useful presets would help users discover patterns. Additionally, there's no search history — a standard modern search UX feature.

> *Multi-model consensus*: Gemini and Opus both flag recent searches as high-impact. Gemini suggests "Did you mean?" via FTS5 spellfix. GPT-5.4 recommends saved investigations.

**Solution**: Add more browse presets AND a recent searches feature.

**Recent Searches** (show on input focus):
```typescript
// Simple localStorage-backed recent searches
const RECENT_SEARCHES_KEY = 'tracepilot:recent-searches';
const MAX_RECENT = 10;

function addRecentSearch(query: string) {
  const recent = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]');
  const filtered = recent.filter((q: string) => q !== query);
  filtered.unshift(query);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(filtered.slice(0, MAX_RECENT)));
}
```

Show in a dropdown when input receives focus:
```
┌─ Recent Searches ────────────────────────┐
│  🕐 "authentication race condition"       │
│  🕐 "error"                               │
│  🕐 type:tool_error tool:powershell       │
└───────────────────────────────────────────┘
```

**Additional browse presets:**

```typescript
// In search store
function browseReasoningThoughts() {
  query.value = '';
  contentTypes.value = ['reasoning'];
  sortBy.value = 'newest';
}

function browseCompactionSummaries() {
  query.value = '';
  contentTypes.value = ['compaction_summary'];
  sortBy.value = 'newest';
}

function browseByRepository(repo: string) {
  query.value = '';
  repository.value = repo;
  sortBy.value = 'newest';
}

function browseRecentActivity() {
  query.value = '';
  contentTypes.value = [];
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  dateFrom.value = dayAgo.toISOString();
  sortBy.value = 'newest';
}

function browseSubagentActivity() {
  query.value = '';
  contentTypes.value = ['subagent'];
  sortBy.value = 'newest';
}
```

**Updated preset grid (2 rows):**
```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ ⚠ All Errors │ │ 💬 User Msgs │ │ 🔧 Tool Calls│
└──────────────┘ └──────────────┘ └──────────────┘
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ 🧠 Reasoning │ │ 🤖 Subagents │ │ 📅 Last 24h  │
└──────────────┘ └──────────────┘ └──────────────┘
```

#### Effort: Low (~0.5 day)

---

### 2.11 🟢 FTS5 Tokenizer Enhancement for Code

**Problem**: The `unicode61` tokenizer treats code identifiers as single tokens. `camelCaseFunction` is one token, so searching for `camel` won't match unless using prefix (`camel*`). Similarly, `snake_case_var` becomes `snake`, `case`, `var` (underscores are token separators in unicode61), which is actually fine for snake_case but inconsistent.

> ⚠️ **GPT-5.4 correction**: `unicode61 remove_diacritics 2` is NOT porter stemming — that's a separate tokenizer. Also, `tokenchars "_"` would preserve `snake_case_var` as ONE token, which **hurts** searching for `snake` alone. The current default may actually be better for code than adding `tokenchars "_"`.

> **Codex note**: Don't default to `porter` globally — it hurts code tokens. If needed, use a separate stemmed index for natural language content.

**Recommendation**: Keep `unicode61` as-is for now. The current behavior (underscores as separators) is actually good for code search. Consider a separate stemmed index only if users report issues finding natural language terms.

**Alternative — literal/code mode** (GPT-5.4): For users searching exact code strings (`src/foo.rs`, `foo::bar()`) that the sanitizer currently strips, add a "literal mode" toggle that wraps the query in quotes and disables sanitization of punctuation.

#### Effort: Low (schema migration + re-index if needed)

---

### 2.12 🟢 Search Results Mini-Map / Timeline

**Problem**: When viewing many results, there's no visual overview of when matches occur in time.

**Solution**: Add a small timeline sparkline at the top of results showing match density over time.

```
Matches over time:  ▁▂▅▇█▃▁▁▂▄▆▃▁  (last 30 days)
```

This can be computed from the `timestamp_unix` of results with a lightweight query:
```sql
SELECT (timestamp_unix / 86400) as day, COUNT(*) as hits
FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid
WHERE search_fts MATCH ?
GROUP BY day ORDER BY day;
```

#### Effort: Medium (~1-2 days for sparkline component + query)

---

### 2.13 🟢 Negative Filter Chips & Active Filter Display

**Problem**: Users can only include content types, not exclude them. With tool_call being 70% of all content, users often want to search "everything except tool calls." Additionally, active filters are hidden in the sidebar — no inline visibility.

> ⚠️ **GPT-5.4 correction**: Negative filters are NOT "already supported" — `SearchFilters` only has positive include lists (`search_reader.rs:37-48`, `packages/types/src/search.ts:46-56`). Both backend and frontend need changes.

**Solution**: 

1. **Add `excludeContentTypes: Vec<String>` to `SearchFilters`** in both Rust and TypeScript
2. **Add `NOT IN` clause to query builder** in `search_reader.rs`
3. **Triple-state filter checkboxes** in UI: unchecked → included → excluded

```vue
<!-- Triple-state checkbox: unchecked → included → excluded -->
<label class="filter-checkbox-row">
  <div 
    class="filter-tri-checkbox"
    :class="{ included: isIncluded(ct), excluded: isExcluded(ct) }"
    @click="cycleFilter(ct)"
  />
  <span class="filter-label">{{ config.label }}</span>
</label>
```

Backend already needs a new `NOT IN` clause — add `exclude_content_types` to `SearchFilters`:
```rust
// In SearchFilters struct
pub exclude_content_types: Option<Vec<String>>,

// In query builder
if let Some(ref exclude) = filters.exclude_content_types {
    if !exclude.is_empty() {
        let placeholders = exclude.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        sql.push_str(&format!(" AND sc.content_type NOT IN ({})", placeholders));
        params.extend(exclude.iter().map(|v| v.to_owned()));
    }
}
```

**Active filter chips** (GPT-5.4): Show inline removable chips above results:
```
Search: "error"  ×  |  Excluding: tool_call ×  |  Repo: TracePilot ×
```

#### Effort: Low-Medium (~1 day)

---

### 2.14 🟡 Relevance Weighting / BM25 Tuning (NEW — from multi-model review)

**Problem**: With 70% of rows being `tool_call`, any unfiltered search is dominated by tool argument matches. Searching for "error" probably returns mostly tool calls that happen to have "error" in their arguments, not actual errors. Adding `tool_result` (Section 2.3) will push tool-related content to ~85%, making this worse.

> *All 4 reviewers identified this as a significant gap.* Opus provides concrete SQL. Codex recommends explicit `bm25()` column weights if multi-column FTS is added.

**Solution**: Apply content-type weighting to relevance sorting:

```rust
// In query_content(), when sorting by relevance:
_ if is_fts => sql.push_str(
    " ORDER BY CASE sc.content_type \
       WHEN 'user_message' THEN rank * 0.5 \
       WHEN 'assistant_message' THEN rank * 0.6 \
       WHEN 'error' THEN rank * 0.7 \
       WHEN 'tool_error' THEN rank * 0.7 \
       WHEN 'reasoning' THEN rank * 0.8 \
       WHEN 'compaction_summary' THEN rank * 0.9 \
       ELSE rank END"  -- tool_call and tool_result get no boost
),
```

> Note: In BM25, **lower rank = better match**. Multiplying by <1 boosts the score.

**Additional UX consideration**: Show a "Tip: Filter to errors only?" suggestion when results are dominated by tool_calls (>80% of first page results).

#### Effort: Low (~0.5 day)

---

### 2.15 🟡 Qualifier Syntax in Search Input (NEW — from GPT-5.4)

**Problem**: All filtering requires sidebar interaction. Power users expect GitHub/Algolia-style qualifier syntax directly in the search input: `type:tool_error repo:TracePilot tool:powershell`.

**Solution**: Parse qualifier prefixes from the query string before sending to FTS5:

```typescript
// In search store or composable
function parseQualifiers(raw: string): { query: string; filters: Partial<SearchFilters> } {
  const filters: Partial<SearchFilters> = {};
  let query = raw;
  
  // Extract type: qualifiers
  query = query.replace(/type:(\w+)/g, (_, type) => {
    filters.contentTypes = [...(filters.contentTypes || []), type];
    return '';
  });
  
  // Extract repo: qualifiers
  query = query.replace(/repo:(\S+)/g, (_, repo) => {
    filters.repository = repo;
    return '';
  });
  
  // Extract tool: qualifiers
  query = query.replace(/tool:(\w+)/g, (_, tool) => {
    filters.toolName = tool;
    return '';
  });
  
  // Extract session: qualifier
  query = query.replace(/session:(\S+)/g, (_, id) => {
    filters.sessionId = id;
    return '';
  });
  
  return { query: query.trim(), filters };
}
```

**Autocomplete**: Show qualifier suggestions on `:` input:
```
type: → [tool_call, assistant_message, reasoning, tool_error, ...]
repo: → [TracePilot, Portify, EdwinDemo, ...]
tool: → [view, powershell, grep, edit, ...]
```

#### Effort: Medium (~1-2 days)

---

### 2.16 🟠 Component Decomposition (NEW — from multi-model review)

**Problem**: `SessionSearchView.vue` is a 1705-line monolith. This hurts maintainability, testability, and makes future improvements harder.

> *All 4 reviewers flagged this.* Gemini and Opus both recommend extracting `ResultCard.vue` and `SearchSidebar.vue`.

**Solution**: Extract into focused components:

```
SessionSearchView.vue (orchestrator, ~200 lines)
├── SearchInput.vue         — input, hints, recent searches dropdown
├── SearchSidebar.vue       — facet filters, date range, negative filters
├── ActiveFilterChips.vue   — inline removable filter pills
├── SearchResultList.vue    — results container (flat/grouped/turns modes)
│   ├── ResultCard.vue      — individual result card
│   ├── SessionGroup.vue    — grouped mode session card
│   └── TurnGroup.vue       — turn-grouped result set
├── SearchPagination.vue    — pagination controls
└── SearchEmptyState.vue    — no results / first-run / browse presets
```

**Key principle**: Each component should be independently testable and have clear props/emit contracts. The orchestrator wires them to the Pinia store.

#### Effort: Medium (~2-3 days)

---

### 2.17 🟠 First-Run / Empty Index UX (NEW — from Opus)

**Problem**: The search view doesn't distinguish between "no index exists yet" and "no results found." A first-run user sees "No results found" with no guidance about running indexing first.

**Solution**: Check `stats.totalSessions` and indexing state to show distinct states:

```vue
<!-- First-run: no index -->
<div v-if="stats.totalSessions === 0 && !isIndexing" class="first-run-state">
  <h3>Search index not built yet</h3>
  <p>Index your Copilot sessions to enable full-text search across all conversations, tool calls, and reasoning.</p>
  <button @click="rebuildIndex">Build Search Index</button>
</div>

<!-- Indexing in progress -->
<div v-else-if="isIndexing" class="indexing-state">
  <ProgressBar :value="indexProgress" />
  <p>Indexing {{ indexProgress.current }} of {{ indexProgress.total }} sessions...</p>
</div>

<!-- No results for query -->
<div v-else-if="!store.loading && store.results.length === 0" class="no-results-state">
  <p>No results found for "{{ store.query }}"</p>
  <p>Try broader terms, check your filters, or <button @click="clearFilters">clear all filters</button></p>
</div>
```

Also expose the existing "rebuild search index" store action as a button in the UI (currently hidden).

#### Effort: Low (~0.5 day)

---

### 2.18 🟢 FTS Maintenance & Health (NEW — from Codex)

**Problem**: No FTS maintenance is performed after bulk writes, and there are no health checks for index integrity.

**Solution**: Add maintenance operations to the indexing pipeline:

```rust
// After bulk indexing completes:
conn.execute_batch("
    INSERT INTO search_fts(search_fts) VALUES('optimize');
")?;

// Set automerge for ongoing inserts (already in Migration 8 above):
// INSERT INTO search_fts(search_fts, rank) VALUES('automerge', 8);
```

**Health checks** (run on app startup or from settings):
```rust
pub fn check_index_health(conn: &Connection) -> Result<IndexHealth> {
    // Quick integrity check
    let result: String = conn.query_row(
        "PRAGMA quick_check;", [], |r| r.get(0)
    )?;
    
    // FTS rebuild if needed
    if result != "ok" {
        conn.execute_batch("INSERT INTO search_fts(search_fts) VALUES('rebuild');")?;
    }
    
    // WAL management
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    
    Ok(IndexHealth { status: result, ... })
}
```

**WAL ops** (Codex):
- Set `wal_autocheckpoint` explicitly
- Run periodic `wal_checkpoint(TRUNCATE)` post-reindex
- Consider `VACUUM` / incremental vacuum after rebuilds/deletes

#### Effort: Low (~0.5 day)

---

## 3. Data Quality Improvements

### 3.1 Empty Sessions (94 of 251)

**Finding**: 94 sessions have no search content and null turn_count/event_count. These are likely abandoned or empty sessions.

**Recommendation**: 
- Skip sessions with 0 events during search indexing (already done — they get 0 rows)
- Filter empty sessions from search facets (they inflate "indexed sessions" count)
- Add a `is_empty` flag to sessions table for quick filtering

### 3.2 System Message & Checkpoint Types

**Finding**: These content types are defined in the CHECK constraint but never populated (0 rows each).

- `system_message`: The extractor handles `TypedEventData::SystemMessage` but apparently no sessions contain this event type
- `checkpoint`: Defined in the CHECK but no extractor branch handles it

**Recommendation**: Add checkpoint content extraction if the enum variant carries useful searchable content:

> ⚠️ **Opus note**: Verify whether `TypedEventData::CheckpointCreated` actually carries searchable content. The wildcard `_ => {}` in the extractor silently skips it. If the variant only has a checkpoint number, indexing it adds minimal value.

```rust
// Only if CheckpointCreated contains useful text:
TypedEventData::CheckpointCreated(d) => {
    if let Some(summary) = &d.summary {
        rows.push(SearchContentRow {
            content_type: "checkpoint",
            content: summary.clone(),
            // ...
        });
    }
}
```

### 3.3 Metadata JSON Enrichment

Currently only 0.1% of rows have metadata. See Section 2.4 for enrichment plan.

---

## 4. Performance Considerations

### 4.1 Current Performance

- Index DB size: **155 MB** (251 sessions, 177K rows)
- FTS search for "error": **7,092 results** — query latency shown in UI (typically <100ms)
- Facet queries: Additional 3 queries per search (content_type, repository, tool_name dimensions)
- **5 separate queries per search** — results, count, and 3 facet dimensions

### 4.2 Query Optimization with CTEs (from Codex, Opus)

> *Codex and Opus both identified the 5-query-per-search pattern as a bottleneck at scale.*

**Current**: Results query + COUNT query + 3 facet queries = 5 DB round-trips.

**Better**: Use a CTE-based approach to compute results, count, and facets from a single hit set:

```sql
WITH hits AS (
    SELECT sc.*, search_fts.rank
    FROM search_fts 
    JOIN search_content sc ON sc.id = search_fts.rowid
    JOIN sessions s ON s.id = sc.session_id
    WHERE search_fts MATCH ?
    AND <filters>
)
-- Derive results
SELECT * FROM hits ORDER BY rank LIMIT ? OFFSET ?;

-- Derive count + facets from same CTE
SELECT COUNT(*) as total,
       json_group_object(content_type, type_count) as type_facets
FROM (SELECT content_type, COUNT(*) as type_count FROM hits GROUP BY content_type);
```

> *Codex note*: Run `EXPLAIN QUERY PLAN` baselines for all query patterns before and after optimization.

> *GPT-5.4 note*: "Facet counts already cached" claim was false — they're refetched after each search (`search.ts:169-171,236-258`). Facet caching would be a genuine improvement.

### 4.3 Projected Growth with Tool Results

Adding `tool_result` content type will roughly **double** the search_content rows (~300K-350K total). Index DB size will grow to ~300-350 MB (corrected estimate per Opus).

**Mitigation:**
- Use `MAX_TOOL_RESULT_BYTES = 10_000` with selective per-tool extraction (Section 2.3)
- Skip `view` tool full file bodies (low search value) — index path + preview only
- FTS5 is designed for millions of documents — 350K is well within comfort zone
- Add per-content-type byte budgets and telemetry for monitoring growth
- Consider providing an index size indicator in settings

### 4.4 Session-Grouped Query Performance

The grouped query (Section 2.1) adds GROUP BY overhead. Mitigation:
- Composite index: `CREATE INDEX idx_sc_session_ts_type ON search_content(session_id, timestamp_unix, content_type)`
- Limit grouped results to top 50 sessions per page
- Use best-hit rank (MIN(rank)) for session ordering, not just hit count
- Consider denormalizing `repository` into `search_content` to avoid sessions JOIN on facets (Opus)

### 4.5 Indexing Pipeline (from Codex)

- **Cancellation**: Currently effectively disabled (`|| false` in bindings). Wire an `Arc<AtomicBool>` and check during parse + insert loops.
- **Streaming parse**: `parse_typed_events` loads whole session; move to streaming parse + chunked `upsert_search_content` for memory efficiency.
- **Cross-process safety**: App semaphores are in-process only; add cross-process lock (lockfile or DB advisory table + `BEGIN IMMEDIATE` retry) for multi-window scenarios.

---

## 5. Implementation Priority Matrix

> *Priority reordered per multi-model consensus.* All 4 reviewers agreed critical UX items should not be in Phase 3. Search Within Session was unanimously recommended as Phase 1 since the backend already supports it.

### Phase 1: Critical UX + Quick Wins (3-4 days)
| # | Improvement | Impact | Effort |
|---|---|---|---|
| 2.2 | **Search within session** (backend ready!) | 🔴 Critical | 1-2d |
| 2.1 | **Session-grouped results** | 🔴 Critical | 2-3d |
| 2.13 | Negative filter chips (exclude tool_calls) | 🟢→🟡 | 1d |

### Phase 2: Data Completeness + Relevance (2-3 days)
| # | Improvement | Impact | Effort |
|---|---|---|---|
| 2.3 | Index tool results (selective per-tool) | 🟡 Major | 1-2d |
| 2.14 | Relevance weighting (BM25 tuning) | 🟡 | 0.5d |
| 2.4 | Enrich metadata_json | 🟡 | 1d |

### Phase 3: Search Power + Polish (3-4 days)
| # | Improvement | Impact | Effort |
|---|---|---|---|
| 2.5 | URL state persistence | 🟡 | 0.5d |
| 2.15 | Qualifier syntax (`type:`, `repo:`, `tool:`) | 🟡 | 1-2d |
| 2.7 | Keyboard nav + accessibility | 🟠 | 1d |
| 2.10 | Enhanced presets + recent searches | 🟠 | 0.5d |
| 2.6 | Contextual snippets | 🟠 | 1-2d |

### Phase 4: Architecture + Operations (3-4 days)
| # | Improvement | Impact | Effort |
|---|---|---|---|
| 2.16 | Component decomposition (split monolith) | 🟠 | 2-3d |
| 2.17 | First-run / empty-index UX | 🟠 | 0.5d |
| 2.18 | FTS maintenance & health checks | 🟢 | 0.5d |
| 2.8 | Export/copy results | 🟠 | 0.5-1d |
| 2.9 | Search syntax help modal | 🟡 | 0.5d |
| 2.12 | Timeline sparkline | 🟢 | 1-2d |
| 2.11 | FTS tokenizer tuning | 🟢 | 0.5d |

---

## 6. File Reference Map

| Component | File Path |
|---|---|
| FTS Schema | `crates/tracepilot-indexer/src/index_db/migrations.rs` |
| Content Extractor | `crates/tracepilot-indexer/src/index_db/search_writer.rs` |
| Query Builder | `crates/tracepilot-indexer/src/index_db/search_reader.rs` |
| Tauri Commands | `crates/tracepilot-tauri-bindings/src/commands/search.rs` |
| Search Types | `packages/types/src/search.ts` |
| Content Type Config | `packages/ui/src/utils/contentTypes.ts` |
| Search Store | `apps/desktop/src/stores/search.ts` |
| Full Search View | `apps/desktop/src/views/SessionSearchView.vue` |
| Search Palette | `apps/desktop/src/components/SearchPalette.vue` |
| Indexer Lib | `crates/tracepilot-indexer/src/lib.rs` |
| DB Types | `crates/tracepilot-indexer/src/index_db/types.rs` |
| Session Reader | `crates/tracepilot-indexer/src/index_db/session_reader.rs` |
| Data Enrichment Report | `docs/data-enrichment-report.md` |

---

*Report generated by comprehensive analysis of source code, live index database (155 MB, 251 sessions, 177,734 search rows), and real query validation.*

---

## 7. Multi-Model Review Consensus

This report was reviewed by 4 AI models. Below is a summary of where they agreed and their unique contributions.

### Universal Agreement (All 4 models)

| Topic | Consensus |
|---|---|
| **Session grouping** | Required, not optional. Users search for context, not text strings. |
| **Search within session** | Should be Phase 1 — backend already supports it. |
| **Migration 8** | Original SQL was broken (breaks FTS content-sync). Drop+recreate is correct. |
| **Vue `watch` bug** | Native `watch` doesn't support `debounce` — use `watchDebounced` from @vueuse/core. |
| **Tool result indexing** | Important but needs guardrails — not blind flattening. |
| **Component decomposition** | 1705-line monolith must be split. |
| **Accessibility gaps** | Result cards need roles, tabindex, ARIA attributes. |
| **Priority reordering** | Critical items should not be in Phase 3. |

### Unique Contributions by Model

#### Claude Opus 4.6
- Found file reference typo (`types.ts` → `types.rs`)
- Identified `flatten_json_value()` drops object keys — significant data quality issue
- Proposed BM25 content-type weighting with concrete SQL
- Estimated realistic tool result size at 100-200MB (not 30-60MB)
- Identified `facetGeneration` race condition in store
- Proposed circuit breaker for repeated search failures
- Recommended default-to-grouped (no toggle), expand to flat
- Called out snippet sentinel markers as a security strength worth documenting

#### GPT-5.4
- Proposed qualifier syntax (`type:`, `repo:`, `tool:`, `session:`) — significant UX improvement
- Recommended turn-level grouping in addition to session grouping (3-mode segmented control)
- Designed selective per-tool extraction strategy instead of blind flattening
- Found export-all won't work due to backend's 200-result cap
- Confirmed "facet counts already cached" was false
- Proposed inline active filter chips with one-click remove
- Suggested "Find similar sessions" feature and tool-flow search
- Recommended preview pane / split view instead of click-heavy expand pattern
- Proposed dedup/cluster mode for repeated errors

#### GPT-5.3-Codex (SQLite/FTS5 specialist)
- Recommended FTS maintenance: `optimize` + `automerge` after bulk writes
- Proposed CTE-based query pattern to reduce 5 queries to 1-2
- Added `CHECK(length(trim(content)) > 0)` guard for content quality
- Identified WAL management gaps: explicit `wal_autocheckpoint`, periodic `TRUNCATE`
- Recommended `EXPLAIN QUERY PLAN` baselines before optimization
- Found cancellation is effectively disabled in indexing pipeline
- Suggested streaming parse instead of loading whole sessions
- Proposed cross-process lock for multi-window safety
- Recommended composite index for grouped mode
- Added health check pattern: `PRAGMA quick_check` + FTS rebuild fallback

#### Gemini 3 Pro
- Recommended URL sync as a composable, not in the store
- Proposed `role="feed"` + `aria-live` for screen reader support
- Added `prefers-reduced-motion` requirement
- Suggested virtual scrolling for future infinite-scroll mode
- Proposed "Did you mean?" via FTS5 spellfix extension
- Designed context-scope toggle: `[Global] [Current Session]`
- Recommended cycling placeholder text for search hints
- Noted repo/branch badges should move to session group headers

### Risk Assessment (Consolidated)

| Risk | Severity | Mitigation |
|---|---|---|
| Migration breaks FTS sync | 🔴 Critical | Drop+recreate approach (Section 2.3) |
| Tool results dominate relevance | 🟡 High | Content-type weighting (Section 2.14) + selective indexing |
| Index bloat (300-350MB) | 🟡 Medium | Per-tool byte budgets, size indicator in settings |
| URL/store sync loops | 🟠 Medium | Use `router.replace`, guard re-entrancy |
| Grouped queries slow at scale | 🟠 Medium | Composite index, CTE optimization, EXPLAIN QUERY PLAN |
| Facet/count query regressions | 🟠 Medium | CTE-based approach, caching |
| UI contract breakage | 🟠 Medium | New endpoint/DTO for grouped results, not mutation of current |
| Highlight complexity in session view | 🟡 Low | Turn/event scrolling is easy; inline markup in rendered markdown is harder |

---

*Multi-model review completed by: Claude Opus 4.6, GPT-5.4, GPT-5.3-Codex, Gemini 3 Pro Preview*
