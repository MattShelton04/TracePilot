<script setup lang="ts">
/**
 * RendererShowcaseView — dev-only page that renders every registered tool
 * renderer with hardcoded sample data, side-by-side, for visual QA.
 *
 * Navigate to /#/dev/renderers in dev mode.
 */
import type { TurnToolCall } from "@tracepilot/types";
import { PageHeader, PageShell } from "@tracepilot/ui";
import { defineAsyncComponent, ref } from "vue";

// ── Async-import each renderer directly (bypasses registry dispatch) ──
const EditDiffRenderer = defineAsyncComponent(
  () => import("@tracepilot/ui/src/components/renderers/EditDiffRenderer.vue"),
);
const EditArgsRenderer = defineAsyncComponent(
  () => import("@tracepilot/ui/src/components/renderers/EditArgsRenderer.vue"),
);
const ViewCodeRenderer = defineAsyncComponent(
  () => import("@tracepilot/ui/src/components/renderers/ViewCodeRenderer.vue"),
);
const CreateFileRenderer = defineAsyncComponent(
  () => import("@tracepilot/ui/src/components/renderers/CreateFileRenderer.vue"),
);
const CreateArgsRenderer = defineAsyncComponent(
  () => import("@tracepilot/ui/src/components/renderers/CreateArgsRenderer.vue"),
);
const GrepResultRenderer = defineAsyncComponent(
  () => import("@tracepilot/ui/src/components/renderers/GrepResultRenderer.vue"),
);
const GlobTreeRenderer = defineAsyncComponent(
  () => import("@tracepilot/ui/src/components/renderers/GlobTreeRenderer.vue"),
);
const ShellOutputRenderer = defineAsyncComponent(
  () => import("@tracepilot/ui/src/components/renderers/ShellOutputRenderer.vue"),
);
const SqlResultRenderer = defineAsyncComponent(
  () => import("@tracepilot/ui/src/components/renderers/SqlResultRenderer.vue"),
);
const WebSearchRenderer = defineAsyncComponent(
  () => import("@tracepilot/ui/src/components/renderers/WebSearchRenderer.vue"),
);
const StoreMemoryRenderer = defineAsyncComponent(
  () => import("@tracepilot/ui/src/components/renderers/StoreMemoryRenderer.vue"),
);
const ReportIntentRenderer = defineAsyncComponent(
  () => import("@tracepilot/ui/src/components/renderers/ReportIntentRenderer.vue"),
);
const AskUserRenderer = defineAsyncComponent(
  () => import("@tracepilot/ui/src/components/renderers/AskUserRenderer.vue"),
);
const AskUserArgsRenderer = defineAsyncComponent(
  () => import("@tracepilot/ui/src/components/renderers/AskUserArgsRenderer.vue"),
);

// ── Helpers ──

function makeTc(overrides: Partial<TurnToolCall>): TurnToolCall {
  return {
    toolName: "unknown",
    isComplete: true,
    success: true,
    durationMs: 120,
    ...overrides,
  };
}

// ── Sample Data ──

const editArgs = {
  path: "src/utils/formatters.ts",
  old_str: `export function formatDate(d: Date): string {\n  return d.toISOString();\n}`,
  new_str: `export function formatDate(d: Date, locale = "en-US"): string {\n  return new Intl.DateTimeFormat(locale, {\n    year: "numeric",\n    month: "short",\n    day: "numeric",\n  }).format(d);\n}`,
};

const editContent =
  "The file was edited successfully. Here's the result of running `cat -n` on a snippet of the edited file:\n" +
  "    14\texport function formatDate(d: Date, locale = 'en-US'): string {\n" +
  "    15\t  return new Intl.DateTimeFormat(locale, {\n" +
  "    16\t    year: 'numeric',\n" +
  "    17\t    month: 'short',\n" +
  "    18\t    day: 'numeric',\n" +
  "    19\t  }).format(d);\n" +
  "    20\t}";

