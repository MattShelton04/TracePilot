/**
 * Shared tool-call display utilities.
 * Centralizes icon mapping, categorization, and argument summarization.
 */

import { getToolArgs } from "@tracepilot/types";
import { TASK_LIST_TOOLS, taskListSummary } from "../components/renderers/taskList";
import type { LucideName } from "../icons/templateCatalogue";

const TOOL_ICONS: Record<string, LucideName> = {
  view: "eye",
  edit: "pencil",
  create: "file-plus",
  grep: "search",
  rg: "search",
  glob: "folder-search",
  powershell: "terminal",
  shell: "terminal",
  read_powershell: "terminal",
  write_powershell: "terminal",
  stop_powershell: "terminal",
  bash: "terminal",
  read_bash: "terminal",
  write_bash: "terminal",
  stop_bash: "terminal",
  task: "bot",
  stop_agent: "bot",
  write_agent: "send",
  read_agent: "inbox",
  list_agents: "users",
  report_intent: "target",
  ask_user: "message-circle",
  store_memory: "brain",
  web_search: "globe",
  web_fetch: "globe",
  sql: "database",
  skill: "zap",
  ExitPlanMode: "clipboard-list",
  ...Object.fromEntries(TASK_LIST_TOOLS.map((name) => [name, "clipboard-list" as const])),
};

export function toolIcon(toolName: string): LucideName {
  return TOOL_ICONS[toolName] ?? "wrench";
}

/** Shells that run a command: Windows (`powershell`) and macOS/Linux (`bash`) Copilot CLI. */
const SHELL_COMMAND_TOOLS = ["shell", "powershell", "bash"];
/** Tools that address an existing shell session by its id. */
const SHELL_SESSION_TOOLS = [
  "read_powershell",
  "write_powershell",
  "stop_powershell",
  "read_bash",
  "write_bash",
  "stop_bash",
];

export type ToolCategory = "file" | "shell" | "agent" | "github" | "web" | "data" | "other";

