import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// Reactive so the composable's computeds re-evaluate on mutation.
const orchestratorState = reactive<{
  starting: boolean;
  stopping: boolean;
  loading: boolean;
  error: string | null;
  handle: { pid: number; launchedAt: string } | null;
  health: {
    health: string;
    heartbeatAgeSecs: number | null;
    lastCycle: number | null;
    activeTasks: string[];
    needsRestart?: boolean;
    sessionUuid?: string | null;
  } | null;
  attribution: { subagents: Array<{ taskId: string; startedAt: string | null }> } | null;
  models: Array<{ id: string; name: string; tier?: string }>;
  selectedModel: string;
  activityFeed: unknown[];
  lastIngestedCount: number;
  activeSubagents: unknown[];
  completedSubagents: unknown[];
  isRunning: boolean;
  isStopped: boolean;
  needsRestart: boolean;
  sessionUuid: string | null;
  refresh: () => void;
  pollCycle: () => Promise<void>;
  loadModels: () => void;
  startOrchestrator: () => void;
  stopOrchestrator: () => void;
}>({
  starting: false,
  stopping: false,
  loading: false,
  error: null,
  handle: null,
  health: null,
  attribution: null,
  models: [
    { id: "m-fast", name: "Fast", tier: "fast" },
    { id: "m-std", name: "Std", tier: "standard" },
    { id: "m-prem", name: "Prem", tier: "premium" },
  ],
  selectedModel: "m-std",
  activityFeed: [],
  lastIngestedCount: 0,
  activeSubagents: [],
  completedSubagents: [],
  isRunning: false,
  isStopped: true,
  needsRestart: false,
  sessionUuid: null,
  refresh: vi.fn(),
  pollCycle: vi.fn().mockResolvedValue(undefined),
  loadModels: vi.fn(),
  startOrchestrator: vi.fn(),
  stopOrchestrator: vi.fn(),
});

vi.mock("@/stores/orchestrator", () => ({
  useOrchestratorStore: () => orchestratorState,
}));

vi.mock("@/stores/tasks", () => ({
  useTasksStore: () => ({
    tasks: [{ id: "task-1", inputParams: { title: "My Task" }, taskType: "analysis" }],
    fetchTasks: vi.fn(),
  }),
  taskTitle: (t: { inputParams?: { title?: string }; id: string }) =>
    t.inputParams?.title ?? t.id,
}));

import {
  durationBetween,
  elapsedSinceFrom,
  formatActivityTimeFrom,
  truncateError,
  truncateId,
  useOrchestratorMonitor,
} from "../useOrchestratorMonitor";

beforeEach(() => {
  setupPinia();
  pushMock.mockReset();
  orchestratorState.health = null;
  orchestratorState.starting = false;
  orchestratorState.handle = null;
  orchestratorState.isRunning = false;
  orchestratorState.sessionUuid = null;
  orchestratorState.attribution = null;
});

describe("pure helpers", () => {
  it("truncateId shortens long ids", () => {
    expect(truncateId("abcdefghij", 5)).toBe("abcde…");
    expect(truncateId("abc", 5)).toBe("abc");
  });

  it("truncateError respects null and length", () => {
    expect(truncateError(null)).toBe("");
    expect(truncateError("short")).toBe("short");
    expect(truncateError("x".repeat(80), 10)).toBe(`${"x".repeat(10)}…`);
  });

  it("elapsedSinceFrom formats minutes:seconds", () => {
    const base = new Date("2026-04-01T10:00:00Z").getTime();
    expect(elapsedSinceFrom(base + 65_000, "2026-04-01T10:00:00Z")).toBe("1:05");
    expect(elapsedSinceFrom(base, null)).toBe("—");
    expect(elapsedSinceFrom(base - 1000, "2026-04-01T10:00:00Z")).toBe("0s");
  });

  it("durationBetween handles null/invalid/valid", () => {
    expect(durationBetween(null, null)).toBe("—");
    expect(durationBetween("2026-04-01T10:00:00Z", "2026-04-01T10:00:30Z")).toBe("30s");
    expect(durationBetween("2026-04-01T10:00:00Z", "2026-04-01T10:02:05Z")).toBe("2m 5s");
  });

  it("formatActivityTimeFrom yields relative then absolute", () => {
    const base = new Date("2026-04-01T10:00:00Z").getTime();
    expect(formatActivityTimeFrom(base + 5000, "2026-04-01T10:00:00Z")).toBe("5s ago");
    expect(formatActivityTimeFrom(base + 120_000, "2026-04-01T10:00:00Z")).toBe("2m ago");
  });
});

/** Mount a dummy component that consumes the composable so onMounted fires. */
function mountComposable() {
  let captured: ReturnType<typeof useOrchestratorMonitor> | null = null;
  const TestComp = defineComponent({
    setup() {
      captured = useOrchestratorMonitor();
      return () => h("div");
    },
  });
  const wrapper = mount(TestComp);
  return { wrapper, api: () => captured! };
}

describe("useOrchestratorMonitor computeds", () => {
  it("stateLabel reflects health states", async () => {
    const { wrapper, api } = mountComposable();
    await nextTick();

    expect(api().stateLabel.value).toBe("Idle");

    orchestratorState.health = {
      health: "healthy",
      heartbeatAgeSecs: 5,
      lastCycle: 3,
      activeTasks: [],
    };
    expect(api().stateLabel.value).toBe("Running");

    orchestratorState.health = {
      health: "stale",
      heartbeatAgeSecs: 90,
      lastCycle: 3,
      activeTasks: [],
    };
    expect(api().stateLabel.value).toBe("Stale");

    orchestratorState.starting = true;
    expect(api().stateLabel.value).toBe("Starting…");

    wrapper.unmount();
  });

  it("heartbeatColor thresholds", async () => {
    const { wrapper, api } = mountComposable();
    await nextTick();

    orchestratorState.health = { health: "healthy", heartbeatAgeSecs: 10, lastCycle: 1, activeTasks: [] };
    expect(api().heartbeatColor.value).toBe("success");

    orchestratorState.health = { health: "healthy", heartbeatAgeSecs: 45, lastCycle: 1, activeTasks: [] };
    expect(api().heartbeatColor.value).toBe("warning");

    orchestratorState.health = { health: "stale", heartbeatAgeSecs: 120, lastCycle: 1, activeTasks: [] };
    expect(api().heartbeatColor.value).toBe("danger");

    orchestratorState.health = { health: "unknown", heartbeatAgeSecs: null, lastCycle: null, activeTasks: [] };
    expect(api().heartbeatColor.value).toBe("danger");

    wrapper.unmount();
  });

  it("modelTiers groups models by tier & sorts fast < standard < premium", async () => {
    const { wrapper, api } = mountComposable();
    await nextTick();

    const tiers = api().modelTiers.value;
    expect(tiers.map((t) => t.id)).toEqual(["fast", "standard", "premium"]);
    expect(tiers[0]?.label).toBe("Fast");
    expect(tiers[1]?.models[0]?.id).toBe("m-std");

    wrapper.unmount();
  });

  it("viewTask pushes to router", async () => {
    const { wrapper, api } = mountComposable();
    await nextTick();

    api().viewTask("task-1");
    expect(pushMock).toHaveBeenCalledWith({ path: "/tasks/task-1" });

    wrapper.unmount();
  });
});
