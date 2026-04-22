import { useAutoRefresh } from "@tracepilot/ui";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { useOrchestratorStore } from "@/stores/orchestrator";
import { taskTitle, useTasksStore } from "@/stores/tasks";

export const TIER_META: Record<string, { label: string; desc: string; order: number }> = {
  fast: { label: "Fast", desc: "Low cost, quick responses", order: 0 },
  standard: { label: "Standard", desc: "Balanced cost & quality", order: 1 },
  premium: { label: "Premium", desc: "Best quality, higher cost", order: 2 },
};

export function truncateId(id: string, len = 12): string {
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

export function truncateError(err: string | null, len = 60): string {
  if (!err) return "";
  return err.length > len ? `${err.slice(0, len)}…` : err;
}

export function elapsedSinceFrom(now: number, isoDate: string | null): string {
  if (!isoDate) return "—";
  const diffMs = now - new Date(isoDate).getTime();
  if (diffMs < 0) return "0s";
  const secs = Math.floor(diffMs / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function durationBetween(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (diffMs < 0) return "—";
  const secs = Math.floor(diffMs / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatActivityTimeFrom(now: number, iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  const diffMs = now - date.getTime();
  if (diffMs < 60_000) return `${Math.max(0, Math.floor(diffMs / 1000))}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function useOrchestratorMonitor() {
  const orchestrator = useOrchestratorStore();
  const tasksStore = useTasksStore();
  const router = useRouter();

  const now = ref(Date.now());
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  const healthExpanded = ref(false);
  const autoRefreshEnabled = ref(true);
  const autoRefreshInterval = ref(5);

  // The orchestrator store already owns a poll loop (fast when running, slow when idle).
  // The view-level autoRefresh is only used for the manual refresh button — it does NOT
  // start its own setInterval when the store is already polling.
  const { refreshing, refresh: autoRefresh } = useAutoRefresh({
    onRefresh: () => orchestrator.pollCycle(),
    enabled: ref(false),
    intervalSeconds: autoRefreshInterval,
  });

  // ── Derived state ───────────────────────────────────────────
  const stateLabel = computed(() => {
    if (orchestrator.starting) return "Starting…";
    switch (orchestrator.health?.health) {
      case "healthy":
        return "Running";
      case "stale":
        return "Stale";
      case "stopped":
        return "Stopped";
      case "unknown":
        return orchestrator.handle ? "Starting…" : "Unknown";
      default:
        return orchestrator.handle ? "Starting…" : "Idle";
    }
  });

  const stateColorClass = computed(() => {
    switch (orchestrator.health?.health) {
      case "healthy":
        return "state-healthy";
      case "stale":
        return "state-stale";
      case "stopped":
        return "state-stopped";
      default:
        return orchestrator.handle ? "state-active" : "state-stopped";
    }
  });

  const heartbeatDisplay = computed(() => {
    const secs = orchestrator.health?.heartbeatAgeSecs;
    if (secs == null) return "No heartbeat";
    if (secs < 60) return `${secs}s ago`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s ago`;
  });

  const heartbeatColor = computed<"success" | "warning" | "danger">(() => {
    const secs = orchestrator.health?.heartbeatAgeSecs;
    if (secs == null) return "danger";
    if (secs < 30) return "success";
    if (secs < 60) return "warning";
    return "danger";
  });

  const activeTaskCount = computed(() => orchestrator.health?.activeTasks?.length ?? 0);
  const lastCycle = computed(() => orchestrator.health?.lastCycle ?? null);

  const ringDasharray = computed(() => {
    switch (orchestrator.health?.health) {
      case "healthy":
        return "327";
      case "stale":
        return "164 163";
      case "stopped":
        return "82 245";
      default:
        return orchestrator.handle ? "245 82" : "82 245";
    }
  });

  const uptimeDisplay = computed(() => {
    const launched = orchestrator.handle?.launchedAt;
    if (!launched || !orchestrator.isRunning) return null;
    const diffMs = now.value - new Date(launched).getTime();
    if (diffMs < 0) return null;
    const secs = Math.floor(diffMs / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${secs % 60}s`;
  });

  // ── Task resolution helpers ─────────────────────────────────
  function subagentLabel(taskId: string): string {
    const task = tasksStore.tasks.find((t) => t.id === taskId);
    if (task) return taskTitle(task);
    return truncateId(taskId, 8);
  }

  function resolveTask(id: string) {
    return tasksStore.tasks.find((t) => t.id === id) ?? null;
  }

  function subagentStartTime(taskId: string): string | null {
    const agent = (orchestrator.attribution?.subagents ?? []).find((s) => s.taskId === taskId);
    return agent?.startedAt ?? null;
  }

  function elapsedSince(isoDate: string | null): string {
    return elapsedSinceFrom(now.value, isoDate);
  }

  function formatActivityTime(iso: string): string {
    return formatActivityTimeFrom(now.value, iso);
  }

  // ── Navigation ──────────────────────────────────────────────
  function viewSession() {
    const uuid = orchestrator.sessionUuid;
    if (uuid) {
      pushRoute(router, ROUTE_NAMES.sessionOverview, { params: { id: uuid } });
    }
  }

  function viewTask(taskId: string) {
    pushRoute(router, ROUTE_NAMES.taskDetail, { params: { taskId } });
  }

  // ── Model picker ────────────────────────────────────────────
  const showModelPicker = ref(false);

  const selectedModelName = computed(() => {
    const m = orchestrator.models.find((m) => m.id === orchestrator.selectedModel);
    return m?.name ?? orchestrator.selectedModel;
  });

  const selectedModelTier = computed(() => {
    const m = orchestrator.models.find((m) => m.id === orchestrator.selectedModel);
    return m?.tier ?? "standard";
  });

  const modelTiers = computed(() => {
    const groups: Record<string, typeof orchestrator.models> = {};
    for (const m of orchestrator.models) {
      const tier = m.tier || "standard";
      if (!groups[tier]) groups[tier] = [];
      groups[tier].push(m);
    }
    return Object.entries(groups)
      .map(([id, models]) => ({
        id,
        label: TIER_META[id]?.label ?? id,
        desc: TIER_META[id]?.desc ?? "",
        order: TIER_META[id]?.order ?? 1,
        models,
      }))
      .sort((a, b) => a.order - b.order);
  });

  const modelDropdownStyle = computed<Record<string, string>>(() => {
    const el = document.querySelector(".model-picker-toggle");
    if (!el) return {} as Record<string, string>;
    const rect = el.getBoundingClientRect();
    return {
      position: "fixed",
      top: `${rect.bottom + 4}px`,
      right: `${window.innerWidth - rect.right}px`,
      minWidth: `${Math.max(rect.width, 280)}px`,
    };
  });

  function selectModel(id: string) {
    orchestrator.selectedModel = id;
    showModelPicker.value = false;
  }

  // ── Lifecycle ───────────────────────────────────────────────
  onMounted(() => {
    orchestrator.refresh();
    orchestrator.loadModels();
    tasksStore.fetchTasks();
    tickTimer = setInterval(() => {
      now.value = Date.now();
    }, 1000);
  });

  onUnmounted(() => {
    if (tickTimer) clearInterval(tickTimer);
  });

  return {
    orchestrator,
    now,
    healthExpanded,
    autoRefreshEnabled,
    autoRefreshInterval,
    refreshing,
    autoRefresh,
    stateLabel,
    stateColorClass,
    heartbeatDisplay,
    heartbeatColor,
    activeTaskCount,
    lastCycle,
    ringDasharray,
    uptimeDisplay,
    subagentLabel,
    resolveTask,
    subagentStartTime,
    truncateId,
    truncateError,
    elapsedSince,
    durationBetween,
    formatActivityTime,
    viewSession,
    viewTask,
    showModelPicker,
    selectedModelName,
    selectedModelTier,
    modelTiers,
    modelDropdownStyle,
    selectModel,
  };
}
