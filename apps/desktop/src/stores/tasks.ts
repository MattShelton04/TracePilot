import {
  taskCancel,
  taskCreate,
  taskCreateBatch,
  taskDelete,
  taskGet,
  taskList,
  taskListJobs,
  taskRetry,
  taskStats,
} from "@tracepilot/client";
import type { Job, NewTask, Task, TaskFilter, TaskStats } from "@tracepilot/types";
import { runAction, runMutation, toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { logWarn } from "@/utils/logger";

export type TaskSortOption = "newest" | "oldest" | "priority" | "status";

/** Deduplicate concurrent fetch calls. */
// Module-level dedup handled inside store setup

export const useTasksStore = defineStore("tasks", () => {
  // ─── State ────────────────────────────────────────────────────────
  const tasks = ref<Task[]>([]);
  const jobs = ref<Job[]>([]);
  const stats = ref<TaskStats | null>(null);
  const selectedTask = ref<Task | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const searchQuery = ref("");
  const filterStatus = ref<string>("all");
  const filterType = ref<string>("all");
  const sortBy = ref<TaskSortOption>("newest");

  const loadGuard = useAsyncGuard();
  const refreshGuard = useAsyncGuard();
  const getTaskGuard = useAsyncGuard();

  // ─── Computed ─────────────────────────────────────────────────────

  const filteredTasks = computed(() => {
    let list = [...tasks.value];

    if (filterStatus.value !== "all") {
      list = list.filter((t) => t.status === filterStatus.value);
    }

    if (filterType.value !== "all") {
      list = list.filter((t) => t.taskType === filterType.value);
    }

    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase();
      list = list.filter(
        (t) =>
          t.taskType.toLowerCase().includes(q) ||
          t.presetId.toLowerCase().includes(q) ||
          (t.resultSummary ?? "").toLowerCase().includes(q) ||
          taskTitle(t).toLowerCase().includes(q),
      );
    }

    list.sort((a, b) => {
      switch (sortBy.value) {
        case "oldest":
          return a.createdAt.localeCompare(b.createdAt);
        case "priority":
          return priorityWeight(b.priority) - priorityWeight(a.priority);
        case "status":
          return statusWeight(a.status) - statusWeight(b.status);
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });

    return list;
  });

  const taskTypes = computed(() => {
    const types = new Set(tasks.value.map((t) => t.taskType));
    return [...types].sort();
  });

  const activeTasks = computed(() =>
    tasks.value.filter((t) => t.status === "in_progress" || t.status === "claimed"),
  );

  const pendingTasks = computed(() => tasks.value.filter((t) => t.status === "pending"));

  // ─── Actions ──────────────────────────────────────────────────────

  let fetchTasksPromise: Promise<void> | null = null;
  let refreshTasksPromise: Promise<void> | null = null;

  async function fetchTasks(filter?: TaskFilter) {
    if (fetchTasksPromise) return fetchTasksPromise;
    const token = loadGuard.start();
    loading.value = true;
    error.value = null;
    fetchTasksPromise = (async () => {
      try {
        const [taskResult, statsResult, jobsResult] = await Promise.all([
          taskList(filter),
          taskStats(),
          taskListJobs(20),
        ]);
        if (!loadGuard.isValid(token)) return;
        tasks.value = taskResult;
        stats.value = statsResult;
        jobs.value = jobsResult;
      } catch (e) {
        if (!loadGuard.isValid(token)) return;
        error.value = toErrorMessage(e);
      } finally {
        fetchTasksPromise = null;
        // Only clear loading when there is no concurrent silent refresh still in-flight,
        // so the spinner does not disappear while refreshTasks is still pending.
        if (loadGuard.isValid(token) && refreshTasksPromise === null) loading.value = false;
      }
    })();
    return fetchTasksPromise;
  }

  /** Silent refresh — no loading state change. */
  async function refreshTasks() {
    if (refreshTasksPromise) return refreshTasksPromise;
    const token = refreshGuard.start();
    refreshTasksPromise = (async () => {
      try {
        const [taskResult, statsResult, jobsResult] = await Promise.all([
          taskList(),
          taskStats(),
          taskListJobs(),
        ]);
        if (!refreshGuard.isValid(token)) return;
        tasks.value = taskResult;
        stats.value = statsResult;
        jobs.value = jobsResult;
        error.value = null;
      } catch (e) {
        if (refreshGuard.isValid(token)) {
          logWarn("[tasks] Silent refresh failed:", e);
        }
      } finally {
        refreshTasksPromise = null;
        // If fetchTasks already finished while we were running, clear the spinner it left open.
        if (fetchTasksPromise === null && loading.value) loading.value = false;
      }
    })();
    return refreshTasksPromise;
  }

  // Dummy loading ref — getTask/refreshTask are called from a detail view
  // that already owns its own visibility state, so the shared `loading` ref
  // must not toggle here (would flicker the list-level skeleton).
  const getTaskLoading = ref(false);

  async function getTask(id: string): Promise<Task | null> {
    selectedTask.value = null;
    let fetched: Task | null = null;
    await runAction({
      loading: getTaskLoading,
      error,
      guard: getTaskGuard,
      action: async () => {
        fetched = await taskGet(id);
        return fetched;
      },
      onSuccess: (task) => {
        selectedTask.value = task;
      },
    });
    return fetched;
  }

  /** Refresh the selected task without nulling it first (avoids UI flash). */
  async function refreshTask(id: string): Promise<Task | null> {
    let fetched: Task | null = null;
    await runAction({
      loading: getTaskLoading,
      error,
      guard: getTaskGuard,
      action: async () => {
        fetched = await taskGet(id);
        return fetched;
      },
      onSuccess: (task) => {
        selectedTask.value = task;
      },
    });
    return fetched;
  }

  async function createTask(
    taskType: string,
    presetId: string,
    inputParams: Record<string, unknown> = {},
    priority?: string,
    maxRetries?: number,
  ): Promise<Task | null> {
    return runMutation(error, async () => {
      const task = await taskCreate(taskType, presetId, inputParams, priority, maxRetries);
      await refreshTasks();
      return task;
    });
  }

  async function createBatch(
    newTasks: NewTask[],
    jobName: string,
    presetId?: string,
  ): Promise<Job | null> {
    return runMutation(error, async () => {
      const job = await taskCreateBatch(newTasks, jobName, presetId);
      await refreshTasks();
      return job;
    });
  }

  async function cancelTask(id: string): Promise<boolean> {
    const ok = await runMutation(error, async () => {
      await taskCancel(id);
      await refreshTasks();
      return true as const;
    });
    return ok ?? false;
  }

  async function retryTask(id: string): Promise<boolean> {
    const ok = await runMutation(error, async () => {
      await taskRetry(id);
      await refreshTasks();
      return true as const;
    });
    return ok ?? false;
  }

  async function deleteTask(id: string): Promise<boolean> {
    const ok = await runMutation(error, async () => {
      await taskDelete(id);
      tasks.value = tasks.value.filter((t) => t.id !== id);
      if (selectedTask.value?.id === id) {
        selectedTask.value = null;
      }
      await refreshTasks();
      return true as const;
    });
    return ok ?? false;
  }

  function resetFilters() {
    searchQuery.value = "";
    filterStatus.value = "all";
    filterType.value = "all";
  }

  return {
    // State
    tasks,
    jobs,
    stats,
    selectedTask,
    loading,
    error,
    searchQuery,
    filterStatus,
    filterType,
    sortBy,
    // Computed
    filteredTasks,
    taskTypes,
    activeTasks,
    pendingTasks,
    // Actions
    fetchTasks,
    refreshTasks,
    getTask,
    refreshTask,
    createTask,
    createBatch,
    cancelTask,
    retryTask,
    deleteTask,
    resetFilters,
  };
});

// ─── Helpers ──────────────────────────────────────────────────────

/** Derive display title from a task. */
export function taskTitle(task: Task): string {
  const title = task.inputParams?.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  return formatTaskType(task.taskType);
}

/** Format a task_type slug into a human-readable label. */
export function formatTaskType(taskType: string): string {
  return taskType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function priorityWeight(priority: string): number {
  switch (priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "normal":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function statusWeight(status: string): number {
  switch (status) {
    case "in_progress":
      return 0;
    case "claimed":
      return 1;
    case "pending":
      return 2;
    case "failed":
      return 3;
    case "done":
      return 4;
    case "cancelled":
      return 5;
    case "expired":
      return 6;
    case "dead_letter":
      return 7;
    default:
      return 8;
  }
}
