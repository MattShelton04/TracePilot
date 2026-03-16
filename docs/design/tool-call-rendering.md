# Custom Tool Call Rendering — Design Document

## Executive Summary

TracePilot currently displays tool calls as generic collapsible rows with JSON arguments and plain-text results. This document proposes **custom, tool-type-aware rendering** that transforms raw data into rich, interactive visualizations — syntax-highlighted diffs for edits, file trees for globs, terminal output for shell commands, and more.

This report covers:
1. Complete tool type inventory with input/output schemas
2. Proposed custom renderers for each tool type
3. Library research for markdown, code highlighting, and diff rendering
4. Interactive HTML prototypes
5. Comprehensive implementation plan

---

## Part 1: Complete Tool Type Inventory

### 1.1 File Tools

#### `view` — File Viewer
**Category:** File | **Icon:** 👁 | **Frequency:** Very High

**Input Parameters:**
```json
{
  "path": "/absolute/path/to/file.ts",
  "view_range": [10, 50]        // optional: [startLine, endLine]
}
```

**Output (result):**
- File contents with line numbers prefixed (e.g., `1. const x = 5;`)
- For directories: 2-level tree listing
- For images: base64-encoded data
- For large files: truncation notice

**Current Rendering:** Plain `<pre>` with `white-space: pre-wrap`
**Proposed Rendering:** Syntax-highlighted code block with line numbers, language auto-detection from file extension, collapsible with file path header

---

#### `edit` — File Editor
**Category:** File | **Icon:** ✏️ | **Frequency:** Very High

**Input Parameters:**
```json
{
  "path": "/absolute/path/to/file.ts",
  "old_str": "const x = 5;",     // string to find and replace
  "new_str": "const x = 10;"     // replacement string
}
```

**Output:** Confirmation message or error

**Current Rendering:** JSON dump of arguments
**Proposed Rendering:** **Side-by-side or unified diff view** showing old_str → new_str with syntax highlighting, file path in header, line context

---

#### `create` — File Creator
**Category:** File | **Icon:** 📄 | **Frequency:** Medium

**Input Parameters:**
```json
{
  "path": "/absolute/path/to/new-file.ts",
  "file_text": "// Full file contents..."
}
```

**Output:** Confirmation message

**Current Rendering:** JSON dump (file_text can be enormous)
**Proposed Rendering:** Syntax-highlighted code block of `file_text`, collapsible, with file path header and "New File" badge. Line count indicator.

---

#### `grep` — Code Search (ripgrep)
**Category:** File | **Icon:** 🔍 | **Frequency:** Very High

**Input Parameters:**
```json
{
  "pattern": "function\\s+handle",
  "path": "src/",                     // optional search root
  "glob": "*.ts",                     // optional file filter
  "output_mode": "content",           // "content" | "files_with_matches" | "count"
  "-n": true,                         // show line numbers
  "-i": true,                         // case insensitive
  "-A": 3, "-B": 2, "-C": 5,         // context lines
  "type": "ts",                       // file type filter
  "head_limit": 20,                   // max results
  "multiline": false
}
```

**Output:** Depends on `output_mode`:
- `content`: Matching lines with line numbers and context
- `files_with_matches`: List of file paths
- `count`: Match counts per file

**Current Rendering:** Plain text dump
**Proposed Rendering:**
- **`files_with_matches`:** Clickable file tree with match count badges
- **`content`:** Grouped by file, syntax-highlighted matches with keyword emphasis, line numbers
- **`count`:** Compact table with file paths and counts

---

#### `glob` — File Pattern Matcher
**Category:** File | **Icon:** 📁 | **Frequency:** High

**Input Parameters:**
```json
{
  "pattern": "src/**/*.test.ts",
  "path": "/optional/root"
}
```

**Output:** Newline-separated list of matching file paths

**Current Rendering:** Plain text list
**Proposed Rendering:** Collapsible file tree with directory grouping, file type icons, match count badge in header

---

### 1.2 Shell Tools

#### `powershell` / `bash` — Shell Execution
**Category:** Shell | **Icon:** 💻 | **Frequency:** Very High

**Input Parameters:**
```json
{
  "command": "npm run build && npm test",
  "description": "Build and test",        // optional
  "mode": "sync",                          // "sync" | "async"
  "shellId": "shell-abc123",              // optional, for session reuse
  "initial_wait": 30,                     // optional seconds
  "detach": false                         // optional, for background processes
}
```

**Output:** Command stdout/stderr text, exit code

**Current Rendering:** Plain monospace text
**Proposed Rendering:** Terminal-style output with:
- Command line header ($ prompt style)
- ANSI color support (or at minimum, error highlighting)
- Exit code badge (green ✓ for 0, red ✗ for non-zero)
- Collapsible long output with "last N lines" preview
- `mode` badge (sync/async/detached)

---

#### `read_powershell` / `write_powershell` / `stop_powershell`
**Category:** Shell | **Icon:** 💻 | **Frequency:** Medium

**Input Parameters:**
- `read_powershell`: `{ "shellId": "...", "delay": 5 }`
- `write_powershell`: `{ "shellId": "...", "input": "y{enter}", "delay": 10 }`
- `stop_powershell`: `{ "shellId": "..." }`

**Proposed Rendering:** Inline with parent shell session, showing the interaction as a terminal session log

---

### 1.3 Agent/Subagent Tools

#### `task` — Sub-Agent Delegation
**Category:** Agent | **Icon:** 🤖 | **Frequency:** High

