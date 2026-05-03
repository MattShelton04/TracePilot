import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import {
  createToolCall,
  createTurn,
  mountTimelineToolState,
  setupTimelineToolStateTest,
} from "./setup";

setupTimelineToolStateTest();

describe("useTimelineToolState derived state", () => {
  it("starts with no selection", () => {
    const wrapper = mountTimelineToolState();

    expect(wrapper.vm.selectedTool).toBe(null);
  });

  it("computes allToolCalls from store turns", async () => {
    const wrapper = mountTimelineToolState();
    const store = wrapper.vm.store;

    const mockToolCall1: TurnToolCall = createToolCall({
      startedAt: "2024-01-01T00:00:00Z",
      completedAt: "2024-01-01T00:00:01Z",
      durationMs: 1000,
    });
    const mockToolCall2: TurnToolCall = createToolCall({
      toolName: "read",
      arguments: '{"path":"file.ts"}',
      startedAt: "2024-01-01T00:00:02Z",
      completedAt: "2024-01-01T00:00:03Z",
      durationMs: 1000,
      toolCallId: "tc-2",
    });

    const mockTurn1: ConversationTurn = createTurn({
      userMessage: "test message 1",
      toolCalls: [mockToolCall1],
    });
    const mockTurn2: ConversationTurn = createTurn({
      turnIndex: 1,
      timestamp: "2024-01-01T00:00:05Z",
      userMessage: undefined,
      toolCalls: [mockToolCall2],
    });

    store.turns = [mockTurn1, mockTurn2];
    await nextTick();

    expect(wrapper.vm.allToolCalls.length).toBe(2);
    expect(wrapper.vm.allToolCalls[0].toolCallId).toBe("tc-1");
    expect(wrapper.vm.allToolCalls[1].toolCallId).toBe("tc-2");
  });
});
