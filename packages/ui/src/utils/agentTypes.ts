/**
 * Shared agent type utilities — inference, coloring, and status helpers.
 *
 * Extracted from AgentTreeView so that ConversationTab, ToolCallItem,
 * and the grouping utility can all share the same logic.
 */

import type { TurnToolCall } from "@tracepilot/types";
import { getToolArgs, toolArgString } from "@tracepilot/types";

export type AgentType =
  | "main"
  | "explore"
  | "general-purpose"
  | "code-review"
  | "rubber-duck"
  | "task";

export const AGENT_COLORS: Record<AgentType, string> = {
  main: "var(--agent-color-main)",
  explore: "var(--agent-color-explore)",
  "general-purpose": "var(--agent-color-general-purpose)",
  "code-review": "var(--agent-color-code-review)",
  "rubber-duck": "var(--agent-color-rubber-duck)",
  task: "var(--agent-color-task)",
};

export const AGENT_ICONS: Record<AgentType, string> = {
  main: "🤖",
  explore: "🔍",
  "general-purpose": "🛠️",
  "code-review": "🔎",
  "rubber-duck": "🦆",
  task: "📋",
};

export type AgentStatus = "completed" | "failed" | "in-progress";

export const STATUS_ICONS: Record<AgentStatus, string> = {
  completed: "✅",
  failed: "❌",
  "in-progress": "⏳",
};

/**
 * Infer the agent type from a subagent tool call's metadata.
 * Checks display name, tool name, and arguments for type hints.
 */
export function inferAgentType(displayName?: string, toolName?: string, args?: unknown): AgentType {
  const name = (displayName ?? toolName ?? "").toLowerCase();
  if (name.includes("explore")) return "explore";
  if (name.includes("rubber-duck") || name.includes("rubber duck") || name.includes("rubberduck"))
    return "rubber-duck";
  if (name.includes("code-review") || name.includes("code review")) return "code-review";
  if (name.includes("general") || name.includes("general-purpose")) return "general-purpose";
  if (args && typeof args === "object") {
    const a = getToolArgs({ arguments: args });
    const agentType = toolArgString(a, "agent_type").toLowerCase();
    if (agentType.includes("explore")) return "explore";
    if (
      agentType.includes("rubber-duck") ||
      agentType.includes("rubber_duck") ||
      agentType.includes("rubberduck")
    )
      return "rubber-duck";
    if (agentType.includes("code-review") || agentType.includes("code_review"))
      return "code-review";
    if (agentType.includes("general")) return "general-purpose";
    if (agentType.includes("task")) return "task";
  }
  return "task";
}

/**
 * Convenience wrapper: infer agent type directly from a TurnToolCall.
 */
export function inferAgentTypeFromToolCall(tc: TurnToolCall): AgentType {
  return inferAgentType(tc.agentDisplayName, tc.toolName, tc.arguments);
}

/**
 * Determine the status of a subagent from its tool call state.
 */
export function agentStatusFromToolCall(tc: TurnToolCall): AgentStatus {
  if (!tc.isComplete) return "in-progress";
  if (tc.success === false) return "failed";
  return "completed";
}

/**
 * Resolve the CSS color variable for a given agent type.
 * Falls back to the main agent color for unrecognized types.
 */
export function getAgentColor(type: AgentType | string): string {
  return AGENT_COLORS[type as AgentType] ?? AGENT_COLORS.main;
}

/**
 * Resolve the emoji icon for a given agent type.
 * Falls back to the main agent icon for unrecognized types.
 */
export function getAgentIcon(type: AgentType | string): string {
  return AGENT_ICONS[type as AgentType] ?? AGENT_ICONS.main;
}

/**
 * Determine the display color for a regular (non-subagent) tool call
 * based on its execution status.
 *
 * - Failed → danger
 * - Pending (success not yet known) → tertiary (dimmed)
 * - read_agent tool → tertiary (read-only, dimmed)
 * - Successful → warning (standard tool accent color)
 */
export function getToolStatusColor(tc: TurnToolCall): string {
  if (tc.success === false) return "var(--danger-fg)";
  if (tc.success == null) return "var(--text-tertiary)";
  if (tc.toolName === "read_agent") return "var(--text-tertiary)";
  return "var(--warning-fg)";
}

/**
 * Determine the display color for any tool call (subagent or regular).
 * Subagent calls are colored by their inferred agent type;
 * regular tools are colored by execution status.
 */
export function getToolCallColor(tc: TurnToolCall): string {
  if (tc.isSubagent) {
    return getAgentColor(inferAgentTypeFromToolCall(tc));
  }
  return getToolStatusColor(tc);
}
