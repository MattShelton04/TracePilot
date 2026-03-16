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
import { defineAsyncComponent, type Component } from "vue";

export interface RendererEntry {
  /** Human-friendly label shown in the settings UI. */
  label: string;
  /** The async component for rendering the tool result. */
  resultComponent?: Component;
  /** The async component for rendering the tool arguments. */
  argsComponent?: Component;
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
  },
  view: {
    label: "View (Code Highlight)",
    resultComponent: defineAsyncComponent(() => import("./ViewCodeRenderer.vue")),
  },
  create: {
    label: "Create (Code Highlight)",
    resultComponent: defineAsyncComponent(() => import("./CreateFileRenderer.vue")),
    argsComponent: defineAsyncComponent(() => import("./CreateArgsRenderer.vue")),
  },
  grep: {
    label: "Grep (Search Results)",
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
