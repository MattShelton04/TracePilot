import type { ConversationTurn } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { groupPhases, toolTooltip } from "../useSwimlaneLayout";

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

describe("groupPhases", () => {
  it("keeps steering messages and notifications in the phase they belong to", () => {
    const phases = groupPhases([
      turn({ userMessage: "fix the tests" }),
      turn(),
      turn({ userMessage: "use vitest", userMessageDelivery: "steering" }),
      turn({ userMessage: "<system_notification> done", systemInitiated: true }),
      turn({ userMessage: "now lint" }),
    ]);
    expect(phases.map((p) => p.label)).toEqual(["fix the tests", "now lint"]);
    expect(phases.map((p) => p.turns.length)).toEqual([4, 1]);
  });

  it("groups turns before the first typed message into an implicit phase", () => {
    const phases = groupPhases([
      turn({ userMessage: "<system_notification> done", systemInitiated: true }),
      turn(),
      turn({ userMessage: "a" }),
    ]);
    expect(phases.map((p) => p.label)).toEqual(["(system)", "a"]);
    expect(phases.map((p) => p.turns.length)).toEqual([2, 1]);
  });
});

it("shows native tool names in swimlane tooltips and preserves canonical argument formatting", () => {
  const call = { toolName: "shell", arguments: { command: "pnpm test" }, isComplete: true };
  expect(toolTooltip({ ...call, nativeToolName: "Bash" })).toBe("Bash · pnpm test · In Progress");
  expect(toolTooltip({ ...call, toolName: "powershell" })).toBe(
    "powershell · pnpm test · In Progress",
  );
});
