/**
 * Tool Renderer Registry
 *
 * Maps tool names to their dedicated renderer components. The registry
 * is the single source of truth for which tools have rich renderers.
 *
 * Adding a renderer also needs types, fixtures and tests; follow
 * docs/design/adding-tool-renderers.md.
 */
import { type Component, defineAsyncComponent } from "vue";

const TaskListRenderer = defineAsyncComponent(() => import("./TaskListRenderer.vue"));

export interface RendererEntry {
  /** Human-friendly label shown in the settings UI. */
  label: string;
  /** The async component for rendering the tool result. */
  resultComponent?: Component;
  /** The async component for rendering the tool arguments. */
  argsComponent?: Component;
  /** When true, hide args display entirely when rich result renderer is active. */
  hideArgsWithRichResult?: boolean;
  /**
   * When true, the args collapsible starts open when the tool has no result yet.
   * Useful for interactive tools (e.g. ask_user) where the args ARE the content
   * the user needs to see while waiting for a response.
   */
  autoExpandArgs?: boolean;
}

/**
 * Registry of all tool renderers.
 * Key = tool name as it appears in `TurnToolCall.toolName`.
 */
const RENDERER_REGISTRY: Record<string, RendererEntry> = {
  edit: {
    label: "Edit (Diff View)",
    resultComponent: defineAsyncComponent(() => import("./EditDiffRenderer.vue")),
    argsComponent: defineAsyncComponent(() => import("./EditArgsRenderer.vue")),
    hideArgsWithRichResult: true,
  },
  view: {
    label: "View (Code Highlight)",
    resultComponent: defineAsyncComponent(() => import("./ViewCodeRenderer.vue")),
  },
  create: {
    label: "Create (Code Highlight)",
    resultComponent: defineAsyncComponent(() => import("./CreateFileRenderer.vue")),
    argsComponent: defineAsyncComponent(() => import("./CreateArgsRenderer.vue")),
    hideArgsWithRichResult: true,
  },
  grep: {
    label: "Grep (Search Results)",
    resultComponent: defineAsyncComponent(() => import("./GrepResultRenderer.vue")),
  },
  rg: {
    label: "Ripgrep (Search Results)",
    resultComponent: defineAsyncComponent(() => import("./GrepResultRenderer.vue")),
  },
  glob: {
    label: "Glob (File Tree)",
    resultComponent: defineAsyncComponent(() => import("./GlobTreeRenderer.vue")),
  },
  shell: {
    label: "Shell (Terminal Output)",
    resultComponent: defineAsyncComponent(() => import("./ShellOutputRenderer.vue")),
  },
  powershell: {
    label: "Shell (Terminal Output)",
    resultComponent: defineAsyncComponent(() => import("./ShellOutputRenderer.vue")),
  },
  read_powershell: {
    label: "Read Shell (Terminal Output)",
    resultComponent: defineAsyncComponent(() => import("./ShellOutputRenderer.vue")),
  },
  write_powershell: {
    label: "Write Shell",
    resultComponent: defineAsyncComponent(() => import("./ShellOutputRenderer.vue")),
  },
  stop_powershell: {
    label: "Stop Shell",
    resultComponent: defineAsyncComponent(() => import("./ShellOutputRenderer.vue")),
  },
  // Copilot CLI on macOS and Linux names its shell tools after bash.
  bash: {
    label: "Bash (Terminal Output)",
    resultComponent: defineAsyncComponent(() => import("./ShellOutputRenderer.vue")),
  },
  read_bash: {
    label: "Read Bash (Terminal Output)",
    resultComponent: defineAsyncComponent(() => import("./ShellOutputRenderer.vue")),
  },
  write_bash: {
    label: "Write Bash",
    resultComponent: defineAsyncComponent(() => import("./ShellOutputRenderer.vue")),
  },
  stop_bash: {
    label: "Stop Bash",
    resultComponent: defineAsyncComponent(() => import("./ShellOutputRenderer.vue")),
  },
  sql: {
    label: "SQL (Query + Table)",
    resultComponent: defineAsyncComponent(() => import("./SqlResultRenderer.vue")),
  },
  web_search: {
    label: "Web Search",
    resultComponent: defineAsyncComponent(() => import("./WebSearchRenderer.vue")),
  },
  store_memory: {
    label: "Store Memory",
    resultComponent: defineAsyncComponent(() => import("./StoreMemoryRenderer.vue")),
  },
  report_intent: {
    label: "Report Intent",
    resultComponent: defineAsyncComponent(() => import("./ReportIntentRenderer.vue")),
    argsComponent: defineAsyncComponent(() => import("./ReportIntentRenderer.vue")),
    hideArgsWithRichResult: true,
    autoExpandArgs: true,
  },
  ask_user: {
    label: "Ask User (Q&A)",
    resultComponent: defineAsyncComponent(() => import("./AskUserRenderer.vue")),
    argsComponent: defineAsyncComponent(() => import("./AskUserArgsRenderer.vue")),
    hideArgsWithRichResult: true,
    autoExpandArgs: true,
  },
  read_agent: {
    label: "Read Agent (Status + Transcript)",
    resultComponent: defineAsyncComponent(() => import("./ReadAgentRenderer.vue")),
    hideArgsWithRichResult: true,
  },
  write_agent: {
    label: "Write Agent (Message + Delivery)",
    resultComponent: defineAsyncComponent(() => import("./WriteAgentRenderer.vue")),
    argsComponent: defineAsyncComponent(() => import("./WriteAgentArgsRenderer.vue")),
    hideArgsWithRichResult: true,
    autoExpandArgs: true,
  },
  list_agents: {
    label: "List Agents (Roster)",
    resultComponent: defineAsyncComponent(() => import("./ListAgentsRenderer.vue")),
    hideArgsWithRichResult: true,
  },
  apply_patch: {
    label: "Apply Patch (Diff View)",
    resultComponent: defineAsyncComponent(() => import("./ApplyPatchRenderer.vue")),
    argsComponent: defineAsyncComponent(() => import("./ApplyPatchArgsRenderer.vue")),
    hideArgsWithRichResult: true,
    autoExpandArgs: true,
  },
  // Claude Code keeps its native name; the plan is Markdown in `args.plan`.
  ExitPlanMode: {
    label: "Exit Plan Mode (Plan)",
    resultComponent: defineAsyncComponent(() => import("./ExitPlanModeRenderer.vue")),
  },
  // Claude task lists: the desktop app's plan tools, then the CLI's task tools.
  // The checklist is the call's input, so one component serves both sides.
  mcp__ccd_turn__update_plan: {
    label: "Update Plan (Checklist)",
    resultComponent: TaskListRenderer,
    argsComponent: TaskListRenderer,
    hideArgsWithRichResult: true,
    autoExpandArgs: true,
  },
  mcp__ccd_turn__wrap_up: {
    label: "Wrap Up (Recap)",
    resultComponent: TaskListRenderer,
    argsComponent: TaskListRenderer,
    hideArgsWithRichResult: true,
    autoExpandArgs: true,
  },
  TodoWrite: {
    label: "Todo Write (Checklist)",
    resultComponent: TaskListRenderer,
    argsComponent: TaskListRenderer,
    hideArgsWithRichResult: true,
    autoExpandArgs: true,
  },
  TaskCreate: {
    label: "Task Create (Checklist)",
    resultComponent: TaskListRenderer,
    argsComponent: TaskListRenderer,
    hideArgsWithRichResult: true,
    autoExpandArgs: true,
  },
  TaskUpdate: {
    label: "Task Update (Checklist)",
    resultComponent: TaskListRenderer,
    argsComponent: TaskListRenderer,
    hideArgsWithRichResult: true,
    autoExpandArgs: true,
  },
};

