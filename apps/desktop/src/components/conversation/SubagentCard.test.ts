import { setupPinia } from "@tracepilot/test-utils";
import type { TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { useSessionsStore } from "@/stores/sessions";
import SubagentCard from "./SubagentCard.vue";

beforeEach(() => setupPinia());

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

describe("subagent end state", () => {
  const unfinished: TurnToolCall = {
    toolName: "task",
    toolCallId: "agent-1",
    isSubagent: true,
    isComplete: false,
    startedAt: "2026-01-01T00:00:00.000Z",
  };
  type Item = ReturnType<typeof useSessionsStore>["sessions"][number];

  function mountIn(source: Item["source"], isRunning: boolean) {
    useSessionDetailStore().sessionId = "s-1";
    useSessionsStore().sessions = [{ id: "s-1", source, isRunning } as Item];
    return mount(SubagentCard, { props: { toolCall: unfinished } });
  }

  it("shows an unreported agent in an ended Claude session as No final report", () => {
    const wrapper = mountIn("claudeCode", false);
    expect(wrapper.get(".cv-subagent-status").classes()).toContain("unreported");
    expect(wrapper.get(".cv-subagent-unreported").text()).toBe("No final report");
    expect(wrapper.find(".cv-subagent-dur").exists()).toBe(false);
  });

  it("keeps the agent running while the Claude session is live", () => {
    const wrapper = mountIn("claudeCode", true);
    expect(wrapper.get(".cv-subagent-status").classes()).toContain("pending");
    expect(wrapper.get(".cv-subagent-status").attributes("title")).toBe("Running");
    expect(wrapper.find(".cv-subagent-unreported").exists()).toBe(false);
  });

  it("keeps Copilot agents running after the session ends", () => {
    const wrapper = mountIn("copilot", false);
    expect(wrapper.get(".cv-subagent-status").classes()).toContain("pending");
    expect(wrapper.find(".cv-subagent-unreported").exists()).toBe(false);
  });
});
