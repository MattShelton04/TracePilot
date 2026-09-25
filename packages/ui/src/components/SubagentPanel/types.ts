// Subagent panel — UI-only types. See docs/design/subagent-panel.md.

import type { TurnToolCall } from "@tracepilot/types";
import type { AgentCommDelivery, AgentCommunication } from "../../utils/agentComms";

export type SubagentStatus = "in-progress" | "completed" | "failed" | "cancelled" | "idle";

export type SubagentType =
  | "main"
  | "explore"
  | "general-purpose"
  | "code-review"
  | "rubber-duck"
  | "task";

export type SubagentActivityPillType = "intent" | "memory";

export type SubagentActivityItem =
  | { kind: "reasoning"; key: string; sortKey: number; content: string; agentName?: string }
  | { kind: "tool"; key: string; sortKey: number; toolCall: TurnToolCall }
  | {
      kind: "pill";
      key: string;
      sortKey: number;
      type: SubagentActivityPillType;
      label: string;
      toolCall: TurnToolCall;
    }
  | { kind: "nested-subagent"; key: string; sortKey: number; toolCall: TurnToolCall }
  | {
      /** A message this agent received (`in`) or sent with write_agent (`out`). */
      kind: "message";
      key: string;
      sortKey: number;
      direction: "in" | "out";
      communication: AgentCommunication;
      /** This agent's own delivery record, for received messages. */
      delivery?: AgentCommDelivery;
    }
  | {
      /** A reply in a multi-turn conversation, shown in place alongside messages. */
      kind: "response";
      key: string;
      sortKey: number;
      content: string;
    };

export interface SubagentView {
  id: string;
  type: SubagentType;
  displayName: string;
  description?: string;
  intentSummary?: string;
  status: SubagentStatus;

  model?: string;
  requestedModel?: string;
  modelSubstituted: boolean;

  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  totalTokens?: number;
  totalToolCalls?: number;
  turnIndex?: number;
  sourceTurnIndex?: number;
  isCrossTurnParent?: boolean;
  parallelGroupLabel?: string;

  prompt?: string;
  /** Joined final messages (full content) shown in the Output section. */
  output?: string;
  /** Output section label; multi-turn agents show only their latest response. */
  outputLabel?: string;
  error?: string;
  activities: SubagentActivityItem[];

  toolCallRef?: TurnToolCall;
  isMainAgent: boolean;
}