**Input Parameters:**
```json
{
  "agent_type": "explore",                    // "explore" | "task" | "general-purpose" | "code-review"
  "prompt": "Find all authentication...",
  "description": "Find auth patterns",
  "mode": "background",                       // "sync" | "background"
  "model": "claude-opus-4.6"                 // optional model override
}
```

**Output:** Agent result text

**Current Rendering:** Generic tool call item
**Proposed Rendering:** Agent card with:
- Agent type badge (color-coded: explore=cyan, task=amber, general-purpose=purple, code-review=pink)
- Model badge
- Prompt preview (collapsible full text)
- Result rendered as markdown (since agents return rich text)
- Duration and status indicator
- Nested tool calls if available

---

#### `read_agent` / `write_agent` / `list_agents`
**Category:** Agent | **Icon:** 🤖 | **Frequency:** Medium

Companion tools for agent management. Should be rendered inline with parent `task` call context.

---

### 1.4 GitHub MCP Tools

#### `github-mcp-server-*`
**Category:** GitHub | **Icon:** 🐙 | **Frequency:** Medium-High

**Common Methods:**
| Method | Input | Output |
|--------|-------|--------|
| `get_file_contents` | `owner`, `repo`, `path`, `ref` | File content or directory listing |
| `search_code` | `query`, `perPage` | Code search results with file paths |
| `list_issues` / `search_issues` | `owner`, `repo`, `query`, `state` | Issue list with titles, labels, states |
| `issue_read` (get) | `owner`, `repo`, `issue_number` | Full issue details |
| `pull_request_read` | `owner`, `repo`, `pullNumber`, `method` | PR details, diff, files, reviews |
| `list_commits` | `owner`, `repo`, `sha` | Commit list |
| `get_commit` | `owner`, `repo`, `sha` | Commit details with diff |
| `actions_list` / `actions_get` | `owner`, `repo`, `method` | Workflow/run/job details |
| `get_job_logs` | `owner`, `repo`, `job_id` | CI log output |

**Current Rendering:** JSON dump with method name as summary
**Proposed Rendering:**
- **Issues/PRs:** Card with title, state badge (open/closed/merged), labels, author
- **Code search:** Grouped by file, syntax-highlighted matches
- **Commits:** Commit message, author, SHA badge, diff stats
- **File contents:** Same as `view` tool (syntax-highlighted)
- **Actions/Logs:** Terminal-style output with status badges

---

### 1.5 Web Tools

#### `web_search` — AI Web Search
**Category:** Web | **Icon:** 🌐 | **Frequency:** Medium

**Input Parameters:**
```json
{ "query": "Vue 3 markdown rendering libraries 2025" }
```

**Output:** AI-generated response with citations and source URLs

**Current Rendering:** Plain text
**Proposed Rendering:** Rendered markdown with clickable citation links, source cards at bottom

---

#### `web_fetch` — URL Fetcher
**Category:** Web | **Icon:** 🌐 | **Frequency:** Low-Medium

**Input Parameters:**
```json
{
  "url": "https://example.com/docs",
  "raw": false,                         // if true, raw HTML; if false, markdown
  "max_length": 5000,
  "start_index": 0
}
```

**Output:** Page content as markdown or raw HTML

**Current Rendering:** Plain text dump
**Proposed Rendering:** Rendered markdown or sandboxed HTML preview, with URL header link

---

### 1.6 Data Tools

#### `sql` — SQLite Query
**Category:** Data | **Icon:** 🗄️ | **Frequency:** Medium

**Input Parameters:**
```json
{
  "query": "SELECT * FROM todos WHERE status = 'pending'",
  "description": "Get pending todos",
  "database": "session"
}
```

**Output:** Query results (typically as formatted text table)

**Current Rendering:** Plain text
**Proposed Rendering:** Formatted data table with:
- SQL syntax-highlighted query in header
- Sortable result table with column headers
- Row count badge
- Differentiated rendering for SELECT vs INSERT/UPDATE/DELETE (show affected rows)

---

### 1.7 Utility/Meta Tools

#### `report_intent` — Intent Reporter
**Input:** `{ "intent": "Exploring codebase" }`
**Proposed Rendering:** Subtle inline badge, not a full tool card. Just an intent label.

#### `ask_user` — User Question
**Input:** `{ "question": "Which database?", "choices": ["PostgreSQL", "MySQL"] }`
**Proposed Rendering:** Question card with choice options displayed, selected answer highlighted

#### `skill` — Skill Invocation
**Input:** `{ "skill": "playwright-cli" }`
**Proposed Rendering:** Skill badge with name, expandable for details

#### `store_memory` — Memory Storage
**Input:** `{ "subject": "...", "fact": "...", "reason": "...", "category": "..." }`
**Proposed Rendering:** Memory card with subject tag, fact text, category badge

---

## Part 2: Library Research — Rendering Technologies

### 2.1 Markdown Rendering

| Library | Approach | Highlighting | Vue 3 | Bundle Size | Recommendation |
|---------|----------|--------------|-------|-------------|----------------|
| **markdown-it + Shiki** (custom) | Manual integration | Shiki (VS Code quality) | ✅ via wrapper | ~200KB (fine-grained) | ⭐ **Recommended** |
| **vue-markdown-shiki** | Pre-built Vue component | Shiki | ✅ Native | ~250KB | Good for quick start |
| **vue3-markdown-it** | Vue plugin | highlight.js | ✅ Native | ~150KB | Good but less accurate |
| **vue-markdown-renderer** | Streaming-friendly | Monaco/Shiki | ✅ Native | ~300KB+ | Overkill for our use |

