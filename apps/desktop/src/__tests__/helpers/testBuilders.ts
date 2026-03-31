/**
 * Test data builders with proper TypeScript types.
 * Provides factory functions for creating mock ConversationTurn and TurnToolCall objects.
 */

import type { AttributedMessage, ConversationTurn, TurnToolCall } from "@tracepilot/types";

/**
 * Creates a mock TurnToolCall with sensible defaults.
 * All fields are optional via the overrides parameter.
 */
export function makeTurnToolCall(overrides: Partial<TurnToolCall> = {}): TurnToolCall {
  const randomId = `tc-${Math.random().toString(36).slice(2, 8)}`;
  return {
    toolName: "view",
    success: true,
    isComplete: true,
    durationMs: 200,
    toolCallId: randomId,
    startedAt: "2025-01-01T00:00:00.000Z",
    completedAt: "2025-01-01T00:00:00.200Z",
    isSubagent: false,
    ...overrides,
  };
}

/**
 * Creates a mock ConversationTurn with sensible defaults.
 * All fields are optional via the overrides parameter.
 */
export function makeTurn(
  overrides: Partial<Omit<ConversationTurn, "userMessage">> & { userMessage?: string | null } = {},
): ConversationTurn {
  const { userMessage, ...rest } = overrides;
  return {
    turnIndex: 0,
    userMessage: userMessage === null ? undefined : (userMessage ?? "Fix the bug"),
    assistantMessages: [{ content: "Done." }],
    model: "gpt-4.1",
    toolCalls: [],
    durationMs: 5000,
    isComplete: true,
    timestamp: "2025-01-01T00:00:00.000Z",
    ...rest,
  };
}

/**
 * Creates a mock AttributedMessage with sensible defaults.
 */
export function makeAttributedMessage(
  overrides: Partial<AttributedMessage> = {},
): AttributedMessage {
  return {
    content: "Mock message",
    ...overrides,
  };
}