/** Get the renderer entry for a tool, or undefined if none registered. */
export function getRendererEntry(toolName: string): RendererEntry | undefined {
  return RENDERER_REGISTRY[toolName];
}

/** Get all registered tool names and their labels (for settings UI). */
export function getRegisteredRenderers(): Array<{ toolName: string; label: string }> {
  return Object.entries(RENDERER_REGISTRY).map(([toolName, entry]) => ({
    toolName,
    label: entry.label,
  }));
}

/** Check if a tool has a dedicated result renderer. */
export function hasResultRenderer(toolName: string): boolean {
  return !!RENDERER_REGISTRY[toolName]?.resultComponent;
}

/** Check if a tool has a dedicated args renderer. */
export function hasArgsRenderer(toolName: string): boolean {
  return !!RENDERER_REGISTRY[toolName]?.argsComponent;
}

/** Check if args should be hidden when rich result rendering is active. */
export function shouldHideArgsWithRichResult(toolName: string): boolean {
  return !!RENDERER_REGISTRY[toolName]?.hideArgsWithRichResult;
}

/** Check if the args collapsible should start open when there is no result yet. */
export function shouldAutoExpandArgs(toolName: string): boolean {
  return !!RENDERER_REGISTRY[toolName]?.autoExpandArgs;
}
