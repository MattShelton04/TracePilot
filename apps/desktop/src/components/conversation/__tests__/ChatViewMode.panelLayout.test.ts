import { setupPinia } from "@tracepilot/test-utils";
import { shallowMount } from "@vue/test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import ChatViewMode from "../ChatViewMode.vue";
import SubagentPanel from "../SubagentPanel.vue";

vi.mock("@/composables/useChatViewModeData", () => ({
  useChatViewModeData: () => ({
    store: { sessionId: "s-1", detail: { id: "s-1", source: "claudeCode" } },
    turns: ref([]),
    allSubagents: [],
    panel: {
      isPanelOpen: computed(() => false),
      selectedAgentId: ref(null),
      selectedSubagent: ref(null),
      selectedIndex: ref(-1),
      hasPrev: ref(false),
      hasNext: ref(false),
      openSubagent: vi.fn(),
    },
  }),
}));

beforeEach(() => setupPinia());

it("passes the subagent panel's footprint up to the conversation tab", () => {
  const wrapper = shallowMount(ChatViewMode);
  wrapper.getComponent(SubagentPanel).vm.$emit("layout", { width: 547, fullWidth: false });
  wrapper.getComponent(SubagentPanel).vm.$emit("layout", { width: 0, fullWidth: false });
  expect(wrapper.emitted("panelLayout")).toEqual([
    [{ width: 547, fullWidth: false }],
    [{ width: 0, fullWidth: false }],
  ]);
});