**Recommendation: Custom `markdown-it` + Shiki integration.**

**Rationale:**
- TracePilot already has a build pipeline (Vite), so we control the integration
- markdown-it is extensible with plugins (tables, task lists, footnotes)
- Shiki provides VS Code-grade highlighting which matches the developer audience
- Fine-grained Shiki bundles minimize size — only load languages we encounter
- We need rendering, not editing, so a full editor component is unnecessary

**Implementation approach:**
```typescript
import MarkdownIt from 'markdown-it';
import { createHighlighter } from 'shiki';

// Lazy-loaded, singleton highlighter
let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: ['typescript', 'javascript', 'rust', 'python', 'json', 'yaml', 'sql', 'bash', 'html', 'css', 'vue', 'markdown'],
    });
  }
  return highlighterPromise;
}

export async function renderMarkdown(source: string): Promise<string> {
  const highlighter = await getHighlighter();
  const md = new MarkdownIt({
    highlight: (code, lang) => {
      try {
        return highlighter.codeToHtml(code, { lang, theme: 'github-dark' });
      } catch { return ''; }
    },
  });
  return md.render(source);
}
```

---

### 2.2 Syntax Highlighting (Code Blocks)

| Library | Quality | Bundle Size | Performance | Vue 3 | Recommendation |
|---------|---------|-------------|-------------|-------|----------------|
| **Shiki** | ★★★★★ (VS Code grammars) | 200KB–6.4MB (configurable) | Medium (WASM) | ✅ | ⭐ **Recommended** |
| **PrismJS** | ★★★☆☆ | ~30KB (selective) | Fast | ✅ | Runner-up |
| **highlight.js** | ★★☆☆☆ | ~40KB | Fast | ✅ | Too basic |

**Recommendation: Shiki with fine-grained bundles.**

**Rationale:**
- TracePilot is a developer tool — VS Code-quality highlighting is expected
- Users will see code in many languages (TS, Rust, Python, SQL, YAML, Bash, etc.)
- Fine-grained Shiki bundle with ~12 languages ≈ 200–400KB (acceptable for desktop app)
- Lazy-load the highlighter — don't block initial app load
- Shiki's dual-theme support (dark/light) matches TracePilot's theme toggle

**Performance strategy:**
1. Load Shiki lazily on first tool call expansion (not on app startup)
2. Use `defineAsyncComponent` + `<Suspense>` for code block components
3. Cache the highlighter singleton — instantiate once, reuse everywhere
4. Only include languages actually encountered (detect from file extensions)
5. For very large outputs (>50KB), fall back to plain monospace text

---

### 2.3 Diff Rendering

| Library | Features | Vue 3 | Bundle Size | Performance | Recommendation |
|---------|----------|-------|-------------|-------------|----------------|
| **@git-diff-view/vue** | Split + unified, syntax highlighting, Web Workers | ✅ Native | ~80KB | ★★★★★ (Workers) | ⭐ **Recommended** |
| **diff2html** | Split + unified, GitHub-style | Wrapper needed | ~60KB | ★★★★☆ | Runner-up |
| **jsdiff** (kpdecker) | Diff algorithm only (no UI) | N/A | ~15KB | ★★★★★ | For custom UI |
| **vue-diff** | Basic diff | ✅ Native | ~20KB | ★★★☆☆ | Too basic |

**Recommendation: `@git-diff-view/vue` for rich diffs, `jsdiff` for inline word-level diffs.**

**Rationale:**
- `@git-diff-view/vue` provides native Vue 3 components with split/unified modes
- Web Worker support handles large diffs without blocking the UI
- Built-in syntax highlighting via HAST AST
- Dark/light theme support
- For the `edit` tool's `old_str`/`new_str`, we can also use `jsdiff` to compute word-level diffs inline (lighter weight for small changes)

**Implementation for `edit` tool:**
```typescript
import { diffWords } from 'diff';

// For small edits: inline word-level diff
function renderInlineDiff(oldStr: string, newStr: string) {
  const changes = diffWords(oldStr, newStr);
  return changes.map(part => ({
    value: part.value,
    type: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
  }));
}

// For large edits or create: full diff view component
// <DiffView :data="diffData" :diff-view-mode="DiffModeEnum.Split" />
```

---

### 2.4 Terminal Output Rendering

| Approach | ANSI Support | Performance | Recommendation |
|----------|-------------|-------------|----------------|
| **ansi-to-html** | Full ANSI codes → HTML spans | Fast | ⭐ **Recommended** |
| **xterm.js** | Full terminal emulator | Heavy | Overkill |
| **Custom CSS classes** | Basic coloring only | Fast | Fallback |

**Recommendation: `ansi-to-html` for ANSI code parsing, custom CSS for terminal styling.**

**Rationale:**
- Shell output often contains ANSI escape codes (colors, bold, etc.)
- `ansi-to-html` is lightweight (~5KB) and converts codes to styled spans
- No need for a full terminal emulator (xterm.js is 500KB+)
- Custom CSS provides the terminal aesthetic (dark background, monospace font)

---

### 2.5 Data Table Rendering

For SQL results, use the existing `DataTable.vue` component in `packages/ui` with sorting capability. No additional library needed.

---

## Part 3: Rendering Architecture

### 3.1 Component Hierarchy

