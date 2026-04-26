// Subagent panel — UI-only types. See docs/design/subagent-panel.md.

import type { TurnToolCall } from "@tracepilot/types";

export type SubagentStatus = "in-progress" | "completed" | "failed";

export type SubagentType =
  | "main"
  | "explore"
  | "general-purpose"
  | "code-review"
  | "rubber-duck"
  | "task";

export type SubagentActivityPillType = "intent" | "memory" | "read_agent";

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
  | { kind: "nested-subagent"; key: string; sortKey: number; toolCall: TurnToolCall };

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
  toolCount: number;

  turnIndex?: number;
  sourceTurnIndex?: number;
  isCrossTurnParent?: boolean;
  parallelGroupLabel?: string;

  prompt?: string;
  resultContent?: string;
  error?: string;
  messages: string[];
  reasoning: string[];
  childTools: TurnToolCall[];
  activities: SubagentActivityItem[];

  toolCallRef?: TurnToolCall;
  isMainAgent: boolean;
}

export type SubagentPanelDisplay = "stream" | "sections";