const viewArgs = {
  path: "C:\\git\\TracePilot\\packages\\ui\\src\\utils\\formatters.ts",
  view_range: [1, 15],
};

const viewContent = [
  "1. // Shared formatting utilities",
  '2. import { format } from "date-fns";',
  "3. ",
  "4. export function formatNumber(n: number): string {",
  '5.   return new Intl.NumberFormat("en-US").format(n);',
  "6. }",
  "7. ",
  "8. export function formatPercent(n: number): string {",
  "9.   return `${(n * 100).toFixed(1)}%`;",
  "10. }",
  "11. ",
  "12. export function formatDuration(ms: number): string {",
  "13.   if (ms < 1000) return `${ms}ms`;",
  "14.   return `${(ms / 1000).toFixed(1)}s`;",
  "15. }",
].join("\n");

const createArgs = {
  path: "C:\\git\\TracePilot\\packages\\ui\\src\\utils\\debounce.ts",
  file_text: [
    "/**",
    " * Debounce a function call by `delay` milliseconds.",
    " */",
    "export function debounce<T extends (...args: unknown[]) => void>(",
    "  fn: T,",
    "  delay: number,",
    "): (...args: Parameters<T>) => void {",
    "  let timer: ReturnType<typeof setTimeout>;",
    "  return (...args) => {",
    "    clearTimeout(timer);",
    "    timer = setTimeout(() => fn(...args), delay);",
    "  };",
    "}",
  ].join("\n"),
};

const createContent =
  "File created successfully at C:\\git\\TracePilot\\packages\\ui\\src\\utils\\debounce.ts";

const grepArgs = {
  pattern: "formatDuration",
  output_mode: "content",
  "-n": true,
  glob: "*.ts",
};

const grepContent = [
  ".\\packages\\ui\\src\\utils\\formatters.ts:12:export function formatDuration(ms: number): string {",
  ".\\packages\\ui\\src\\utils\\formatters.ts:13:  if (ms < 1000) return `${ms}ms`;",
  ".\\packages\\ui\\src\\utils\\formatters.ts:14:  return `${(ms / 1000).toFixed(1)}s`;",
  "--",
  ".\\apps\\desktop\\src\\views\\AnalyticsDashboardView.vue:10:  formatDuration,",
  ".\\apps\\desktop\\src\\views\\AnalyticsDashboardView.vue:47:  const elapsed = formatDuration(data.value?.totalDurationMs ?? 0);",
  "--",
  ".\\packages\\ui\\src\\index.ts:60:export * from './utils/formatters';",
].join("\n");

const globArgs = { pattern: "**/*.test.ts", path: "packages/ui/src" };

const globContent = [
  ".\\packages\\ui\\src\\components\\renderers\\__tests__\\EditDiffRenderer.test.ts",
  ".\\packages\\ui\\src\\components\\renderers\\__tests__\\ViewCodeRenderer.test.ts",
  ".\\packages\\ui\\src\\components\\renderers\\__tests__\\CreateFileRenderer.test.ts",
  ".\\packages\\ui\\src\\components\\renderers\\__tests__\\GrepResultRenderer.test.ts",
  ".\\packages\\ui\\src\\components\\renderers\\__tests__\\RendererShell.test.ts",
  ".\\packages\\ui\\src\\components\\renderers\\__tests__\\CodeBlock.test.ts",
  ".\\packages\\ui\\src\\components\\renderers\\__tests__\\PlainTextRenderer.test.ts",
  ".\\packages\\ui\\src\\utils\\__tests__\\formatters.test.ts",
  ".\\packages\\ui\\src\\utils\\__tests__\\pathUtils.test.ts",
  ".\\packages\\ui\\src\\composables\\__tests__\\useClipboard.test.ts",
].join("\n");

const shellArgs = {
  command: "pnpm --filter @tracepilot/ui typecheck",
  description: "Run typechecking for UI package",
  mode: "sync",
  initial_wait: 60,
};