```
<ToolCallItem>                          ← Existing (header row with icon, name, status)
  └─ <ToolCallDetail>                   ← Existing (expanded detail panel)
       └─ <ToolResultRenderer>          ← NEW: Smart dispatcher
            ├─ <EditDiffRenderer>       ← NEW: Side-by-side/unified diff
            ├─ <ViewCodeRenderer>       ← NEW: Syntax-highlighted code
            ├─ <CreateFileRenderer>     ← NEW: Full file with "new" badge
            ├─ <GrepResultRenderer>     ← NEW: Grouped search results
            ├─ <GlobTreeRenderer>       ← NEW: File tree
            ├─ <ShellOutputRenderer>    ← NEW: Terminal-style output
            ├─ <AgentResultRenderer>    ← NEW: Markdown + agent card
            ├─ <GitHubRenderer>         ← NEW: Issue/PR/commit cards
            ├─ <WebSearchRenderer>      ← NEW: Markdown + citations
            ├─ <SqlResultRenderer>      ← NEW: Query + data table
            ├─ <AskUserRenderer>        ← NEW: Question + choices card
            ├─ <MarkdownRenderer>       ← NEW: Generic markdown rendering
            └─ <PlainTextRenderer>      ← EXISTING: Fallback `<pre>` block
```

### 3.2 Smart Dispatcher Pattern

```typescript
// ToolResultRenderer.vue — dispatches to the right sub-renderer
const rendererMap: Record<string, Component> = {
  edit: EditDiffRenderer,
  view: ViewCodeRenderer,
  create: CreateFileRenderer,
  grep: GrepResultRenderer,
  glob: GlobTreeRenderer,
  powershell: ShellOutputRenderer,
  bash: ShellOutputRenderer,
  task: AgentResultRenderer,
  sql: SqlResultRenderer,
  web_search: WebSearchRenderer,
  web_fetch: MarkdownRenderer,
  ask_user: AskUserRenderer,
  report_intent: null,                // suppress — render inline in header only
};

function getRenderer(toolName: string): Component {
  if (toolName.startsWith('github-mcp-server')) return GitHubRenderer;
  return rendererMap[toolName] ?? PlainTextRenderer;
}
```

### 3.3 Arguments Display Enhancement

Beyond result rendering, we should also enhance **argument display** per tool type:

| Tool | Current Args Display | Proposed Args Display |
|------|---------------------|----------------------|
| `edit` | JSON dump | Side-by-side old_str → new_str with diff highlighting |
| `view` | File path | File path + line range badge |
| `create` | JSON dump | File path + line count + language badge |
| `grep` | Pattern text | Regex badge + path + flags (case-insensitive, multiline) |
| `powershell` | Command text | Terminal-style command with mode badge |
| `task` | Description | Agent type + model + description |
| `sql` | Description | Syntax-highlighted SQL query |

---

## Part 4: Approach Comparison & Recommendations

### 4.1 Rendering Integration Approaches

#### Approach A: Component-per-tool (Recommended ⭐)
Each tool type gets its own Vue component. A dispatcher selects the right one.

**Pros:** Clean separation of concerns, easy to test individually, progressive enhancement (add one tool at a time), each component can be lazy-loaded
**Cons:** More files to maintain, some duplication in common patterns

#### Approach B: Template-driven rendering
A single component with a large `v-if/v-else-if` chain and template sections.

**Pros:** Fewer files, shared state management
**Cons:** Monolithic component, hard to test, poor code splitting

#### Approach C: Plugin/slot architecture
A registry-based system where renderers are registered dynamically.

**Pros:** Most extensible, supports future MCP tools
**Cons:** Over-engineered for current needs, harder to type-check

**Verdict: Approach A** — Component-per-tool with a dispatcher. It's the standard Vue pattern, enables lazy loading, and each renderer can be developed and tested independently. The dispatcher provides the extensibility of Approach C without the complexity.

---

### 4.2 Syntax Highlighting Strategy

#### Strategy 1: Shiki everywhere (Recommended ⭐)
Use Shiki for all code highlighting (view results, edit diffs, create files, grep matches, SQL queries).

**Pros:** Consistent VS Code-quality highlighting, single highlighter instance, dual-theme support
**Cons:** Heavier bundle (~300KB), WASM initialization latency (~100ms first load)
**Mitigation:** Lazy-load on first tool expansion, cache singleton, fine-grained language bundles

#### Strategy 2: Shiki for blocks, PrismJS for inline
Use Shiki for large code blocks, PrismJS for small inline highlights.

**Pros:** Lighter for inline cases
**Cons:** Two highlighting systems, inconsistent appearance, more complexity

#### Strategy 3: highlight.js only
Use highlight.js for everything.

**Pros:** Lightest, simplest, auto-detection
**Cons:** Lower quality, no VS Code themes, limited language support for modern syntax

**Verdict: Strategy 1** — Shiki everywhere. For a developer tool, quality matters more than 200KB of bundle size. The lazy loading strategy eliminates startup impact.

---

### 4.3 Diff Rendering Strategy

#### Strategy 1: @git-diff-view/vue for all diffs (Recommended ⭐)
Use the full diff view component for edit tool and any other diff context.

**Pros:** Rich UI (split/unified toggle), syntax highlighting, handles large diffs, Web Workers
**Cons:** Heavier component (~80KB), needs unified diff format conversion

#### Strategy 2: jsdiff + custom rendering
Compute diffs with jsdiff, render with custom Vue template.

**Pros:** Lightweight, full control over appearance
**Cons:** Significant custom UI work, no split view, no syntax highlighting in diff

#### Strategy 3: Hybrid (Recommended for edit tool ⭐⭐)
Use **jsdiff word-level diff** for the `edit` tool's compact inline view (old_str/new_str are usually small), and **@git-diff-view/vue** for an optional "full diff view" toggle and for larger contexts.

