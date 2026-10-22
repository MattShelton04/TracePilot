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

  it("lists Claude Code todos by default and remembers each source's choice", async () => {
    mockGetSessionTodos.mockResolvedValue({
      todos: [{ id: "1", title: "Survey corpus", status: "in_progress" }],
      deps: [],
    });
    const store = useSessionDetailStore();
    const stubs = {
      LoadingOverlay: LoadingOverlayStub,
      EmptyState: EmptyStateStub,
      ErrorAlert: ErrorAlertStub,
      SectionPanel: { template: '<div class="section-panel"><slot /></div>' },
      Badge: true,
      StatusIcon: true,
      TodoDependencyGraph: true,
    };
    const open = async (id: string, source: "copilot" | "claudeCode") => {
      store.sessionId = id;
      store.$patch({ detail: { id, source } });
      const wrapper = mount(TodosTab, { global: { stubs } });
      await flushPromises();
      return wrapper;
    };

    const claude = await open("claude-1", "claudeCode");
    expect(claude.find("todo-dependency-graph-stub").exists()).toBe(false);
    expect(claude.text()).toContain("Survey corpus");
    // Choosing the graph for Claude Code leaves Copilot's default alone.
    await claude.findAll("button.toggle-btn")[1].trigger("click");
    expect(claude.find("todo-dependency-graph-stub").exists()).toBe(true);
    claude.unmount();

    store.loaded.delete("todos");
    const copilot = await open("copilot-1", "copilot");
    expect(copilot.find("todo-dependency-graph-stub").exists()).toBe(true);
    await copilot.findAll("button.toggle-btn")[0].trigger("click");
    copilot.unmount();

    store.loaded.delete("todos");
    const claudeAgain = await open("claude-2", "claudeCode");
    expect(claudeAgain.find("todo-dependency-graph-stub").exists()).toBe(true);
    claudeAgain.unmount();
  });
});

describe("TodosTab progress", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    localStorage.clear();
    resetSessionTabViews();
  });

  async function progressFor(done: number, total: number) {
    mockGetSessionTodos.mockResolvedValue({
      todos: Array.from({ length: total }, (_, i) => ({
        id: `t${i}`,
        title: `Todo ${i}`,
        status: i < done ? "done" : "pending",
      })),
      deps: [],
    });
    const store = useSessionDetailStore();
    store.loaded.delete("todos");
    store.sessionId = `session-progress-${done}-${total}`;
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
    const header = wrapper.find(".progress-section").text();
    const bar = wrapper.find('[role="progressbar"]').attributes("aria-valuenow");
    wrapper.unmount();
    return { header, bar };
  }

  it("reads 100% only once every todo is done", async () => {
    const almost = await progressFor(199, 200);
    expect(almost.header).toContain("99%");
    expect(almost.header).not.toContain("100%");
    expect(almost.bar).toBe("99");
    expect((await progressFor(200, 200)).header).toContain("100%");
  });

  it("reads 0% only while no todo is done", async () => {
    const sliver = await progressFor(1, 300);
    expect(sliver.header).toContain("<1%");
    expect(sliver.header).not.toContain("0%");
    expect(sliver.bar).toBe("1");
    expect((await progressFor(0, 300)).header).toContain("0%");
    expect((await progressFor(1, 4)).header).toContain("25%");
  });
});
