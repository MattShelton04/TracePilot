# Rich Tool Rendering — Comprehensive Audit & Review

> **Date:** 2026-04-16  
> **Scope:** All renderer implementations in `packages/ui/src/components/renderers/`  
> **Purpose:** Document the current state, identify issues, propose improvements, and catalog candidates for new renderers.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Current Renderer Catalog](#2-current-renderer-catalog)
3. [Per-Renderer Deep Dive & Issues](#3-per-renderer-deep-dive--issues)
4. [Shared Components Audit](#4-shared-components-audit)
5. [Test Coverage](#5-test-coverage)
6. [Missing Renderers — New Tool Candidates](#6-missing-renderers--new-tool-candidates)
7. [Cross-Cutting UX Issues](#7-cross-cutting-ux-issues)
8. [Improvement Recommendations](#8-improvement-recommendations)
9. [Priority Roadmap](#9-priority-roadmap)

---

## 1. Architecture Overview

### Component Hierarchy

```
ToolCallItem.vue                    ← Row header (icon, name, status, duration, chevron)
  └─ ToolCallDetail.vue             ← Expanded panel (error, metadata, args, result)
       ├─ ToolArgsRenderer.vue      ← Args dispatcher (collapsible, JSON fallback)
       │   ├─ EditArgsRenderer       ← per-tool rich args (if registered)
       │   ├─ CreateArgsRenderer
       │   ├─ AskUserArgsRenderer
       │   ├─ ReportIntentRenderer
       │   └─ [JSON <pre> fallback]
       └─ ToolResultRenderer.vue    ← Result dispatcher
            ├─ EditDiffRenderer      ← per-tool rich result (if registered)
            ├─ ViewCodeRenderer
            ├─ ...11 more...
            ├─ MarkdownContent       ← for task/read_agent (inline)
            └─ PlainTextRenderer     ← catch-all
```

### Key Files

| File | Role |
|------|------|
| `registry.ts` | Maps tool names → async Vue components |
| `RendererShell.vue` | Shared chrome (header, copy, truncation, error) |
| `CodeBlock.vue` | Syntax-highlighted code with line numbers |
| `PlainTextRenderer.vue` | Monospace `<pre>` fallback |
| `tool-rendering.ts` (types) | `RichRenderableToolName` type + preferences |

### Data Flow

Every renderer receives a standard contract:

```ts
// Result renderers
{ content: string, args: Record<string, unknown>, tc: TurnToolCall, isTruncated?: boolean }

// Args renderers  
{ args: Record<string, unknown>, tc: TurnToolCall }
```

The `content` is **always a string** — even JSON must be `JSON.parse()`'d with a try/catch.

---

## 2. Current Renderer Catalog

| # | Tool Name | Result Renderer | Args Renderer | `hideArgsWithRichResult` | Category |
|---|-----------|----------------|---------------|--------------------------|----------|
| 1 | `edit` | ✅ EditDiffRenderer | ✅ EditArgsRenderer | ✅ | File |
| 2 | `view` | ✅ ViewCodeRenderer | ❌ | ❌ | File |
| 3 | `create` | ✅ CreateFileRenderer | ✅ CreateArgsRenderer | ✅ | File |
| 4 | `grep` | ✅ GrepResultRenderer | ❌ | ❌ | File |
| 5 | `glob` | ✅ GlobTreeRenderer | ❌ | ❌ | File |
| 6 | `powershell` | ✅ ShellOutputRenderer | ❌ | ❌ | Shell |
| 7 | `read_powershell` | ✅ ShellOutputRenderer | ❌ | ❌ | Shell |
| 8 | `write_powershell` | ✅ ShellOutputRenderer | ❌ | ❌ | Shell |
| 9 | `sql` | ✅ SqlResultRenderer | ❌ | ❌ | Data |
| 10 | `web_search` | ✅ WebSearchRenderer | ❌ | ❌ | Web |
| 11 | `store_memory` | ✅ StoreMemoryRenderer | ❌ | ❌ | Utility |
| 12 | `report_intent` | ❌ | ✅ ReportIntentRenderer | ❌ | Utility |
| 13 | `ask_user` | ✅ AskUserRenderer | ✅ AskUserArgsRenderer | ✅ | Utility |

**Total:** 13 tools registered, 12 result renderers, 4 args renderers.

---

## 3. Per-Renderer Deep Dive & Issues

### 3.1 EditDiffRenderer ✏️

**What it does:** Unified/split diff view with LCS line-level diffing, badge (Modified/Extended/Trimmed/Deleted), stats bar.

**Strengths:**
- 👍 Unified/split toggle is excellent UX
- 👍 Smart badges (Modified, Extended, Trimmed, Deleted)
- 👍 Stats bar with `−N lines` / `+N lines` / `N unchanged`
- 👍 Complexity guard (`MAX_DIFF_COMPLEXITY = 4M`)

**Issues & Feedback Areas:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| E1 | **Dead code: `computeWordDiff`** | 🟡 Med | The word-level diff function (lines 47-101) is defined but **never called** in the template. Only line-level diff is used. Either remove it or integrate inline word-level highlights within diff lines. |
| E2 | **No syntax highlighting in diff lines** | 🟡 Med | Diff lines render as plain monospace text. Adding language-aware highlighting (using the file extension) would significantly improve readability for code changes. |
| E3 | **O(m×n) memory for LCS** | 🟡 Med | The `dp` array allocates `(m+1)×(n+1)` entries. For edits with 500+ lines on each side, this creates 250K+ entries. Consider using Myers' diff algorithm or a space-optimized LCS. |
| E4 | **Long file paths get truncated silently** | 🟢 Low | The path uses `text-overflow: ellipsis` but there's no tooltip showing the full path on the header (there IS one on the path-group span, but not on the label in RendererShell). |
| E5 | **Split view doesn't handle wide content well** | 🟢 Low | Very long lines in split view cause horizontal scrolling within each half, which can be confusing. Consider word-wrap option. |
| E6 | **No keyboard navigation** | 🟢 Low | Can't keyboard-navigate between unified/split tabs (arrow keys). |

---

### 3.2 EditArgsRenderer

**What it does:** Structured display of edit args (File path, Find, Replace blocks).

**Strengths:**
- 👍 Clean labeled layout (File → Find → Replace)
- 👍 Color-coded find/replace blocks (red for old, green for new)
- 👍 Truncation of long strings (500 chars)

**Issues:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| EA1 | **Max-height 120px clips content** | 🟡 Med | The `max-height: 120px` on `.edit-args-code` will clip many multi-line edits without an obvious "show more" affordance. Users may think content is missing. |
| EA2 | **No syntax highlighting** | 🟢 Low | The find/replace blocks are plain monospace. Even basic keyword highlighting would help readability. |

---

### 3.3 ViewCodeRenderer 👁

**What it does:** Syntax-highlighted code with line numbers, view range indicator, directory listing detection.

**Strengths:**
- 👍 Language auto-detection from file path
- 👍 View range display (e.g., "Lines 10–50")
- 👍 Directory vs file detection
- 👍 Line count badge

**Issues:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| V1 | **No image preview** | 🟡 Med | The `view` tool returns base64 for images, but this renderer just shows the raw base64 text. Should detect image MIME and render `<img>`. |
| V2 | **Directory detection is fragile** | 🟡 Med | The heuristic (no extension + `detectLanguage === "text"`) misidentifies extensionless files like `Makefile`, `Dockerfile` as directories. The function handles known filenames, but edge cases remain (e.g., `LICENSE`, `CODEOWNERS`). |
| V3 | **maxLines=2000 could lag** | 🟢 Low | Rendering 2000 syntax-highlighted lines in a table may cause scroll jank. Consider virtual scrolling or a lower default with expand-on-demand. |
| V4 | **No search within code** | 🟢 Low | Can't Ctrl+F search within the code block effectively because of HTML table structure. |

---

### 3.4 CreateFileRenderer 📄

**What it does:** "New File" badge, line count, syntax-highlighted content.

**Strengths:**
- 👍 Clear "New File" visual indicator
- 👍 Uses `file_text` from args (not just result content)
- 👍 Language detection from path

**Issues:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| C1 | **Duplicates content with CreateArgsRenderer** | 🟡 Med | When `hideArgsWithRichResult` is true, args are hidden — but if a user expands args, they see the same code twice (args shows `file_text`, result shows it again). Consider showing only a "File created successfully" message in the result, with the code in the args view. |
| C2 | **Large files render fully** | 🟢 Low | No progressive loading for very large created files. The `maxLines=2000` in CodeBlock helps but the full content is still in the DOM. |

---

### 3.5 CreateArgsRenderer

**What it does:** Shows path + content preview with CodeBlock (max 30 lines).

**Strengths:**
- 👍 Compact preview (30 lines max)
- 👍 Uses CodeBlock for consistent formatting

**Issues:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| CA1 | **No "expand to full" option** | 🟢 Low | Capped at 30 lines with no way to see more without expanding the result (which shows the same content). |

---

### 3.6 GrepResultRenderer 🔍

**What it does:** Grouped search results by file, pattern highlighting, context line distinction, three output modes.

**Strengths:**
- 👍 Excellent file grouping with count badges
- 👍 Pattern highlighting (amber) with HTML-safe escaping
- 👍 Context vs match line distinction (opacity difference)
- 👍 Gap separators (`⋯`) between non-contiguous matches
- 👍 Handles all three output modes (content, files_with_matches, count)

**Issues:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| G1 | **Regex parse fragility** | 🟡 Med | The line-parsing regexes (lines 49-112) handle Windows and Unix paths, but can produce false positives. E.g., a filename like `error-404-handler.ts` at line 1 matches the context pattern `^(.+?)-(\d+)-(.*)$`. The path-separator guard helps but isn't foolproof. |
| G2 | **Pattern highlight can throw** | 🟡 Med | `highlightPattern` wraps regex construction in try/catch (good!), but it uses `escapeRegex` on the already-escaped HTML. If the pattern contains HTML-special chars, the escaped versions may not match the text. Consider matching against raw text, then applying HTML escaping. |
| G3 | **No clickable file paths** | 🟡 Med | Files in the results aren't clickable/openable. Adding a "click to open in view" action would be very useful. |
| G4 | **Line number width is fixed at 4ch** | 🟢 Low | Files with 10000+ lines would clip the line number. |
| G5 | **No syntax highlighting in match text** | 🟢 Low | Match lines are plain monospace. Language-aware highlighting (like VS Code search) would improve readability. |

---

### 3.7 GlobTreeRenderer 📁

**What it does:** Hierarchical collapsible file tree with directory/file icons, file counts.

**Strengths:**
- 👍 True tree hierarchy (not flat list)
- 👍 Collapsible directories with arrow animation
- 👍 File type icons (emoji-based, 15 extensions mapped)
- 👍 Directories sorted first, then alphabetical
- 👍 Relative paths from search root

**Issues:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| GL1 | **No virtualization for large trees** | 🟡 Med | A glob returning 1000+ files renders all DOM nodes. For large codebases, this could cause significant lag. Consider virtual scrolling. |
| GL2 | **Limited icon set** | 🟢 Low | Only 15 file extensions have custom icons. Common types like `.sh`, `.env`, `.docker`, `.svelte`, `.java`, `.cpp`, `.rb` use the generic 📄. |
| GL3 | **Collapsed state is reactive but not persisted** | 🟢 Low | If the user collapses directories and re-renders (e.g., navigating away and back), all directories re-expand. |
| GL4 | **No search/filter** | 🟢 Low | Can't filter the tree by name. Useful when glob returns many files. |
| GL5 | **Path separator normalization** | 🟢 Low | Uses `/` for tree building but original paths may use `\`. The normalization works but display shows `/` paths even on Windows. |

---

### 3.8 ShellOutputRenderer 💻

**What it does:** Terminal-style chrome (macOS dots, prompt, command, exit badge) with semantic line coloring.

**Strengths:**
- 👍 Beautiful terminal aesthetic (gradient background, dots, prompt)
- 👍 Exit status badge (success/error/running)
- 👍 Mode badge (sync/async)
- 👍 Description as terminal title
- 👍 Semantic line coloring (error, warning, success, dim)

**Issues:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| S1 | **No ANSI escape code support** | 🔴 High | Shell output frequently contains ANSI codes for colors. Currently these render as raw `\x1b[31m` text. Need `ansi-to-html` or similar library. |
| S2 | **Keyword-based coloring is too aggressive** | 🟡 Med | Any line containing "error" is red — including legitimate output like `error_handler.ts`, `0 errors`, `ErrorBoundary`. The heuristic `lower.startsWith("e ")` is also problematic (catches any line starting with "e"). Consider more precise patterns (e.g., require "error:" prefix, or only color lines starting with ERROR/Error). |
| S3 | **Long commands are truncated without expand** | 🟡 Med | The command bar uses `text-overflow: ellipsis` but there's no way to see the full command. Should be expandable on click. |
| S4 | **macOS dots on Windows** | 🟢 Low | The macOS-style traffic light dots (red/yellow/green) feel incongruent on Windows. Consider platform-adaptive chrome or a neutral design. |
| S5 | **No stdout/stderr distinction** | 🟢 Low | All output is rendered the same. If the tool metadata included stream info, it would be valuable to visually separate stderr. |
| S6 | **No line numbers** | 🟢 Low | Large build outputs benefit from line numbers for reference. |
| S7 | **No auto-scroll to errors** | 🟢 Low | For long outputs with errors at the bottom, the user must scroll manually. A "Jump to first error" button would help. |

---

### 3.9 SqlResultRenderer 🗄️

**What it does:** Syntax-highlighted SQL query, JSON → table rendering, semantic cell styling.

**Strengths:**
- 👍 SQL syntax highlighting (keywords, strings, numbers, functions)
- 👍 Automatic JSON array → table conversion
- 👍 Semantic cell coloring (null, number, boolean, date)
- 👍 Striped rows + hover highlight
- 👍 Sticky header in scrollable table
- 👍 Description as label

**Issues:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| SQ1 | **Only handles JSON array format** | 🟡 Med | `parsedTable` only works when content is `JSON.parse()`-able as an array of objects. Messages like "3 rows affected" or "Table created" render as plain `<pre>` with no formatting. |
| SQ2 | **No column sorting** | 🟡 Med | Would be very useful for exploring result sets. Click column header to sort. |
| SQ3 | **No pagination for large results** | 🟢 Low | A query returning 500 rows renders all at once. Virtual scrolling or pagination (show 50, load more) would help. |
| SQ4 | **No CSV/JSON export** | 🟢 Low | Copy button copies raw JSON, but a "Download as CSV" option would be useful for data exploration. |
| SQ5 | **No cell wrapping for long text** | 🟢 Low | Long text values in cells overflow. Consider `word-break: break-word` or truncation with expand. |

---

### 3.10 WebSearchRenderer 🌐

**What it does:** Rendered markdown body with source cards, citations, and favicons.

**Strengths:**
- 👍 Full markdown rendering (headings, bold, italic, code, lists, blockquotes, links)
- 👍 Citation badges (numbered circles matching sources)
- 👍 Source card grid with favicons (via DuckDuckGo proxy)
- 👍 Query display bar
- 👍 HTML-safe (escapes first, then applies formatting)

**Issues:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| W1 | **No fenced code block support** | 🟡 Med | The custom markdown parser doesn't handle \`\`\` code blocks. If web search results include code snippets, they render as inline code or plain text. |
| W2 | **No table support** | 🟡 Med | Markdown tables in search results aren't rendered. |
| W3 | **Body max-height 400px** | 🟡 Med | Long search results get cut off with no "expand" button. The `overflow: auto` provides scrolling, but users may not notice the scrollable area. |
| W4 | **Citation numbering may not match** | 🟢 Low | Citations `[1]` in text assume sources are in order. If the markdown text references `[3]` but only 2 sources are extracted, the citation badge shows "3" with no matching source card. |
| W5 | **Nested list support** | 🟢 Low | The regex-based list parser doesn't handle nested lists (indented `- items`). |
| W6 | **Should use MarkdownContent component** | 🟡 Med | The app already has a `MarkdownContent.vue` component used elsewhere. This renderer reimplements markdown parsing from scratch — should use the shared component for consistency and to avoid duplicating bugs/features. |

---

### 3.11 StoreMemoryRenderer 🧠

**What it does:** Memory card with fact, category badge, and reason.

**Strengths:**
- 👍 Clean card layout with lightbulb icon
- 👍 Category badge
- 👍 Reason text

**Issues:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| M1 | **`category` field doesn't exist on store_memory** | 🟡 Med | The renderer looks for `args.category` (line 25), but the `store_memory` tool uses `subject` (not category). The `subject` IS correctly extracted (line 20), but `category` is dead code or a misnomer. |
| M2 | **Citations field not displayed** | 🟡 Med | `store_memory` has a `citations` argument that provides source references, but this renderer doesn't show it at all. This is important context for understanding why a fact was stored. |
| M3 | **No visual success/failure indicator** | 🟢 Low | The result content (usually "Memory stored") isn't rendered when `fact` is available. A small ✓ badge confirming storage succeeded would be nice. |

---

### 3.12 ReportIntentRenderer 🎯

**What it does:** Inline intent badge (args-only renderer).

**Strengths:**
- 👍 Minimal, non-intrusive design (pill badge)
- 👍 Correct: intent is an args-only tool

**Issues:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| R1 | **No intent change history** | 🟢 Low | Each `report_intent` call replaces the previous one. Showing a trail of intent changes (→ Exploring codebase → Installing deps → Running tests) would provide useful timeline context. |

---

### 3.13 AskUserRenderer 💬

**What it does:** Question display, choice list with selection indicator, freeform response, pending state.

**Strengths:**
- 👍 Clear question → choices → response flow
- 👍 Selected choice highlighting (filled vs empty circles)
- 👍 Freeform response detection when user types custom answer
- 👍 "Awaiting user response" pending state

**Issues:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| A1 | **No markdown in question text** | 🟢 Low | Questions sometimes contain formatted text (code snippets, emphasis). Plain text rendering loses this. |
| A2 | **Choice matching is case-insensitive only** | 🟢 Low | If the user's response is "yes" and choices are ["Yes", "No"], it matches. But whitespace differences ("Yes " vs "Yes") would cause a false mismatch → showing as freeform response. Consider `.trim()` on comparison. |

---

### 3.14 AskUserArgsRenderer

**Strengths:**
- 👍 Clean preview of question + choices before result is available

**Issues:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| AA1 | **`question()` and `choices()` are functions, not computed** | 🟢 Low | Lines 9-13 define plain functions instead of computed properties. They're called reactively in the template (which works) but it's unconventional and recalculates every render. Not a bug, but inconsistent with other renderers. |

---

## 4. Shared Components Audit

### 4.1 RendererShell

**Strengths:** Consistent chrome, copy-to-clipboard, truncation banner, error state.

**Issues:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| RS1 | **Label is UPPERCASED via CSS** | 🟢 Low | `text-transform: uppercase` makes labels like file paths hard to read. Consider removing uppercase for path-like labels. |
| RS2 | **No collapse/minimize action** | 🟡 Med | Users can't collapse a rendered result to save space. Only the parent ToolCallItem can collapse the entire detail. |
| RS3 | **"Show Full Output" duplicated** | 🟢 Low | Both RendererShell and ToolCallDetail show "Show Full Output" buttons when truncated. This creates redundant controls. |

### 4.2 CodeBlock

**Strengths:** Language detection, line numbers, max-line collapsing, syntax tokens.

**Issues:**

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| CB1 | **Regex-based syntax highlighting** | 🟡 Med | Uses a custom tokenizer (`syntaxHighlight.ts`) instead of a proper parser. Works for common cases but produces incorrect highlighting for complex syntax (nested template literals, multi-line strings, decorators). |
| CB2 | **No "expand collapsed lines" button** | 🟡 Med | When `maxLines` is exceeded, the collapsed notice says "… N more lines" but there's no button to expand in-place. User must use "Show Full Output" which reloads everything. |

---

## 5. Test Coverage

| Renderer | Has Tests? | Test File |
|----------|-----------|-----------|
| EditDiffRenderer | ✅ | `EditDiffRenderer.test.ts` |
| EditArgsRenderer | ✅ | `EditArgsRenderer.test.ts` |
| ViewCodeRenderer | ✅ | `ViewCodeRenderer.test.ts` |
| CreateFileRenderer | ✅ | `CreateFileRenderer.test.ts` |
| GrepResultRenderer | ✅ | `GrepResultRenderer.test.ts` |
| GlobTreeRenderer | ❌ | — |
| ShellOutputRenderer | ❌ | — |
| SqlResultRenderer | ❌ | — |
| WebSearchRenderer | ❌ | — |
| StoreMemoryRenderer | ❌ | — |
| ReportIntentRenderer | ✅ | `ReportIntentRenderer.test.ts` |
| AskUserRenderer | ❌ | — |
| AskUserArgsRenderer | ❌ | — |
| RendererShell | ✅ | `RendererShell.test.ts` |
| PlainTextRenderer | ✅ | `PlainTextRenderer.test.ts` |
| CodeBlock | ✅ | `CodeBlock.test.ts` |
| ToolResultRenderer | ✅ | `ToolResultRenderer.test.ts` |
| ToolArgsRenderer | ✅ | `ToolArgsRenderer.test.ts` |
| Registry | ✅ | `registry.test.ts` |

**Coverage: 10/19 components tested.** Missing tests for 6 renderers and 3 args renderers.

---

## 6. Missing Renderers — New Tool Candidates

### 6.1 Listed in `RichRenderableToolName` but No Renderer

These tools are declared in the type union but have NO registered renderer:

| Tool | Current Fallback | Impact | Priority |
|------|-----------------|--------|----------|
| **`task`** | MarkdownContent (special case in ToolResultRenderer) | 🔴 High — extremely common, agent results are rich | **P0** |
| **`read_agent`** | MarkdownContent (special case) | 🟡 Med — companion to task | **P1** |
| **`web_fetch`** | PlainTextRenderer | 🟡 Med — URL + markdown content | **P1** |

### 6.2 Not in Type Union, Should Have Renderers

| Tool | Current Display | What a Renderer Could Show | Priority |
|------|----------------|---------------------------|----------|
| **`github-mcp-server-*`** (all) | Raw JSON dump | Issues → card with title, state, labels; PRs → diff stats, review status; Code search → highlighted matches; Commits → message + SHA; Actions → status badges + logs | **P0** |
| **`skill`** | Plain text | Skill badge with name, invocation card | **P2** |
| **`stop_powershell`** | Plain text | "Session terminated" badge | **P3** |
| **`list_powershell`** | Plain text | Table of active sessions | **P3** |
| **`list_agents`** | Plain text | Agent cards with status | **P2** |
| **`write_agent`** | Plain text | Input display (like write_powershell) | **P3** |
| **`deepwiki-*`** | Plain text | Wiki content as rendered markdown | **P2** |
| **`ide-get_diagnostics`** | Plain text | Error/warning list with file + line (like VS Code problems panel) | **P1** |
| **`ide-get_selection`** | Plain text | Code snippet with selection highlighted | **P2** |
| **`fetch_copilot_cli_documentation`** | Plain text | Rendered markdown documentation | **P3** |

### 6.3 Proposed New Renderers (Detail)

#### TaskAgentRenderer (P0) 🤖
The `task` tool is one of the most frequently used and produces rich, multi-paragraph results. Currently gets special-cased in `ToolResultRenderer.vue` (line 67-69) with inline MarkdownContent — but deserves a proper renderer.

**Proposed features:**
- Agent type badge (explore → cyan, task → amber, general-purpose → purple, code-review → pink)
- Model badge
- Prompt preview (collapsible)
- Rendered markdown body
- Stats bar (total tokens, total tool calls, duration)
- Status indicator (success/failure)

#### GitHubRenderer (P0) 🐙
GitHub MCP tools return structured JSON that currently renders as raw dumps. This is one of the most impactful areas for improvement.

**Proposed approach:** A single `GitHubRenderer` that detects the method/tool and renders appropriately:
- **Issues/PRs:** Title, state badge (open/closed/merged), labels as colored pills, author avatar
- **Code search:** File-grouped results like GrepResultRenderer
- **Commits:** Commit message, author, SHA badge, files changed count
- **Actions:** Workflow status badges, job list with pass/fail
- **File contents:** Delegates to ViewCodeRenderer

#### WebFetchRenderer (P1) 🌐
Similar to WebSearchRenderer but simpler — show URL as header link, render content as markdown.

#### IdeDiagnosticsRenderer (P1) 🔍
Show TypeScript/ESLint diagnostics as a VS Code-style problems panel:
- Grouped by file
- Error (🔴) / Warning (🟡) / Info (🔵) severity badges
- Line + column numbers
- Message text

---

## 7. Cross-Cutting UX Issues

### 7.1 Information Density & Overflow

| Issue | Description | Affected Renderers |
|-------|-------------|-------------------|
| **Fixed max-heights** | Many renderers cap at 400-500px with `overflow: auto`. Users may not notice content is scrollable. | All renderers |
| **No expand-to-full-height option** | Once truncated, the only option is "Show Full Output" which reloads from the backend. No in-place expand. | All renderers |
| **Double scrollbar nesting** | Renderer body scrolls independently of the page scroll, creating nested scrollbars. | ShellOutput, Grep, Glob, SQL |

### 7.2 Consistency

| Issue | Description |
|-------|-------------|
| **Emoji vs Unicode icons** | Some renderers use emoji (📄, 🔍, 💻) while others could use SVG icons. Mixed approach looks inconsistent. |
| **JetBrains Mono hardcoded** | Font stack `'JetBrains Mono', 'Fira Code', monospace` is repeated in every renderer. Should be a CSS variable. |
| **Border radius inconsistency** | Some use `var(--radius-sm)`, some use `var(--radius-md)`, some hardcode `6px` or `9999px`. |
| **Padding inconsistency** | Header padding varies: `6px 10px`, `8px 12px`, `10px 12px`. Should standardize. |

### 7.3 Accessibility

| Issue | Description |
|-------|-------------|
| **Keyboard navigation** | Only the parent ToolCallItem is keyboard-navigable. Internal controls (diff mode toggle, tree collapse) aren't in tab order. |
| **Screen reader support** | `role="presentation"` on tables is correct for visual layout, but actual data tables (SQL results) should use proper table roles. |
| **Color-only indicators** | Diff line coloring (red/green) relies on color alone. Add `+`/`−` indicators (✅ already done in EditDiffRenderer) but not in all colored contexts. |

### 7.4 Performance

| Issue | Description |
|-------|-------------|
| **No virtual scrolling** | Large outputs (500+ lines in shell, 1000+ files in glob) render all DOM nodes. |
| **LCS is synchronous** | Diff computation blocks the main thread for large edits. Consider Web Workers. |
| **All renderers are async-loaded** | Good for bundle splitting, but the loading state (flash of empty content) isn't handled with skeletons. |

---

## 8. Improvement Recommendations

### 🔴 High Priority

1. **Add ANSI escape code support to ShellOutputRenderer** — Install `ansi-to-html` (~5KB) and parse ANSI codes before semantic line classification. This is the #1 user-visible issue.

2. **Create TaskAgentRenderer** — The `task` tool's current inline MarkdownContent special-case in the dispatcher is fragile and feature-poor. A proper renderer with agent type/model badges and stats would be a significant UX win.

3. **Create GitHubRenderer** — GitHub MCP tools are heavily used and JSON dumps are nearly unreadable. Even a basic card layout for issues/PRs would be a massive improvement.

4. **Fix ShellOutputRenderer keyword matching** — Replace naive `line.includes("error")` with smarter patterns:
   ```ts
   // Better: require error at word boundary or as a log prefix
   const isError = /\b(?:error|ERROR|FAIL|FATAL|EXCEPTION|panic)\b/i.test(line) 
     && !/0 errors?\b/i.test(line) && !/no errors?\b/i.test(line);
   ```

5. **Add missing `citations` display to StoreMemoryRenderer** — The `citations` field contains valuable source references that are completely invisible.

### 🟡 Medium Priority

6. **Wire up word-level diff in EditDiffRenderer** — The `computeWordDiff` function exists but isn't used. Integrate it to highlight changed words within changed lines (like GitHub's diff view).

7. **Add "expand in place" to CodeBlock** — When lines are collapsed, show an "Expand" button that reveals them without hitting the backend.

8. **Improve WebSearchRenderer markdown parsing** — Either use the existing `MarkdownContent` component for consistency, or add fenced code block and table support to the custom parser.

9. **Add image preview to ViewCodeRenderer** — Detect base64 image content and render an `<img>` tag.

10. **Fix StoreMemoryRenderer `category` → `subject` confusion** — Remove the dead `category` computed, or if both exist, display `subject` as the primary tag.

11. **Add column sorting to SqlResultRenderer** — Click-to-sort on table headers.

12. **Add tests for untested renderers** — GlobTreeRenderer, ShellOutputRenderer, SqlResultRenderer, WebSearchRenderer, StoreMemoryRenderer, AskUserRenderer.

### 🟢 Low Priority

13. **Standardize font-family as CSS variable** — Define `--font-mono` in the theme and reference it everywhere.
14. **Add file type icons for more extensions in GlobTreeRenderer** — At minimum: `.sh`, `.env`, `.java`, `.cpp`, `.c`, `.rb`, `.php`, `.svelte`, `.scss`.
15. **Add keyboard navigation within renderers** — Tab stops for interactive elements (diff mode toggle, tree nodes).
16. **Consider virtual scrolling** for ShellOutputRenderer and GlobTreeRenderer when content exceeds 200 items.
17. **Platform-adaptive terminal chrome** — Detect OS and use appropriate window decoration style.

---

## 9. Priority Roadmap

### Phase 1: Fix Critical Issues
- [ ] ANSI support in ShellOutputRenderer
- [ ] Fix keyword coloring heuristics
- [ ] Add citations to StoreMemoryRenderer
- [ ] Fix category/subject confusion in StoreMemoryRenderer

### Phase 2: New High-Impact Renderers
- [ ] TaskAgentRenderer
- [ ] GitHubRenderer (issues, PRs, code search at minimum)
- [ ] WebFetchRenderer

### Phase 3: Enhancement Pass
- [ ] Word-level diff highlighting
- [ ] Image preview in ViewCodeRenderer
- [ ] Column sorting in SqlResultRenderer
- [ ] WebSearchRenderer markdown improvements
- [ ] CodeBlock expand-in-place

### Phase 4: Missing Tests & Polish
- [ ] Tests for all untested renderers
- [ ] CSS variable standardization
- [ ] Accessibility improvements
- [ ] Virtual scrolling for large outputs
- [ ] Extended file icon set

---

## Appendix A: All Tool Names in Codebase

From `toolCall.ts` categories and registry analysis:

```
File:     view, edit, create, grep, glob
Shell:    powershell, read_powershell, write_powershell, stop_powershell, list_powershell
Agent:    task, read_agent, write_agent, list_agents
GitHub:   github-mcp-server-get_file_contents, github-mcp-server-search_code,
          github-mcp-server-list_issues, github-mcp-server-issue_read,
          github-mcp-server-list_pull_requests, github-mcp-server-pull_request_read,
          github-mcp-server-search_pull_requests, github-mcp-server-list_commits,
          github-mcp-server-get_commit, github-mcp-server-actions_list,
          github-mcp-server-actions_get, github-mcp-server-get_job_logs,
          github-mcp-server-search_issues, github-mcp-server-search_repositories,
          github-mcp-server-search_users, github-mcp-server-list_branches,
          github-mcp-server-get_copilot_space, github-mcp-server-list_copilot_spaces
Web:      web_search, web_fetch
Data:     sql
IDE:      ide-get_selection, ide-get_diagnostics
Wiki:     deepwiki-read_wiki_structure, deepwiki-read_wiki_contents, deepwiki-ask_question
Utility:  report_intent, ask_user, store_memory, skill, fetch_copilot_cli_documentation
```

## Appendix B: Renderer Props Contract

```ts
// Result renderer props
interface ResultRendererProps {
  content: string;                    // Tool result text (may be truncated)
  args: Record<string, unknown>;      // Parsed tool arguments
  tc: TurnToolCall;                   // Full tool call metadata
  isTruncated?: boolean;              // Whether content was clipped
}

// Args renderer props
interface ArgsRendererProps {
  args: Record<string, unknown>;      // Parsed tool arguments
  tc: TurnToolCall;                   // Full tool call metadata
}

// TurnToolCall (key fields)
interface TurnToolCall {
  toolCallId?: string;
  toolName: string;
  arguments?: unknown;
  success?: boolean;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  mcpServerName?: string;
  mcpToolName?: string;
  isComplete: boolean;
  isSubagent?: boolean;
  agentDisplayName?: string;
  model?: string;
  totalTokens?: number;
  totalToolCalls?: number;
  intentionSummary?: string;
  resultContent?: string;             // Truncated preview (≤1KB)
}
```

## Appendix C: RendererEntry Registration Contract

```ts
interface RendererEntry {
  label: string;                      // Human-friendly name for Settings UI
  resultComponent?: Component;        // Async component for result rendering
  argsComponent?: Component;          // Async component for args rendering
  hideArgsWithRichResult?: boolean;   // Hide args when rich result is shown
}

// Registration example
const RENDERER_REGISTRY: Record<string, RendererEntry> = {
  my_tool: {
    label: "My Tool (Description)",
    resultComponent: defineAsyncComponent(() => import("./MyToolRenderer.vue")),
    argsComponent: defineAsyncComponent(() => import("./MyToolArgsRenderer.vue")),
    hideArgsWithRichResult: true,
  },
};
```