**Pros:** Best of both — fast inline for small edits, full diff for complex changes
**Cons:** Two dependencies (but jsdiff is only 15KB)

**Verdict: Strategy 3 (Hybrid)** — Word-level inline diff by default (most edits are small), with a toggle to open full diff view for complex changes.

---

## Part 5: Comprehensive Implementation Plan

### Phase 1: Foundation — Rendering Infrastructure
**Scope:** Build the core rendering pipeline without tool-specific renderers

**Tasks:**
1. Create `ToolResultRenderer.vue` dispatcher component in `packages/ui/src/components/`
2. Create `PlainTextRenderer.vue` as the default fallback (migrate from current `<pre>` in ToolCallDetail)
3. Install and configure Shiki with fine-grained bundle (lazy-loaded singleton)
4. Create `useShikiHighlighter` composable for shared highlighter access
5. Update `ToolCallDetail.vue` to delegate result rendering to `ToolResultRenderer`
6. Add language detection utility (file extension → Shiki language)
7. Write unit tests for dispatcher and language detection

**Libraries to install:**
- `shiki` (syntax highlighting)
- `markdown-it` (markdown parsing)

**Estimated scope:** ~8 files, ~400 LOC

---

### Phase 2: File Tool Renderers
**Scope:** Custom renderers for view, edit, create, grep, glob

**Tasks:**
1. **`ViewCodeRenderer.vue`** — Syntax-highlighted code with line numbers
   - Parse line-number format (`1. code here`) from view output
   - Detect language from file path in arguments
   - Render via Shiki with line numbers
   - Collapsible for large files

2. **`EditDiffRenderer.vue`** — Diff view for edit operations
   - Install `diff` (jsdiff) package
   - Word-level inline diff for compact view
   - Toggle for side-by-side view (install `@git-diff-view/vue`)
   - Syntax highlight both old and new with Shiki
   - File path header with "Modified" badge

3. **`CreateFileRenderer.vue`** — New file display
   - Syntax-highlighted file content via Shiki
   - File path header with "Created" badge and line count
   - Collapsible for large files

4. **`GrepResultRenderer.vue`** — Search results display
   - Parse grep output into file groups
   - Syntax highlight matching lines
   - Bold/highlight search pattern matches
   - File group headers with match counts
   - Differentiate output_mode (files list vs content vs count)

5. **`GlobTreeRenderer.vue`** — File tree display
   - Parse file paths into tree structure
   - Render as collapsible directory tree
   - File type icons
   - Total count badge

**Libraries to install:**
- `diff` (jsdiff — for word-level diff computation)
- `@git-diff-view/vue` (for full split/unified diff view)

**Estimated scope:** ~12 files, ~1200 LOC

---

### Phase 3: Shell & Terminal Renderers
**Scope:** Terminal-style output for shell tools

**Tasks:**
1. **`ShellOutputRenderer.vue`** — Terminal output display
   - Install `ansi-to-html` for ANSI code conversion
   - Terminal aesthetic (dark bg, monospace, green prompt)
   - Command line header with `$` prompt
   - Exit code badge
   - Auto-collapse long output (show last 20 lines, expand on click)
   - Mode badge (sync/async/detach)

2. Update `formatArgsSummary` for shell tools to show command in terminal style
3. Handle `read_powershell`/`write_powershell` as inline session interactions

**Libraries to install:**
- `ansi-to-html`

**Estimated scope:** ~4 files, ~300 LOC

---

### Phase 4: Agent & Markdown Renderers
**Scope:** Rich rendering for subagent results and markdown content

**Tasks:**
1. **`AgentResultRenderer.vue`** — Subagent result display
   - Agent type card with color-coded badge
   - Model badge
   - Prompt preview (collapsible)
   - Result rendered as markdown (via MarkdownRenderer)
   - Duration and status

2. **`MarkdownRenderer.vue`** — Generic markdown rendering component
   - Uses markdown-it + Shiki integration
   - Renders tables, code blocks, lists, headings, links
   - Scoped styles to prevent CSS leakage
   - Lazy-loads Shiki on first render

3. **`WebSearchRenderer.vue`** — Web search results
   - Extends MarkdownRenderer with citation link cards
   - Source URL list at bottom

**Estimated scope:** ~6 files, ~500 LOC

---

### Phase 5: GitHub & Data Renderers
**Scope:** Rich rendering for GitHub MCP tools and SQL

**Tasks:**
1. **`GitHubRenderer.vue`** — Smart GitHub content renderer
   - Sub-dispatch by `method` parameter
   - Issue/PR cards with state, labels, author
   - Commit cards with message, SHA, diff stats
   - Code search results (grouped, highlighted)
   - CI/CD log output (terminal style)

2. **`SqlResultRenderer.vue`** — SQL query + results
   - SQL query in syntax-highlighted code block
   - Result as sortable DataTable
   - Row count badge
   - Different styles for SELECT vs DML

3. **`AskUserRenderer.vue`** — Question/answer display
   - Question text with choice buttons
   - Selected answer highlighted

**Estimated scope:** ~6 files, ~600 LOC

---

### Phase 6: Polish & Optimization
**Scope:** Performance, accessibility, edge cases

**Tasks:**
1. Lazy-load all renderer components via `defineAsyncComponent`
2. Add loading skeletons while Shiki initializes
3. Virtual scrolling for very large tool outputs
4. Copy-to-clipboard button on all code blocks
5. Keyboard navigation (arrow keys to navigate between tool calls)
6. Accessibility audit (ARIA labels, screen reader support)
7. Theme-aware rendering (respect dark/light toggle)
8. Performance profiling with large sessions (1000+ tool calls)
9. Integration tests with real session data

