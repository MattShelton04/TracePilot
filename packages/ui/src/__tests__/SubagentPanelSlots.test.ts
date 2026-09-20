import type { TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import SubagentPanel from "../components/SubagentPanel/SubagentPanel.vue";
import type { SubagentView } from "../components/SubagentPanel/types";

function makeToolCall(overrides: Partial<TurnToolCall> = {}): TurnToolCall {
  return {
    toolName: "skill",
    isComplete: true,
    toolCallId: "tc-skill",
    ...overrides,
  };
}

function makeView(toolCall: TurnToolCall): SubagentView {
  return {
    id: "agent-1",
    type: "task",
    displayName: "Task agent",
    status: "completed",
    modelSubstituted: false,
    activities: [{ kind: "tool", key: "tool-1", sortKey: 1, toolCall }],
    isMainAgent: false,
  };
}

function emptyResultSet(): Set<string> {
  return new Set<string>();
}

describe("SubagentPanel slots", () => {
  it("forwards tool activity rows to host renderers", () => {
    const wrapper = mount(SubagentPanel, {
      props: {
        view: makeView(makeToolCall()),
        renderMarkdown: false,
        fullResults: new Map(),
        loadingResults: emptyResultSet(),
        failedResults: emptyResultSet(),
      },
      slots: {
        tool: `<template #tool="{ item }"><div class="custom-tool-row">{{ item.toolCall.toolName }}</div></template>`,
      },
    });

    expect(wrapper.find(".custom-tool-row").text()).toBe("skill");
    expect(wrapper.find(".tool-call-item").exists()).toBe(false);
  });

  it("renders the default tool row when no host renderer is supplied", () => {
    const wrapper = mount(SubagentPanel, {
      props: {
        view: makeView(makeToolCall({ toolName: "view" })),
        renderMarkdown: false,
        fullResults: new Map(),
        loadingResults: emptyResultSet(),
        failedResults: emptyResultSet(),
      },
    });

    expect(wrapper.find(".tool-call-item").exists()).toBe(true);
    expect(wrapper.text()).toContain("view");
  });

  it.each([
    "idle",
    "cancelled",
  ] as const)("does not animate saved activity as running for a %s worker", (status) => {
    const view = makeView(makeToolCall({ intentionSummary: "Review changes" }));
    const wrapper = mount(SubagentPanel, {
      props: {
        view: { ...view, status },
        renderMarkdown: false,
        fullResults: new Map(),
        loadingResults: emptyResultSet(),
        failedResults: emptyResultSet(),
      },
    });
    expect(wrapper.get(".ob-label").text()).toBe("Activity");
    expect(wrapper.get(".ob-status").text()).toBe("Idle");
    expect(wrapper.find(".ob-status-dots").exists()).toBe(false);
  });

  it.each([
    "intent",
    "tool",
    "nested-subagent",
  ] as const)("reveals the originating %s row when the banner is clicked", async (kind) => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    try {
      const wrapper = mount(SubagentPanel, {
        props: {
          view: {
            ...makeView(makeToolCall()),
            status: "in-progress",
            activities: [
              {
                kind: kind === "intent" ? "pill" : kind,
                key: "intent-1",
                sortKey: 1,
                type: "intent",
                label: "Reviewing branch",
                toolCall: makeToolCall({
                  toolName: kind === "intent" ? "report_intent" : kind === "tool" ? "view" : "task",
                  toolCallId: "intent-call",
                  eventIndex: 42,
                  arguments: { intent: "Reviewing branch" },
                  intentionSummary: "Reviewing branch",
                }),
              },
            ],
          },
          renderMarkdown: false,
          fullResults: new Map(),
          loadingResults: emptyResultSet(),
          failedResults: emptyResultSet(),
        },
      });

      await wrapper.find("button.ob-text").trigger("click");
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
      expect(wrapper.find('[data-sap-event-idx="42"]').classes()).toContain("sap-reveal-highlight");
    } finally {
      Object.defineProperty(Element.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
    }
  });
});
