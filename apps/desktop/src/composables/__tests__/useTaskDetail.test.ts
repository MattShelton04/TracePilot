import { setupPinia } from "@tracepilot/test-utils";
import type { Task } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

const mockRouterPush = vi.fn();
const mockRouteParams: Record<string, string> = { taskId: "task-1" };
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: mockRouteParams }),
  useRouter: () => ({ push: mockRouterPush }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const confirmMock = vi.fn(async () => ({ confirmed: true }));
vi.mock("@tracepilot/ui", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@tracepilot/ui");
  return {
    ...actual,
    useToast: () => ({
      success: toastSuccess,
      error: toastError,
      info: vi.fn(),
      warn: vi.fn(),
      show: vi.fn(),
      dismiss: vi.fn(),
    }),
    useConfirmDialog: () => ({ confirm: confirmMock }),
  };
});

const tasksStoreMock = {
  selectedTask: null as Task | null,
  error: null as string | null,
  getTask: vi.fn(async () => {}),
  refreshTask: vi.fn(async () => {}),
  cancelTask: vi.fn(async () => true),
  retryTask: vi.fn(async () => true),
  deleteTask: vi.fn(async () => true),
};
vi.mock("@/stores/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/tasks")>();
  return {
    ...actual,
    useTasksStore: () => tasksStoreMock,
  };
});

import { computeTimelineEvents, formatValue, isSimpleValue, useTaskDetail } from "../useTaskDetail";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    status: "done",
    taskType: "analysis",
    priority: "normal",
    presetId: "p1",
    inputParams: { title: "Demo" },
    contextHash: null,
    attemptCount: 1,
    maxRetries: 3,
    orchestratorSessionId: null,
    resultSummary: "Summary",
    resultParsed: { foo: "bar" },
    schemaValid: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:05:00Z",
    completedAt: "2026-01-01T00:05:00Z",
    claimedAt: "2026-01-01T00:01:00Z",
    startedAt: "2026-01-01T00:02:00Z",
    ...overrides,
  } as Task;
}

const TestHost = defineComponent({
  setup() {
    const detail = useTaskDetail();
    return { detail };
  },
  template: "<div />",
});

describe("useTaskDetail pure helpers", () => {
  it("formatValue handles primitives and objects", () => {
    expect(formatValue(null)).toBe("—");
    expect(formatValue(undefined)).toBe("—");
    expect(formatValue("hello")).toBe("hello");
    expect(formatValue(42)).toBe("42");
    expect(formatValue(true)).toBe("true");
    expect(formatValue({ a: 1 })).toContain('"a"');
  });

  it("isSimpleValue identifies primitives", () => {
    expect(isSimpleValue(null)).toBe(true);
    expect(isSimpleValue("s")).toBe(true);
    expect(isSimpleValue(1)).toBe(true);
    expect(isSimpleValue(false)).toBe(true);
    expect(isSimpleValue({})).toBe(false);
    expect(isSimpleValue([1, 2])).toBe(false);
  });

  it("computeTimelineEvents builds 4-stage done timeline", () => {
    const events = computeTimelineEvents(makeTask({ status: "done" }));
    expect(events).toHaveLength(4);
    expect(events[0]!.label).toBe("Created");
    expect(events[1]!.label).toBe("Claimed");
    expect(events[2]!.label).toBe("In Progress");
    expect(events[3]!.label).toBe("Completed");
    expect(events[3]!.variant).toBe("success");
  });

  it("computeTimelineEvents marks failed variant danger", () => {
    const events = computeTimelineEvents(makeTask({ status: "failed" }));
    expect(events[3]!.label).toBe("Failed");
    expect(events[3]!.variant).toBe("danger");
  });

  it("computeTimelineEvents pending for fresh task", () => {
    const events = computeTimelineEvents(makeTask({ status: "pending" }));
    expect(events[1]!.state).toBe("pending");
    expect(events[2]!.state).toBe("pending");
    expect(events[3]!.state).toBe("pending");
  });

  it("computeTimelineEvents returns [] for null", () => {
    expect(computeTimelineEvents(null)).toEqual([]);
  });
});

describe("useTaskDetail composable", () => {
  beforeEach(() => {
    setupPinia();
    mockRouterPush.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    confirmMock.mockReset();
    confirmMock.mockResolvedValue({ confirmed: true });
    tasksStoreMock.selectedTask = null;
    tasksStoreMock.error = null;
    tasksStoreMock.getTask = vi.fn(async () => {});
    tasksStoreMock.refreshTask = vi.fn(async () => {});
    tasksStoreMock.cancelTask = vi.fn(async () => true);
    tasksStoreMock.retryTask = vi.fn(async () => true);
    tasksStoreMock.deleteTask = vi.fn(async () => true);
    mockRouteParams.taskId = "task-1";
  });

  it("loads task on mount and computes truncatedId", async () => {
    tasksStoreMock.selectedTask = makeTask({
      id: "0123456789abcdef-very-long",
    });
    const wrapper = mount(TestHost);
    await Promise.resolve();
    await Promise.resolve();
    expect(tasksStoreMock.getTask).toHaveBeenCalledWith("task-1");
    expect(wrapper.vm.detail.truncatedId.value).toBe("0123456789ab…");
    expect(wrapper.vm.detail.canRetry.value).toBe(false);
    wrapper.unmount();
  });

  it("canCancel reflects in-progress status", () => {
    tasksStoreMock.selectedTask = makeTask({ status: "in_progress" });
    const wrapper = mount(TestHost);
    expect(wrapper.vm.detail.canCancel.value).toBe(true);
    expect(wrapper.vm.detail.canRetry.value).toBe(false);
    wrapper.unmount();
  });

  it("handleDelete asks for confirmation and navigates on success", async () => {
    tasksStoreMock.selectedTask = makeTask();
    const wrapper = mount(TestHost);
    await wrapper.vm.detail.handleDelete();
    expect(confirmMock).toHaveBeenCalled();
    expect(tasksStoreMock.deleteTask).toHaveBeenCalledWith("task-1");
    expect(mockRouterPush).toHaveBeenCalledWith({ name: "tasks" });
    expect(toastSuccess).toHaveBeenCalledWith("Task deleted");
    wrapper.unmount();
  });

  it("handleCancel calls store.cancelTask and shows toast", async () => {
    tasksStoreMock.selectedTask = makeTask({ status: "in_progress" });
    const wrapper = mount(TestHost);
    await wrapper.vm.detail.handleCancel();
    expect(tasksStoreMock.cancelTask).toHaveBeenCalledWith("task-1");
    expect(toastSuccess).toHaveBeenCalledWith("Task cancelled");
    wrapper.unmount();
  });
});
