# 13 · Tool-Call Renderers

> **Scope:** The per-tool **bodies** that fill `<RendererShell>` in the Conversation tab. Defines layout, syntax tokens, body affordances, and per-renderer contracts for every renderer registered in `packages/ui/src/components/renderers/registry.ts`. Closes the audit's **Conversation Tool-Call Renderers (High)** finding (`design-system/audit/UI-AUDIT.md` lines 315–321).
> **Inherits:** `00-globals.md` (all hygiene rules — icons, color, motion, glass, gradients, hex), `02-primitives.md` (especially **§RendererShell** — the frame contract is mandatory), `12-conversation-tab.md` (turn layout, global keyboard, copy/expand affordances at the Conversation level).
> **Lives in:** `packages/ui/src/components/renderers/` — exported from `@tracepilot/ui`.

This file documents the **bodies** that go inside the shell. **Every renderer in this directory MUST compose `<RendererShell>` from `02-primitives §RendererShell`**; this spec does not redefine the header strip, status pill, latency-mono, copy button, retry button, collapse chevron, or footer — those are owned by the shell. A renderer's job is to render structured payload into `#default`, optionally provide tabs via `#tabs`, and pass the right `iconName`, `status`, `primaryHint`, `copyText`, and `durationMs` props **upwards** to the shell.

If you are migrating an existing renderer, the audit observation is simple: today every renderer hand-rolls its own header strip, copy button, truncation banner, and corner radii — those must all delete in favour of the shell. See **§10 Anti-patterns** for the exact list.

---

## Index

