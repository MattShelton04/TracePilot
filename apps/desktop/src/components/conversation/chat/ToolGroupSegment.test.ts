import type { TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import ToolGroupSegment from "./ToolGroupSegment.vue";

vi.mock("@tracepilot/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tracepilot/ui")>();
  return {
    ...actual,
    ToolCallItem: {
      name: "ToolCallItem",
      props: ["tc"],
      template: '<div class="stub-tool-call">{{ tc.toolName }}</div>',
    },
  };
});

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({ isFeatureEnabled: () => true }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({}),
  useRoute: () => ({ params: {} }),
}));

vi.mock("@/router/navigation", () => ({
  pushRoute: vi.fn(),
}));

const toggleSet = {
  set: ref(new Set<string>()),
  has: () => false,
  add: vi.fn(),
  clear: vi.fn(),
  toggle: vi.fn(),
};

function toolCall(partial: Partial<TurnToolCall>): TurnToolCall {
  return {
    toolName: "view",
    isComplete: true,
    ...partial,
  };
}

describe("ToolGroupSegment", () => {
  it("renders linked skill invocations inside the skill tool row", () => {
    const skill = toolCall({
      toolName: "skill",
      toolCallId: "tc-skill",
      skillInvocation: {
        contextFolded: true,
        name: "trace-skill",
        content: "# trace-skill",
        contentLength: "# trace-skill".length,
      },
    });

    const wrapper = mount(ToolGroupSegment, {
      props: {
        turn: {
          turnIndex: 0,
          assistantMessages: [],
          toolCalls: [skill],
          isComplete: true,
        },
        items: [{ type: "tool", toolCall: skill }],
        groupKey: "g0",
        expandedGroups: toggleSet,
        tcProps: (tc: TurnToolCall) => ({
          tc,
          variant: "compact" as const,
          argsSummary: "",
          expanded: false,
          fullResult: undefined,
          loadingFullResult: false,
          failedFullResult: false,
          richEnabled: true,
        }),
        toggleToolDetail: vi.fn(),
      },
    });

    expect(wrapper.find(".skill-row").exists()).toBe(true);
    expect(wrapper.text()).toContain("trace-skill");
    expect(wrapper.find(".stub-tool-call").exists()).toBe(false);
  });

  it("uses the normal tool row for unlinked skill tools", () => {
    const skill = toolCall({
      toolName: "skill",
      toolCallId: "tc-skill",
    });

    const wrapper = mount(ToolGroupSegment, {
      props: {
        turn: {
          turnIndex: 0,
          assistantMessages: [],
          toolCalls: [skill],
          isComplete: true,
        },
        items: [{ type: "tool", toolCall: skill }],
        groupKey: "g0",
        expandedGroups: toggleSet,
        tcProps: (tc: TurnToolCall) => ({
          tc,
          variant: "compact" as const,
          argsSummary: "",
          expanded: false,
          fullResult: undefined,
          loadingFullResult: false,
          failedFullResult: false,
          richEnabled: true,
        }),
        toggleToolDetail: vi.fn(),
      },
    });

    expect(wrapper.find(".skill-row").exists()).toBe(false);
    expect(wrapper.find(".stub-tool-call").exists()).toBe(true);
  });
});
