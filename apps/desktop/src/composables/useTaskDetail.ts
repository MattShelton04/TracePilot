import {
  formatDuration,
  useAutoRefresh,
  useConfirmDialog,
  useToast,
} from "@tracepilot/ui";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTasksStore } from "@/stores/tasks";

export type TaskDetailTabId =
  | "result"
  | "context"
  | "timeline"
  | "subagent"
  | "raw";

export interface TimelineEvent {
  label: string;
  timestamp: string | null;
  state: "done" | "active" | "pending";
  variant: "default" | "success" | "danger" | "warning";
}

const POST_CLAIMED = new Set([
  "in_progress",
  "done",
  "failed",
  "cancelled",
  "expired",
  "dead_letter",
]);

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

export function isSimpleValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function computeTimelineEvents(
  task: {
    status: string;
    createdAt: string;
    updatedAt: string;
    claimedAt?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
  } | null,
): TimelineEvent[] {
  if (!task) return [];
  const s = task.status;
  const events: TimelineEvent[] = [];

  events.push({
    label: "Created",
    timestamp: task.createdAt,
    state: "done",
    variant: "default",
  });

  if (s === "claimed") {
    events.push({
      label: "Claimed",
      timestamp: task.claimedAt ?? task.updatedAt,
      state: "active",
      variant: "default",
    });
  } else if (POST_CLAIMED.has(s)) {
    events.push({
      label: "Claimed",
      timestamp: task.claimedAt ?? null,
      state: "done",
      variant: "default",
    });
  } else {
    events.push({
      label: "Claimed",
      timestamp: null,
      state: "pending",
      variant: "default",
    });
  }

  if (s === "in_progress") {
    events.push({
      label: "In Progress",
      timestamp: task.startedAt ?? task.updatedAt,
      state: "active",
      variant: "default",
    });
  } else if (s === "done" || s === "failed") {
    events.push({
      label: "In Progress",
      timestamp: task.startedAt ?? null,
      state: "done",
      variant: "default",
    });
  } else {
    events.push({
      label: "In Progress",
      timestamp: null,
      state: "pending",
      variant: "default",
    });
  }

  if (s === "done") {
    events.push({
      label: "Completed",
      timestamp: task.completedAt ?? null,
      state: "done",
      variant: "success",
    });
  } else if (s === "failed") {
    events.push({
      label: "Failed",
      timestamp: task.completedAt ?? task.updatedAt,
      state: "done",
      variant: "danger",
    });
  } else if (s === "cancelled") {
    events.push({
      label: "Cancelled",
      timestamp: task.updatedAt,
      state: "done",
      variant: "warning",
    });
  } else if (s === "expired") {
    events.push({
      label: "Expired",
      timestamp: task.updatedAt,
      state: "done",
      variant: "warning",
    });
  } else if (s === "dead_letter") {
    events.push({
      label: "Dead Letter",
      timestamp: task.updatedAt,
      state: "done",
      variant: "danger",
    });
  } else {
    events.push({
      label: "Completed",
      timestamp: null,
      state: "pending",
      variant: "default",
    });
  }

  return events;
}

export function useTaskDetail() {
  const route = useRoute();
  const router = useRouter();
  const store = useTasksStore();
  const toast = useToast();
  const { confirm } = useConfirmDialog();

  const taskId = computed(() => route.params.taskId as string);
  const task = computed(() => store.selectedTask);
  const initialLoading = ref(true);
  const cancelling = ref(false);
  const retrying = ref(false);

  const autoRefreshEnabled = ref(true);
  const autoRefreshInterval = ref(5);

  const { refreshing, refresh } = useAutoRefresh({
    onRefresh: async () => {
      if (taskId.value) await store.refreshTask(taskId.value);
    },
    enabled: autoRefreshEnabled,
    intervalSeconds: autoRefreshInterval,
  });

  const canCancel = computed(() => {
    const s = task.value?.status;
    return s === "pending" || s === "claimed" || s === "in_progress";
  });

  const canRetry = computed(() => {
    const s = task.value?.status;
    return s === "failed" || s === "expired" || s === "dead_letter";
  });

  const truncatedId = computed(() => {
    const id = task.value?.id;
    if (!id) return "";
    return id.length > 12 ? `${id.slice(0, 12)}…` : id;
  });

  const duration = computed(() => {
    const t = task.value;
    if (!t?.completedAt || !t.createdAt) return null;
    const start = new Date(t.createdAt).getTime();
    const end = new Date(t.completedAt).getTime();
    return formatDuration(end - start);
  });

  const inputEntries = computed(() => {
    const params = task.value?.inputParams;
    if (!params || typeof params !== "object") return [];
    return Object.entries(params);
  });

  const resultEntries = computed(() => {
    const parsed = task.value?.resultParsed;
    if (!parsed || typeof parsed !== "object") return [];
    return Object.entries(parsed);
  });

  const timelineEvents = computed(() => computeTimelineEvents(task.value));

  const copiedSection = ref<string | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  async function copyText(text: string, section: string) {
    try {
      await navigator.clipboard.writeText(text);
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedSection.value = section;
      copiedTimer = setTimeout(() => {
        copiedSection.value = null;
      }, 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  }

  async function loadTask(id: string) {
    await store.getTask(id);
    initialLoading.value = false;
  }

  async function handleCancel() {
    if (!task.value) return;
    cancelling.value = true;
    const ok = await store.cancelTask(task.value.id);
    cancelling.value = false;
    if (ok) {
      toast.success("Task cancelled");
      await store.getTask(task.value.id);
    } else {
      toast.error(store.error ?? "Failed to cancel task");
    }
  }

  async function handleRetry() {
    if (!task.value) return;
    retrying.value = true;
    const ok = await store.retryTask(task.value.id);
    retrying.value = false;
    if (ok) {
      toast.success("Task queued for retry");
      await store.getTask(task.value.id);
    } else {
      toast.error(store.error ?? "Failed to retry task");
    }
  }

  async function handleDelete() {
    if (!task.value) return;
    const { confirmed } = await confirm({
      title: "Delete Task",
      message:
        "Are you sure you want to permanently delete this task?" +
        " This action cannot be undone.",
      variant: "danger",
      confirmLabel: "Yes, Delete",
    });
    if (!confirmed) return;
    const ok = await store.deleteTask(task.value.id);
    if (ok) {
      toast.success("Task deleted");
      router.push("/tasks");
    } else {
      toast.error(store.error ?? "Failed to delete task");
    }
  }

  function goBack() {
    router.push("/tasks");
  }

  onMounted(() => {
    if (taskId.value) loadTask(taskId.value);
  });

  watch(taskId, (newId) => {
    if (newId) loadTask(newId);
  });

  return {
    store,
    taskId,
    task,
    initialLoading,
    cancelling,
    retrying,
    autoRefreshEnabled,
    autoRefreshInterval,
    refreshing,
    refresh,
    canCancel,
    canRetry,
    truncatedId,
    duration,
    inputEntries,
    resultEntries,
    timelineEvents,
    copiedSection,
    copyText,
    loadTask,
    handleCancel,
    handleRetry,
    handleDelete,
    goBack,
  };
}