const shellContent = [
  "> @tracepilot/ui@ typecheck C:\\git\\TracePilot\\packages\\ui",
  "> vue-tsc --noEmit",
  "",
  "src/components/DataTable.vue:42:7 - error TS2322: Type 'string' is not assignable to type 'number'.",
  "",
  "42       width: header.width ?? 'auto',",
  "         ~~~~~",
  "",
  "src/utils/syntaxHighlight.ts:118:3 - warning TS6133: 'idx' is declared but never used.",
  "",
  "118   const idx = tokens.findIndex(t => t.type === 'keyword');",
  "         ~~~",
  "",
  "Found 1 error and 1 warning.",
].join("\n");

const shellSuccessContent = [
  "> @tracepilot/ui@ typecheck C:\\git\\TracePilot\\packages\\ui",
  "> vue-tsc --noEmit",
  "",
  "Done in 4.2s",
].join("\n");

const sqlArgs = {
  query:
    "SELECT id, title, status, created_at FROM todos WHERE status != 'done' ORDER BY created_at DESC LIMIT 5;",
  description: "Query pending todos",
};

const sqlContent = JSON.stringify([
  {
    id: "add-mcp-renderer",
    title: "Add GitHub MCP renderer",
    status: "in_progress",
    created_at: "2025-07-16T10:00:00Z",
  },
  {
    id: "fix-ansi-shell",
    title: "Support ANSI codes in shell renderer",
    status: "pending",
    created_at: "2025-07-15T14:30:00Z",
  },
  {
    id: "web-fetch-renderer",
    title: "Create web_fetch renderer",
    status: "pending",
    created_at: "2025-07-14T09:00:00Z",
  },
  {
    id: "task-renderer",
    title: "Create task subagent renderer",
    status: "blocked",
    created_at: "2025-07-13T16:45:00Z",
  },
  {
    id: "renderer-tests",
    title: "Add missing renderer tests",
    status: "pending",
    created_at: "2025-07-12T08:15:00Z",
  },
]);

const sqlEmptyContent = "Query executed successfully. 0 rows affected.";

const webSearchArgs = {
  query: "What are the latest features in Vue 3.5?",
};

const webSearchContent = [
  "Vue 3.5 was released in September 2024 with several major improvements:",
  "",
  "## Key Features",
  "",
  "**Reactive Props Destructure** — Props can now be destructured directly in `<script setup>` while maintaining reactivity [1].",
  "",
  "**useTemplateRef()** — A new composable for typed template refs that replaces the old string-ref approach [2].",
  "",
  "**Deferred Teleport** — Teleport now supports `defer` to render content after the target is mounted [3].",
  "",
  "**Memory Improvements** — The reactivity system uses 56% less memory compared to Vue 3.4 [4].",
  "",
  "## Sources",
  "",
  "- [Vue 3.5 Release Blog Post](https://blog.vuejs.org/posts/vue-3-5)",
  "- [Vue RFC #502: Reactive Props Destructure](https://github.com/vuejs/rfcs/discussions/502)",
  "- [Vue 3.5 Changelog](https://github.com/vuejs/core/blob/main/CHANGELOG.md)",
  "- [Evan You on X — Memory Improvements](https://x.com/youyuxi/status/1830890893718491627)",
].join("\n");

const storeMemoryArgs = {
  subject: "testing practices",
  fact: "Desktop typechecking is done with `pnpm --filter @tracepilot/desktop typecheck` (vue-tsc --noEmit).",
  reason:
    "This is the verified command for running type checks on the desktop app. It's important to remember for CI/CD and for ensuring code quality before commits.",
  citations: "C:\\git\\TracePilot\\apps\\desktop\\package.json:9-17",
};

const storeMemoryContent = "Memory stored successfully.";

const reportIntentArgs = { intent: "Fixing homepage CSS" };

