import type { ConversationTurn } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { turnsToReplaySteps } from "../../utils/replayTransform";

function makeTurn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    turnIndex: 0,
    timestamp: "2025-01-15T10:30:00Z",
    durationMs: 3000,
    outputTokens: 500,
    model: "claude-sonnet-4",
    isComplete: true,
    userMessage: "",
    assistantMessages: [],
    reasoningTexts: [],
    toolCalls: [],
    sessionEvents: [],
    ...overrides,
  };
}

describe("turnsToReplaySteps", () => {
  it("returns empty array for empty input", () => {
    expect(turnsToReplaySteps([])).toEqual([]);
  });

  it("converts a user-message turn into a user-type step", () => {
    const turns = [makeTurn({ turnIndex: 0, userMessage: "Hello world" })];
    const steps = turnsToReplaySteps(turns);

    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe("user");
    expect(steps[0].userMessage).toBe("Hello world");
    expect(steps[0].turnIndex).toBe(0);
    expect(steps[0].index).toBe(0);
  });

  it("converts an assistant-only turn into an assistant-type step", () => {
    const turns = [
      makeTurn({
        turnIndex: 0,
        userMessage: "",
        assistantMessages: [{ content: "I will help you" }],
      }),
    ];
    const steps = turnsToReplaySteps(turns);

    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe("assistant");
    expect(steps[0].assistantMessages).toHaveLength(1);
  });

  it("converts a tool-only turn into a tool-type step", () => {
    const turns = [
      makeTurn({
        turnIndex: 0,
        userMessage: "",
        assistantMessages: [],
        toolCalls: [
          {
            toolName: "edit",
            toolCallId: "tc1",
            arguments: { path: "src/app.ts" },
            success: true,
            isComplete: true,
            durationMs: 200,
          },
        ],
      }),
    ];
    const steps = turnsToReplaySteps(turns);

    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe("tool");
    expect(steps[0].richToolCalls).toHaveLength(1);
  });

  it("assigns sequential indexes", () => {
    const turns = [
      makeTurn({ turnIndex: 0, userMessage: "First" }),
      makeTurn({ turnIndex: 1, userMessage: "Second" }),
      makeTurn({ turnIndex: 2, userMessage: "Third" }),
    ];
    const steps = turnsToReplaySteps(turns);

    expect(steps.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it("detects model switches between consecutive turns", () => {
    const turns = [
      makeTurn({ turnIndex: 0, model: "claude-sonnet-4", userMessage: "Hi" }),
      makeTurn({ turnIndex: 1, model: "claude-opus-4", userMessage: "Switch!" }),
    ];
    const steps = turnsToReplaySteps(turns);

    expect(steps[0].modelSwitchFrom).toBeUndefined();
    expect(steps[1].modelSwitchFrom).toBe("claude-sonnet-4");
  });

  it("does not flag model switch when model is the same", () => {
    const turns = [
      makeTurn({ turnIndex: 0, model: "claude-sonnet-4", userMessage: "Hi" }),
      makeTurn({ turnIndex: 1, model: "claude-sonnet-4", userMessage: "Hello" }),
    ];
    const steps = turnsToReplaySteps(turns);

    expect(steps[1].modelSwitchFrom).toBeUndefined();
  });

  it("extracts files modified from tool call args", () => {
    const turns = [
      makeTurn({
        turnIndex: 0,
        userMessage: "",
        toolCalls: [
          {
            toolName: "edit",
            toolCallId: "tc1",
            arguments: { path: "src/main.ts" },
            success: true,
            isComplete: true,
          },
          {
            toolName: "create",
            toolCallId: "tc2",
            arguments: { path: "src/new-file.ts" },
            success: true,
            isComplete: true,
          },
        ],
      }),
    ];
    const steps = turnsToReplaySteps(turns);

    expect(steps[0].filesModified).toBeDefined();
    expect(steps[0].filesModified?.length).toBeGreaterThanOrEqual(1);
  });

  it("derives title from user message for user-type steps", () => {
    const turns = [makeTurn({ turnIndex: 0, userMessage: "Please implement auth module" })];
    const steps = turnsToReplaySteps(turns);

    expect(steps[0].title).toContain("auth module");
  });

  it("handles incomplete turns", () => {
    const turns = [
      makeTurn({
        turnIndex: 0,
        isComplete: false,
        userMessage: "Still going",
      }),
    ];
    const steps = turnsToReplaySteps(turns);

    expect(steps).toHaveLength(1);
    expect(steps[0].title).toBeDefined();
  });

  it("populates session events on the step", () => {
    const turns = [
      makeTurn({
        turnIndex: 0,
        userMessage: "test",
        sessionEvents: [
          { eventType: "session.compaction", severity: "info", summary: "Context compacted" },
        ],
      }),
    ];
    const steps = turnsToReplaySteps(turns);

    expect(steps[0].sessionEvents).toHaveLength(1);
    expect(steps[0].sessionEvents?.[0].eventType).toBe("session.compaction");
  });

  it("handles turns with reasoning texts", () => {
    const turns = [
      makeTurn({
        turnIndex: 0,
        userMessage: "",
        reasoningTexts: [{ content: "Let me think about this..." }],
        assistantMessages: [{ content: "Here is my answer" }],
      }),
    ];
    const steps = turnsToReplaySteps(turns);

    expect(steps[0].reasoningTexts).toHaveLength(1);
  });

  it("maps tokens correctly", () => {
    const turns = [makeTurn({ turnIndex: 0, outputTokens: 1234, userMessage: "test" })];
    const steps = turnsToReplaySteps(turns);

    expect(steps[0].tokens).toBe(1234);
  });

  it("maps model correctly", () => {
    const turns = [makeTurn({ turnIndex: 0, model: "gpt-5.4", userMessage: "test" })];
    const steps = turnsToReplaySteps(turns);

    expect(steps[0].model).toBe("gpt-5.4");
  });
});
