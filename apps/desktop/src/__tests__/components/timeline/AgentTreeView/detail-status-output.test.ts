import { makeTurn, makeTurnToolCall } from "@tracepilot/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { mountAgentTreeView, setupAgentTreeViewTest } from "./setup";

const ctx = setupAgentTreeViewTest();

describe("AgentTreeView detail status and output", () => {
  it("shows prompt in detail panel when subagent has arguments", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "code-review",
      isSubagent: true,
      toolCallId: "agent-prompt",
      agentDisplayName: "Code Review Agent",
      arguments: {
        prompt: "Review the auth module for vulnerabilities",
        agent_type: "code-review",
      },
    });

    ctx.store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })];

    const wrapper = mountAgentTreeView();
    // Click the subagent node to open detail panel
    const nodes = wrapper.findAll(".agent-node");
    const childNode = nodes.find((n) => n.text().includes("Code Review Agent"));
    expect(childNode).toBeDefined();
    await childNode?.trigger("click");
    await nextTick();

    expect(wrapper.find(".detail-panel").exists()).toBe(true);
    expect(wrapper.text()).toContain("Review the auth module for vulnerabilities");
  });

  it("in-progress subagent shows ⏳ and pulsing node class", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      isComplete: false,
      success: undefined,
      toolCallId: "agent-ip",
      agentDisplayName: "Running Agent",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: undefined,
      durationMs: undefined,
    });

    ctx.store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })];

    const wrapper = mountAgentTreeView();
    expect(wrapper.text()).toContain("⏳");
    const nodes = wrapper.findAll(".agent-node");
    const inProgressNode = nodes.find((n) => n.text().includes("Running Agent"));
    expect(inProgressNode).toBeDefined();
    expect(inProgressNode?.classes()).toContain("agent-node--in-progress");
  });

  it("main agent tool list includes subagent-spawning tool calls with agent badge", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-spawn-1",
      agentDisplayName: "Explore Agent",
      arguments: { agent_type: "explore", prompt: "Find auth code" },
    });
    const directTool = makeTurnToolCall({
      toolName: "view",
      isSubagent: false,
      toolCallId: "tc-view-1",
    });

    ctx.store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc, directTool] })];

    const wrapper = mountAgentTreeView();
    // Click main agent node to open detail panel
    const mainNode = wrapper.findAll(".agent-node").find((n) => n.text().includes("Main Agent"));
    expect(mainNode).toBeDefined();
    await mainNode?.trigger("click");
    await nextTick();

    const detailPanel = wrapper.find(".detail-panel");
    expect(detailPanel.exists()).toBe(true);
    // Should show both the subagent tool call and the direct tool
    expect(detailPanel.text()).toContain("Explore Agent");
    expect(detailPanel.text()).toContain("view");
    // Subagent tool call should appear as a nested-subagent activity row
    const nestedRows = wrapper.findAll(".sap-nested-subagent");
    expect(nestedRows.length).toBe(1);
  });

  it("in-progress node status icon has pulsing animation class", () => {
    const agentTc = makeTurnToolCall({
      toolName: "explore",
      isSubagent: true,
      isComplete: false,
      success: undefined,
      toolCallId: "agent-pulse",
      agentDisplayName: "Pulsing Agent",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: undefined,
      durationMs: undefined,
    });

    ctx.store.turns = [makeTurn({ turnIndex: 0, toolCalls: [agentTc] })];

    const wrapper = mountAgentTreeView();
    const statusIcons = wrapper.findAll(".agent-node-status--in-progress");
    expect(statusIcons.length).toBeGreaterThan(0);
  });

  it("shows failure reason when a failed subagent is selected", async () => {
    const failedAgent = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-fail",
      agentDisplayName: "Failing Agent",
      success: false,
      isComplete: true,
      error: "Agent exceeded maximum retries. Last error: connection timeout",
    });

    ctx.store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [failedAgent],
        assistantMessages: [{ content: "Starting task...", parentToolCallId: "agent-fail" }],
      }),
    ];

    const wrapper = mountAgentTreeView();
    const nodes = wrapper.findAll(".agent-node");
    const failedNode = nodes.find((n) => n.text().includes("Failing Agent"));
    expect(failedNode).toBeDefined();
    await failedNode?.trigger("click");
    await nextTick();

    const detailPanel = wrapper.find(".detail-panel");
    expect(detailPanel.exists()).toBe(true);
    // Should show status as failed
    expect(detailPanel.text().toLowerCase()).toContain("failed");
    // Should show failure reason section
    expect(detailPanel.find(".sap-failure").exists()).toBe(true);
    expect(detailPanel.find(".sap-failure-body").text()).toContain("connection timeout");
  });

  it("does not show failure reason for completed subagents", async () => {
    const successAgent = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-ok",
      agentDisplayName: "Success Agent",
      success: true,
      isComplete: true,
    });

    ctx.store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [successAgent],
        assistantMessages: [{ content: "Done!", parentToolCallId: "agent-ok" }],
      }),
    ];

    const wrapper = mountAgentTreeView();
    const nodes = wrapper.findAll(".agent-node");
    const okNode = nodes.find((n) => n.text().includes("Success Agent"));
    await okNode?.trigger("click");
    await nextTick();

    expect(wrapper.find(".sap-failure").exists()).toBe(false);
  });

  it("renders full output content without truncation", async () => {
    const longContent = "A".repeat(600);
    const agentTc = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-long",
      agentDisplayName: "Verbose Agent",
    });

    ctx.store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [{ content: longContent, parentToolCallId: "agent-long" }],
      }),
    ];

    const wrapper = mountAgentTreeView();
    const nodes = wrapper.findAll(".agent-node");
    const verboseNode = nodes.find((n) => n.text().includes("Verbose Agent"));
    await verboseNode?.trigger("click");
    await nextTick();

    // Full output renders inside the standalone Output section (no Show more/Show less toggle)
    const output = wrapper.find(".sap-block");
    expect(output.exists()).toBe(true);
    expect(output.text()).toContain("A".repeat(600));
  });

  it("renders short output without any toggle", async () => {
    const agentTc = makeTurnToolCall({
      toolName: "task",
      isSubagent: true,
      toolCallId: "agent-short",
      agentDisplayName: "Brief Agent",
    });

    ctx.store.turns = [
      makeTurn({
        turnIndex: 0,
        toolCalls: [agentTc],
        assistantMessages: [{ content: "Short answer", parentToolCallId: "agent-short" }],
      }),
    ];

    const wrapper = mountAgentTreeView();
    const nodes = wrapper.findAll(".agent-node");
    const briefNode = nodes.find((n) => n.text().includes("Brief Agent"));
    await briefNode?.trigger("click");
    await nextTick();

    // No truncation toggle in unified activity stream
    expect(wrapper.find(".output-toggle").exists()).toBe(false);
    expect(wrapper.find(".detail-output--collapsed").exists()).toBe(false);
  });
});
