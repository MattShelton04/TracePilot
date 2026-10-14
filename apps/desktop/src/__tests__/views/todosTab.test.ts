import { createDeferred, setupPinia } from "@tracepilot/test-utils";
import type { TodosResponse } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSessionTabViews } from "@/composables/useSessionTabViews";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import TodosTab from "../../views/tabs/TodosTab.vue";

const mockGetSessionTodos = vi.fn();

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    getSessionDetail: vi.fn(),
    getSessionTurns: vi.fn(),
    checkSessionFreshness: vi.fn(),
    getSessionEvents: vi.fn(),
    getSessionTodos: (...args: unknown[]) => mockGetSessionTodos(...args),
    getSessionCheckpoints: vi.fn(),
    getSessionPlan: vi.fn(),
    getShutdownMetrics: vi.fn(),
    getSessionIncidents: vi.fn(),
  });
});

const LoadingOverlayStub = {
  name: "LoadingOverlay",
  props: { loading: Boolean, message: String },
  template:
    '<div><div v-if="loading" class="loading-overlay">{{ message }}</div><slot v-else /></div>',
};

const EmptyStateStub = {
  name: "EmptyState",
  props: { message: String },
  template: '<div class="empty-state">{{ message }}</div>',
};

const ErrorAlertStub = {
  name: "ErrorAlert",
  props: { message: String },
  template: '<div class="error-alert">{{ message }}</div>',
};
describe("TodosTab", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
  });

  it("shows loading overlay before data arrives then renders empty state", async () => {
    const deferred = createDeferred<TodosResponse>();
    mockGetSessionTodos.mockReturnValue(deferred.promise);

    const store = useSessionDetailStore();
    store.sessionId = "session-1";

    const wrapper = mount(TodosTab, {
      global: {
        stubs: {
          LoadingOverlay: LoadingOverlayStub,
          EmptyState: EmptyStateStub,
          ErrorAlert: ErrorAlertStub,
          SectionPanel: { template: '<div class="section-panel"><slot /></div>' },
          Badge: true,
          StatusIcon: true,
          TodoDependencyGraph: true,
        },
      },
    });

    await flushPromises();

    expect(wrapper.find(".loading-overlay").exists()).toBe(true);
    expect(wrapper.find(".empty-state").exists()).toBe(false);

    deferred.resolve({ todos: [], deps: [] });
    await flushPromises();

    expect(wrapper.find(".loading-overlay").exists()).toBe(false);
    expect(wrapper.find(".empty-state").exists()).toBe(true);
  });

  it("surfaces load errors without showing empty state", async () => {
    mockGetSessionTodos.mockRejectedValue(new Error("fail to load"));

    const store = useSessionDetailStore();
    store.sessionId = "session-err";

    const wrapper = mount(TodosTab, {
      global: {
        stubs: {
          LoadingOverlay: LoadingOverlayStub,
          EmptyState: EmptyStateStub,
          ErrorAlert: ErrorAlertStub,
          SectionPanel: { template: '<div class="section-panel"><slot /></div>' },
          Badge: true,
          StatusIcon: true,
          TodoDependencyGraph: true,
        },
      },
    });

    await flushPromises();

    expect(wrapper.find(".error-alert").exists()).toBe(true);
    expect(wrapper.find(".empty-state").exists()).toBe(false);
    expect(wrapper.find(".loading-overlay").exists()).toBe(false);
  });
});

describe("TodosTab view choice", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    localStorage.clear();
    resetSessionTabViews();
  });

  it("keeps the list view when the Todos tab is left and reopened", async () => {
    mockGetSessionTodos.mockResolvedValue({
      todos: [{ id: "a", title: "Write tests", status: "pending" }],
      deps: [],
    });
    const store = useSessionDetailStore();
    store.sessionId = "session-views";
    const stubs = {
      LoadingOverlay: LoadingOverlayStub,
      EmptyState: EmptyStateStub,
      ErrorAlert: ErrorAlertStub,
      SectionPanel: { template: '<div class="section-panel"><slot /></div>' },
      Badge: true,
      StatusIcon: true,
      TodoDependencyGraph: true,
    };

    const first = mount(TodosTab, { global: { stubs } });
    await flushPromises();
    expect(first.find("todo-dependency-graph-stub").exists()).toBe(true);
    await first.findAll("button.toggle-btn")[0].trigger("click");
    expect(first.find("todo-dependency-graph-stub").exists()).toBe(false);
    first.unmount();

    const reopened = mount(TodosTab, { global: { stubs } });
    await flushPromises();
    expect(reopened.find("todo-dependency-graph-stub").exists()).toBe(false);
    expect(reopened.text()).toContain("Write tests");
    reopened.unmount();
  });
});
