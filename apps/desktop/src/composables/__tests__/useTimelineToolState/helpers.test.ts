import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { describe, expect, it, vi } from "vitest";
import {
  createToolCall,
  createTurn,
  mountTimelineToolState,
  setupTimelineToolStateTest,
} from "./setup";

setupTimelineToolStateTest();

describe("useTimelineToolState helper functions", () => {
  it("isToolSelected returns true for selected tool by ID", () => {
    const wrapper = mountTimelineToolState();
    const mockTool = createToolCall();

    wrapper.vm.selectTool(mockTool);
    expect(wrapper.vm.isToolSelected(mockTool)).toBe(true);

    const sameIdTool = createToolCall();
    expect(wrapper.vm.isToolSelected(sameIdTool)).toBe(true);
  });

  it("isToolSelected returns false for non-selected tool", () => {
    const wrapper = mountTimelineToolState();
    const toolA = createToolCall();
    const toolB = createToolCall({
      toolName: "read",
      arguments: '{"path":"file.ts"}',
      toolCallId: "tc-2",
    });

    wrapper.vm.selectTool(toolA);

    expect(wrapper.vm.isToolSelected(toolB)).toBe(false);
  });

  it("returns undefined when no turnOwnershipCheck provided", () => {
    const wrapper = mountTimelineToolState();

    expect(wrapper.vm.turnOwnsSelected).toBeUndefined();
  });

  it("uses custom turnOwnershipCheck function", () => {
    const turnOwnershipCheck = vi.fn((turn: ConversationTurn, tool: TurnToolCall) => {
      return turn.toolCalls.some((tc) => tc.toolCallId === tool.toolCallId);
    });

    const wrapper = mountTimelineToolState({ turnOwnershipCheck });
    expect(wrapper.vm.turnOwnsSelected).toBeDefined();
    expect(typeof wrapper.vm.turnOwnsSelected).toBe("function");

    const mockTool = createToolCall();
    const mockTurn = createTurn({ toolCalls: [mockTool] });

    wrapper.vm.selectTool(mockTool);
    const result = wrapper.vm.turnOwnsSelected?.(mockTurn);

    expect(result).toBe(true);
    expect(turnOwnershipCheck).toHaveBeenCalled();
    const call = turnOwnershipCheck.mock.calls[0];
    expect(call[0]).toMatchObject(mockTurn);
    expect(call[1].toolCallId).toBe("tc-1");
  });

  it("turnOwnsSelected returns false when no tool is selected", () => {
    const turnOwnershipCheck = vi.fn(() => true);
    const wrapper = mountTimelineToolState({ turnOwnershipCheck });
    const mockTurn = createTurn();

    const result = wrapper.vm.turnOwnsSelected?.(mockTurn);

    expect(result).toBe(false);
    expect(turnOwnershipCheck).not.toHaveBeenCalled();
  });
});