export function toolCategory(toolName: string): ToolCategory {
  if (["view", "edit", "create", "grep", "rg", "glob"].includes(toolName)) return "file";
  if (SHELL_COMMAND_TOOLS.includes(toolName) || SHELL_SESSION_TOOLS.includes(toolName))
    return "shell";
  if (["task", "read_agent", "write_agent", "list_agents", "stop_agent"].includes(toolName))
    return "agent";
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

function truncateSummary(text: string, max = 100): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

const PATCH_FILE_LINE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm;

/** Files named by an apply_patch envelope: "a.ts", or "a.ts +2 files". */
function patchSummary(args: unknown): string {
  const record = getToolArgs({ arguments: args });
  const patch =
    typeof args === "string"
      ? args
      : typeof record.patch === "string"
        ? record.patch
        : typeof record.input === "string"
          ? record.input
          : "";
  const paths = [...patch.matchAll(PATCH_FILE_LINE)].map((match) => match[1].trim());
  if (paths.length === 0) return "";
  const others = paths.length - 1;
  return others > 0 ? `${paths[0]} +${others} file${others === 1 ? "" : "s"}` : paths[0];
}

/** The plan's first Markdown heading, or its first non-empty line. */
function planSummary(plan: string): string {
  const lines = plan.split(/\r?\n/).map((line) => line.trim());
  const heading = lines.find((line) => /^#{1,6}\s+\S/.test(line));
  const first = heading?.replace(/^#{1,6}\s+/, "") ?? lines.find(Boolean) ?? "";
  return truncateSummary(first);
}

/** A string argument as one truncated line, or "". */
function stringArg(value: unknown): string {
  return typeof value === "string" ? truncateSummary(value) : "";
}

/** Arguments that usually name what an MCP call is about, most specific first. */
const MCP_SUMMARY_KEYS = ["query", "q", "url", "path", "file_path", "name", "title", "description"];

/** An MCP call's first descriptive string argument. Other arguments may hold secrets or blobs. */
function mcpSummary(a: Record<string, unknown>): string {
  for (const key of MCP_SUMMARY_KEYS) {
    const value = stringArg(a[key]);
    if (value) return value;
  }
  return "";
}

/**
 * A GitHub MCP call (Copilot's `github-mcp-server-*`): its `method`, then
 * `owner/repo`, then the path or query, e.g. "get · octo/app · src/a.ts".
 * Mirrored by `compute_args_summary` in `crates/tracepilot-core/src/turns/args_summary/`.
 */
function githubSummary(a: Record<string, unknown>): string {
  const owner = stringArg(a.owner);
  const repo = stringArg(a.repo);
  const target = stringArg(a.path) || stringArg(a.query);
  const parts = [stringArg(a.method), owner && repo ? `${owner}/${repo}` : owner || repo, target];
  return truncateSummary(parts.filter(Boolean).join(" · "));
}

/** Extract a useful one-line summary from tool call arguments. */
export function formatArgsSummary(args: unknown, toolName: string): string {
  // apply_patch arguments are usually the raw patch string, not an object.
  if (toolName === "apply_patch") return patchSummary(args);
  if (!args || typeof args !== "object") return "";
  const a = getToolArgs({ arguments: args });

  if (toolName === "view" && a.path) return String(a.path);
  if (toolName === "edit" && a.path) return String(a.path);
  if (toolName === "create" && a.path) return String(a.path);
  if ((toolName === "grep" || toolName === "rg") && a.pattern) {
    const path = a.path ?? a.paths;
    const summary = Array.isArray(path)
      ? path.filter((item) => typeof item === "string").join(", ")
      : typeof path === "string"
        ? path
        : "";
    return `/${a.pattern}/${summary ? ` in ${summary}` : ""}`;
  }
  if (toolName === "glob" && a.pattern) return String(a.pattern);
  if (SHELL_COMMAND_TOOLS.includes(toolName) && a.command) {
    const cmd = String(a.command);
    return cmd.length > 150 ? `${cmd.slice(0, 150)}…` : cmd;
  }
  if (SHELL_SESSION_TOOLS.includes(toolName)) {
    const shellId = a.shellId ?? a.shell_id;
    return shellId == null ? "" : `Shell ${shellId}`;
  }
  if (toolName === "task" && a.description) return String(a.description);
  if (toolName === "read_agent" || toolName === "stop_agent") {
    const candidate = a.agent_id ?? a.agent_name ?? a.name;
    if (candidate) return String(candidate);
  }
  if (toolName === "write_agent") {
    const target =
      typeof a.agent_id === "string"
        ? a.agent_id
        : Array.isArray(a.agent_ids)
          ? `${a.agent_ids.length} agents`
          : typeof a.scope === "string"
            ? `all ${a.scope}`
            : "";
    const line = typeof a.message === "string" ? a.message.replace(/\s+/g, " ").trim() : "";
    const message = line.length > 100 ? `${line.slice(0, 100)}…` : line;
    return [target && `→ ${target}`, message].filter(Boolean).join(" · ");
  }
  if (toolName === "list_agents" && a.scope) return `scope: ${a.scope}`;
  if (toolName === "report_intent" && a.intent) return String(a.intent);
  if (toolName === "sql" && a.description) return String(a.description);
  if (toolName === "store_memory" && a.fact) {
    const fact = String(a.fact);
    return fact.length > 100 ? `${fact.slice(0, 100)}…` : fact;
  }
  if (toolName === "ask_user") {
    // Claude Code and schema forms carry `message`; older Copilot calls `question`.
    const prompt = typeof a.message === "string" && a.message ? a.message : a.question;
    if (typeof prompt === "string" && prompt) return truncateSummary(prompt);
  }
  if (toolName === "skill" && typeof a.skill === "string") return a.skill;
  if (toolName === "ExitPlanMode" && typeof a.plan === "string") return planSummary(a.plan);
  if (toolName === "web_search" && a.query) return String(a.query);
  if (toolName === "web_fetch" && a.url) return String(a.url);
  if (toolName.startsWith("github-mcp-server")) return githubSummary(a);
  if (TASK_LIST_TOOLS.includes(toolName)) return truncateSummary(taskListSummary(toolName, a));
  // Claude Code tools without a canonical mapping keep their native names.
  if (toolName === "ToolSearch") return stringArg(a.query);
  if (toolName === "NotebookEdit") return stringArg(a.notebook_path);
  if (toolName === "Monitor") return stringArg(a.description) || stringArg(a.command);
  if (toolName.startsWith("mcp__")) return mcpSummary(a);
  return "";
}

/** Extract prompt/description text from tool-call arguments. */
export function extractPrompt(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const obj = getToolArgs({ arguments: args });
  const raw = obj.prompt ?? obj.description;
  return typeof raw === "string" ? raw : null;
}
