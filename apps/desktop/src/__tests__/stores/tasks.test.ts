import type { Job, Task, TaskStats } from "@tracepilot/types";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../helpers/deferred";
import { useTasksStore } from "../../stores/tasks";

const mockTaskList = vi.fn();
const mockTaskStats = vi.fn();
const mockTaskListJobs = vi.fn();

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    taskList: (...args: unknown[]) => mockTaskList(...args),
    taskStats: (...args: unknown[]) => mockTaskStats(...args),
    taskListJobs: (...args: unknown[]) => mockTaskListJobs(...args),
  });
});

function makeTask(id: string, status: Task["status"] = "pending"): Task {
  return {
    id,
    jobId: null,
    taskType: "analyze",
    presetId: "default",
    status,
    priority: "normal",
    inputParams: {},
    contextHash: null,
    attemptCount: 0,
    maxRetries: 3,
    orchestratorSessionId: null,
    resultSummary: null,
    resultParsed: null,
    schemaValid: null,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    claimedAt: null,
    startedAt: null,
  };
}

function makeStats(total: number): TaskStats {
  return {
    total,
    pending: total,
    inProgress: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };
}

function makeJob(id: string): Job {
  return {
    id,
    name: `job-${id}`,
    presetId: null,
    status: "running",
    taskCount: 1,
    tasksCompleted: 0,
    tasksFailed: 0,
    createdAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    orchestratorSessionId: null,
  };
}