**Estimated scope:** ~500 LOC of enhancements

---

### Dependency Summary

| Package | Size (gzipped) | Purpose | Phase |
|---------|---------------|---------|-------|
| `shiki` | ~200KB (fine-grained) | Syntax highlighting | 1 |
| `markdown-it` | ~35KB | Markdown parsing | 1 |
| `diff` (jsdiff) | ~8KB | Word-level diff computation | 2 |
| `@git-diff-view/vue` | ~30KB | Rich diff view component | 2 |
| `ansi-to-html` | ~3KB | ANSI escape code rendering | 3 |
| **Total** | **~276KB** | | |

All are well-maintained, MIT-licensed, and widely used.

---

## Part 6: Migration Strategy

### 6.1 Backward Compatibility
The new rendering system is **additive** — it enhances `ToolCallDetail.vue` without breaking existing behavior:

1. `ToolResultRenderer` always falls back to `PlainTextRenderer` for unknown tools
2. New renderers are lazy-loaded — no impact on initial bundle size
3. Feature flag: `useRichToolRendering` setting to toggle between old/new rendering
4. Roll out one tool type at a time — start with `edit` (highest visual impact)

### 6.2 Rollout Order (by impact)
1. **`edit`** — Diff rendering is the single highest-impact improvement
2. **`view`** — Syntax-highlighted file viewing
3. **`powershell`/`bash`** — Terminal-style shell output
4. **`grep`** — Grouped, highlighted search results
5. **`create`** — Syntax-highlighted new files
6. **`task`** — Markdown-rendered agent results
7. **`sql`** — Query + table results
8. **`glob`** — File tree
9. **GitHub MCP tools** — Issue/PR/commit cards
10. **Web tools** — Markdown with citations

---

## Appendix A: Prototype Reference

Interactive HTML prototypes are available at:
- `docs/design/prototypes/tool-call-renderers.html` — All proposed tool renderers in one page

Open locally:
```bash
cd docs/design/prototypes
python -m http.server 3333
# Visit http://localhost:3333/tool-call-renderers.html
```

---

## Appendix B: Real Tool Call Examples (from session data)

### Edit Tool Call
```json
{
  "toolName": "edit",
  "arguments": {
    "path": "C:\\git\\Project\\src\\components\\Auth.vue",
    "old_str": "const token = localStorage.getItem('token');",
    "new_str": "const token = sessionStorage.getItem('auth_token');\nconst refreshToken = sessionStorage.getItem('refresh_token');"
  },
  "success": true,
  "durationMs": 45,
  "resultContent": "Applied edit to C:\\git\\Project\\src\\components\\Auth.vue"
}
```

### Grep Tool Call
```json
{
  "toolName": "grep",
  "arguments": {
    "pattern": "function\\s+handle",
    "path": "src/",
    "glob": "*.ts",
    "output_mode": "content",
    "-n": true
  },
  "success": true,
  "durationMs": 120,
  "resultContent": "src/auth.ts:15:function handleLogin(user: User) {\nsrc/auth.ts:42:function handleLogout() {\nsrc/api.ts:8:function handleRequest(req: Request) {"
}
```

### Shell Tool Call
```json
{
  "toolName": "powershell",
  "arguments": {
    "command": "npm run build && npm test",
    "description": "Build and run tests",
    "mode": "sync",
    "initial_wait": 60
  },
  "success": true,
  "durationMs": 15420,
  "resultContent": "> project@1.0.0 build\n> vite build\n\n✓ 42 modules transformed.\ndist/index.html   0.5 kB\ndist/assets/...   245.3 kB\n\n> project@1.0.0 test\n> vitest run\n\n ✓ auth.test.ts (5 tests) 120ms\n ✓ api.test.ts (12 tests) 340ms\n\nTest Files  2 passed\nTests       17 passed"
}
```

---

## Part 7: Multi-Model Review — Consolidated Findings

The design was independently reviewed by **Claude Opus 4.6**, **GPT-5.4**, and **Gemini 3 Pro Preview**. Below is a synthesis of their feedback.

### 7.1 Scores & Overall Verdict

| Reviewer | Score | Key Takeaway |
|----------|-------|-------------|
| Claude Opus 4.6 | **8/10** | Thorough and production-ready; needs edge case work and a validation spike |
| GPT-5.4 | **7/10** | Strong research; misses architectural blockers in the data pipeline |
| Gemini 3 Pro | **9/10** | Exceptionally well-structured; needs streaming/virtualization earlier |

**Consensus:** The plan is solid and the library choices are correct. All three reviewers agree on the component-per-tool dispatcher pattern. The main gaps are in the **data pipeline**, **edge cases**, and **performance-critical paths**.

### 7.2 Universal Consensus (All 3 Models Agree)

**1. Add a Phase 0 validation spike.**
Before building anything, validate: (a) Shiki WASM works in Tauri WebView, (b) `@git-diff-view/vue` renders correctly in the CSS variable system, (c) `v-html` works with Tauri's Content Security Policy, (d) lazy-loading works with the current Vite config. All reviewers flagged Tauri WASM compatibility as the top risk.

**2. Phase 2 is too large — split it.**
Five renderers + two library installs + ~1200 LOC in one phase. Split into:
- Phase 2a: `edit` + `view` (highest impact, shared Shiki infra)
- Phase 2b: `create` + `grep` + `glob`