1. [Information architecture — tool categories](#ia)
2. [Layout — body region per category](#layout)
3. [Tokens used](#tokens)
4. [Component contracts — per renderer](#contracts)
5. [Interaction model](#interaction)
6. [States](#states)
7. [Motion](#motion)
8. [Accessibility](#a11y)
9. [Anti-patterns to remove](#anti)
10. [Acceptance checklist](#acceptance)

---

## 1. Information architecture — tool categories  <a id="ia"></a>

Renderers are grouped by **what they show**, not by tool name. The category determines the body archetype (diff, terminal, table, list, prose) and the default `iconName` family. Every category composes the **same** `<RendererShell>` — the category only changes the body.

The full registry today (verified against `packages/ui/src/components/renderers/registry.ts`):

| Category | Tools | Renderer file (result · args) |
|---|---|---|
| **1A · Code — write** | `apply_patch`, `edit`, `create` | `ApplyPatchRenderer.vue` · `ApplyPatchArgsRenderer.vue` // `EditDiffRenderer.vue` · `EditArgsRenderer.vue` // `CreateFileRenderer.vue` · `CreateArgsRenderer.vue` |
| **1B · Code — read** | `view` | `ViewCodeRenderer.vue` |
| **2 · Filesystem search** | `grep`, `rg`, `glob` | `GrepResultRenderer.vue`, `GlobTreeRenderer.vue` |
| **3 · Shell** | `powershell`, `read_powershell`, `write_powershell` | `ShellOutputRenderer.vue` |
| **4 · Data query** | `sql` | `SqlResultRenderer.vue` |
| **5 · Network** | `web_search` | `WebSearchRenderer.vue` |
| **6 · Conversation control** | `ask_user`, `report_intent` | `AskUserRenderer.vue` · `AskUserArgsRenderer.vue` // `ReportIntentRenderer.vue` |
| **7 · Memory / misc** | `store_memory` | `StoreMemoryRenderer.vue` |
| **8 · Fallback** | any tool not in registry | `PlainTextRenderer.vue` |

Two helper components live alongside but **are not** registered renderers — they are body building blocks consumed by the renderers above:

- `CodeBlock.vue` — syntax-highlighted monospace block. Used by Code-write/read renderers.
- `ToolErrorDisplay.vue` — the body shown when `status === 'error'`. Used by every renderer via `<RendererShell>`'s error slot path.

There is **no `BashRenderer`, no `ReadFileRenderer`, no `FetchRenderer`** in the codebase today. They appear in some specs because the audit assumed POSIX naming; in TracePilot the equivalents are `ShellOutputRenderer` (covers all shell variants) and `ViewCodeRenderer` (covers read-file). The plain `fetch` tool reuses `PlainTextRenderer` until a dedicated network renderer ships.

> **Cross-ref:** the dispatcher that routes a `TurnToolCall` into one of these renderers lives in `ToolResultRenderer.vue` / `ToolArgsRenderer.vue`. Those are documented in `12-conversation-tab.md §Turn layout` — they pick a renderer from the registry and pass it to `<RendererShell>` as the body slot.

---

## 2. Layout — body region per category  <a id="layout"></a>

Each ASCII below shows **only the body** that goes inside `<RendererShell>`. The shell's header (`[icon] tool-name [status] [duration] … [hint] [⌄]`) and footer are drawn elsewhere; do not redraw them in the renderer template.

### 2.1 · Code-write body (apply_patch · edit · create)

Three columns: line-number gutter (old) · line-number gutter (new) · code. Indicator column (`+ / − / @@ / ·`) sits between the gutters and the code, full-line tinted background per line type.

```
┌─ #tabs (slot) ────────────────────────────────────────────────────┐
│  ◐ Unified   ○ Split   ○ Raw                       packages/ui/Btn.vue │  segmented control + path
├───────────────────────────────────────────────────────────────────┤
│ stats:   −12  +34  · 18 unchanged   [ Modified ]                  │  hairline, --text-tertiary
├──┬──┬──┬──────────────────────────────────────────────────────────┤
│12│  │ −│  const oldValue = computeLegacy(input);                  │  removed: bg --danger-subtle
│  │35│ +│  const newValue = compute(input, opts);                  │  added:   bg --success-subtle
│13│36│  │  return validate(newValue);                              │  context: bg transparent
│··│··│@@│  @@ -42,7 +42,9 @@                                       │  hunk:    bg --accent-subtle
└──┴──┴──┴──────────────────────────────────────────────────────────┘
 ↑   ↑   ↑   ↑
 │   │   │   └ code: --font-mono 12/18, white-space: pre, syntax tokens (§3)
 │   │   └ indicator: 1ch, --syn-* tone matches line type
 │   └ new line-num gutter: 4ch, right-align, --text-tertiary, tnum
 └ old line-num gutter: 4ch, right-align, --text-tertiary, tnum
```

Diff-header conventions:
- **Hunk lines** (`@@ -a,b +c,d @@`) render as a full-width separator row tinted with `--accent-subtle`, indicator `@@`, mono.
- **File path** is rendered in the **shell header's `primaryHint`** (right-aligned, mono) — *not* a second header inside the body.
- **Multi-file patch** (`apply_patch`) uses one body section per file; each section is a `<details>` open-by-default with the file path as `<summary>` and a per-file mini-stats row (`+12  −3`).

### 2.2 · Code-read body (view)

Pure `CodeBlock`: a 4ch line-number gutter and a code column. No indicator column. Optional `[ jump-to-line ]` chip in the shell header's `primaryHint` slot when the source path is available.

```
┌──┬───────────────────────────────────────────────────────────────┐
│ 1│  import { defineComponent } from "vue";                       │
│ 2│  import type { Props } from "./types";                        │
│ 3│                                                                │
│ 4│  export default defineComponent<Props>({                       │
│ 5│    name: "EntityCard",                                         │
└──┴───────────────────────────────────────────────────────────────┘
```

### 2.3 · Filesystem search body

Two flavours selected by `args.output_mode`:

**Content mode** — file-grouped match list. Each group has a sticky 28px header (`[file-icon] path  [count]`) on `--canvas-inset`, then matches with a 4ch line-num gutter and pattern hits highlighted with `--syn-match`. A `⋯` separator row is inserted where line numbers skip.

```
┌─ packages/ui/src/components/EntityCard.vue                    [3]┐  group header (sticky)
├──┬───────────────────────────────────────────────────────────────┤
│42│  const «status» = computed(() => …);                          │  match: --syn-match highlight
│43│  if («status».value === "error") {                            │  match
│  │  ⋯                                                            │  gap separator
│87│    return «status»Pill(value);                                │  match
└──┴───────────────────────────────────────────────────────────────┘
```

**Files-with-matches / count mode** — flat list, 24px rows: `[file-icon] path     [count?]`.

### 2.4 · Glob tree body

Hierarchical collapsible tree, indent = 12px per depth, chevron `▸ / ▾` at the start of any directory row. File rows show file-icon + name; directory rows additionally show `[N]` total descendant file count.

```
▾ packages/
  ▾ ui/
    ▸ src/components/        [38]
    ▾ src/composables/       [4]
        useClipboard.ts
        useHotkey.ts
        useResizeObserver.ts
        useVirtualList.ts
```

### 2.5 · Shell body

Three stacked rows: command bar, optional pwd/mode meta, output stream. **No macOS traffic-light dots, no fake terminal chrome** — the shell already provides identity (the `terminal` Lucide icon is the `iconName`). Output lines are classified into `error / warning / success / dim / default` purely for color, never to obscure content.

```
┌────────────────────────────────────────────────────────────────────┐
│  ❯ pnpm --filter @tracepilot/ui typecheck            [exit 0]     │  command bar
├────────────────────────────────────────────────────────────────────┤
│  cwd C:\git\TracePilot   mode sync   118ms                         │  meta row (--text-tertiary)
├────────────────────────────────────────────────────────────────────┤
│   > @tracepilot/ui@0.6.3 typecheck                                 │  default
│   > vue-tsc --noEmit                                               │  default
│   ✓ no errors                                                       │  --success-fg
│   ⚠ deprecated: legacy-octal                                        │  --warning-fg
│   ✗ src/foo.ts(12,4): TS2322 …                                      │  --danger-fg
└────────────────────────────────────────────────────────────────────┘
```

### 2.6 · Data-query body (sql)

Two parts: the query (CodeBlock with SQL syntax tokens), then a `<DataGrid>` (see `02-primitives §DataGrid`) bound to `rows`. If the result is empty, render `<EmptyState>` with title "0 rows" and the query as `hint`.

```
┌────────────────────────────────────────────────────────────────────┐
│  SELECT id, summary, updated_at                                    │  CodeBlock (sql)
│    FROM sessions                                                   │
│   WHERE branch = 'main' ORDER BY updated_at DESC LIMIT 5;          │
├────────────────────────────────────────────────────────────────────┤
│  id          summary                       updated_at              │  DataGrid header
│  ────────── ──────────────────────────── ────────────              │
│  s_4f2a…    feat: refactor auth          2m ago                    │
│  s_3e1b…    fix: crash on resume         1h ago                    │
└────────────────────────────────────────────────────────────────────┘
                                                       5 rows · 18ms │  --text-tertiary
```

### 2.7 · Network body (web_search)

Vertical list of result cards (24/28px rows) — title (`text.body-strong`, link color), URL (mono, `text.small`, `--text-tertiary`, middle-truncated), 2-line snippet with query terms highlighted via `--syn-match`.

```
┌────────────────────────────────────────────────────────────────────┐
│  Vue 3.5 release notes                                              │  title (link)
│  vuejs.org/guide/whats-new/3-5                                      │  url (mono, tertiary)
│  Vue 3.5 introduces «reactivity» improvements and a new compiler …  │  snippet (--syn-match hits)
├────────────────────────────────────────────────────────────────────┤
│  Migrating from Vue 2 to Vue 3                                      │
│  ……                                                                 │
└────────────────────────────────────────────────────────────────────┘
```

### 2.8 · Conversation-control bodies

`ask_user` — args body is the **prompt + choices form** (the user's reply lives elsewhere in the turn). The body uses `<Heading level="3">` for the question, then either a free-text input or an option list rendered with `<StatusPill>`-like option chips. `report_intent` — single-line body, `target` Lucide icon left, intent text mono. Both compose `<RendererShell>` with `collapsible={false}` since they are essential conversational signals.

```
┌─ ask_user ─────────────────────────────────────────────────────────┐
│  Which approach should we take for the migration?                  │
│  ○  Rewrite incrementally                                          │
│  ○  Big-bang replace                                               │
│  ○  Keep both engines in parallel                                  │
└────────────────────────────────────────────────────────────────────┘

┌─ report_intent ────────────────────────────────────────────────────┐
│  ⊕ Refactoring authentication module                               │
└────────────────────────────────────────────────────────────────────┘
```

### 2.9 · Memory body (store_memory)

Two-line body: `subject` chip on the left (uppercase `text.micro`, `--accent-subtle`), `fact` text on the right (`text.body`). A footer row (passed via shell `#footer` only when `reason` exists) renders the rationale dimly.

### 2.10 · Plain-text fallback

Single `<pre>` block with `--font-mono`, `text.code` (13/20), `white-space: pre-wrap`, capped at 320px height before the shell's collapse chevron is offered.

---

## 3. Tokens used  <a id="tokens"></a>

All values come from `packages/ui/src/styles/tokens.css`. **No hex literals in any renderer CSS.** If a token is missing, add it to `tokens.css` first (see `00-globals §G6`).

### 3.1 · Surface, border, text

| Concern | Token |
|---|---|
| Renderer body background | `--canvas-subtle` (matches shell) |
| Code/diff/terminal inset | `--canvas-inset` |
| Sticky group headers (grep, multi-file patch) | `--canvas-inset` |
| Hairlines between groups, between meta/body, between body/footer | `--border-subtle` |
| Inter-row dividers (only when explicitly needed; default: none) | `--border-muted` |
| Body text | `--text-secondary` |
| Mono primary (path, command, code) | `--text-primary` on `--font-mono` |
| Line numbers, gutter, dim shell output | `--text-tertiary` |
| Hover fill on selectable rows | `--surface-tertiary` (per `00-globals §G4`) |

### 3.2 · Diff line tones

| Line type | Background | Foreground (indicator) |
|---|---|---|
| `added` | `--success-subtle` | `--success-fg` |
| `removed` | `--danger-subtle` | `--danger-fg` |
| `context` | transparent | `--text-tertiary` |
| `hunk` (`@@`) | `--accent-subtle` | `--accent-fg` |
| `meta` (file rename, etc.) | transparent | `--text-tertiary`, italic |

### 3.3 · Shell-output tones

`error → --danger-fg`, `warning → --warning-fg`, `success → --success-fg`, `dim → --text-tertiary`, default → `--text-secondary`. Backgrounds remain `--canvas-inset` — never per-line. Pattern: line classification is presentational only; the literal text is preserved.

### 3.4 · Search-match highlight

Pattern hits in `GrepResultRenderer` and `WebSearchRenderer` use `--syn-match` foreground on a `--warning-subtle` background, `border-radius: 2px`, `padding: 0 1px`. Never invert color or use a hard yellow fill.

### 3.5 · Syntax highlighting palette  (cited from `tokens.css` lines 172–183 dark / 283–294 light)

These are the **only** tokens any renderer may use to color code. Themes resolve them per `data-theme`.

| Token | Role |
|---|---|
| `--syn-keyword` | language keywords (`if`, `return`, `def`, `SELECT`) |
| `--syn-type` | type names, class names, JSX/TSX tags treated as types |
| `--syn-string` | string literals, template literals, template-quoted SQL |
| `--syn-number` | numeric literals, byte sizes, durations |
| `--syn-func` | function/method names at definition or call site |
| `--syn-const` | constants, enum members, top-level identifiers |
| `--syn-param` | parameter names, destructured bindings |
| `--syn-tag` | HTML/Vue/JSX element tags (`<div>`) |
| `--syn-attr` | HTML attribute names (`class`, `:href`) |
| `--syn-prop` | object property keys, JSON keys |
| `--syn-regex` | regex literals, glob patterns |
| `--syn-match` | search-match highlight (grep, web search) |

> If a renderer needs a syntax role not listed above (e.g. a comment style), add `--syn-comment` to `tokens.css` per the existing taxonomy and reference it here. Do not reach for `--text-*` tones — those are not syntax tokens.

### 3.6 · Status & motion

Defer to `02-primitives §RendererShell` (status icons + tones) and `00-globals §G5` (durations 120/180/220ms, ease `cubic-bezier(0.2,0.6,0.2,1)`, transform/opacity only).

---

## 4. Component contracts — per renderer  <a id="contracts"></a>

Every row asserts: this renderer **composes `<RendererShell>`**. The contract spells out (a) the `iconName` it must pass, (b) how its `status` is derived from `TurnToolCall.success`, (c) what goes in `primaryHint`, (d) what its body renders, (e) the `copyText` it must produce, and (f) optional `#tabs`. Anything not listed defers to the shell defaults.

### 4.1 · `ApplyPatchRenderer` (tool: `apply_patch`)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ |
| `iconName` | `git-pull-request` |
| `status` derivation | `success` if all hunks applied, `warning` if any hunk fuzzy/skipped, `error` if patch rejected, `pending` while running |
| `primaryHint` | first file path (single-file patch) or `"{n} files"` (multi-file) |
| Body | one section per file; section header `[op-badge] path [→ moveTo?]`; body = `CodeBlock` for `add`, diff table for `update`, prose `"Deletes path"` for `delete`. Op-badge uses `--success-* / --warning-* / --danger-*` for add/update/delete |
| `#tabs` | none (patch is whole-file; raw view is a `<details>` at the bottom of the body, not a tab) |
| `copyText` | the original raw `*** Begin Patch … *** End Patch` block |

### 4.2 · `ApplyPatchArgsRenderer` (args view of `apply_patch`)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ |
| `iconName` | `file-diff` |
| `status` | always `pending` while args are showing pre-result; otherwise inherit from parent turn |
| `primaryHint` | same as result renderer |
| Body | summary stats only (`{n} files · +{added} −{removed} · {hunks} hunks`) — full diff lives in the result renderer to avoid double-rendering |
| `copyText` | raw patch |

### 4.3 · `EditDiffRenderer` (tool: `edit`)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ |
| `iconName` | `file-edit` |
| `status` derivation | `success` on success, `warning` if `old_str` matched fuzzily, `error` on no-match, `pending` while running |
| `primaryHint` | `args.path` (mono, middle-truncated) |
| Body | diff table per §2.1, with edit-kind badge (`Modified / Extended / Trimmed / Deleted`) at top of body |
| `#tabs` | `Unified` · `Split` (only when both `old_str` and `new_str` exist; otherwise tab strip is hidden) |
| `copyText` | `args.new_str` if present, else raw content |

### 4.4 · `EditArgsRenderer` (args view of `edit`)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ |
| `iconName` | `file-edit` |
| Body | path (mono) + line counts of `old_str` / `new_str`. No diff (same dedup rule as 4.2). |
| `copyText` | the JSON args |

### 4.5 · `CreateFileRenderer` (tool: `create`)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ |
| `iconName` | `file-plus` |
| `status` derivation | `success` on success, `error` on EEXIST or write failure |
| `primaryHint` | `args.path` |
| Body | `CodeBlock` with the created content; language inferred from extension |
| `copyText` | the created file's content |

### 4.6 · `CreateArgsRenderer` (args view of `create`)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ |
| `iconName` | `file-plus` |
| Body | path (mono) + byte/line count chips. Defers full content to the result renderer. |

### 4.7 · `ViewCodeRenderer` (tool: `view`)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ |
| `iconName` | `file-code-2` |
| `status` derivation | `success`, `error` on missing file |
| `primaryHint` | `args.path` (mono, middle-truncated) — clickable to open file (see §5) |
| Body | `CodeBlock` with line numbers; if `view_range` was provided, gutter starts at the range's first line, not 1 |
| `#tabs` | none |
| `copyText` | raw file content as shown |

### 4.8 · `GrepResultRenderer` (tools: `grep`, `rg`)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ |
| `iconName` | `search` |
| `status` derivation | `success` if any match, `success` (with empty body) if zero matches — render `<EmptyState>` `"0 matches"` inside the body, not error |
| `primaryHint` | `/${args.pattern}/` rendered mono |
| Body | category 2.3 — content / files-with-matches / count flavours selected by `args.output_mode` |
| `copyText` | the original ripgrep stdout |

### 4.9 · `GlobTreeRenderer` (tool: `glob`)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ |
| `iconName` | `folder-tree` |
| `status` derivation | `success`; `success` + EmptyState when no files matched |
| `primaryHint` | the glob pattern (mono) |
| Body | category 2.4 collapsible tree |
| `copyText` | newline-joined list of matched paths |

### 4.10 · `ShellOutputRenderer` (tools: `powershell`, `read_powershell`, `write_powershell`)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ |
| `iconName` | `terminal` |
| `status` derivation | `success` if `tc.success === true`, `error` if `false`, `pending` if `null`/`undefined` (tool still streaming). Long-running async sessions stay `pending` indefinitely; the shell shows the `loader-2` icon. |
| `primaryHint` | `args.description` if present, else first 60 chars of `args.command` |
| Body | category 2.5 (command bar · meta · output stream). `args.mode !== 'sync'` shows a small `mode` chip in the command bar (not in the shell header). |
| `#tabs` | none — `read_powershell` continuations append to the same body |
| `copyText` | the raw `content` (output only, not the command) |

### 4.11 · `SqlResultRenderer` (tool: `sql`)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ |
| `iconName` | `database` |
| `status` derivation | `success` on result, `error` on query exception, `warning` when result was truncated by row-limit |
| `primaryHint` | `args.database` (e.g. `"session"`) + row count |
| Body | category 2.6 — SQL `CodeBlock` then `<DataGrid>` |
| `#tabs` | `Table` · `JSON` (JSON shows the raw result via `PlainTextRenderer`-style `<pre>`) |
| `copyText` | tab-separated values of the result rows |

### 4.12 · `WebSearchRenderer` (tool: `web_search`)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ |
| `iconName` | `globe` |
| `status` derivation | `success`, `error` on network failure, `warning` on partial results |
| `primaryHint` | the query string in mono (truncated) |
| Body | category 2.7 list of result cards |
| `copyText` | newline-joined `title — url` pairs |

### 4.13 · `AskUserRenderer` (tool: `ask_user`, result side)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ — `collapsible={false}`, `defaultCollapsed={false}` |
| `iconName` | `message-circle-question` |
| `status` derivation | `success` (user answered), `cancelled` (user dismissed), `pending` (awaiting answer) |
| `primaryHint` | (none — the question itself is the body) |
| Body | the user's selected answer rendered as a quoted block; if free-text, mono. |
| `copyText` | the user's answer text |

### 4.14 · `AskUserArgsRenderer` (tool: `ask_user`, args side)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ — `autoExpandArgs` honoured by the dispatcher |
| `iconName` | `message-circle-question` |
| `status` | `pending` while awaiting; mirrors result once answered |
| Body | `<Heading level="3">` question + option list / input form (category 2.8) |

### 4.15 · `ReportIntentRenderer` (tool: `report_intent`, args-only)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ — `collapsible={false}` |
| `iconName` | `target` |
| `status` | always `success` (intent is a record, not an action) |
| `primaryHint` | (none) |
| Body | single-line: Lucide `target` icon + intent text in mono. Height: 28px. |
| `copyText` | intent text |

### 4.16 · `StoreMemoryRenderer` (tool: `store_memory`)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ |
| `iconName` | `brain` |
| `status` derivation | `success`, `error` on storage failure |
| `primaryHint` | `args.subject` chip (mono `text.micro`) |
| Body | category 2.9: subject + fact, optional reason in `#footer` |
| `copyText` | `${subject}: ${fact}` |

### 4.17 · `PlainTextRenderer` (fallback)

| Field | Value |
|---|---|
| Composes | `<RendererShell>` ✓ |
| `iconName` | `file-text` |
| `status` | passes through `tc.success` |
| `primaryHint` | tool name in mono (since no specialised hint exists) |
| Body | category 2.10 `<pre>` block, capped at 320px before collapse |

### 4.18 · `[PLANNED] BashRenderer` / `[PLANNED] FetchRenderer` / `[PLANNED] ReadFileRenderer`

Not present in the registry today. If they ship later, **they MUST compose `<RendererShell>`** and follow the matching category body (Shell, Network, Code-read respectively). This file should be amended when they land — do not invent placeholders.

---

## 5. Interaction model  <a id="interaction"></a>

Renderer-local interactions only. Global keyboard (turn navigation, focus jumps between renderers, Cmd/Ctrl+K, Cmd/Ctrl+L) is owned by `12-conversation-tab.md` — do not redefine it here.

| Affordance | Behaviour | Where it lives |
|---|---|---|
| **Copy code/output** | One canonical "Copy" button on the shell footer (per `02-primitives §RendererShell`). The renderer supplies `copyText`; success is announced via the global aria-live region (§8). | Shell |
| **View raw** | For renderers with structured bodies (apply_patch, sql, web_search), a `Raw` tab is exposed via `#tabs`. Apply-patch additionally has an inline `<details>` "Show raw patch" because of multi-file scope. | Body |
| **View full** (truncated) | The shell's existing truncation banner (`isTruncated` prop) emits `load-full`. Renderers must propagate the event upward via `defineEmits<{ 'load-full': [] }>()` so the dispatcher can refetch full content. | Shell + body emit |
| **Expand / collapse long bodies** | Bodies > 500px (diff, terminal, sql, code) get `max-height: 500px; overflow: auto;`. The shell's collapse chevron (header) is the only **whole-renderer** toggle. There is **no** per-section collapse inside the body, except for the multi-file patch sections, which use native `<details>` open-by-default. | Body |
| **Click-to-open-file** | Wherever a file path appears as `primaryHint` (Edit, Create, View, ApplyPatch single-file, GrepResult per-group header), the path is wrapped in a button that emits an `open-file` event with `{ path, line? }`. The Conversation tab listens and routes to the appropriate viewer. Dim the chrome to indicate it's clickable: hover tone goes from `--text-tertiary` → `--text-link`. | Body emits, shell forwards |
| **Diff mode toggle** | `Unified` / `Split` segmented control rendered into the shell's `#tabs` slot — never as a free-floating toolbar inside the body. State is local-only; not persisted. | `#tabs` slot |
| **Pattern jump** | In `GrepResultRenderer`, hovering a match row reveals a `↗` glyph on the right; click emits `open-file` with `{ path, line }`. | Body |

> **What renderers must NOT add:** their own copy buttons, their own collapse chevrons, their own truncation banners, their own retry buttons, their own corner radii or borders. Every one of those is already in the shell. Adding a duplicate is the most common bug found in audit (see §9).

---

## 6. States  <a id="states"></a>

Each renderer responds to the `status` value its dispatcher passes through `<RendererShell>`. The body must remain coherent in every state.

| State | Shell behaviour | Body behaviour |
|---|---|---|
| **pending** | `loader-2` icon spins in the header (respects reduced-motion); left rule `--accent-emphasis`. | Renderer shows skeleton lines (3 mono lines, `--canvas-inset`, fading at 1500ms intervals — but no infinite pulse, see `00-globals §G5`). For shell renderer: command bar visible, output area shows blinking caret only. |
| **success** | Header icon `check-circle-2`, tone `--success-fg`. Left rule `--success-emphasis`. | Full body rendered. |
| **warning** (partial truncation, soft fail, fuzzy match) | Icon `alert-triangle`, tone `--warning-fg`. Left rule `--warning-emphasis`. | Body renders normally but a single hairline notice row sits at the top of the body: `text.small`, `--warning-fg`, `--warning-subtle` background, e.g. `"Output truncated at 500 lines — view full"`. The notice is **not** a renderer-owned banner; it's a 1-row body element. |
| **error** | Icon `octagon-x`, tone `--danger-fg`. Left rule `--danger-emphasis`. | Body is replaced by `<ToolErrorDisplay>`: `text.body` error message + `<details>` "View error" tab containing the raw stderr / exception payload. The shell still shows `copyText` (which now contains the error text). |
| **cancelled** | Icon `circle-slash-2`, tone `--neutral-fg`. Shell collapses to header-only by default (`defaultCollapsed: true`); body is omitted from the DOM until the user expands. | No body. |

> Renderers must accept `status` from props and **not** infer their own state from `content` / `success` ad-hoc. State derivation rules are listed in each renderer's row in §4.

---

## 7. Motion  <a id="motion"></a>

Per `00-globals §G5`. Renderer-specific clarifications:

- **Body expand/collapse** (shell chevron) — 180ms `cubic-bezier(0.2,0.6,0.2,1)`, animate `opacity` and `max-height` via `grid-template-rows: 0fr → 1fr` (CSS-grid trick avoids animating raw height). Reduced-motion: instant cross-fade ≤ 80ms.
- **Tab switch inside `#tabs`** — 120ms cross-fade on the body content; no slide.
- **Skeleton fade in pending state** — single 180ms fade on first render. **No infinite pulse.** No marquee. No scrolling text.
- **Match highlight** — `--syn-match` background appears with the row; never animated in.
- **Hover** — color/border only (`00-globals §G4`); never `transform`, never layout shift inside diff tables, terminal, or grep rows.

---

## 8. Accessibility  <a id="a11y"></a>

- **Code blocks** — every `CodeBlock` instance and every `<pre>` body wrapper carries `role="region"` and `aria-label="{language} code, {n} lines"` (e.g. `"TypeScript code, 42 lines"`). The language is inferred from the file extension or `args.language`; if unknown, use `"code"`.
- **Diffs** — every `+` line carries `aria-label="added"` and every `−` line `aria-label="removed"` (G1 `color-not-only`). The indicator column is `aria-hidden="true"` because the per-line label already conveys the meaning. Hunk headers use `role="separator"`.
- **Search hits** — pattern highlight spans carry `aria-label="match"` so a screen-reader user hears the match marker without seeing the color.
- **Copy buttons** — already part of the shell. Renderer responsibility: produce useful `copyText`. The shell announces "Copied" via the **global** aria-live region (`<div role="status" aria-live="polite">` mounted in the Conversation tab — see `12-conversation-tab.md §Live region`).
- **Click-to-open-file** — the file-path button has `aria-label="Open {path}{:line ? ' at line ' + line : ''}"`.
- **Tabs** — tab strip (`#tabs` slot) uses `role="tablist"` with `role="tab"` children and proper `aria-selected` / `aria-controls`; arrow-key cycles tabs.
- **Tables** (`SqlResultRenderer`) — defer to `<DataGrid>` (`02-primitives §DataGrid`), which provides `<th scope="col">`, sortable header buttons, and a row-count summary.
- **Status icons** — already labelled by the shell; renderers must not add a second status pill or ARIA label inside the body.

---

## 9. Anti-patterns to remove  <a id="anti"></a>

These are what migration removes, citing the audit clauses (CC-4 frame soup, CC-9 component duplication, plus `00-globals` G1/G3/G6).

### 9.1 · Per-renderer hand-rolled frames (CC-4 / CC-9)

Found today in **every** renderer:
- `ApplyPatchRenderer.vue` — `.patch-summary` re-implements a header strip with its own padding and a multi-stop `radial-gradient` background. **Delete:** the gradient violates `00-globals §G3`; the strip duplicates the shell header.
- `EditDiffRenderer.vue` — `.edit-diff-header` re-renders the file path *and* the diff-mode tabs as a sub-header. **Replace:** path → shell `primaryHint`; tabs → `#tabs` slot.
- `ShellOutputRenderer.vue` — `.shell-titlebar` paints fake macOS traffic lights with hex `#ff5f57` / `#febc2e` / `#28c840`. **Delete entirely** (G1 + G6: hex literals + ad-hoc icon set).
- `RendererShell.vue` (legacy state today) — its own `.renderer-shell-header` with an emoji "📋 Copy" / "✓ Copied" string. **Replace:** Lucide `clipboard` + global aria-live announcement (G1).
- `GrepResultRenderer.vue` / `EditDiffRenderer.vue` — emoji `📄` for the file icon. **Replace:** Lucide `file` (G1).
- `GrepResultRenderer.vue` — `.grep-stat` uses emoji `🔍`. **Replace:** Lucide `search`.

### 9.2 · Inconsistent corner radii & borders

- `ShellOutputRenderer.vue` hard-codes `border-radius: 0 0 6px 6px` on its inner container, then sits inside the shell which already supplies `--radius-md`. **Delete the inner radius** — the shell owns the outer corner.
- Several renderers set `border: 1px solid var(--border-muted)` on inner cards, producing a doubled hairline against the shell. **Use `--border-subtle` only between sub-sections, never around the body itself.**

### 9.3 · Mixed icon sources

- `ApplyPatchRenderer` uses text glyphs `+ / − / @@` for diff indicators (this is fine, they're punctuation, not iconography), but combines them with emoji file icons (not fine).
- `GrepResultRenderer` mixes emoji + Lucide depending on file. **Adopt Lucide everywhere, sized 16px in body rows, 14px in dense gutter contexts** (sub-16 only allowed inside line-num gutter context per `00-globals §G1` exception note).

### 9.4 · Hex literals in component CSS (G6)

The audit-flagged literals to replace:
- `ApplyPatchRenderer.vue` — `rgba(52, 211, 153, 0.09)`, `rgba(248, 113, 113, 0.07)`, `#34d399`, `#f87171`, `#fbbf24`, `#818cf8` → `--success-* / --danger-* / --warning-* / --accent-*` tokens.
- `EditDiffRenderer.vue` — `rgba(99, 102, 241, 0.15)`, `#fbbf24`, `#34d399`, `#f87171`, `#818cf8`, `rgba(251, 113, 133, 0.08)` → same tokens.
- `ShellOutputRenderer.vue` — every `#…` value in the `:root`-scoped fallback chain (`#0d1117`, `#161b22`, `#30363d`, `#c9d1d9`, …, `#ff5f57`, `#28c840`). **Delete the fallback chain entirely** — `tokens.css` is mandatory imports per `00-globals`.
- `GrepResultRenderer.vue` — `rgba(251, 191, 36, 0.04)`, `rgba(251, 191, 36, 0.25)`, `#fbbf24` → `--syn-match`, `--warning-subtle`.

### 9.5 · Decorative gradients (G3)

`ApplyPatchRenderer .patch-summary`'s twin `radial-gradient`s and `ShellOutputRenderer .shell-output`'s `linear-gradient(180deg, …)` background. **Both deleted** — solid `--canvas-inset` only.

### 9.6 · Inline emoji in body templates (G1)

`📄`, `🔍`, `📋`, `✓`, `⚠`, `❯` (the `❯` prompt is acceptable as Unicode punctuation — see G1 user-content carve-out — but only when it's inert chrome, not an icon). Replace `📋 Copy` / `✓ Copied` with Lucide `clipboard` / `check`.

### 9.7 · Local truncation banners

`RendererShell.vue` legacy `.renderer-shell-truncated` works today but the per-view spec moves the truncation notice **into the body** as a 1-row warning (see §6 `warning` row), and the "Show Full Output" button becomes a plain link inside that row. The shell stops owning truncation chrome; the renderer (knowing more about the data) decides whether to render it.

---

## 10. Acceptance checklist  <a id="acceptance"></a>

Run before considering the renderers migration "done".

### 10.1 · Structure

- [ ] Every file in `packages/ui/src/components/renderers/*Renderer.vue` (and every `*ArgsRenderer.vue`) imports and composes `<RendererShell>`. Lint regex `<RendererShell` must appear in every renderer template.
- [ ] No renderer defines its own `.renderer-shell-*` CSS class.
- [ ] No renderer renders its own `.copy`, `.expand`, `.retry`, `.truncated`, or `.error` chrome — those come from the shell.
- [ ] `iconName` per §4 matches the contract row exactly.
- [ ] `status` is sourced from props/derivation rules in §4 — no string parsing of `content` to infer state.

### 10.2 · Visual hygiene

- [ ] **No glassmorphism.** `rg "backdrop-filter" packages/ui/src/components/renderers` returns 0 hits.
- [ ] **No marketing gradients.** `rg "linear-gradient|radial-gradient" packages/ui/src/components/renderers` returns 0 hits.
- [ ] **No hex literals.** `rg "#[0-9a-fA-F]{3,8}" packages/ui/src/components/renderers/*.vue` returns 0 hits.
- [ ] **No emoji in templates.** `rg "[\u{1F300}-\u{1FAFF}]" packages/ui/src/components/renderers` returns 0 hits in `<template>` blocks (the `❯` prompt is a U+276F glyph, outside that range, and is allowed as inert punctuation in `ShellOutputRenderer`).
- [ ] All radii come from `--radius-md` on the shell; renderers do not declare `border-radius` on outer wrappers.
- [ ] All borders use `--border-subtle` (preferred) or `--border-muted` (sub-sections only).

### 10.3 · Tokens

- [ ] Every diff line uses `--success-* / --danger-* / --accent-*` tones; no inline rose/emerald rgba.
- [ ] Every code-coloring rule cites a `--syn-*` token; no `--text-*` used for syntax.
- [ ] Mono blocks use `var(--font-mono)`; no `'JetBrains Mono', 'Fira Code', monospace` inline stack.
- [ ] Tabular numerals enabled on diff line-num gutters, sql row counts, durations (`font-feature-settings: 'tnum' 1`).

### 10.4 · Interaction & states

- [ ] Each renderer correctly emits `load-full` upward when truncated.
- [ ] File-path buttons in body emit `open-file` with `{ path, line? }`.
- [ ] `cancelled` status renders header-only, body removed from DOM.
- [ ] `error` status routes to `<ToolErrorDisplay>` body with raw payload in a `View error` `<details>`.
- [ ] `pending` skeletons do not loop infinitely (`00-globals §G5`).

### 10.5 · Accessibility

- [ ] `aria-label="{lang} code, {n} lines"` on every code body.
- [ ] `aria-label="added" / "removed"` on diff lines (not color-only — G1).
- [ ] Pattern hits carry `aria-label="match"`.
- [ ] Tabs slot uses `role="tablist"` with arrow-key cycling.
- [ ] Copy success announced via global aria-live region (Conversation tab owns it; renderers do not mount a second one).

### 10.6 · Cross-references resolve

- [ ] Shell behaviour delegated to `02-primitives §RendererShell` (no re-statement here that contradicts it).
- [ ] Global keyboard shortcuts delegated to `12-conversation-tab.md` (this file does not define `Cmd+K`, `Cmd+L`, turn navigation).
- [ ] `<DataGrid>` used by `SqlResultRenderer` is the canonical `02-primitives §DataGrid`.
- [ ] `<EmptyState>` used by zero-result `grep` / `glob` is the canonical `02-primitives §EmptyState`.

---

*Renderers are the densest content surfaces in TracePilot. The contract is: **shell owns the frame, the renderer owns the payload.** Anything else is drift.*
