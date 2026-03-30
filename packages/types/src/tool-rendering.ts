// ─── Tool Rendering Types ─────────────────────────────────────────
// Types and defaults for the rich tool-call renderer: which tools
// have dedicated visualisations and user preference overrides.

/** Tool names that have dedicated rich renderers. */
export type RichRenderableToolName =
  | "edit"
  | "view"
  | "create"
  | "grep"
  | "glob"
  | "powershell"
  | "read_powershell"
  | "write_powershell"
  | "sql"
  | "task"
  | "read_agent"
  | "ask_user"
  | "web_search"
  | "web_fetch"
  | "store_memory"
  | "report_intent";

/** User preferences for tool rendering: global toggle + per-tool overrides. */
export interface ToolRenderingPreferences {
  /** Master switch: when false, all tool calls use the plain/minimal renderer. */
  enabled: boolean;
  /** Per-tool overrides. Missing keys inherit from `enabled`. */
  toolOverrides: Partial<Record<RichRenderableToolName, boolean>>;
}

/** Default tool rendering preferences — everything enabled. */
export const DEFAULT_TOOL_RENDERING_PREFS: ToolRenderingPreferences = {
  enabled: true,
  toolOverrides: {},
};
