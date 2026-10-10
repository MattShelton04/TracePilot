import type { ContextTimeline } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ContextToolContribution from "../ContextToolContribution.vue";

const type = { callCount: 1, errorCount: 0, argumentTokens: 5, resultTokens: 5, totalTokens: 10 };

function mountWith(toolTypes: ContextTimeline["toolTypes"]) {
  const timeline = {
    points: [],
    events: [],
    compactions: [],
    topToolCalls: [
      {
        turn: 1,
        toolCallId: "c1",
        toolName: "ask_user",
        nativeToolName: "AskUserQuestion",
        argumentTokens: 5,
        resultTokens: 5,
        totalTokens: 10,
      },
    ],
    toolTypes,
    turnCount: 1,
    observedPointCount: 0,
    estimatedPointCount: 0,
    compactionStartCount: 0,
    compactionCompleteCount: 0,
    pairedCompactionCount: 0,
    methodology: "",
  } as ContextTimeline;
  return mount(ContextToolContribution, {
    props: {
      timeline,
      selectedToolCall: null,
      selectedContributionToolCall: null,
      fullResults: new Map(),
      loadingResults: new Set<string>(),
      failedResults: new Set<string>(),
      richEnabledFor: () => false,
    },
  });
}

describe("ContextToolContribution tool names", () => {
  it("names Claude Code tools natively, canonical as the tooltip", async () => {
    const wrapper = mountWith([
      { ...type, toolName: "ask_user", nativeToolNames: ["AskUserQuestion"], percentage: 50 },
      { ...type, toolName: "create", nativeToolNames: ["Write"], percentage: 25 },
      { ...type, toolName: "apply_patch", nativeToolNames: ["Write"], percentage: 25 },
    ]);
    const names = wrapper.findAll(".context-tab__tool-type-heading strong");
    expect(names.map((n) => n.text())).toEqual([
      "AskUserQuestion",
      "Write (create)",
      "Write (apply_patch)",
    ]);
    expect(names[0].attributes("title")).toBe("ask_user");
    expect(wrapper.find(".tool-donut__legend").text()).toContain("AskUserQuestion");

    await wrapper.findAll(".context-tab__view-switch button")[1].trigger("click");
    expect(wrapper.get(".context-tab__ranked-tool-heading strong").text()).toBe("AskUserQuestion");
  });

  it("keeps canonical names for Copilot sessions", () => {
    const wrapper = mountWith([{ ...type, toolName: "view", percentage: 100 }]);
    const name = wrapper.get(".context-tab__tool-type-heading strong");
    expect(name.text()).toBe("view");
    expect(name.attributes("title")).toBeUndefined();
  });
});
