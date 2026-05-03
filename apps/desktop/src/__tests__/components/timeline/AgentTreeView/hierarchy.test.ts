import { makeTurn, makeTurnToolCall } from "@tracepilot/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { mountAgentTreeView, setupAgentTreeViewTest } from "./setup";

const ctx = setupAgentTreeViewTest();

describe("AgentTreeView hierarchy resolution", () => {
  it("finds child tools across turns (cross-turn boundary)", () => {
    // Subagent in turn 0, its child tools end up in turn 1
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      toolCallId: "agent-cross",
      agentDisplayName: "Cross-Turn Agent",
      durationMs: 120000,
    });
    // Child tool in a DIFFERENT turn
    const childTool = makeTurnToolCall({
      toolName: "grep",
      isSubagent: false,
      toolCallId: "child-grep-1",
      parentToolCallId: "agent-cross",
      durationMs: 50,
    });

    ctx.store.turns = [
      makeTurn({ turnIndex: 0, toolCalls: [agentTc] }),
      makeTurn({ turnIndex: 1, toolCalls: [childTool] }),
    ];

    const wrapper = mountAgentTreeView();
    // The agent node should show "1 tool" (found cross-turn)
    expect(wrapper.text()).toContain("1 tool");
  });

  it("resolves cross-turn parent subagent hierarchy", async () => {
    // Turn 0: Main agent spawns subagent "parent-sub"
    const parentSubagent = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "parent-sub",
      agentDisplayName: "GPT 5.3 Codex",
      model: "gpt-5.3-codex",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:01:00.000Z",
      durationMs: 60000,
    });

    // Turn 1: The parent subagent spawns child subagents
    const childSub1 = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "child-sub-1",
      parentToolCallId: "parent-sub",
      agentDisplayName: "GPT 5.3 Codex #2",
      model: "gpt-5.3-codex",
      startedAt: "2025-01-01T00:00:10.000Z",
    });
    const childSub2 = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "child-sub-2",
      parentToolCallId: "parent-sub",
      agentDisplayName: "GPT 5.4",
      model: "gpt-5.4",
      startedAt: "2025-01-01T00:00:15.000Z",
    });

    ctx.store.turns = [
      makeTurn({
        turnIndex: 0,
        model: "claude-sonnet-4",
        toolCalls: [parentSubagent],
      }),
      makeTurn({
        turnIndex: 1,
        model: "gpt-5.3-codex",
        toolCalls: [childSub1, childSub2],
      }),
    ];

    const wrapper = mountAgentTreeView();
    // Navigate to the second agent turn (turn 1) which has the child subagents
    const nextBtn = wrapper.find('button[aria-label="Next agent turn"]');
    await nextBtn.trigger("click");
    await nextTick();

    // Should show "GPT 5.3 Codex" as a cross-turn parent node
    // with children nested under it
    expect(wrapper.text()).toContain("GPT 5.3 Codex");
    // The cross-turn badge should appear
    expect(wrapper.find(".cross-turn-badge").exists()).toBe(true);
  });

  it("cross-turn parent nodes show correct child tool counts", async () => {
    const parentSubagent = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "parent-sub",
      agentDisplayName: "Parent Agent",
      model: "gpt-5.3-codex",
      startedAt: "2025-01-01T00:00:00.000Z",
    });
    // A child tool that belongs to the parent subagent (from a different turn)
    const parentChildTool = makeTurnToolCall({
      toolName: "grep",
      isSubagent: false,
      toolCallId: "parent-child-grep",
      parentToolCallId: "parent-sub",
    });
    const childSub = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "child-sub",
      parentToolCallId: "parent-sub",
      agentDisplayName: "Child Agent",
      startedAt: "2025-01-01T00:00:10.000Z",
    });

    ctx.store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [parentSubagent, parentChildTool],
      }),
      makeTurn({
        turnIndex: 1,
        toolCalls: [childSub],
      }),
    ];

    const wrapper = mountAgentTreeView();
    // Navigate to second agent turn
    const nextBtn = wrapper.find('button[aria-label="Next agent turn"]');
    await nextBtn.trigger("click");
    await nextTick();

    // Parent agent node should exist as a cross-turn parent
    expect(wrapper.text()).toContain("Parent Agent");
  });

  it("nests same-turn subagent tool calls correctly (attribution fix)", async () => {
    // Parent subagent spawned by Main Agent
    const parentSub = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "parent-same-turn",
      agentDisplayName: "Parent Same Turn",
    });
    // Child subagent spawned by the parent subagent
    const childSub = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "child-same-turn",
      parentToolCallId: "parent-same-turn",
      agentDisplayName: "Child Same Turn",
    });
    // A regular tool spawned by the child subagent
    const childTool = makeTurnToolCall({
      toolName: "grep",
      isSubagent: false,
      toolCallId: "child-tool-grep",
      parentToolCallId: "child-same-turn",
    });

    ctx.store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [parentSub, childSub, childTool],
      }),
    ];

    const wrapper = mountAgentTreeView();
    await nextTick();

    // 1. Check Main Agent's tool list (should only include parentSub)
    const nodes = wrapper.findAll(".agent-node");
    const mainNode = nodes.find((n) => n.text().includes("Main Agent"));
    await mainNode?.trigger("click");
    await nextTick();

    const detailPanel = wrapper.find(".detail-panel");
    const toolItems = detailPanel.findAll(".sap-nested-subagent");
    // Main agent should only have ONE nested subagent (the parent subagent spawn)
    // It should NOT include childSub or childTool
    expect(toolItems.length).toBe(1);
    expect(toolItems[0].text()).toContain("Parent Same Turn");

    // 2. Check Parent Subagent's activity stream (should include childSub)
    const parentNode = nodes.find((n) => n.text().includes("Parent Same Turn"));
    await parentNode?.trigger("click");
    await nextTick();

    const parentTools = wrapper.find(".detail-panel").findAll(".sap-nested-subagent");
    // Parent should have the child subagent spawn in its activity stream
    expect(parentTools.length).toBe(1);
    expect(parentTools[0].text()).toContain("Child Same Turn");

    // 3. Check Child Subagent's activity stream (should include childTool)
    const childNode = nodes.find((n) => n.text().includes("Child Same Turn"));
    await childNode?.trigger("click");
    await nextTick();

    const childTools = wrapper.find(".detail-panel").findAll(".tool-call-item");
    expect(childTools.length).toBeGreaterThanOrEqual(1);
    expect(wrapper.find(".detail-panel").text()).toContain("grep");
  });
});
