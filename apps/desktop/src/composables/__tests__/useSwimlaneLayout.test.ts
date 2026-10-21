import type { ConversationTurn } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { groupPhases, phaseDurationMs, toolTooltip } from "../useSwimlaneLayout";

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

  it("labels a phase with pasted text, not the wrapper tags", () => {
    const phases = groupPhases([
      turn({
        userMessage: 'Explain:\n\n<pasted_content id="1">\nstack trace\n</pasted_content id="1">',
      }),
    ]);
    expect(phases[0].label).toBe("Explain:\n\nstack trace");
  });
});

describe("phaseDurationMs", () => {
  const phase = (...durations: (number | undefined)[]) => ({
    index: 0,
    label: "a",
    turns: durations.map((durationMs) => turn({ durationMs })),
  });

  it("is null, not 0, when no turn recorded a duration", () => {
    expect(phaseDurationMs(phase(undefined))).toBeNull();
    expect(phaseDurationMs(phase(undefined, undefined))).toBeNull();
  });

  it("sums the turns that recorded one", () => {
    expect(phaseDurationMs(phase(2000, undefined, 3000))).toBe(5000);
  });
});

it("shows native tool names in swimlane tooltips and preserves canonical argument formatting", () => {
  const call = { toolName: "shell", arguments: { command: "pnpm test" }, isComplete: true };
  expect(toolTooltip({ ...call, nativeToolName: "Bash" })).toBe("Bash · pnpm test · In Progress");
  expect(toolTooltip({ ...call, toolName: "powershell" })).toBe(
    "powershell · pnpm test · In Progress",
  );
});
