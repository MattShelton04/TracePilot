/**
 * Tool Renderer Registry
 *
 * Maps tool names to their dedicated renderer components. The registry
 * is the single source of truth for which tools have rich renderers.
 *
 * To add a new renderer:
 *  1. Create your component in this directory (e.g. MyToolRenderer.vue)
 *  2. Add a `defineAsyncComponent(() => import('./MyToolRenderer.vue'))` entry
 *  3. That's it — the dispatcher auto-discovers from this registry
 *
 * @see docs/design/adding-tool-renderers.md for the full guide
 */
import { type Component, defineAsyncComponent } from "vue";

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
    argsComponent: defineAsyncComponent(() => import("./ReportIntentRenderer.vue")),
  },
  ask_user: {
    label: "Ask User (Q&A)",
    resultComponent: defineAsyncComponent(() => import("./AskUserRenderer.vue")),
    argsComponent: defineAsyncComponent(() => import("./AskUserArgsRenderer.vue")),
    hideArgsWithRichResult: true,
    autoExpandArgs: true,
  },
  apply_patch: {
    label: "Apply Patch (Diff View)",
    resultComponent: defineAsyncComponent(() => import("./ApplyPatchRenderer.vue")),
    argsComponent: defineAsyncComponent(() => import("./ApplyPatchArgsRenderer.vue")),
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