describe("useTasksStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockTaskList.mockReset();
    mockTaskStats.mockReset();
    mockTaskListJobs.mockReset();

    mockTaskList.mockResolvedValue([makeTask("default-task")]);
    mockTaskStats.mockResolvedValue(makeStats(1));
    mockTaskListJobs.mockResolvedValue([makeJob("default-job")]);
  });

  it("prevents stuck loading when refresh supersedes an in-flight fetch", async () => {
    const fetchTasksDeferred = createDeferred<Task[]>();
    const fetchStatsDeferred = createDeferred<TaskStats>();
    const fetchJobsDeferred = createDeferred<Job[]>();
    const refreshTasksDeferred = createDeferred<Task[]>();
    const refreshStatsDeferred = createDeferred<TaskStats>();
    const refreshJobsDeferred = createDeferred<Job[]>();

    mockTaskList.mockReset();
    mockTaskStats.mockReset();
    mockTaskListJobs.mockReset();
    mockTaskList.mockReturnValueOnce(fetchTasksDeferred.promise).mockReturnValueOnce(refreshTasksDeferred.promise);
    mockTaskStats.mockReturnValueOnce(fetchStatsDeferred.promise).mockReturnValueOnce(refreshStatsDeferred.promise);
    mockTaskListJobs.mockReturnValueOnce(fetchJobsDeferred.promise).mockReturnValueOnce(refreshJobsDeferred.promise);

    const store = useTasksStore();
    const fetchPromise = store.fetchTasks();
    expect(store.loading).toBe(true);

    const refreshPromise = store.refreshTasks();

    fetchTasksDeferred.resolve([makeTask("old-task")]);
    fetchStatsDeferred.resolve(makeStats(10));
    fetchJobsDeferred.resolve([makeJob("old-job")]);
    await fetchPromise;

    expect(store.loading).toBe(true);

    refreshTasksDeferred.resolve([makeTask("new-task", "done")]);
    refreshStatsDeferred.resolve(makeStats(1));
    refreshJobsDeferred.resolve([makeJob("new-job")]);
    await refreshPromise;

    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(store.tasks.map((t) => t.id)).toEqual(["new-task"]);
    expect(store.stats?.total).toBe(1);
    expect(store.jobs.map((j) => j.id)).toEqual(["new-job"]);
  });

  it("keeps loading false when refresh runs first and fetch supersedes it", async () => {
    const refreshTasksDeferred = createDeferred<Task[]>();
    const refreshStatsDeferred = createDeferred<TaskStats>();
    const refreshJobsDeferred = createDeferred<Job[]>();
    const fetchTasksDeferred = createDeferred<Task[]>();
    const fetchStatsDeferred = createDeferred<TaskStats>();
    const fetchJobsDeferred = createDeferred<Job[]>();

    mockTaskList.mockReset();
    mockTaskStats.mockReset();
    mockTaskListJobs.mockReset();
    mockTaskList
      .mockReturnValueOnce(refreshTasksDeferred.promise)
      .mockReturnValueOnce(fetchTasksDeferred.promise);
    mockTaskStats
      .mockReturnValueOnce(refreshStatsDeferred.promise)
      .mockReturnValueOnce(fetchStatsDeferred.promise);
    mockTaskListJobs.mockReturnValueOnce(refreshJobsDeferred.promise).mockReturnValueOnce(fetchJobsDeferred.promise);

    const store = useTasksStore();
    const refreshPromise = store.refreshTasks();
    expect(store.loading).toBe(false);

    const fetchPromise = store.fetchTasks();
    expect(store.loading).toBe(true);

    refreshTasksDeferred.resolve([makeTask("refresh-task")]);
    refreshStatsDeferred.resolve(makeStats(5));
    refreshJobsDeferred.resolve([makeJob("refresh-job")]);
    await refreshPromise;
    expect(store.loading).toBe(true);

    fetchTasksDeferred.resolve([makeTask("fetch-task")]);
    fetchStatsDeferred.resolve(makeStats(2));
    fetchJobsDeferred.resolve([makeJob("fetch-job")]);
    await fetchPromise;

    expect(store.loading).toBe(false);
    expect(store.tasks.map((t) => t.id)).toEqual(["fetch-task"]);
    expect(store.stats?.total).toBe(2);
    expect(store.jobs.map((j) => j.id)).toEqual(["fetch-job"]);
  });

  it("does not leak stale fetch error when refresh supersedes it", async () => {
    const fetchTasksDeferred = createDeferred<Task[]>();
    const fetchStatsDeferred = createDeferred<TaskStats>();
    const fetchJobsDeferred = createDeferred<Job[]>();
    const refreshTasksDeferred = createDeferred<Task[]>();
    const refreshStatsDeferred = createDeferred<TaskStats>();
    const refreshJobsDeferred = createDeferred<Job[]>();

    mockTaskList.mockReset();
    mockTaskStats.mockReset();
    mockTaskListJobs.mockReset();
    mockTaskList.mockReturnValueOnce(fetchTasksDeferred.promise).mockReturnValueOnce(refreshTasksDeferred.promise);
    mockTaskStats.mockReturnValueOnce(fetchStatsDeferred.promise).mockReturnValueOnce(refreshStatsDeferred.promise);
    mockTaskListJobs.mockReturnValueOnce(fetchJobsDeferred.promise).mockReturnValueOnce(refreshJobsDeferred.promise);

    const store = useTasksStore();
    const fetchPromise = store.fetchTasks();
    const refreshPromise = store.refreshTasks();

    fetchTasksDeferred.reject(new Error("fetch failed"));
    fetchStatsDeferred.resolve(makeStats(9));
    fetchJobsDeferred.resolve([makeJob("unused-job")]);
    await fetchPromise;

    refreshTasksDeferred.resolve([makeTask("fresh-task")]);
    refreshStatsDeferred.resolve(makeStats(1));
    refreshJobsDeferred.resolve([makeJob("fresh-job")]);
    await refreshPromise;

    expect(store.error).toBeNull();
    expect(store.loading).toBe(false);
    expect(store.tasks.map((t) => t.id)).toEqual(["fresh-task"]);
  });

  it("clears stale error on successful silent refresh", async () => {
    mockTaskList.mockRejectedValueOnce(new Error("network failure"));
    const store = useTasksStore();

    await store.fetchTasks();
    expect(store.error).toContain("network failure");

    const refreshTasksDeferred = createDeferred<Task[]>();
    const refreshStatsDeferred = createDeferred<TaskStats>();
    const refreshJobsDeferred = createDeferred<Job[]>();
    mockTaskList.mockReturnValueOnce(refreshTasksDeferred.promise);
    mockTaskStats.mockReturnValueOnce(refreshStatsDeferred.promise);
    mockTaskListJobs.mockReturnValueOnce(refreshJobsDeferred.promise);

    const refreshPromise = store.refreshTasks();
    expect(store.loading).toBe(false);

    refreshTasksDeferred.resolve([makeTask("recover-task")]);
    refreshStatsDeferred.resolve(makeStats(1));
    refreshJobsDeferred.resolve([makeJob("recover-job")]);
    await refreshPromise;

    expect(store.error).toBeNull();
    expect(store.loading).toBe(false);
    expect(store.tasks.map((t) => t.id)).toEqual(["recover-task"]);
  });

  it("clears loading after refresh failure that supersedes fetch", async () => {
    const fetchTasksDeferred = createDeferred<Task[]>();
    const fetchStatsDeferred = createDeferred<TaskStats>();
    const fetchJobsDeferred = createDeferred<Job[]>();
    const refreshTasksDeferred = createDeferred<Task[]>();

    mockTaskList.mockReset();
    mockTaskStats.mockReset();
    mockTaskListJobs.mockReset();
    mockTaskList.mockReturnValueOnce(fetchTasksDeferred.promise).mockReturnValueOnce(refreshTasksDeferred.promise);
    mockTaskStats.mockReturnValue(fetchStatsDeferred.promise);
    mockTaskListJobs.mockReturnValue(fetchJobsDeferred.promise);

    const store = useTasksStore();
    const fetchPromise = store.fetchTasks();
    const refreshPromise = store.refreshTasks();

    fetchTasksDeferred.resolve([makeTask("old-task")]);
    fetchStatsDeferred.resolve(makeStats(1));
    fetchJobsDeferred.resolve([makeJob("old-job")]);
    await fetchPromise;
    expect(store.loading).toBe(true);

    refreshTasksDeferred.reject(new Error("refresh failed"));
    await refreshPromise;

    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });
});