const askUserArgs = {
  question: "What database should I use for the session store?",
  choices: ["SQLite (Recommended)", "PostgreSQL", "MySQL"],
  allow_freeform: true,
};

const askUserContent = "SQLite (Recommended)";

const askUserFreeformArgs = {
  question: "What naming convention do you prefer for component files?",
  choices: ["PascalCase.vue", "kebab-case.vue"],
  allow_freeform: true,
};

const askUserFreeformContent = "I prefer PascalCase but with a .component.vue suffix";

// ── Layout ──

interface ShowcaseSection {
  id: string;
  title: string;
  tool: string;
  type: "result" | "args";
  description: string;
  issues: string[];
}

const sections: ShowcaseSection[] = [
  {
    id: "edit-result",
    title: "EditDiffRenderer",
    tool: "edit",
    type: "result",
    description: "Unified/split diff view with line numbers and word-level highlights.",
    issues: [
      "Split view column widths unbalanced on narrow viewports",
      "No syntax highlighting within diff lines",
    ],
  },
  {
    id: "edit-args",
    title: "EditArgsRenderer",
    tool: "edit",
    type: "args",
    description: "Structured view of edit arguments (file path, find, replace).",
    issues: ["Long paths may overflow without ellipsis"],
  },
  {
    id: "view-result",
    title: "ViewCodeRenderer",
    tool: "view",
    type: "result",
    description: "Syntax-highlighted code with line numbers and language detection.",
    issues: ["Line numbers from view_range not shown when startLine != 1"],
  },
  {
    id: "create-result",
    title: "CreateFileRenderer",
    tool: "create",
    type: "result",
    description: "New-file badge with syntax-highlighted content.",
    issues: [],
  },
  {
    id: "create-args",
    title: "CreateArgsRenderer",
    tool: "create",
    type: "args",
    description: "File path and content preview for create operations.",
    issues: [],
  },
  {
    id: "grep-result",
    title: "GrepResultRenderer",
    tool: "grep",
    type: "result",
    description: "Grouped file matches with pattern highlighting and context gaps.",
    issues: [
      "Regex metacharacters in pattern cause highlighting crash",
      "files_with_matches mode shows paths without file icons",
    ],
  },
  {
    id: "glob-result",
    title: "GlobTreeRenderer",
    tool: "glob",
    type: "result",
    description: "Collapsible hierarchical file tree with unlimited depth.",
    issues: ["No file-type icons", "Empty directory segments shown as separate nodes"],
  },
  {
    id: "shell-error",
    title: "ShellOutputRenderer (with errors)",
    tool: "powershell",
    type: "result",
    description: "Terminal chrome with exit status badge and keyword coloring.",
    issues: ["No ANSI escape code support — raw sequences render as text"],
  },
  {
    id: "shell-success",
    title: "ShellOutputRenderer (success)",
    tool: "powershell",
    type: "result",
    description: "Clean success case with exit 0 badge.",
    issues: [],
  },
  {
    id: "sql-result",
    title: "SqlResultRenderer (with data)",
    tool: "sql",
    type: "result",
    description: "Highlighted SQL query with a striped data table and row count.",
    issues: ["Wide tables overflow without horizontal scroll on narrow viewports"],
  },
  {
    id: "sql-empty",
    title: "SqlResultRenderer (empty result)",
    tool: "sql",
    type: "result",
    description: "Non-JSON response fallback (e.g. INSERT/UPDATE).",
    issues: [],
  },
  {
    id: "web-search",
    title: "WebSearchRenderer",
    tool: "web_search",
    type: "result",
    description: "Markdown body with numbered source cards.",
    issues: [
      "Reimplements markdown parsing instead of using MarkdownContent",
      "Missing fenced code blocks and table support",
      "Citation [N] references not linked to source cards",
    ],
  },
  {
    id: "store-memory",
    title: "StoreMemoryRenderer",
    tool: "store_memory",
    type: "result",
    description: "Memory card with fact, subject, reason, and citations.",
    issues: [],
  },
  {
    id: "report-intent",
    title: "ReportIntentRenderer",
    tool: "report_intent",
    type: "args",
    description: "Intent badge displayed inline.",
    issues: [],
  },
  {
    id: "ask-user-result",
    title: "AskUserRenderer (choice selected)",
    tool: "ask_user",
    type: "result",
    description: "Question + choices with selected answer highlighted.",
    issues: [],
  },
  {
    id: "ask-user-freeform",
    title: "AskUserRenderer (freeform response)",
    tool: "ask_user",
    type: "result",
    description: "Freeform response shown when user didn't pick a predefined choice.",
    issues: [],
  },
  {
    id: "ask-user-args",
    title: "AskUserArgsRenderer",
    tool: "ask_user",
    type: "args",
    description: "Question and choices displayed before user responds.",
    issues: [],
  },
];

