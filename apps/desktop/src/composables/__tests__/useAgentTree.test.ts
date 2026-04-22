import { makeTurn, makeTurnToolCall, setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { useAgentTree } from "../useAgentTree";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../__tests__/mocks/client");
  return createClientMock({
    getSessionDetail: vi.fn(),
    getSessionTurns: vi.fn(),
    getSessionEvents: vi.fn(),
    getSessionTodos: vi.fn(),
    getSessionCheckpoints: vi.fn(),
    getShutdownMetrics: vi.fn(),
  });
});

function harness() {
  let api: ReturnType<typeof useAgentTree>;
  const Host = defineComponent({
    setup() {
      api = useAgentTree();
      return () => null;
    },
  });
  const wrapper = mount(Host);
  return { wrapper, api: api! };
}

describe("useAgentTree", () => {
  let store: ReturnType<typeof useSessionDetailStore>;

  beforeEach(() => {
    setupPinia();
    store = useSessionDetailStore();
  });

  it("exposes only turns that contain subagents via agentTurns", () => {
    store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [makeTurnToolCall({ isSubagent: false })] }),
      makeTurn({
        turnIndex: 1,
        toolCalls: [makeTurnToolCall({ isSubagent: true, toolCallId: "s1" })],
      }),
      makeTurn({ turnIndex: 2, toolCalls: [makeTurnToolCall({ isSubagent: false })] }),
    ];

    const { api } = harness();
    expect(api.agentTurns.value.map((t) => t.turnIndex)).toEqual([1]);
  });

  it("builds a paginated tree with a Main Agent root + subagent children", () => {
    store.turns = [
      makeTurn({
        turnIndex: 0,
        model: "gpt-4.1",
        toolCalls: [
          makeTurnToolCall({
            isSubagent: true,
            toolCallId: "explore-1",
            toolName: "explore",
            agentDisplayName: "Explore",
          }),
          makeTurnToolCall({ toolCallId: "view-1", toolName: "view" }),
        ],
      }),
    ];

    const { api } = harness();
    expect(api.treeData.value?.root.id).toBe("main");
    expect(api.treeData.value?.root.displayName).toBe("Main Agent");
    expect(api.treeData.value?.root.model).toBe("gpt-4.1");
    expect(api.treeData.value?.children.map((c) => c.displayName)).toEqual(["Explore"]);
  });

  it("toggles a node selection: first click selects, second deselects", () => {
    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [
          makeTurnToolCall({
            isSubagent: true,
            toolCallId: "s",
            agentDisplayName: "S",
          }),
        ],
      }),
    ];

    const { api } = harness();
    expect(api.selectedNode.value).toBeNull();

    api.selectNode("s");
    expect(api.selectedNode.value?.id).toBe("s");

    api.selectNode("s");
    expect(api.selectedNode.value).toBeNull();
  });

  it("closeDetail clears the current selection", () => {
    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [makeTurnToolCall({ isSubagent: true, toolCallId: "s" })],
      }),
    ];
    const { api } = harness();
    api.selectNode("s");
    expect(api.selectedNodeId.value).toBe("s");
    api.closeDetail();
    expect(api.selectedNodeId.value).toBeNull();
  });

  it("setViewMode switches to unified and aggregates every turn's subagents", async () => {
    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [makeTurnToolCall({ isSubagent: true, toolCallId: "a", agentDisplayName: "A" })],
      }),
      makeTurn({
        turnIndex: 1,
        toolCalls: [makeTurnToolCall({ isSubagent: true, toolCallId: "b", agentDisplayName: "B" })],
      }),
    ];

    const { api } = harness();
    expect(api.treeData.value?.children.map((c) => c.displayName)).toEqual(["A"]);

    api.setViewMode("unified");
    await nextTick();

    const displayNames = api.treeData.value?.children.map((c) => c.displayName) ?? [];
    expect(displayNames).toEqual(expect.arrayContaining(["A", "B"]));
  });

  it("hasInProgress flips to true when any subagent is still running", () => {
    store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [
          makeTurnToolCall({
            isSubagent: true,
            toolCallId: "inp",
            isComplete: false,
            success: undefined,
            startedAt: "2025-01-01T00:00:00.000Z",
          }),
        ],
      }),
    ];
    const { api } = harness();
    expect(api.hasInProgress.value).toBe(true);
  });
});
