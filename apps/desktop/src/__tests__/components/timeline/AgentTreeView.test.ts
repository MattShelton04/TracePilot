import { makeTurn, makeTurnToolCall } from "@tracepilot/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { mountAgentTreeView, setupAgentTreeViewTest } from "./AgentTreeView/setup";

const ctx = setupAgentTreeViewTest();

describe("AgentTreeView basic rendering and selection", () => {
  it("renders empty state when no turns have subagents", () => {
    // Turns with only non-subagent tool calls
    ctx.store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [makeTurnToolCall({ isSubagent: false })],
      }),
    ];

    const wrapper = mountAgentTreeView();
    const empty = wrapper.find(".empty-state-stub");
    expect(empty.exists()).toBe(true);
    expect(wrapper.html()).toContain("No Agent Orchestration");
  });

  it("shows turn navigation for turns with subagents", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Explore Agent",
    });

    ctx.store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
      makeTurn({
        turnIndex: 1,
        toolCalls: [
          makeTurnToolCall({
            toolName: "task",
            isSubagent: true,
            toolCallId: "agent-2",
            agentDisplayName: "Task Agent",
          }),
        ],
      }),
    ];

    const wrapper = mountAgentTreeView();
    const navLabel = wrapper.find(".turn-nav-label");
    expect(navLabel.exists()).toBe(true);
    expect(navLabel.text()).toContain("1 of 2 with agents");
  });

  it("root node shows Main Agent with turn model", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Explore",
    });

    ctx.store.turns = [makeTurn({ turnIndex: 0, model: "gpt-4.1", toolCalls: [agentTc] })];

    const wrapper = mountAgentTreeView();
    expect(wrapper.text()).toContain("Main Agent");
    expect(wrapper.text()).toContain("gpt-4.1");
  });

  it("subagent child nodes appear with correct display names", () => {
    const agent1 = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Explore Agent",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:05.000Z",
      durationMs: 5000,
    });
    const agent2 = makeTurnToolCall({
      toolName: "code-review",
      isSubagent: true,
      toolCallId: "agent-2",
      agentDisplayName: "Code Review Agent",
      startedAt: "2025-01-01T00:00:06.000Z",
      completedAt: "2025-01-01T00:00:10.000Z",
      durationMs: 4000,
    });

    ctx.store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agent1, agent2] })];

    const wrapper = mountAgentTreeView();
    expect(wrapper.text()).toContain("Explore Agent");
    expect(wrapper.text()).toContain("Code Review Agent");
  });

  it("subagent nodes show their own model (tc.model) if available", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Explore Agent",
      model: "claude-haiku-4.5",
    });

    ctx.store.turns = [makeTurn({ turnIndex: 0, model: "gpt-4.1", toolCalls: [agentTc] })];

    const wrapper = mountAgentTreeView();
    // The agent node should show its own model
    expect(wrapper.text()).toContain("claude-haiku-4.5");
  });

  it("clicking a node selects it and shows detail panel", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Explore Agent",
    });

    ctx.store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })];

    const wrapper = mountAgentTreeView();
    // No detail panel initially
    expect(wrapper.find(".detail-panel").exists()).toBe(false);

    // Click a node
    const nodes = wrapper.findAll(".agent-node");
    expect(nodes.length).toBeGreaterThan(0);
    await nodes[0].trigger("click");
    await nextTick();

    expect(wrapper.find(".detail-panel").exists()).toBe(true);
  });

  it("clicking same node deselects it", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Explore Agent",
    });

    ctx.store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })];

    const wrapper = mountAgentTreeView();
    const nodes = wrapper.findAll(".agent-node");

    // Click to select
    await nodes[0].trigger("click");
    await nextTick();
    expect(wrapper.find(".detail-panel").exists()).toBe(true);

    // Click same node to deselect
    await nodes[0].trigger("click");
    await nextTick();
    expect(wrapper.find(".detail-panel").exists()).toBe(false);
  });
});
