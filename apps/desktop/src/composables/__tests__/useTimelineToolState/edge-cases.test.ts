import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import {
  createToolCall,
  createTurn,
  mountTimelineToolState,
  setupTimelineToolStateTest,
} from "./setup";

setupTimelineToolStateTest();

describe("useTimelineToolState edge cases", () => {
  it("toggles selection when selecting same tool by reference (no ID)", () => {
    const wrapper = mountTimelineToolState();
    const mockTool = createToolCall({ toolCallId: undefined });

    wrapper.vm.selectTool(mockTool);
    expect(wrapper.vm.selectedTool?.toolName).toBe("bash");

    wrapper.vm.selectTool(mockTool);
    expect(wrapper.vm.selectedTool?.toolName).toBeDefined();
  });

  it("isToolSelected checks tool selection", () => {
    const wrapper = mountTimelineToolState();
    const mockTool = createToolCall({ toolCallId: undefined });

    wrapper.vm.selectTool(mockTool);
    expect(wrapper.vm.selectedTool).toBeDefined();

    const differentTool = createToolCall({ toolCallId: undefined });
    expect(wrapper.vm.isToolSelected(differentTool)).toBe(false);
  });

  it("does not re-resolve if selected tool has no ID", async () => {
    const wrapper = mountTimelineToolState();
    const store = wrapper.vm.store;
    const mockTool = createToolCall({ toolCallId: undefined });
    const mockTurn = createTurn({ toolCalls: [mockTool] });

    store.turns = [mockTurn];
    await nextTick();

    wrapper.vm.selectTool(mockTool);
    expect(wrapper.vm.selectedTool?.toolName).toBe("bash");
    const originalArgs = wrapper.vm.selectedTool?.arguments;

    const newMockTool = createToolCall({
      arguments: '{"command":"pwd"}',
      toolCallId: undefined,
    });
    const newMockTurn = createTurn({ ...mockTurn, toolCalls: [newMockTool] });

    store.turns = [newMockTurn];
    await nextTick();

    expect(wrapper.vm.selectedTool?.arguments).toBe(originalArgs);
  });
});
