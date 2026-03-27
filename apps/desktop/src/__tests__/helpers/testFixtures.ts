import type { ConversationTurn, TurnToolCall, AttributedMessage } from '@tracepilot/types';

/**
 * Test fixture builders for creating properly-typed test data.
 *
 * These builders eliminate the need for `as any` type assertions in tests
 * by providing minimal, valid instances of complex types with sensible defaults.
 *
 * @example
 * ```typescript
 * // Create a turn with defaults
 * const turn = makeTurn();
 *
 * // Override specific fields
 * const turn = makeTurn({ turnIndex: 5, model: 'gpt-4.1' });
 *
 * // Create multiple turns
 * const turns = makeTurns(3);
 * ```
 */

/**
 * Creates a minimal TurnToolCall for testing.
 *
 * Provides sensible defaults for all required fields, with random IDs to avoid
 * collisions in tests that work with multiple tool calls.
 *
 * @param overrides - Partial TurnToolCall to override defaults
 * @returns A complete TurnToolCall object
 */
export function makeTurnToolCall(overrides: Partial<TurnToolCall> = {}): TurnToolCall {
  return {
    toolName: 'view',
    toolCallId: `tc-${Math.random().toString(36).slice(2, 8)}`,
    success: true,
    isComplete: true,
    durationMs: 200,
    startedAt: '2025-01-01T00:00:00.000Z',
    completedAt: '2025-01-01T00:00:00.200Z',
    ...overrides,
  };
}

/**
 * Creates a minimal ConversationTurn for testing.
 *
 * Provides sensible defaults for all required fields. Tool calls can be added
 * via the overrides or by using the provided helpers.
 *
 * @param overrides - Partial ConversationTurn to override defaults
 * @returns A complete ConversationTurn object
 *
 * @example
 * ```typescript
 * // Basic turn
 * const turn = makeTurn();
 *
 * // Turn with tool calls
 * const turn = makeTurn({
 *   toolCalls: [makeTurnToolCall({ toolName: 'edit' })]
 * });
 *
 * // Turn with specific index and message
 * const turn = makeTurn({
 *   turnIndex: 3,
 *   userMessage: 'Fix the bug'
 * });
 * ```
 */
export function makeTurn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    turnIndex: 0,
    userMessage: 'Test user message',
    assistantMessages: [
      {
        content: 'Test assistant response',
        agentDisplayName: 'main',
      } as AttributedMessage,
    ],
    model: 'gpt-4.1',
    toolCalls: [],
    durationMs: 5000,
    isComplete: true,
    timestamp: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Creates multiple ConversationTurn instances with sequential turnIndex values.
 *
 * Useful for tests that need a list of turns with proper indexing.
 *
 * @param count - Number of turns to create
 * @param baseOverrides - Partial ConversationTurn applied to all turns
 * @returns Array of ConversationTurn objects with sequential indices
 *
 * @example
 * ```typescript
 * // Create 5 turns with indices 0-4
 * const turns = makeTurns(5);
 *
 * // Create 3 turns, all with the same model
 * const turns = makeTurns(3, { model: 'claude-opus-4.5' });
 * ```
 */
export function makeTurns(
  count: number,
  baseOverrides: Partial<ConversationTurn> = {}
): ConversationTurn[] {
  return Array.from({ length: count }, (_, i) =>
    makeTurn({ ...baseOverrides, turnIndex: i })
  );
}

/**
 * Creates an AttributedMessage for testing.
 *
 * @param overrides - Partial AttributedMessage to override defaults
 * @returns A complete AttributedMessage object
 *
 * @example
 * ```typescript
 * const msg = makeAttributedMessage({
 *   content: 'Custom message',
 *   agentDisplayName: 'explore'
 * });
 * ```
 */
export function makeAttributedMessage(
  overrides: Partial<AttributedMessage> = {}
): AttributedMessage {
  return {
    content: 'Test message',
    agentDisplayName: 'main',
    ...overrides,
  } as AttributedMessage;
}

/**
 * Creates a TurnToolCall representing a subagent invocation.
 *
 * Convenience wrapper around makeTurnToolCall with subagent-specific defaults.
 *
 * @param overrides - Partial TurnToolCall to override defaults
 * @returns A TurnToolCall configured as a subagent invocation
 *
 * @example
 * ```typescript
 * const agentCall = makeSubagentToolCall({
 *   toolName: 'explore',
 *   agentDisplayName: 'Explore Agent'
 * });
 * ```
 */
export function makeSubagentToolCall(
  overrides: Partial<TurnToolCall> = {}
): TurnToolCall {
  return makeTurnToolCall({
    isSubagent: true,
    toolName: 'agent',
    agentDisplayName: 'Test Agent',
    agentDescription: 'A test subagent',
    ...overrides,
  });
}
