import type { ConversationTurn } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { groupPhases } from "../useSwimlaneLayout";

let next = 0;
function turn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    turnIndex: next++,
    assistantMessages: [],
    toolCalls: [],
    isComplete: true,
    ...overrides,
  };
}

const sizes = (turns: ConversationTurn[]) => groupPhases(turns).map((p) => p.turns.length);

describe("groupPhases", () => {
  it("keeps steering messages and notifications in the user turn they belong to", () => {
    const phases = groupPhases([
      turn({ userMessage: "fix the tests", userTurnIndex: 0 }),
      turn({ userMessage: "use vitest", userMessageDelivery: "steering", userTurnIndex: 0 }),
      turn({ userMessage: "<system_notification> done", systemInitiated: true, userTurnIndex: 0 }),
      turn({ userMessage: "now lint", userTurnIndex: 1 }),
    ]);
    expect(phases.map((p) => p.label)).toEqual(["fix the tests", "now lint"]);
    expect(phases.map((p) => p.turns.length)).toEqual([3, 1]);
  });

  it("falls back to typed user messages when turns have no user turn index", () => {
    expect(
      sizes([
        turn(),
        turn({ userMessage: "a" }),
        turn(),
        turn({ userMessage: "<system_notification> done", systemInitiated: true }),
        turn({ userMessage: "b" }),
      ]),
    ).toEqual([1, 3, 1]);
  });
});