const activeSection = ref<string | null>(null);
function toggleSection(id: string) {
  activeSection.value = activeSection.value === id ? null : id;
}
</script>

<template>
  <PageShell fluid>
    <PageHeader
      title="🎨 Renderer Showcase"
      subtitle="Visual QA for all registered rich tool renderers — dev only"
    />

    <p class="showcase-intro">
      Each section below renders a tool renderer with realistic sample data.
      Known issues are listed beneath each renderer. Click the issue pills to
      toggle details.
    </p>

    <nav class="showcase-toc">
      <strong>Jump to:</strong>
      <a
        v-for="s in sections"
        :key="s.id"
        :href="`#${s.id}`"
        class="toc-link"
      >
        {{ s.title }}
      </a>
    </nav>

    <div class="showcase-grid">
      <section
        v-for="s in sections"
        :id="s.id"
        :key="s.id"
        class="showcase-card"
      >
        <div class="card-header">
          <h2 class="card-title">{{ s.title }}</h2>
          <span class="card-badge" :class="`card-badge--${s.type}`">{{ s.type }}</span>
          <code class="card-tool">{{ s.tool }}</code>
        </div>
        <p class="card-desc">{{ s.description }}</p>

        <!-- Render the actual component -->
        <div class="card-renderer">
          <!-- ── Result renderers ── -->
          <EditDiffRenderer
            v-if="s.id === 'edit-result'"
            :content="editContent"
            :args="editArgs"
          />
          <ViewCodeRenderer
            v-if="s.id === 'view-result'"
            :content="viewContent"
            :args="viewArgs"
          />
          <CreateFileRenderer
            v-if="s.id === 'create-result'"
            :content="createContent"
            :args="createArgs"
          />
          <GrepResultRenderer
            v-if="s.id === 'grep-result'"
            :content="grepContent"
            :args="grepArgs"
          />
          <GlobTreeRenderer
            v-if="s.id === 'glob-result'"
            :content="globContent"
            :args="globArgs"
          />
          <ShellOutputRenderer
            v-if="s.id === 'shell-error'"
            :content="shellContent"
            :args="shellArgs"
            :tc="makeTc({ toolName: 'powershell', success: false, durationMs: 4200 })"
          />
          <ShellOutputRenderer
            v-if="s.id === 'shell-success'"
            :content="shellSuccessContent"
            :args="shellArgs"
            :tc="makeTc({ toolName: 'powershell', success: true, durationMs: 4200 })"
          />
          <SqlResultRenderer
            v-if="s.id === 'sql-result'"
            :content="sqlContent"
            :args="sqlArgs"
          />
          <SqlResultRenderer
            v-if="s.id === 'sql-empty'"
            :content="sqlEmptyContent"
            :args="sqlArgs"
          />
          <WebSearchRenderer
            v-if="s.id === 'web-search'"
            :content="webSearchContent"
            :args="webSearchArgs"
          />
          <StoreMemoryRenderer
            v-if="s.id === 'store-memory'"
            :content="storeMemoryContent"
            :args="storeMemoryArgs"
          />
          <AskUserRenderer
            v-if="s.id === 'ask-user-result'"
            :content="askUserContent"
            :args="askUserArgs"
          />
          <AskUserRenderer
            v-if="s.id === 'ask-user-freeform'"
            :content="askUserFreeformContent"
            :args="askUserFreeformArgs"
          />

          <!-- ── Args renderers ── -->
          <EditArgsRenderer
            v-if="s.id === 'edit-args'"
            :args="editArgs"
            :tc="makeTc({ toolName: 'edit' })"
          />
          <CreateArgsRenderer
            v-if="s.id === 'create-args'"
            :args="createArgs"
            :tc="makeTc({ toolName: 'create' })"
          />
          <ReportIntentRenderer
            v-if="s.id === 'report-intent'"
            :args="reportIntentArgs"
            :tc="makeTc({ toolName: 'report_intent' })"
          />
          <AskUserArgsRenderer
            v-if="s.id === 'ask-user-args'"
            :args="askUserArgs"
            :tc="makeTc({ toolName: 'ask_user' })"
          />
        </div>

        <!-- Issues -->
        <div v-if="s.issues.length > 0" class="card-issues">
          <button
            class="issues-toggle"
            :aria-expanded="activeSection === s.id"
            @click="toggleSection(s.id)"
          >
            ⚠ {{ s.issues.length }} known issue{{ s.issues.length > 1 ? "s" : "" }}
          </button>
          <ul v-show="activeSection === s.id" class="issues-list">
            <li v-for="(issue, idx) in s.issues" :key="idx" class="issue-item">
              {{ issue }}
            </li>
          </ul>
        </div>
        <div v-else class="card-no-issues">✅ No known issues</div>
      </section>
    </div>
  </PageShell>
