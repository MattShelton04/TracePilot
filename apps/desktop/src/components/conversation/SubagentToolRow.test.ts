import type { TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SubagentToolRow from "./SubagentToolRow.vue";

function toolCall(overrides: Partial<TurnToolCall> = {}): TurnToolCall {
  return {
    toolName: "view",
    isComplete: true,
    ...overrides,
  };
}

function mountRow(toolCallProp: TurnToolCall) {
  return mount(SubagentToolRow, {
    props: {
      toolCall: toolCallProp,
      expanded: false,
      loadingFullResult: false,
      failedFullResult: false,
      richEnabled: true,
    },
    global: {
      stubs: {
        SkillInvocationEventRow: {
          props: ["toolCall"],
          template: `<div class="skill-row-stub">{{ toolCall.skillInvocation.name }}</div>`,
        },
        ToolCallItem: {
          props: ["tc"],
          emits: ["toggle"],
          template: `<button class="tool-row-stub" @click="$emit('toggle')">{{ tc.toolName }}</button>`,
        },
      },
    },
  });
}

describe("SubagentToolRow", () => {
  it("uses the skill invocation renderer for linked skill tool calls", () => {
    const wrapper = mountRow(
      toolCall({
        toolName: "skill",
        skillInvocation: {
          id: "evt-skill",
          name: "tracepilot-app-automation",
          contextFolded: true,
        },
      }),
    );

    expect(wrapper.find(".skill-row-stub").text()).toBe("tracepilot-app-automation");
    expect(wrapper.find(".tool-row-stub").exists()).toBe(false);
  });

  it("falls back to the generic tool row for ordinary tool calls", async () => {
    const wrapper = mountRow(toolCall({ toolName: "view" }));

    expect(wrapper.find(".tool-row-stub").text()).toBe("view");
    expect(wrapper.find(".skill-row-stub").exists()).toBe(false);

    await wrapper.find(".tool-row-stub").trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });
});
