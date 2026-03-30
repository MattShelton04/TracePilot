/**
 * Shared tool-call display utilities.
 * Centralizes icon mapping, categorization, and argument summarization.
 */

const TOOL_ICONS: Record<string, string> = {
  view: "👁",
  edit: "✏️",
  create: "📄",
  grep: "🔍",
  glob: "📁",
  powershell: "💻",
  task: "🤖",
  report_intent: "🎯",
  ask_user: "💬",
  web_search: "🌐",
  web_fetch: "🌐",
  sql: "🗄️",
  skill: "⚡",
};

export function toolIcon(toolName: string): string {
  return TOOL_ICONS[toolName] || "🔧";
}

export type ToolCategory = "file" | "shell" | "agent" | "github" | "web" | "data" | "other";

export function toolCategory(toolName: string): ToolCategory {
  if (["view", "edit", "create", "grep", "glob"].includes(toolName)) return "file";
  if (["powershell", "read_powershell", "write_powershell", "stop_powershell"].includes(toolName))
    return "shell";
  if (["task", "read_agent", "write_agent", "list_agents"].includes(toolName)) return "agent";
  if (toolName.startsWith("github-mcp-server")) return "github";
  if (["web_search", "web_fetch"].includes(toolName)) return "web";
  if (toolName === "sql") return "data";
  return "other";
}

const CATEGORY_COLORS: Record<ToolCategory | string, string> = {
  file: "text-[var(--accent-fg)]",
  shell: "text-[var(--warning-fg)]",
  agent: "text-[var(--done-fg)]",
  github: "text-[var(--text-secondary)]",
  web: "text-[var(--success-fg)]",
  data: "text-[var(--accent-fg)]",
  other: "text-[var(--text-secondary)]",
};

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.other;
}

/** Extract a useful one-line summary from tool call arguments. */
export function formatArgsSummary(args: unknown, toolName: string): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;

  if (toolName === "view" && a.path) return String(a.path);
  if (toolName === "edit" && a.path) return String(a.path);
  if (toolName === "create" && a.path) return String(a.path);
  if (toolName === "grep" && a.pattern) return `/${a.pattern}/${a.path ? ` in ${a.path}` : ""}`;
  if (toolName === "glob" && a.pattern) return String(a.pattern);
  if (toolName === "powershell" && a.command) {
    const cmd = String(a.command);
    return cmd.length > 150 ? cmd.slice(0, 150) + "…" : cmd;
  }
  if (toolName === "task" && a.description) return String(a.description);
  if (toolName === "report_intent" && a.intent) return String(a.intent);
  if (toolName === "sql" && a.description) return String(a.description);
  if (toolName === "web_search" && a.query) return String(a.query);
  if (toolName === "web_fetch" && a.url) return String(a.url);
  if (toolName.startsWith("github-mcp-server") && a.method) return String(a.method);
  return "";
}

/** Extract prompt/description text from tool-call arguments. */
export function extractPrompt(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const obj = args as Record<string, unknown>;
  const raw = obj.prompt ?? obj.description;
  return typeof raw === "string" ? raw : null;
}
