# Rich Tool Rendering — User Customization Research Report

> **Date:** 2025-07-17  
> **Status:** Research / RFC  
> **Audience:** TracePilot core contributors, UX design

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture Audit](#2-current-architecture-audit)
3. [Feasibility Analysis of User Customization](#3-feasibility-analysis-of-user-customization)
4. [User-Created Custom Renderers](#4-user-created-custom-renderers)
5. [Schema Mapping — Renderer Data Model](#5-schema-mapping--renderer-data-model)
6. [Proposed Configuration Schema](#6-proposed-configuration-schema)
7. [Implementation Roadmap](#7-implementation-roadmap)
8. [Security Considerations](#8-security-considerations)
9. [Recommendations](#9-recommendations)

---

## 1. Executive Summary

TracePilot's Rich Tool Rendering system is one of the most compelling features of the app — it turns raw JSON tool calls into syntax-highlighted diffs, terminal UIs, file trees, and source-card grids. The system currently ships **13 hardcoded renderers** with a master toggle and per-tool on/off preferences.

This report evaluates four approaches for opening this system to user customization, ranging from "enhanced preferences" (low effort, high value) to a full "visual component builder" (high effort, uncertain value). **Our recommendation is a phased approach:**

| Phase | What | Effort | Value |
|-------|------|--------|-------|
| 1 | Enhanced preferences (layout modes, max-height, collapse) | **Low** | **High** |
| 2 | Template-based custom renderers (JSON config) | **Medium** | **High** |
| 3 | Plugin/Extension API (`.js` modules) | **High** | **Medium** |
| 4 | Visual builder (drag-and-drop) | **Very High** | **Low** |

The visual builder (Phase 4) is **not recommended for the foreseeable future** — the engineering cost vastly outweighs demand, and template-based configs cover 90%+ of customization needs.

---

## 2. Current Architecture Audit

### 2.1 File Structure

```
packages/ui/src/components/renderers/
├── registry.ts                  # RendererEntry map + lookup helpers
├── ToolResultRenderer.vue       # Dispatcher — selects renderer or fallback
├── ToolArgsRenderer.vue         # Dispatcher — args in collapsible panel
├── RendererShell.vue            # Shared wrapper (header, copy, truncation)
├── CodeBlock.vue                # Syntax-highlighted code with line numbers
├── PlainTextRenderer.vue        # Monospace <pre> fallback
├── EditDiffRenderer.vue         # ← edit (unified/split diff, LCS, badges)
├── EditArgsRenderer.vue         # ← edit args (path + old_str/new_str)
├── ViewCodeRenderer.vue         # ← view (code highlight + directory detect)
├── CreateFileRenderer.vue       # ← create (new-file badge + code)
├── CreateArgsRenderer.vue       # ← create args
├── GrepResultRenderer.vue       # ← grep (grouped matches, pattern highlight)
├── GlobTreeRenderer.vue         # ← glob (collapsible file tree)
├── ShellOutputRenderer.vue      # ← powershell/read/write (terminal chrome)
├── SqlResultRenderer.vue        # ← sql (query highlight + data table)
├── WebSearchRenderer.vue        # ← web_search (markdown + source cards)
├── StoreMemoryRenderer.vue      # ← store_memory (memory card)
├── ReportIntentRenderer.vue     # ← report_intent (intent badge, args-only)
├── AskUserRenderer.vue          # ← ask_user (question + choices)
├── AskUserArgsRenderer.vue      # ← ask_user args
└── index.ts                     # Barrel export
```

### 2.2 Registration Contract

```ts
// registry.ts
interface RendererEntry {
  label: string;                    // Human-friendly name for settings UI
  resultComponent?: Component;       // Async Vue component for result body
  argsComponent?: Component;         // Async Vue component for arguments
  hideArgsWithRichResult?: boolean;  // Hide args when rich result is shown
}

const RENDERER_REGISTRY: Record<string, RendererEntry> = { ... };
```

Renderers are keyed by `toolName` as it appears in `TurnToolCall.toolName`. The registry is the **single source of truth** — the dispatcher (`ToolResultRenderer.vue`) calls `getRendererEntry(toolName)` and falls back to `PlainTextRenderer` when no match is found.

### 2.3 Renderer Props Contract

Every result renderer receives:

| Prop | Type | Description |
|------|------|-------------|
| `content` | `string` | Raw tool result text (may be truncated) |
| `args` | `Record<string, unknown>` | Parsed tool arguments via `getToolArgs()` |
| `tc` | `TurnToolCall` | Full tool call metadata (status, timing, etc.) |
| `isTruncated` | `boolean?` | Whether content was truncated at ~1KB |

Every args renderer receives:

| Prop | Type | Description |
|------|------|-------------|
| `args` | `Record<string, unknown>` | Parsed tool arguments |
| `tc` | `TurnToolCall` | Full tool call metadata |

### 2.4 Preference System

```ts
// tool-rendering.ts
interface ToolRenderingPreferences {
  enabled: boolean;                                           // Master toggle
  toolOverrides: Partial<Record<RichRenderableToolName, boolean>>;  // Per-tool on/off
}
```

Persisted in `config.toml` under `[toolRendering]`. The preferences store exposes:

- `isRichRenderingEnabled(toolName)` — returns `false` if master is off, else checks per-tool override
- `setToolRenderingOverride(toolName, enabled)` — sets per-tool override
- `resetToolRendering()` — resets to defaults

The settings UI (`SettingsToolVisualization.vue`) renders a toggle grid using `getRegisteredRenderers()`.

### 2.5 Building Blocks Available to Renderers

| Component | Purpose | Used By |
|-----------|---------|---------|
| `RendererShell` | Header bar, copy button, truncation notice, error boundary | All result renderers |
| `CodeBlock` | Syntax-highlighted code with line numbers, language badge | `view`, `create` |
| `PlainTextRenderer` | Monospace `<pre>` wrapper | Fallback |
| `MarkdownContent` | Rendered markdown | `read_agent`, `task` |

### 2.6 CSS Design Token System

All renderers use CSS custom properties for theming. Key token families:

```css
/* Canvas */
--canvas-default, --canvas-inset, --canvas-subtle

/* Text */
--text-primary, --text-secondary, --text-tertiary

/* Borders */
--border-muted, --border-subtle

/* Semantic */
--accent-fg, --accent-emphasis, --accent-muted
--success-fg, --success-subtle
--warning-fg, --warning-subtle
--danger-fg, --danger-muted, --danger-subtle

/* Syntax highlighting */
--syn-keyword, --syn-type, --syn-string, --syn-number,
--syn-func, --syn-const, --syn-param, --syn-tag, --syn-attr,
--syn-prop, --syn-regex, --syn-match

/* Layout */
--radius-md, --radius-sm
```

---

## 3. Feasibility Analysis of User Customization

### 3.1 Per-Tool Toggle (Already Exists ✅)

**Status:** Fully implemented.

Users can already toggle renderers on/off per tool in Settings → Tool Visualization. The UI presents a grid of switches, one per registered renderer. Disabled tools fall back to `PlainTextRenderer`.

### 3.2 Layout Customization (Compact vs. Expanded)

**Feasibility: High** — Estimated effort: **Low (2-3 days)**

The architecture naturally supports this. Key observation: most renderers already have hardcoded `max-height` values (e.g., `max-height: 500px` on `.edit-diff-body`, `max-height: 400px` on `.sql-table-wrap`). These should be configurable.

**Proposed additions to `ToolRenderingPreferences`:**

```ts
interface ToolRenderingPreferences {
  enabled: boolean;
  toolOverrides: Partial<Record<RichRenderableToolName, boolean>>;

  // NEW — Phase 1
  layout: 'default' | 'compact' | 'expanded';
  maxResultHeight: number;           // px, 0 = unlimited. Default: 500
  collapseByDefault: boolean;        // Default: false
  showToolArgs: 'collapsed' | 'expanded' | 'hidden';
}
```

**Implementation approach:**

1. Add layout preference refs to the preferences store
2. Pass them down to `RendererShell` as props or provide/inject
3. `RendererShell` applies corresponding CSS classes:
   - `compact`: smaller padding, reduced font size, tighter line-height
   - `expanded`: no max-height, larger type
4. Individual renderers read `maxResultHeight` from context

**Example `RendererShell` enhancement:**

```vue
<script setup lang="ts">
import { inject } from 'vue';

const layoutMode = inject<'default' | 'compact' | 'expanded'>('renderer-layout', 'default');
const maxHeight = inject<number>('renderer-max-height', 500);
</script>

<template>
  <div :class="['renderer-shell', `renderer-shell--${layoutMode}`]">
    <div class="renderer-shell-body" :style="{ maxHeight: maxHeight ? maxHeight + 'px' : 'none' }">
      <slot />
    </div>
  </div>
</template>
```

### 3.3 Field Reordering / Prioritization

**Feasibility: Medium** — Estimated effort: **Medium (1 week)**

This is relevant for renderers that display multiple sections (e.g., `SqlResultRenderer` shows Query + Result Table, `ShellOutputRenderer` shows Command Bar + Output Body).

**Approach:** Each renderer defines named "sections" and the user config specifies which sections are visible and in what order.

```ts
// Per-tool section config
interface RendererSectionConfig {
  sections: string[];               // Ordered list of visible section IDs
  // e.g., for 'sql': ['query', 'table'] or ['table'] (hide query)
  // e.g., for 'powershell': ['command', 'output'] or ['output'] (hide command bar)
}
```

This requires each renderer to export its section names — a refactor, but not a heavy one. Renderers would use `v-if` checks against the provided section list.

**Verdict:** Useful but niche. Defer to Phase 2 unless there's strong user demand.

### 3.4 Theming / Color Customization Per Renderer

**Feasibility: High** — Estimated effort: **Low-Medium (3-5 days)**

The existing CSS custom property system makes this straightforward. Users could override token values per-renderer or globally.

**Approach A — Global syntax token overrides (simplest):**

Users override the `--syn-*` and `--term-*` variables in a custom CSS block:

```css
/* User's custom overrides */
:root[data-theme="dark"] {
  --syn-keyword: #ff79c6;  /* Dracula purple → pink */
  --syn-string: #50fa7b;
}
```

This could be exposed as a "Syntax Theme" dropdown with presets (Dracula, Monokai, Solarized, etc.) plus a "Custom" option with individual color pickers.

**Approach B — Per-renderer CSS variable scoping:**

```css
/* Override just for terminal renderers */
.shell-output {
  --term-bg: #1a1b26;
  --term-success: #9ece6a;
}
```

**Verdict:** Global syntax theme presets are low-hanging fruit and high-value. Per-renderer overrides are possible but add UI complexity.

---

## 4. User-Created Custom Renderers

This section evaluates four approaches for letting users create renderers for **new** tool names (e.g., MCP tools, custom skill tools) that don't ship with built-in renderers.

### 4.1 Approach A: Template-Based System

**Concept:** Pre-built layout templates (card, table, terminal, code, list) that users configure with field bindings.

**How it works:**

1. User selects a layout template from a palette
2. User maps data fields (`content`, `args.query`, `tc.success`, etc.) to template slots
3. Configuration is saved as JSON in `config.toml` or a sidecar file
4. At runtime, a `DynamicRenderer` component reads the config and renders accordingly

**Example configuration:**

```json
{
  "toolName": "my_api_call",
  "label": "API Response",
  "template": "card",
  "sections": [
    {
      "type": "key-value",
      "title": "Request",
      "fields": [
        { "label": "Method", "binding": "args.method", "style": "badge" },
        { "label": "URL", "binding": "args.url", "style": "monospace" }
      ]
    },
    {
      "type": "code",
      "title": "Response Body",
      "binding": "content",
      "language": "json",
      "maxHeight": 300
    }
  ],
  "headerBadge": {
    "binding": "tc.success",
    "trueText": "200 OK",
    "trueColor": "success",
    "falseText": "Error",
    "falseColor": "danger"
  }
}
```

**Available template types:**

| Template | Renders As | Best For |
|----------|-----------|----------|
| `card` | RendererShell with key-value pairs, badges | Simple tools with a few fields |
| `table` | Tabular data display (like SqlResultRenderer) | Tools returning structured JSON arrays |
| `terminal` | Terminal chrome with semantic line coloring | CLI/shell-like tools |
| `code` | CodeBlock with language detection | Tools returning source code |
| `list` | Scrollable list with icons | Tools returning file/item lists |
| `markdown` | Rendered markdown content | Tools returning rich text |
| `key-value` | Two-column key/value pairs | Simple metadata display |

**Section primitives (composable within templates):**

| Primitive | Description |
|-----------|-------------|
| `text` | Plain text or monospace display |
| `code` | Syntax-highlighted code block |
| `table` | Data table from JSON arrays |
| `badge` | Inline status badge |
| `key-value` | Label → value pairs |
| `divider` | Horizontal separator |
| `conditional` | Show/hide based on a binding value |

**Pros:**
- Declarative — no code to write
- Safe — no XSS vectors (all bindings are escaped)
- Serializable — easy to share, version-control, export/import
- Covers 80-90% of use cases

**Cons:**
- Can't express complex logic (word-level diffs, tree construction, regex highlighting)
- Template palette must be maintained
- Learning curve for binding syntax

**Estimated effort: Medium (2-3 weeks)**

**Verdict: ✅ Recommended as the primary customization path.**

### 4.2 Approach B: Visual Component Builder (Drag & Drop)

**Concept:** A WYSIWYG editor where users drag primitive blocks onto a canvas, bind them to data fields, and preview the result.

**How it works:**

1. Canvas-based editor with a left sidebar of available blocks (text, code, table, badge, icon, divider)
2. Each block has a properties panel: data binding, styling, visibility conditions
3. Blocks can be nested within containers (rows, columns, cards)
4. Live preview with sample data from a recent tool call
5. Generates and saves the same JSON config as Approach A

**Required engineering:**

- Custom drag-and-drop framework (or integrate `vue-draggable-plus`)
- Canvas layout engine with grid/flex positioning
- Block property inspector panel
- Live preview with data injection
- Undo/redo stack
- Responsive layout handling
- Serialization/deserialization of visual layout → JSON config

**Pros:**
- Most intuitive for non-technical users
- Visual feedback loop
- Impressive demo/marketing value

**Cons:**
- Enormous engineering effort (8-12 weeks minimum)
- Complex UX edge cases (responsive layouts, overflow, nesting)
- Still limited by the same primitive set as Approach A
- Generates the exact same output as a JSON config — users who'd use a builder are unlikely to need custom renderers at all
- Maintenance burden: every new primitive needs a designer + editor integration

**Estimated effort: Very High (8-12 weeks)**

**Verdict: ❌ Not recommended.** The cost/benefit ratio is poor. Users sophisticated enough to want custom renderers can write JSON configs. Users who can't write JSON configs don't need custom renderers — they can use the built-in ones. A visual builder is solving a problem that doesn't exist for our user base (developers and dev-tool power users).

### 4.3 Approach C: Custom CSS/Markdown Templates

**Concept:** Users write a simple template string with mustache-style bindings and optional CSS.

**How it works:**

```yaml
# ~/.tracepilot/renderers/my_tool.yaml
toolName: my_custom_tool
label: "Custom Tool"
template: |
  <div class="custom-tool">
    <h3>{{args.title}}</h3>
    <pre>{{content}}</pre>
    {{#if tc.success}}
      <span class="badge-success">✓ Done</span>
    {{/if}}
  </div>
css: |
  .custom-tool { padding: 10px; }
  .badge-success { color: var(--success-fg); }
```

**Pros:**
- Flexible — users can express arbitrary layouts
- Familiar syntax (Mustache/Handlebars)
- CSS allows unlimited visual control

**Cons:**
- **XSS risk**: Raw template interpolation with `content` that may include user-controlled data requires careful sanitization
- No component reuse — can't use `CodeBlock`, `RendererShell`, etc.
- CSS conflicts with app styles
- No Vue reactivity — static render only
- Harder to validate/lint

**Estimated effort: Medium (2-3 weeks)**

**Verdict: ⚠️ Not recommended as primary path.** The XSS surface area is concerning for a desktop app that renders arbitrary agent output. The template-based system (Approach A) is safer and more structured. However, a scoped "Custom CSS" text area for advanced users could be a nice power-user escape hatch layered on top of Approach A.

### 4.4 Approach D: Plugin/Extension API

**Concept:** Users write actual JavaScript/TypeScript modules that export a Vue render function or SFC. Loaded at runtime via dynamic import.

**How it works:**

```ts
// ~/.tracepilot/plugins/my-renderer.js
export default {
  toolName: 'my_custom_tool',
  label: 'My Custom Tool',
  render(h, { content, args, tc }) {
    return h('div', { class: 'my-renderer' }, [
      h('h3', {}, args.title),
      h('pre', {}, content),
    ]);
  }
};
```

**Runtime loading:**

```ts
// In the app
async function loadUserRenderers() {
  const pluginDir = await resolvePluginDir();
  const files = await readDir(pluginDir);
  for (const file of files) {
    if (file.endsWith('.js')) {
      const mod = await import(/* @vite-ignore */ `file://${file}`);
      registerDynamicRenderer(mod.default.toolName, mod.default);
    }
  }
}
```

**Pros:**
- Maximum flexibility — can express any UI logic
- Can import shared building blocks (`RendererShell`, `CodeBlock`)
- Familiar to developers
- Natural extension point for a plugin ecosystem

**Cons:**
- **Security: severe** — arbitrary JS execution in the app context. Can access Tauri APIs, IPC, filesystem.
- Requires sandboxing (iframe sandbox, Web Worker, or Tauri's isolated context)
- Module loading complexity (ESM in Tauri webview, path resolution)
- Vue version coupling — plugins break on Vue upgrades
- Error isolation — a bad plugin crashes the whole UI

**Sandboxing strategies:**

1. **`<iframe sandbox>`** — render plugin in a sandboxed iframe. Communicates via `postMessage`. Isolated from app DOM, Tauri APIs, and store. **Most secure**, but complex to implement and loses access to design tokens.

2. **Restricted eval with proxy** — execute plugin code in a `new Function()` scope with a proxied `h()` that only allows whitelisted elements/attributes. Medium security — can't prevent all escape vectors.

3. **WASM sandbox** — compile user code to WASM and run in an isolated memory space. Overkill for this use case.

**Estimated effort: High (4-6 weeks with sandboxing)**

**Verdict: ⚠️ Recommended for Phase 3, but only with iframe sandboxing.** This is the right long-term architecture for a plugin ecosystem, but it's premature until we have concrete demand from MCP tool authors who need renderers beyond what templates can express.

---

## 5. Schema Mapping — Renderer Data Model

### 5.1 TurnToolCall Interface (Full Schema)

This is the complete data available to every renderer:

```ts
interface TurnToolCall {
  // ── Identity ──
  toolCallId?: string;              // Unique ID for this invocation
  parentToolCallId?: string;        // Parent subagent's tool call ID
  toolName: string;                 // e.g., "edit", "grep", "my_mcp_tool"
  eventIndex?: number;              // Position in event stream

  // ── Arguments ──
  arguments?: unknown;              // Raw JSON — narrowed via getToolArgs()
  argsSummary?: string;             // Server-computed short summary

  // ── Result ──
  resultContent?: string;           // Truncated preview (≤1KB)
  // Full content loaded on demand via getToolResult() IPC

  // ── Status ──
  success?: boolean;                // true = succeeded, false = error
  error?: string;                   // Error message if failed
  isComplete: boolean;              // false while still executing

  // ── Timing ──
  startedAt?: string;               // ISO timestamp
  completedAt?: string;             // ISO timestamp
  durationMs?: number;              // Execution duration

  // ── MCP metadata ──
  mcpServerName?: string;           // MCP server that provided this tool
  mcpToolName?: string;             // Tool name within the MCP server

  // ── Subagent metadata ──
  isSubagent?: boolean;
  agentDisplayName?: string;        // e.g., "Explore Agent"
  agentDescription?: string;
  model?: string;                   // Model used for this call
  totalTokens?: number;             // Tokens consumed by subagent
  totalToolCalls?: number;          // Nested tool call count

  // ── AI-generated ──
  intentionSummary?: string;        // AI summary of what this call does
}
```

### 5.2 Tool Arguments by Tool Type

Each tool has a characteristic argument shape. This is what users would bind to in custom renderers:

| Tool | Key Arguments | Notes |
|------|--------------|-------|
| `edit` | `path: string`, `old_str: string`, `new_str: string` | Both `old_str` and `new_str` present for replace; only `old_str` for delete |
| `view` | `path: string`, `view_range?: [number, number]` | `view_range[1] = -1` means "to end" |
| `create` | `path: string`, `file_text: string` | |
| `grep` | `pattern: string`, `output_mode?: string`, `path?: string`, `glob?: string` | `output_mode`: "content" / "files_with_matches" / "count" |
| `glob` | `pattern: string`, `path?: string` | |
| `powershell` | `command: string`, `description?: string`, `mode?: string` | `mode`: "sync" / "async" |
| `read_powershell` | `shellId: string`, `delay?: number` | |
| `write_powershell` | `shellId: string`, `input?: string`, `delay?: number` | |
| `sql` | `query: string`, `description?: string` | |
| `web_search` | `query: string` | |
| `store_memory` | `fact: string`, `subject?: string`, `category?: string`, `reason?: string` | |
| `report_intent` | `intent: string` | |
| `ask_user` | `question: string`, `choices?: string[]`, `allow_freeform?: boolean` | |

### 5.3 Binding Expression Language

For template-based renderers, bindings follow a dot-notation path:

```
content              → raw result string
args.fieldName       → args["fieldName"]
args.nested.field    → args["nested"]["field"]
tc.success           → TurnToolCall.success
tc.durationMs        → TurnToolCall.durationMs
tc.toolName          → TurnToolCall.toolName
tc.mcpServerName     → TurnToolCall.mcpServerName
tc.error             → TurnToolCall.error
```

**Type coercion rules:**

- All bindings resolve to `string | number | boolean | null | undefined`
- Arrays and objects are JSON-stringified for display in text/badge contexts
- The `table` section type expects `content` to be a JSON array of objects

---

## 6. Proposed Configuration Schema

### 6.1 Enhanced Preferences Schema (Phase 1)

Extension to the existing `ToolRenderingPreferences`:

```ts
interface ToolRenderingPreferences {
  // Existing
  enabled: boolean;
  toolOverrides: Partial<Record<RichRenderableToolName, boolean>>;

  // Phase 1 additions
  layout: 'default' | 'compact' | 'expanded';
  maxResultHeight: number;        // px, 0 = unlimited. Default: 500
  collapseResultsByDefault: boolean;  // Default: false
  argsDisplay: 'collapsed' | 'expanded' | 'hidden';  // Default: 'collapsed'
  syntaxTheme: string;            // 'default' | 'dracula' | 'monokai' | ... | 'custom'
  customSyntaxTokens?: Record<string, string>;  // --syn-keyword → "#ff79c6"
}
```

### 6.2 Custom Renderer Configuration Schema (Phase 2)

```ts
/** A user-defined renderer configuration stored in config or a sidecar file. */
interface CustomRendererConfig {
  /** The tool name this renderer handles (must not conflict with built-ins). */
  toolName: string;

  /** Human-readable label for the settings UI. */
  label: string;

  /** Optional icon emoji or unicode symbol. */
  icon?: string;

  /** The primary layout template. */
  layout: 'card' | 'table' | 'terminal' | 'code' | 'list' | 'markdown';

  /** Ordered list of sections to render. */
  sections: CustomRendererSection[];

  /** Optional header badge configuration. */
  headerBadge?: BadgeConfig;

  /** Optional custom CSS (scoped to this renderer). */
  customCss?: string;
}

type CustomRendererSection =
  | TextSection
  | CodeSection
  | TableSection
  | KeyValueSection
  | BadgeRowSection
  | DividerSection
  | ConditionalSection;

interface TextSection {
  type: 'text';
  title?: string;
  binding: string;           // e.g., "content" or "args.message"
  style?: 'default' | 'monospace' | 'muted';
  maxHeight?: number;
}

interface CodeSection {
  type: 'code';
  title?: string;
  binding: string;           // Binding that resolves to the code string
  language?: string;         // Override language detection
  languageBinding?: string;  // e.g., "args.language"
  filePathBinding?: string;  // e.g., "args.path" for auto-detection
  maxLines?: number;
  showLineNumbers?: boolean;
}

interface TableSection {
  type: 'table';
  title?: string;
  binding: string;           // Must resolve to JSON array of objects
  maxRows?: number;
  maxHeight?: number;
  stickyHeader?: boolean;
}

interface KeyValueSection {
  type: 'key-value';
  title?: string;
  fields: Array<{
    label: string;
    binding: string;
    style?: 'default' | 'monospace' | 'badge' | 'link';
    fallback?: string;       // Shown when binding resolves to null/undefined
  }>;
}

interface BadgeRowSection {
  type: 'badge-row';
  badges: BadgeConfig[];
}

interface DividerSection {
  type: 'divider';
}

interface ConditionalSection {
  type: 'conditional';
  /** Show this section only when the binding is truthy. */
  showWhen: string;          // e.g., "tc.success" or "args.verbose"
  /** Negate the condition. */
  negate?: boolean;
  /** The section to conditionally render. */
  section: CustomRendererSection;
}

interface BadgeConfig {
  binding?: string;          // Dynamic text from binding
  text?: string;             // Static text (used when binding is absent)
  color: 'accent' | 'success' | 'warning' | 'danger' | 'muted';
  /** For boolean bindings: map true/false to different labels. */
  trueText?: string;
  falseText?: string;
  trueColor?: string;
  falseColor?: string;
}
```

### 6.3 Full Config Example — Custom MCP Tool Renderer

```json
{
  "toolName": "database_query",
  "label": "Database Query",
  "icon": "🗄️",
  "layout": "card",
  "sections": [
    {
      "type": "badge-row",
      "badges": [
        {
          "binding": "tc.mcpServerName",
          "color": "muted"
        },
        {
          "binding": "tc.success",
          "trueText": "OK",
          "trueColor": "success",
          "falseText": "Failed",
          "falseColor": "danger"
        }
      ]
    },
    {
      "type": "code",
      "title": "Query",
      "binding": "args.query",
      "language": "sql",
      "showLineNumbers": false
    },
    {
      "type": "divider"
    },
    {
      "type": "conditional",
      "showWhen": "tc.success",
      "section": {
        "type": "table",
        "title": "Results",
        "binding": "content",
        "maxRows": 100,
        "maxHeight": 400,
        "stickyHeader": true
      }
    },
    {
      "type": "conditional",
      "showWhen": "tc.success",
      "negate": true,
      "section": {
        "type": "text",
        "title": "Error",
        "binding": "tc.error",
        "style": "monospace"
      }
    }
  ],
  "headerBadge": {
    "binding": "args.database",
    "color": "accent"
  }
}
```

### 6.4 Storage Location

Custom renderer configs should live in:

```
~/.tracepilot/renderers/
├── database_query.json
├── my_api_call.json
└── custom_search.json
```

Or inline in `config.toml`:

```toml
[[customRenderers]]
toolName = "database_query"
label = "Database Query"
# ... (TOML is verbose for this; prefer sidecar JSON files)
```

**Recommendation:** Sidecar JSON files in `~/.tracepilot/renderers/`. Scanned on app launch. Hot-reloadable via file watcher.

---

## 7. Implementation Roadmap

### Phase 1: Enhanced Preferences (2-3 weeks)

**Goal:** Give users control over layout density, height limits, collapse behavior, and syntax colors without touching individual renderers.

| Task | Effort | Description |
|------|--------|-------------|
| Extend `ToolRenderingPreferences` type | S | Add `layout`, `maxResultHeight`, `collapseResultsByDefault`, `argsDisplay`, `syntaxTheme` |
| Update preferences store | S | Wire new fields through `applyConfig` / `buildConfig` |
| Update `RendererShell` | M | Accept layout mode, apply CSS class variants |
| Create syntax theme presets | M | Define 4-5 preset token maps (default, dracula, monokai, solarized, github) |
| Build settings UI section | M | Layout dropdown, max-height slider, collapse toggle, theme picker |
| Provide/inject layout context | S | `provide('renderer-layout', ...)` at the conversation level |
| Update config.toml schema on Rust side | S | Add new fields with defaults to `ToolRenderingConfig` |

**Deliverables:**
- Layout mode selector (compact/default/expanded)
- Max result height slider (200px – unlimited)
- Collapse-by-default toggle
- Args display mode (collapsed/expanded/hidden)
- Syntax theme picker with 5 presets + custom token editor

### Phase 2: Template-Based Custom Renderers (3-4 weeks)

**Goal:** Allow users to define renderers for MCP and custom tools using JSON configuration files.

| Task | Effort | Description |
|------|--------|-------------|
| Define `CustomRendererConfig` types | S | TypeScript interfaces as specified in §6.2 |
| Build `DynamicRenderer.vue` | L | Generic Vue component that interprets a `CustomRendererConfig` and renders sections |
| Build section sub-renderers | M | `DynamicTextSection`, `DynamicCodeSection`, `DynamicTableSection`, etc. |
| Implement binding resolver | M | `resolveBinding(path, { content, args, tc })` with safe dot-path traversal |
| JSON schema + validation | S | Validate user configs on load, surface errors in settings UI |
| File watcher for hot-reload | S | Watch `~/.tracepilot/renderers/` for changes, reload registry |
| Extend `RENDERER_REGISTRY` to support dynamic entries | M | `registerDynamicRenderer()` / `unregisterDynamicRenderer()` |
| Settings UI for managing custom renderers | M | List, edit JSON, preview, delete |
| Sample configs for common MCP tools | S | Ship 2-3 examples as documentation |
| IPC: Rust-side directory resolution + file reads | S | `get_custom_renderers` command |

**Deliverables:**
- Users can drop `.json` files into `~/.tracepilot/renderers/`
- New tools automatically get rich rendering
- Settings UI shows list of custom renderers with enable/disable toggles
- Live preview with sample data from a recent tool call
- Validation errors surfaced clearly

### Phase 3: Plugin/Extension API (4-6 weeks)

**Goal:** Allow advanced users to write JavaScript renderer modules loaded at runtime in an isolated context.

| Task | Effort | Description |
|------|--------|-------------|
| Define plugin manifest format | S | `manifest.json` with `toolName`, `label`, `entryPoint`, `permissions` |
| Implement iframe sandbox renderer | L | `PluginRendererHost.vue` creates sandboxed iframe, injects data via `postMessage` |
| Plugin SDK | M | `@tracepilot/renderer-sdk` package with helpers, type definitions, CSS token values |
| Design token bridge | M | Inject CSS custom properties into sandbox iframe |
| Error boundary + crash isolation | M | Catch errors, show fallback, don't crash app |
| Plugin manager UI | M | Install, enable/disable, view source, remove |
| Documentation + starter template | S | Cookiecutter template for new plugins |
| Permissions model | M | Declare which data fields a plugin can access |

**Deliverables:**
- Users can write `.js` renderer plugins
- Plugins run in isolated iframes with no access to app state
- CSS design tokens are bridged for consistent theming
- Plugin crashes don't affect the app
- CLI command: `tracepilot plugin init my-renderer`

### Phase 4: Visual Builder (NOT RECOMMENDED)

Included for completeness. If ever pursued:

| Task | Effort | Description |
|------|--------|-------------|
| Drag-and-drop canvas framework | XL | Custom or vue-draggable integration |
| Block palette + properties panel | L | UI for each primitive type |
| Layout engine | L | Grid/flex positioning with constraints |
| Canvas → JSON serialization | M | Generate `CustomRendererConfig` from visual layout |
| Live preview | M | Side-by-side preview with real data |
| Undo/redo | M | Command stack |
| Responsive behavior | L | Handle different panel widths |

**Estimated total: 8-12 weeks. Not recommended.**

---

## 8. Security Considerations

### 8.1 XSS in Template Bindings

**Risk: Medium** (Phase 2 templates)

Tool result `content` is controlled by the AI agent, which in turn processes user-controlled input and arbitrary web content. If a binding like `{{content}}` is rendered as raw HTML, an attacker could inject `<script>` tags via crafted tool results.

**Mitigation:**
- All binding interpolation MUST use `textContent` (not `innerHTML`)
- The `DynamicRenderer` should NEVER use `v-html` with user bindings
- HTML in `customCss` is scoped via `<style scoped>` equivalent (CSS-only, no `<script>` or HTML elements)
- Implement a CSS sanitizer that strips `url()`, `@import`, and `expression()` from custom CSS

**Implementation:**

```ts
function resolveBinding(path: string, context: RendererContext): string {
  const raw = getNestedValue(context, path);
  if (raw == null) return '';
  return String(raw);  // Always coerce to string — never pass objects to template
}

// In template:
// <span>{{ resolvedValue }}</span>  ← Vue's {{ }} already escapes HTML
// NEVER: <span v-html="resolvedValue">
```

### 8.2 Plugin Sandboxing (Phase 3)

**Risk: High** without sandboxing

A malicious or buggy plugin with access to the Tauri webview can:
- Access `window.__TAURI__` APIs (filesystem, shell, process)
- Read/write the app's Pinia stores
- Exfiltrate data via `fetch()` to external servers
- Modify DOM of the host application

**Required sandboxing:**

```html
<iframe
  sandbox="allow-scripts"
  src="plugin-host.html"
  style="border: none; width: 100%; height: 100%;"
></iframe>
```

The `sandbox` attribute without `allow-same-origin` ensures:
- ❌ No access to parent window (`window.parent` throws)
- ❌ No access to Tauri APIs
- ❌ No access to parent document DOM
- ❌ No cookie/localStorage access from parent origin
- ✅ JavaScript execution within the iframe
- ✅ CSS styling within the iframe

**Data flow:**

```
Host App                          Sandboxed iframe
─────────                         ──────────────────
PluginRendererHost.vue            plugin-host.html
  │                                 │
  ├── postMessage({                 │
  │     type: 'render',             │
  │     content, args, tc,          ├── window.onmessage
  │     tokens: { ... }             │     → call plugin.render()
  │   })                            │     → update DOM
  │                                 │
  ├── ResizeObserver ←──────────────┤── postMessage({ type: 'resize', height })
  │                                 │
```

### 8.3 Custom CSS Injection

**Risk: Low-Medium**

Custom CSS (`customCss` in Phase 2) could:
- Use `url()` to make external network requests (privacy leak)
- Use `@import` to load external stylesheets
- Use `expression()` (IE-only, not relevant for WebKit)
- Affect elements outside the renderer via non-scoped selectors

**Mitigation:**
- Scope all custom CSS by prepending a unique class: `.custom-renderer-[toolName] { ... }`
- Strip `url()`, `@import`, `expression()`, and `javascript:` from CSS values
- Limit CSS properties to a safe allowlist (optional, may be too restrictive)

```ts
function sanitizeCustomCss(css: string, scopeClass: string): string {
  // Remove dangerous constructs
  let safe = css
    .replace(/@import\b[^;]+;/gi, '/* @import stripped */')
    .replace(/url\s*\([^)]*\)/gi, '/* url() stripped */')
    .replace(/expression\s*\([^)]*\)/gi, '/* expression() stripped */');

  // Scope all selectors
  return safe.replace(
    /([^{}]+)\{/g,
    (_, selector) => `.${scopeClass} ${selector.trim()} {`
  );
}
```

### 8.4 Data Access Boundaries

Renderers should NOT have access to:
- Other sessions' data
- Application configuration (API keys, paths)
- Tauri IPC commands
- Other tool calls in the same turn (unless explicitly provided)

Custom renderers (both template and plugin) receive ONLY:
- `content: string` — this specific tool call's result
- `args: Record<string, unknown>` — this tool call's arguments
- `tc: TurnToolCall` — this tool call's metadata (minus `resultContent` to avoid duplication)

The `tc` object should be filtered before passing to plugins:

```ts
function sanitizeTcForPlugin(tc: TurnToolCall): Partial<TurnToolCall> {
  return {
    toolCallId: tc.toolCallId,
    toolName: tc.toolName,
    success: tc.success,
    error: tc.error,
    durationMs: tc.durationMs,
    mcpServerName: tc.mcpServerName,
    mcpToolName: tc.mcpToolName,
    isComplete: tc.isComplete,
    isSubagent: tc.isSubagent,
    agentDisplayName: tc.agentDisplayName,
    model: tc.model,
    intentionSummary: tc.intentionSummary,
    // Omit: arguments (provided separately), resultContent (provided as content),
    //       parentToolCallId, eventIndex (internal IDs)
  };
}
```

---

## 9. Recommendations

### What to Build

| Priority | Feature | Approach | Effort | Impact |
|----------|---------|----------|--------|--------|
| **P0** | Layout mode (compact/default/expanded) | Phase 1 | Low | High — every user benefits |
| **P0** | Max result height + collapse-by-default | Phase 1 | Low | High — addresses "too much output" pain |
| **P0** | Syntax theme presets | Phase 1 | Low | Medium — differentiates from plain editors |
| **P1** | Template-based custom renderers | Phase 2 | Medium | High — unlocks MCP ecosystem |
| **P1** | Args display mode (collapsed/expanded/hidden) | Phase 1 | Low | Medium — power-user preference |
| **P2** | Plugin API (iframe-sandboxed) | Phase 3 | High | Medium — long-tail power users |
| **P3** | Visual builder | Phase 4 | Very High | Low — not worth the investment |

### What NOT to Build

1. **Visual drag-and-drop builder** — Engineering cost is 8-12 weeks for a feature that serves ~1% of users. The template JSON system is more than sufficient.

2. **Unsandboxed plugin execution** — Never allow user code to run in the main webview context. The iframe sandbox is non-negotiable.

3. **Per-renderer CSS override UI** — Overly granular. Global syntax themes + scoped `customCss` on custom renderers is enough.

### Architecture Decision: DynamicRenderer Component

The `DynamicRenderer.vue` component is the linchpin of Phase 2. Its design must be:

```vue
<script setup lang="ts">
import type { CustomRendererConfig } from '@tracepilot/types';
import type { TurnToolCall } from '@tracepilot/types';
import { computed } from 'vue';
import RendererShell from './RendererShell.vue';
import { resolveBinding } from './dynamicBindings';

const props = defineProps<{
  config: CustomRendererConfig;
  content: string;
  args: Record<string, unknown>;
  tc: TurnToolCall;
  isTruncated?: boolean;
}>();

const context = computed(() => ({
  content: props.content,
  args: props.args,
  tc: props.tc,
}));

function resolve(binding: string): unknown {
  return resolveBinding(binding, context.value);
}
</script>

<template>
  <RendererShell
    :label="config.icon ? `${config.icon} ${config.label}` : config.label"
    :copy-content="content"
    :is-truncated="isTruncated"
  >
    <component
      v-for="(section, idx) in config.sections"
      :key="idx"
      :is="getSectionComponent(section.type)"
      :section="section"
      :resolve="resolve"
      :context="context"
    />
  </RendererShell>
</template>
```

This reuses `RendererShell` (header, copy, truncation) and delegates each section to a dedicated sub-component, keeping the architecture consistent with existing renderers.

### Trade-off Summary

| Dimension | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|-----------|---------|---------|---------|---------|
| User skill required | None | JSON literacy | JavaScript | None |
| Expressiveness | Low | Medium-High | Unlimited | Medium |
| Security risk | None | Low | Medium (sandboxed) | Low |
| Maintenance cost | Low | Low-Medium | Medium | Very High |
| Time to value | 2-3 weeks | 5-7 weeks (cumul.) | 9-13 weeks (cumul.) | 17-25 weeks |

### Final Recommendation

**Ship Phase 1 immediately** — it's low-effort, high-impact, and benefits every user. **Commit to Phase 2** once MCP tool usage grows and users request custom renderers. **Design Phase 3 but don't build it yet** — document the plugin API contract so early adopters can prepare, but defer implementation until there's concrete demand.

**Skip Phase 4 entirely.** A visual builder is a product in itself, not a feature.