</template>

<style scoped>
.showcase-intro {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 16px;
  max-width: 720px;
}

.showcase-toc {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin-bottom: 24px;
  padding: 10px 14px;
  background: var(--canvas-inset);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md, 8px);
  font-size: 0.75rem;
}
.toc-link {
  color: var(--accent-fg, #818cf8);
  text-decoration: none;
}
.toc-link:hover {
  text-decoration: underline;
}

.showcase-grid {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.showcase-card {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md, 8px);
  background: var(--canvas-default);
  overflow: hidden;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-muted);
  background: var(--canvas-subtle);
}
.card-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
}
.card-badge {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 9999px;
}
.card-badge--result {
  background: rgba(52, 211, 153, 0.12);
  color: var(--success-fg, #34d399);
}
.card-badge--args {
  background: rgba(99, 102, 241, 0.12);
  color: var(--accent-fg, #818cf8);
}
.card-tool {
  font-size: 0.6875rem;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--neutral-muted);
  color: var(--text-tertiary);
  margin-left: auto;
}

.card-desc {
  margin: 0;
  padding: 8px 16px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-muted);
}

.card-renderer {
  padding: 12px;
  background: var(--canvas-default);
}

.card-issues {
  border-top: 1px solid var(--border-muted);
  background: rgba(251, 191, 36, 0.04);
}
.issues-toggle {
  display: block;
  width: 100%;
  padding: 8px 16px;
  border: none;
  background: none;
  color: var(--attention-fg, #fbbf24);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}
.issues-toggle:hover {
  background: rgba(251, 191, 36, 0.08);
}
.issues-list {
  list-style: none;
  margin: 0;
  padding: 0 16px 10px 16px;
}
.issue-item {
  font-size: 0.75rem;
  color: var(--text-secondary);
  padding: 4px 0;
  border-top: 1px solid var(--border-muted);
  line-height: 1.5;
}
.issue-item::before {
  content: "• ";
  color: var(--attention-fg, #fbbf24);
}

.card-no-issues {
  padding: 8px 16px;
  font-size: 0.75rem;
  color: var(--success-fg, #34d399);
  border-top: 1px solid var(--border-muted);
}
</style>
