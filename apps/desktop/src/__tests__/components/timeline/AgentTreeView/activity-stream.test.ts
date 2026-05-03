import { makeTurn, makeTurnToolCall } from "@tracepilot/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { mountAgentTreeView, setupAgentTreeViewTest } from "./setup";

const ctx = setupAgentTreeViewTest();

describe("AgentTreeView activity stream", () => {
  it("shows output section when a subagent with messages is selected", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Explore Agent",
    });

    ctx.store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [
          { content: "Main agent text" },
          { content: "Subagent found the answer", parentToolCallId: "agent-1" },
        ],
      }),
    ];

    const wrapper = mountAgentTreeView();
    // Select the subagent node (second node after main)
    const nodes = wrapper.findAll(".agent-node");
    const subagentNode = nodes.find((n) => n.text().includes("Explore Agent"));
    expect(subagentNode).toBeDefined();
    await subagentNode?.trigger("click");
    await nextTick();

    const detailPanel = wrapper.find(".detail-panel");
    expect(detailPanel.exists()).toBe(true);
    // Output section renders subagent's final message
    expect(detailPanel.text()).toContain("Output");
    expect(detailPanel.text()).toContain("Subagent found the answer");
    // Main agent text should NOT appear anywhere in the subagent's panel
    expect(detailPanel.text()).not.toContain("Main agent text");
  });

  it("shows reasoning interleaved in activity stream, expanded by default", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Thinking Agent",
    });

    ctx.store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [{ content: "Result", parentToolCallId: "agent-1" }],
        reasoningTexts: [{ content: "Let me think about this...", parentToolCallId: "agent-1" }],
      }),
    ];

    const wrapper = mountAgentTreeView();
    const nodes = wrapper.findAll(".agent-node");
    const subagentNode = nodes.find((n) => n.text().includes("Thinking Agent"));
    await subagentNode?.trigger("click");
    await nextTick();

    const detailPanel = wrapper.find(".detail-panel");
    // Reasoning block appears in activity stream with content visible by default
    const reasoningBlocks = detailPanel.findAll(".sap-reasoning");
    expect(reasoningBlocks.length).toBe(1);
    expect(detailPanel.find(".sap-reasoning-content").exists()).toBe(true);
    expect(detailPanel.find(".sap-reasoning-content").text()).toContain(
      "Let me think about this...",
    );

    // Clicking the toggle collapses the reasoning content
    await detailPanel.find(".sap-reasoning-toggle").trigger("click");
    await nextTick();
    expect(detailPanel.find(".sap-reasoning-content").exists()).toBe(false);
  });

  it("main agent node excludes subagent-attributed messages", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Sub Agent",
    });

    ctx.store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [
          { content: "Main says hello" },
          { content: "Sub says hello", parentToolCallId: "agent-1" },
        ],
      }),
    ];

    const wrapper = mountAgentTreeView();
    // Select main agent node (first node)
    const nodes = wrapper.findAll(".agent-node");
    const mainNode = nodes.find((n) => n.text().includes("Main Agent"));
    expect(mainNode).toBeDefined();
    await mainNode?.trigger("click");
    await nextTick();

    const detailPanel = wrapper.find(".detail-panel");
    expect(detailPanel.exists()).toBe(true);
    // Main output should contain only main agent's message
    expect(detailPanel.text()).toContain("Main says hello");
    // Subagent message should NOT appear in main agent's activity stream
    const activities = detailPanel.find(".sap-activities");
    if (activities.exists()) {
      expect(activities.text()).not.toContain("Sub says hello");
    }
  });

  it("does not show output section when subagent has no messages", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-1",
      agentDisplayName: "Silent Agent",
    });

    ctx.store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [{ content: "Main only" }],
      }),
    ];

    const wrapper = mountAgentTreeView();
    const nodes = wrapper.findAll(".agent-node");
    const subagentNode = nodes.find((n) => n.text().includes("Silent Agent"));
    await subagentNode?.trigger("click");
    await nextTick();

    const detailPanel = wrapper.find(".detail-panel");
    expect(detailPanel.exists()).toBe(true);
    // No activity stream rendered when no tools/messages/reasoning
    expect(detailPanel.find(".sap-activities").exists()).toBe(false);
    expect(detailPanel.find(".sap-reasoning").exists()).toBe(false);
  });
});
