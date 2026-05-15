import type { ConversationTurn } from "@tracepilot/types";

/**
 * Build a `Map<turnIndex, T>` by applying `fn` to each turn.
 *
 * When multiple turns share the same `turnIndex`, the last one wins. This
 * mirrors the inline `for … map.set(turn.turnIndex, …)` pattern used across
 * the conversation view layer.
 */
export function mapByTurnIndex<T>(
  turns: readonly ConversationTurn[],
  fn: (turn: ConversationTurn) => T,
): Map<number, T> {
  const map = new Map<number, T>();
  for (const turn of turns) {
    map.set(turn.turnIndex, fn(turn));
  }
  return map;
}
