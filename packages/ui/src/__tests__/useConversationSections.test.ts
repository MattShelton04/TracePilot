import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import { useConversationSections } from "../composables/useConversationSections";

function makeToolCall(overrides: Partial<TurnToolCall> = {}): TurnToolCall {
  return {
    toolName: "view",
    isComplete: true,
    ...overrides,
  };
}

function makeTurn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    turnIndex: 0,
    assistantMessages: [],
    toolCalls: [],
    isComplete: true,
    ...overrides,
  };
}

describe("useConversationSections", () => {
  describe("getSections", () => {
    it("returns sections for a turn with no subagents", () => {
      const turns = ref<ConversationTurn[]>([
        makeTurn({
          turnIndex: 0,
          assistantMessages: [{ content: "Hello" }],
          toolCalls: [makeToolCall({ toolCallId: "tc1" })],
        }),
      ]);
      const { getSections } = useConversationSections(() => turns.value);

      const sections = getSections(0);
      expect(sections).toHaveLength(1);
      expect(sections[0].agentId).toBeUndefined();
      expect(sections[0].messages).toEqual(["Hello"]);
      expect(sections[0].toolCalls).toHaveLength(1);
    });

    it("returns sections grouped by subagent", () => {
      const turns = ref<ConversationTurn[]>([
        makeTurn({
          turnIndex: 0,
          assistantMessages: [
            { content: "Main message" },
            { content: "Sub message", parentToolCallId: "sub-1" },
          ],
          toolCalls: [
            makeToolCall({ toolCallId: "sub-1", toolName: "task", isSubagent: true }),
            makeToolCall({ toolCallId: "child-1", parentToolCallId: "sub-1" }),
          ],
        }),
      ]);
      const { getSections } = useConversationSections(() => turns.value);

      const sections = getSections(0);
      expect(sections.length).toBeGreaterThan(1);

      const mainSection = sections.find((s) => !s.agentId);
      expect(mainSection).toBeDefined();
      expect(mainSection?.messages).toEqual(["Main message"]);

      const subSection = sections.find((s) => s.agentId === "sub-1");
      expect(subSection).toBeDefined();
      expect(subSection?.messages).toEqual(["Sub message"]);
    });

    it("returns empty array for unknown turn index", () => {
      const turns = ref<ConversationTurn[]>([]);
      const { getSections } = useConversationSections(() => turns.value);
      expect(getSections(999)).toEqual([]);
    });
  });

  describe("getArgsSummary", () => {
    it("returns formatted args summary for tool calls", () => {
      const turns = ref<ConversationTurn[]>([
        makeTurn({
          turnIndex: 0,
          toolCalls: [
            makeToolCall({
              toolCallId: "tc1",
              toolName: "view",
              arguments: { path: "/some/file.ts" },
            }),
          ],
        }),
      ]);
      const { getArgsSummary } = useConversationSections(() => turns.value);
      expect(getArgsSummary(0, 0)).toContain("/some/file.ts");
    });

    it("returns empty string for non-existent indices", () => {
      const turns = ref<ConversationTurn[]>([]);
      const { getArgsSummary } = useConversationSections(() => turns.value);
      expect(getArgsSummary(0, 0)).toBe("");
    });
  });

  describe("findToolCallIndex", () => {
    it("finds index by toolCallId via pre-computed map", () => {
      const tc1 = makeToolCall({ toolCallId: "tc-a", toolName: "grep" });
      const tc2 = makeToolCall({ toolCallId: "tc-b", toolName: "edit" });
      const tc3 = makeToolCall({ toolCallId: "tc-c", toolName: "view" });
      const turn = makeTurn({
        turnIndex: 0,
        toolCalls: [tc1, tc2, tc3],
      });
      const turns = ref<ConversationTurn[]>([turn]);
      const { findToolCallIndex } = useConversationSections(() => turns.value);

      expect(findToolCallIndex(turn, tc1)).toBe(0);
      expect(findToolCallIndex(turn, tc2)).toBe(1);
      expect(findToolCallIndex(turn, tc3)).toBe(2);
    });

    it("falls back to linear scan when toolCallId missing", () => {
      const tc1 = makeToolCall({ toolName: "grep" });
      const tc2 = makeToolCall({ toolName: "edit" });
      const turn = makeTurn({
        turnIndex: 0,
        toolCalls: [tc1, tc2],
      });
      const turns = ref<ConversationTurn[]>([turn]);
      const { findToolCallIndex } = useConversationSections(() => turns.value);

      expect(findToolCallIndex(turn, tc1)).toBe(0);
      expect(findToolCallIndex(turn, tc2)).toBe(1);
    });
  });

  describe("totalToolCalls", () => {
    it("sums tool calls across all turns", () => {
      const turns = ref<ConversationTurn[]>([
        makeTurn({ turnIndex: 0, toolCalls: [makeToolCall(), makeToolCall(), makeToolCall()] }),
        makeTurn({ turnIndex: 1, toolCalls: [makeToolCall()] }),
        makeTurn({ turnIndex: 2, toolCalls: [] }),
      ]);
      const { totalToolCalls } = useConversationSections(() => turns.value);
      expect(totalToolCalls.value).toBe(4);
    });

    it("returns 0 for empty turns", () => {
      const turns = ref<ConversationTurn[]>([]);
      const { totalToolCalls } = useConversationSections(() => turns.value);
      expect(totalToolCalls.value).toBe(0);
    });
  });

  describe("totalDurationMs", () => {
    it("sums duration across all turns", () => {
      const turns = ref<ConversationTurn[]>([
        makeTurn({ turnIndex: 0, durationMs: 1000 }),
        makeTurn({ turnIndex: 1, durationMs: 2500 }),
        makeTurn({ turnIndex: 2 }),
      ]);
      const { totalDurationMs } = useConversationSections(() => turns.value);
      expect(totalDurationMs.value).toBe(3500);
    });

    it("returns 0 for empty turns", () => {
      const turns = ref<ConversationTurn[]>([]);
      const { totalDurationMs } = useConversationSections(() => turns.value);
      expect(totalDurationMs.value).toBe(0);
    });
  });

  describe("reactivity", () => {
    it("updates sections when turns change", async () => {
      const turns = ref<ConversationTurn[]>([]);
      const { getSections, totalToolCalls } = useConversationSections(() => turns.value);

      expect(getSections(0)).toEqual([]);
      expect(totalToolCalls.value).toBe(0);

      turns.value = [
        makeTurn({
          turnIndex: 0,
          assistantMessages: [{ content: "New" }],
          toolCalls: [makeToolCall({ toolCallId: "tc1" })],
        }),
      ];
      await nextTick();

      expect(getSections(0)).toHaveLength(1);
      expect(totalToolCalls.value).toBe(1);
    });
  });
});
