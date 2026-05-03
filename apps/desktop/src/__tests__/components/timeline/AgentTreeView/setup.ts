import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { beforeEach, vi } from "vitest";
import AgentTreeView from "../../../../components/timeline/AgentTreeView.vue";
import { useSessionDetailStore } from "../../../../stores/sessionDetail";

// ── Mock @tracepilot/client ─────────────────────────────────────────
vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../../mocks/client");
  return createClientMock({
    getSessionDetail: vi.fn(),
    getSessionTurns: vi.fn(),
    getSessionEvents: vi.fn(),
    getSessionTodos: vi.fn(),
    getSessionCheckpoints: vi.fn(),
    getShutdownMetrics: vi.fn(),
  });
});

export function mountAgentTreeView() {
  return mount(AgentTreeView, {
    global: {
      stubs: {
        EmptyState: {
          template: '<div class="empty-state-stub">{{ title }}</div>',
          props: ["icon", "title", "message"],
        },
        Badge: {
          template: '<span class="badge-stub"><slot /></span>',
          props: ["variant"],
        },
        ExpandChevron: {
          template: '<span class="chevron-stub" />',
          props: ["expanded", "size"],
        },
      },
    },
  });
}

export function setupAgentTreeViewTest() {
  let store!: ReturnType<typeof useSessionDetailStore>;

  beforeEach(() => {
    setupPinia();
    store = useSessionDetailStore();
  });

  return {
    get store() {
      return store;
    },
  };
}
