import { makeTurn, makeTurnToolCall } from "@tracepilot/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { mountAgentTreeView, setupAgentTreeViewTest } from "./setup";

const ctx = setupAgentTreeViewTest();

describe("AgentTreeView parallel groups and navigation", () => {
  it("parallel groups detect overlapping time ranges", () => {
    // Two subagents with overlapping time ranges
    const agent1 = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Agent A",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:05.000Z",
      durationMs: 5000,
    });
    const agent2 = makeTurnToolCall({
      toolName: "code-review",
      isSubagent: true,
      toolCallId: "agent-2",
      agentDisplayName: "Agent B",
      startedAt: "2025-01-01T00:00:02.000Z",
      completedAt: "2025-01-01T00:00:07.000Z",
      durationMs: 5000,
    });
    // Third non-overlapping agent to ensure we have multiple groups
    // (parallelGroups returns [] when there's only 1 group)
    const agent3 = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-3",
      agentDisplayName: "Agent C",
      startedAt: "2025-01-01T00:00:20.000Z",
      completedAt: "2025-01-01T00:00:25.000Z",
      durationMs: 5000,
    });
    const agent4 = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-4",
      agentDisplayName: "Agent D",
      startedAt: "2025-01-01T00:00:22.000Z",
      completedAt: "2025-01-01T00:00:27.000Z",
      durationMs: 5000,
    });

    ctx.store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agent1, agent2, agent3, agent4],
      }),
    ];

    const wrapper = mountAgentTreeView();
    // With 2+ parallel groups, parallel badges should appear
    const badges = wrapper.findAll(".parallel-badge");
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(wrapper.text()).toContain("Parallel Group");
  });

  it("nodes with no overlap are not grouped together", () => {
    const agent1 = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Agent A",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:02.000Z",
      durationMs: 2000,
    });
    const agent2 = makeTurnToolCall({
      toolName: "code-review",
      isSubagent: true,
      toolCallId: "agent-2",
      agentDisplayName: "Agent B",
      startedAt: "2025-01-01T00:00:10.000Z",
      completedAt: "2025-01-01T00:00:12.000Z",
      durationMs: 2000,
    });

    ctx.store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agent1, agent2] })];

    const wrapper = mountAgentTreeView();
    // No parallel badges should appear for non-overlapping agents
    const badges = wrapper.findAll(".parallel-badge");
    expect(badges).toHaveLength(0);
  });

  it("prev button disabled on first agent turn", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
    });

    ctx.store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })];

    const wrapper = mountAgentTreeView();
    const prevBtn = wrapper.find('button[aria-label="Previous agent turn"]');
    expect(prevBtn.attributes("disabled")).toBeDefined();
  });

  it("next button disabled on last agent turn", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-1",
    });

    ctx.store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })];

    const wrapper = mountAgentTreeView();
    const nextBtn = wrapper.find('button[aria-label="Next agent turn"]');
    expect(nextBtn.attributes("disabled")).toBeDefined();
  });

  it("renders unified session view with agents from all turns", async () => {
    // Turn 1: Subagent A
    const subA = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "sub-a",
      agentDisplayName: "Agent A",
    });
    // Turn 2: Subagent B
    const subB = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "sub-b",
      agentDisplayName: "Agent B",
    });

    ctx.store.turns = [
      makeTurn({ turnIndex: 1, toolCalls: [subA] }),
      makeTurn({ turnIndex: 2, toolCalls: [subB] }),
    ];

    const wrapper = mountAgentTreeView();
    await nextTick();

    // Default: Paginated view, only shows Agent A (from turn 1)
    expect(wrapper.text()).toContain("Agent A");
    expect(wrapper.text()).not.toContain("Agent B");

    // Switch to Unified mode
    const unifiedBtn = wrapper.findAll(".view-mode-btn").find((b) => b.text().includes("Unified"));
    await unifiedBtn?.trigger("click");
    await nextTick();

    // Now shows both agents
    expect(wrapper.text()).toContain("Agent A");
    expect(wrapper.text()).toContain("Agent B");

    // Turn navigation should be disabled in unified mode
    const navButtons = wrapper.findAll(".turn-nav-btn");
    navButtons.forEach((btn) => {
      expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