**3. Virtualization/performance limits must be addressed earlier than Phase 6.**
A 1MB file in `ViewCodeRenderer` with Shiki will freeze the UI. Implement hard limits (e.g., first 2000 lines) or virtualization in the renderer phases, not as polish. All large-output renderers (view, grep, shell, glob) need this from day one.

**4. The edit diff prototype fabricates context lines.**
The `edit` tool only provides `old_str` and `new_str` — there is no surrounding file context in the data. The prototype misleadingly shows context lines (14–18) that don't exist. The renderer should show only the exact old/new strings, or explicitly label reconstructed context as "approximate."

**5. Every renderer must integrate with the existing truncation/full-result system.**
`resultContent` is truncated to ≤1KB with `…[truncated]`. Every renderer needs to handle truncated content gracefully AND trigger the existing `loadFullResult` mechanism. This critical integration point was not discussed.

**6. Accessibility should be built-in from the start, not Phase 6.**
ARIA roles on code blocks, screen reader text for diff additions/removals, keyboard-navigable trees — these should be part of each renderer's spec, not a later audit.

### 7.3 Critical Finding: Data Pipeline Blocker (GPT-5.4)

**The current result loader stringifies everything.** `useToolResultLoader.ts` calls `formatResult()` which converts structured JSON results into flat strings. For tool-specific renderers to work (e.g., SQL tables, GitHub cards), the raw structured result data must be preserved.

**Action required:** Before any renderer work, modify the data pipeline:
1. Extend `useToolResultLoader` to return `{ raw: unknown; formatted: string }` instead of just `string`
2. Each renderer can then access typed structured data (e.g., SQL table rows, GitHub issue objects)
3. Fall back to `formatted` string for PlainTextRenderer

This is a **Phase 0/1 blocker** that all renderer phases depend on.

### 7.4 Missing Tool Types

All reviewers identified tools absent from the inventory:

| Tool | Category | Notes |
|------|----------|-------|
| `list_powershell` | shell | Renders table of active sessions |
| `ide-get_selection` | ide | VS Code selection data |
| `ide-get_diagnostics` | ide | VS Code errors/warnings |
| `fetch_copilot_cli_documentation` | utility | Help text retrieval |
| `apply_patch` | file | OpenAI Codex patch format |
| `show_file` | file | Code/diff presentation to user |

Additionally, the `view` tool has three output modes that need separate handling:
- **File content** → syntax-highlighted code (covered)
- **Directory listing** → file tree (NOT covered — needs sub-renderer)
- **Image data** → inline image render (NOT covered)

### 7.5 Design & UX Refinements

**From Opus 4.6:**
- Terminal "exit code" badge shows "exit 0"/"exit 1" but the data model only has `success: boolean`, not an exit code. Use ✓/✗ instead.
- Copy-to-clipboard in Tauri needs `navigator.clipboard` API or Tauri clipboard plugin. Verify permissions.
- Shell output should support both "first N lines" and "last N lines" preview modes (errors may be at the start or end).

**From GPT-5.4:**
- Diff view: **unified should be default**, not split — the app pane is often narrow. Split as optional toggle.
- `ask_user` renderer: buttons should look like historical state (answered), not actionable UI.
- Too much chrome on every tool call may hurt scannability — prefer progressive disclosure.
- Add a `ToolArgsRenderer` dispatcher for argument display (parallel to `ToolResultRenderer`).

**From Gemini:**
- Add "Copy" buttons to ALL code blocks (view, create, sql, shell) by default.
- Add client-side search/filter within large results (grep, sql tables).
- `@git-diff-view/vue` and Shiki themes must dynamically update on dark/light mode toggle.

### 7.6 Architecture Refinements

**1. Base Renderer Pattern** (all reviewers)
Extract shared renderer infrastructure:
```
<RendererShell>                     ← Shared frame: error states, truncation, copy, loading
  └─ <SpecificRenderer />           ← Tool-specific body content only
</RendererShell>
```
Use a `useRendererBase` composable for shared logic (truncation detection, full-result loading, error handling).

**2. Separate args + result dispatchers** (GPT-5.4, Opus)
The document proposes `ToolResultRenderer` for results but the §3.3 table also enhances argument display. Create:
- `ToolArgsRenderer.vue` — dispatches argument rendering per tool
- `ToolResultRenderer.vue` — dispatches result rendering per tool
Both integrate into `ToolCallDetail.vue`.

**3. GitHubRenderer sub-dispatch** (Opus)
With 10+ GitHub MCP methods, a single component is too complex. Split into:
- `GitHubIssueRenderer`, `GitHubPrRenderer`, `GitHubCommitRenderer`, `GitHubActionsRenderer`

### 7.7 Streaming & Incomplete States (Gemini)

The plan doesn't address how renderers react to **streaming updates** (e.g., `read_powershell` appending content, background agent partial results). Re-running Shiki or markdown-it on every chunk will kill performance.

**Recommendation:** Implement a "draft mode" for active/streaming tool calls:
- Plain monospace text during streaming
- Switch to full Shiki/markdown rendering only when `isComplete: true`
- Use a `watch` on `isComplete` to trigger re-render

### 7.8 Security: XSS & Sanitization (GPT-5.4)

Any `v-html` usage (required for Shiki, markdown-it, ansi-to-html) is an XSS vector. All three rendering libraries produce trusted HTML from trusted input (session data), but:
- Markdown-it should use `html: false` option (disable raw HTML in markdown source)
- Wrap all `v-html` containers in a scoped `<div>` with restricted CSS
- Consider `DOMPurify` as a sanitization layer if rendering user-provided markdown

