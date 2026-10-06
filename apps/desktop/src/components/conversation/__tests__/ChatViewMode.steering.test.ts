import { setupPinia } from "@tracepilot/test-utils";
import type { SessionSource } from "@tracepilot/types";
import { shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import ChatViewMode from "../ChatViewMode.vue";

const state = vi.hoisted(() => ({ source: undefined as SessionSource | undefined }));

vi.mock("@/composables/useChatViewModeData", () => ({
  useChatViewModeData: () => ({
    store: { sessionId: "s-1", detail: { id: "s-1", source: state.source } },
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

function steeringPanels(source?: SessionSource) {
  state.source = source;
  const wrapper = shallowMount(ChatViewMode);
  return wrapper.findAllComponents({ name: "SdkSteeringPanel" }).length;
}

describe("ChatViewMode steering", () => {
  beforeEach(() => setupPinia());

  it("mounts the steering panel for Copilot sessions", () => {
    expect(steeringPanels()).toBe(1);
    expect(steeringPanels("copilot")).toBe(1);
  });

  it("leaves steering out for Claude Code sessions", () => {
    expect(steeringPanels("claudeCode")).toBe(0);
  });
});
