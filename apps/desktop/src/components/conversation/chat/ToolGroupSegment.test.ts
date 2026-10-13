import type { TurnToolCall } from "@tracepilot/types";
import { useToggleSet } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { ToolGroupItem } from "../chatViewUtils";
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
  it("preserves disclosure, pills and event targets without repeatedly scanning the group", async () => {
    let typeReads = 0;
    const items: ToolGroupItem[] = Array.from({ length: 200 }, (_, index) => ({
      get type(): "tool" {
        typeReads++;
        return "tool";
      },
      toolCall: toolCall({ toolCallId: `tool-${index}`, eventIndex: index }),
    }));
    items.splice(20, 0, {
      type: "intent",
      toolCall: toolCall({ toolName: "report_intent", arguments: { intent: "Keep visible" } }),
    });
    items.push({ type: "ask-user", toolCall: toolCall({ toolName: "ask_user", eventIndex: 201 }) });
    const expandedGroups = useToggleSet<string>();
    const wrapper = mount(ToolGroupSegment, {
      attachTo: document.body,
      props: {
        turn: { turnIndex: 0, assistantMessages: [], toolCalls: [], isComplete: true },
        items,
        groupKey: "large-group",
        expandedGroups,
        tcProps: (tc) => ({
          tc,
          variant: "compact",
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

    // The hidden rows remain mounted for event deep links and retain their state.
    expect(wrapper.findAll(".stub-tool-call")).toHaveLength(201);
    expect(wrapper.get('[data-event-idx="6"]').isVisible()).toBe(true);
    expect(wrapper.get('[data-event-idx="7"]').isVisible()).toBe(false);
    expect(wrapper.get('[data-event-idx="199"]').isVisible()).toBe(false);
    expect(wrapper.get('[data-event-idx="201"]').isVisible()).toBe(true);
    expect(wrapper.get(".cv-intent-pill").text()).toContain("Keep visible");
    expect(wrapper.get(".cv-collapsed-toggle").text()).toContain("Show 193 more tools");
    expect(typeReads).toBeLessThan(items.length * 15);

    const lastRow = wrapper.get('[data-event-idx="199"]').element;
    await wrapper.get(".cv-collapsed-toggle").trigger("click");
    expect(expandedGroups.has("large-group")).toBe(true);
    expect(wrapper.get('[data-event-idx="199"]').isVisible()).toBe(true);
    expect(wrapper.get('[data-event-idx="199"]').element).toBe(lastRow);
    await wrapper.get(".cv-collapsed-toggle").trigger("click");
    expect(wrapper.get('[data-event-idx="199"]').isVisible()).toBe(false);
    await wrapper.setProps({ items: items.slice(0, 10) });
    expect(wrapper.find(".cv-collapsed-toggle").exists()).toBe(false);
    expect(wrapper.get('[data-event-idx="9"]').isVisible()).toBe(true);
    await wrapper.setProps({ items: items.slice(0, 11) });
    expect(wrapper.get(".cv-collapsed-toggle").text()).toContain("Show 4 more tools");
    expect(wrapper.get('[data-event-idx="10"]').isVisible()).toBe(false);
    wrapper.unmount();
  });

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