### 7.9 Revised Bundle Size Estimate

The original ~276KB estimate was optimistic. Revised with reviewer corrections:

| Package | Realistic Size (gzipped) | Phase |
|---------|-------------------------|-------|
| `shiki` (12 langs, 2 themes) | ~350–500KB | 0/1 |
| `markdown-it` | ~35KB | 4 |
| `diff` (jsdiff) | ~8KB | 2a |
| `@git-diff-view/vue` | ~50–80KB | 2a |
| `ansi-to-html` | ~3KB | 3 |
| **Total** | **~450–625KB** | |

Still acceptable for a desktop app (loaded lazily, not on startup), but the original estimate should not be cited.

---

## Part 8: Revised Implementation Plan (Post-Review)

### Phase 0: Validation Spike ⚡ (NEW)
**Scope:** Validate critical assumptions before committing to the architecture

**Tasks:**
1. Verify Shiki WASM loads in Tauri 2 WebView (create minimal test component)
2. Test `v-html` rendering with Tauri's Content Security Policy
3. Verify `@git-diff-view/vue` renders correctly with TracePilot's CSS variables
4. Confirm `defineAsyncComponent` + Vite code-splitting works for lazy-loaded renderers
5. Benchmark Shiki initialization time and per-highlight latency
6. Test `navigator.clipboard` API in Tauri for copy buttons

**Exit criteria:** All 6 validations pass. If any fail, identify alternative approaches before proceeding.

---

### Phase 1: Foundation (Updated)
**Scope:** Core rendering infrastructure + data pipeline changes

**Tasks:**
1. **Data pipeline:** Extend `useToolResultLoader` to preserve raw structured results alongside formatted strings
2. Create `RendererShell.vue` base component (error states, truncation, copy, loading skeleton)
3. Create `ToolResultRenderer.vue` dispatcher component
4. Create `ToolArgsRenderer.vue` dispatcher component
5. Create `PlainTextRenderer.vue` as default fallback
6. Install and configure Shiki with fine-grained bundle (lazy-loaded singleton)
7. Create `useShikiHighlighter` composable
8. Create `useRendererBase` composable (shared logic)
9. Add language detection utility (file extension → Shiki language)
10. Add `useRichToolRendering` feature flag in settings
11. Update `ToolCallDetail.vue` to delegate to dispatchers
12. Write unit tests for dispatchers, language detection, and feature flag

**Libraries:** `shiki`

---

### Phase 2a: Edit + View Renderers (Split from Phase 2)
**Tasks:**
1. `EditDiffRenderer.vue` — Word-level inline diff (jsdiff), no fabricated context
2. `ViewCodeRenderer.vue` — Syntax-highlighted code with line numbers, hard limit at 2000 lines
3. `ViewDirectoryRenderer.vue` — File tree for directory output mode
4. `ViewImageRenderer.vue` — Inline image for base64 image output
5. Output parser utilities: `parseViewOutput()`, `parseEditArgs()`
6. Fixture-based tests with real session data

**Libraries:** `diff` (jsdiff), `@git-diff-view/vue`

---

### Phase 2b: Create + Grep + Glob Renderers (Split from Phase 2)
**Tasks:**
1. `CreateFileRenderer.vue` — Syntax-highlighted new file with badges
2. `GrepResultRenderer.vue` — Grouped results with match highlighting (handles all 3 output modes)
3. `GlobTreeRenderer.vue` — Collapsible file tree
4. Output parser utilities: `parseGrepOutput()`, `buildFileTree()`
5. Hard limits on large outputs (max 100 files for glob, max 500 matches for grep)
6. Fixture-based tests

---

### Phase 3: Shell & Terminal Renderers (Unchanged but enhanced)
**Tasks:**
1. `ShellOutputRenderer.vue` — Terminal aesthetic, ANSI support, auto-collapse
2. Streaming/draft mode: plain text while `isComplete: false`, full render on completion
3. Handle `read_powershell`/`write_powershell` as session interaction log
4. Both "first N" and "last N" preview modes

**Libraries:** `ansi-to-html`

---

### Phase 4: Agent & Markdown Renderers (Updated)
**Tasks:**
1. `MarkdownRenderer.vue` — markdown-it + Shiki, scoped styles, `html: false`
2. `AgentResultRenderer.vue` — Agent card + markdown-rendered result
3. `WebSearchRenderer.vue` — Markdown + citation cards
4. DOMPurify integration for sanitization layer

**Libraries:** `markdown-it`, `dompurify`

---

### Phase 5: GitHub, SQL, & Remaining Renderers (Updated)
**Tasks:**
1. `GitHubIssueRenderer.vue` — Issue/PR cards
2. `GitHubCommitRenderer.vue` — Commit cards with diff stats
3. `GitHubActionsRenderer.vue` — CI/CD log output
4. `SqlResultRenderer.vue` — SQL query + data table (enhance DataTable.vue with sorting)
5. `AskUserRenderer.vue` — Historical question/answer display (non-interactive buttons)
6. `StoreMemoryRenderer.vue` — Memory card with subject/fact/category
7. `SkillRenderer.vue` — Skill badge with details

---

### Phase 6: Polish & Optimization (Updated — moved critical items earlier)
**Tasks:**
1. Client-side search/filter within large results
2. Theme-sync: dynamic Shiki/diff-view theme switching on dark/light toggle
3. Performance profiling with large sessions (1000+ tool calls)
4. Integration tests with real session data
5. Export capabilities (copy code, download files, export CSV from SQL)
6. Documentation update
