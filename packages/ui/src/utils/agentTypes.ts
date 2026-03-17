/**
 * Shared agent type utilities — inference, coloring, and status helpers.
 *
 * Extracted from AgentTreeView so that ConversationTab, ToolCallItem,
 * and the grouping utility can all share the same logic.
 */

import type { TurnToolCall } from "@tracepilot/types";

export type AgentType =
  | "main"
  | "explore"
  | "general-purpose"
  | "code-review"
  | "task";

export const AGENT_COLORS: Record<AgentType, string> = {
  main: "#6366f1",
  explore: "#22d3ee",
  "general-purpose": "#a78bfa",
  "code-review": "#f472b6",
  task: "#fbbf24",
};

export const AGENT_ICONS: Record<AgentType, string> = {
  main: "🤖",
  explore: "🔍",
  "general-purpose": "🛠️",
  "code-review": "🔎",
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
export function inferAgentType(
  displayName?: string,
  toolName?: string,
  args?: unknown,
): AgentType {
  const name = (displayName ?? toolName ?? "").toLowerCase();
  if (name.includes("explore")) return "explore";
  if (name.includes("code-review") || name.includes("code review"))
    return "code-review";
  if (name.includes("general") || name.includes("general-purpose"))
    return "general-purpose";
  if (args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    const agentType = String(a.agent_type ?? "").toLowerCase();
    if (agentType.includes("explore")) return "explore";
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
  if (tc.isSubagent && tc.success == null) return "in-progress";
  if (tc.success === false) return "failed";
  return "completed";
}
