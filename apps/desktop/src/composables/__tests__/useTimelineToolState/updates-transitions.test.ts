import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import {
  createToolCall,
  createTurn,
  mountTimelineToolState,
  setupTimelineToolStateTest,
} from "./setup";

setupTimelineToolStateTest();

describe("useTimelineToolState updates and transitions", () => {
  it("provides expandedToolCalls toggle set", () => {
    const wrapper = mountTimelineToolState();
    const { expandedToolCalls } = wrapper.vm;

    expect(expandedToolCalls.has("test-id")).toBe(false);
    expandedToolCalls.set.value.add("test-id");
    expect(expandedToolCalls.has("test-id")).toBe(true);
    expandedToolCalls.set.value.delete("test-id");
    expect(expandedToolCalls.has("test-id")).toBe(false);
  });

  it("provides expandedReasoning toggle set", () => {
    const wrapper = mountTimelineToolState();
    const { expandedReasoning } = wrapper.vm;

    expect(expandedReasoning.has("reasoning-1")).toBe(false);
    expandedReasoning.set.value.add("reasoning-1");
    expect(expandedReasoning.has("reasoning-1")).toBe(true);
  });

  it("provides expandedOutputs toggle set", () => {
    const wrapper = mountTimelineToolState();
    const { expandedOutputs } = wrapper.vm;

    expect(expandedOutputs.has("output-1")).toBe(false);
    expandedOutputs.set.value.add("output-1");
    expect(expandedOutputs.has("output-1")).toBe(true);
  });

  it("clears all expansion state with clearAllState", () => {
    const wrapper = mountTimelineToolState();
    const { expandedToolCalls, expandedReasoning, expandedOutputs, clearAllState } = wrapper.vm;

    expandedToolCalls.set.value.add("tc-1");
    expandedReasoning.set.value.add("r-1");
    expandedOutputs.set.value.add("o-1");

    clearAllState();

    expect(expandedToolCalls.has("tc-1")).toBe(false);
    expect(expandedReasoning.has("r-1")).toBe(false);
    expect(expandedOutputs.has("o-1")).toBe(false);
  });

  it("selects a tool", () => {
    const wrapper = mountTimelineToolState();
    const mockTool = createToolCall();

    wrapper.vm.selectTool(mockTool);

    expect(wrapper.vm.selectedTool?.toolCallId).toBe("tc-1");
    expect(wrapper.vm.selectedTool?.toolName).toBe("bash");
  });

  it("toggles selection when selecting same tool by ID", () => {
    const wrapper = mountTimelineToolState();
    const mockTool = createToolCall();

    wrapper.vm.selectTool(mockTool);
    expect(wrapper.vm.selectedTool?.toolCallId).toBe("tc-1");

    wrapper.vm.selectTool(mockTool);
    expect(wrapper.vm.selectedTool).toBe(null);
  });

  it("clears selection with clearSelection", () => {
    const wrapper = mountTimelineToolState();
    const mockTool = createToolCall();

    wrapper.vm.selectTool(mockTool);
    expect(wrapper.vm.selectedTool?.toolCallId).toBe("tc-1");

    wrapper.vm.clearSelection();
    expect(wrapper.vm.selectedTool).toBe(null);
  });

  it("clears selection with clearAllState", () => {
    const wrapper = mountTimelineToolState();
    const mockTool = createToolCall();

    wrapper.vm.selectTool(mockTool);
    expect(wrapper.vm.selectedTool?.toolCallId).toBe("tc-1");

    wrapper.vm.clearAllState();
    expect(wrapper.vm.selectedTool).toBe(null);
  });

  it("re-resolves selected tool on data refresh", async () => {
    const wrapper = mountTimelineToolState();
    const store = wrapper.vm.store;
    const mockTool = createToolCall();
    const mockTurn = createTurn({ toolCalls: [mockTool] });

    store.turns = [mockTurn];
    await nextTick();

    wrapper.vm.selectTool(mockTool);
    expect(wrapper.vm.selectedTool?.toolCallId).toBe("tc-1");
    expect(wrapper.vm.selectedTool?.arguments).toBe('{"command":"ls"}');

    const newMockTool = createToolCall({ arguments: '{"command":"pwd"}' });
    const newMockTurn = createTurn({ ...mockTurn, toolCalls: [newMockTool] });

    store.turns = [newMockTurn];
    await nextTick();

    expect(wrapper.vm.selectedTool?.toolCallId).toBe("tc-1");
    expect(wrapper.vm.selectedTool?.arguments).toBe('{"command":"pwd"}');
  });

  it("clears selection when selected tool is removed from store", async () => {
    const wrapper = mountTimelineToolState();
    const store = wrapper.vm.store;
    const mockTool = createToolCall();
    const mockTurn = createTurn({ toolCalls: [mockTool] });

    store.turns = [mockTurn];
    await nextTick();

    wrapper.vm.selectTool(mockTool);
    expect(wrapper.vm.selectedTool?.toolCallId).toBe("tc-1");

    store.turns = [];
    await nextTick();

    expect(wrapper.vm.selectedTool).toBe(null);
  });
});
