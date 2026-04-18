import type { Task } from "@tracepilot/types";
import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tracepilot/ui", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@tracepilot/ui",
  );
  return {
    ...actual,
    useToast: () => ({
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      show: vi.fn(),
      dismiss: vi.fn(),
    }),
  };
});

vi.mock("@/stores/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/tasks")>();
  return {
    ...actual,
    useTasksStore: () => ({
      selectedTask: null,
      error: null,
    }),
  };
});

import TaskContextPanel from "../TaskContextPanel.vue";
import TaskDetailHeader from "../TaskDetailHeader.vue";
import TaskRawPanel from "../TaskRawPanel.vue";
import TaskResultPanel from "../TaskResultPanel.vue";
import TaskSubagentPanel from "../TaskSubagentPanel.vue";
import TaskTimelinePanel from "../TaskTimelinePanel.vue";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    status: "done",
    taskType: "analysis",
    priority: "normal",
    presetId: "p1",
    inputParams: { title: "My Task" },
    contextHash: "hash-xyz",
    attemptCount: 2,
    maxRetries: 3,
    orchestratorSessionId: "sess-1",
    resultSummary: "All good",
    resultParsed: { score: 0.95 },
    schemaValid: true,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:05:00Z",
    completedAt: "2026-01-01T00:05:00Z",
    claimedAt: "2026-01-01T00:01:00Z",
    startedAt: "2026-01-01T00:02:00Z",
    jobId: "job-1",
    ...overrides,
  } as Task;
}

beforeEach(() => {
  setupPinia();
});

describe("TaskDetailHeader", () => {
  it("emits cancel/retry/delete when action buttons clicked", async () => {
    const wrapper = mount(TaskDetailHeader, {
      props: {
        task: makeTask({ status: "in_progress" }),
        truncatedId: "task-1",
        duration: "5m",
        canCancel: true,
        canRetry: true,
        cancelling: false,
        retrying: false,
        copiedSection: null,
      },
    });
    await wrapper.find(".btn-warning").trigger("click");
    expect(wrapper.emitted("cancel")).toBeTruthy();
    await wrapper.find(".btn-accent").trigger("click");
    expect(wrapper.emitted("retry")).toBeTruthy();
    await wrapper.find(".btn-danger").trigger("click");
    expect(wrapper.emitted("delete")).toBeTruthy();
  });

  it("emits copy with id when id chip is clicked", async () => {
    const wrapper = mount(TaskDetailHeader, {
      props: {
        task: makeTask(),
        truncatedId: "task-1",
        duration: null,
        canCancel: false,
        canRetry: false,
        cancelling: false,
        retrying: false,
        copiedSection: null,
      },
    });
    await wrapper.find(".meta-chip-id").trigger("click");
    expect(wrapper.emitted("copy")?.[0]).toEqual(["task-1", "id"]);
  });
});

describe("TaskResultPanel", () => {
  it("renders summary and parsed result entries", () => {
    const wrapper = mount(TaskResultPanel, {
      props: {
        task: makeTask(),
        resultEntries: [["score", 0.95]],
      },
    });
    expect(wrapper.text()).toContain("All good");
    expect(wrapper.text()).toContain("score");
  });

  it("renders empty state when no results and pending", () => {
    const wrapper = mount(TaskResultPanel, {
      props: {
        task: makeTask({
          status: "pending",
          resultSummary: null,
          resultParsed: null,
        }),
        resultEntries: [],
      },
    });
    expect(wrapper.text()).toContain("No results yet");
  });
});

describe("TaskContextPanel", () => {
  it("renders input entries and preset info", () => {
    const wrapper = mount(TaskContextPanel, {
      props: {
        task: makeTask(),
        inputEntries: [["title", "My Task"]],
      },
    });
    expect(wrapper.text()).toContain("title");
    expect(wrapper.text()).toContain("p1");
  });
});

describe("TaskTimelinePanel", () => {
  it("renders timeline events", () => {
    const wrapper = mount(TaskTimelinePanel, {
      props: {
        task: makeTask(),
        duration: "5m",
        timelineEvents: [
          {
            label: "Created",
            timestamp: "2026-01-01T00:00:00Z",
            state: "done",
            variant: "default",
          },
          {
            label: "Completed",
            timestamp: "2026-01-01T00:05:00Z",
            state: "done",
            variant: "success",
          },
        ],
      },
    });
    expect(wrapper.findAll(".tl-item")).toHaveLength(2);
    expect(wrapper.text()).toContain("Created");
    expect(wrapper.text()).toContain("Completed");
  });
});

describe("TaskSubagentPanel", () => {
  it("renders attribution when orchestratorSessionId present", () => {
    const wrapper = mount(TaskSubagentPanel, {
      props: { task: makeTask() },
    });
    expect(wrapper.text()).toContain("sess-1");
  });

  it("renders empty state when no orchestrator", () => {
    const wrapper = mount(TaskSubagentPanel, {
      props: { task: makeTask({ orchestratorSessionId: null }) },
    });
    expect(wrapper.text()).toContain("No subagent data");
  });
});

describe("TaskRawPanel", () => {
  it("emits copy event when Copy button clicked", async () => {
    const wrapper = mount(TaskRawPanel, {
      props: { task: makeTask(), copiedSection: null },
    });
    const btns = wrapper.findAll(".copy-btn");
    expect(btns.length).toBeGreaterThanOrEqual(2);
    await btns[0]!.trigger("click");
    expect(wrapper.emitted("copy")?.[0]?.[1]).toBe("raw-task");
  });
});
