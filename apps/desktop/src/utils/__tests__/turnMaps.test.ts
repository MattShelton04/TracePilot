import type { ConversationTurn } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { mapByTurnIndex } from "../turnMaps";

function makeTurn(partial: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    turnIndex: 0,
    assistantMessages: [],
    toolCalls: [],
    isComplete: true,
    ...partial,
  };
}

describe("mapByTurnIndex", () => {
  it("returns an empty map for empty input", () => {
    const result = mapByTurnIndex([], (t) => t.turnIndex);
    expect(result.size).toBe(0);
  });

  it("maps a single turn keyed by turnIndex", () => {
    const turn = makeTurn({ turnIndex: 3, assistantMessages: [{ content: "hi" }] });
    const result = mapByTurnIndex([turn], (t) => t.assistantMessages.length);
    expect(result.size).toBe(1);
    expect(result.get(3)).toBe(1);
  });

  it("preserves last-wins semantics for overlapping turnIndex values", () => {
    const a = makeTurn({ turnIndex: 2, assistantMessages: [{ content: "first" }] });
    const b = makeTurn({ turnIndex: 2, assistantMessages: [{ content: "second" }] });
    const result = mapByTurnIndex([a, b], (t) => t.assistantMessages[0]?.content ?? "");
    expect(result.size).toBe(1);
    expect(result.get(2)).toBe("second");
  });

  it("applies the projection function to each turn", () => {
    const turns = [
      makeTurn({ turnIndex: 0 }),
      makeTurn({ turnIndex: 1 }),
      makeTurn({ turnIndex: 4 }),
    ];
    const result = mapByTurnIndex(turns, (t) => t.turnIndex * 10);
    expect([...result.entries()]).toEqual([
      [0, 0],
      [1, 10],
      [4, 40],
    ]);
  });
});
