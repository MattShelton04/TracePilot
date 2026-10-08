import type { TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SubagentCard from "./SubagentCard.vue";

describe("subagent tool header", () => {
  const toolCall: TurnToolCall = {
    toolName: "task",
    agentDisplayName: "task",
    isSubagent: true,
    isComplete: true,
    success: true,
  };

  it("shows Claude's native Agent name", () => {
    const wrapper = mount(SubagentCard, {
      props: { toolCall: { ...toolCall, nativeToolName: "Agent" } },
    });
    expect(wrapper.get(".cv-subagent-badge").text()).toContain("Agent");
    expect(wrapper.get(".cv-subagent-badge").text()).not.toContain("task");
  });

  it("keeps Copilot's agent display name", () => {
    const wrapper = mount(SubagentCard, {
      props: { toolCall: { ...toolCall, agentDisplayName: "Explore Agent" } },
    });
    expect(wrapper.get(".cv-subagent-badge").text()).toContain("Explore Agent");
  });
});
