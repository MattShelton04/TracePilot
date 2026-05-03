import { setupPinia } from "@tracepilot/test-utils";
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, vi } from "vitest";
import { defineComponent } from "vue";
import type { UseTimelineToolStateOptions } from "../../useTimelineToolState";
import { useTimelineToolState } from "../../useTimelineToolState";

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({}),
}));

export function setupTimelineToolStateTest(): void {
  beforeEach(() => {
    setupPinia();
  });
}

export function mountTimelineToolState(options: UseTimelineToolStateOptions = {}) {
  const TestComponent = defineComponent({
    setup() {
      const state = useTimelineToolState(options);
      return { ...state };
    },
    template: "<div></div>",
  });

  return mount(TestComponent);
}

export function createToolCall(overrides: Partial<TurnToolCall> = {}): TurnToolCall {
  return {
    toolName: "bash",
    arguments: '{"command":"ls"}',
    success: true,
    isSubagent: false,
    isComplete: true,
    toolCallId: "tc-1",
    ...overrides,
  };
}

export function createTurn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    turnIndex: 0,
    timestamp: "2024-01-01T00:00:00Z",
    userMessage: "test",
    assistantMessages: [],
    toolCalls: [],
    isComplete: true,
    ...overrides,
  };
}
