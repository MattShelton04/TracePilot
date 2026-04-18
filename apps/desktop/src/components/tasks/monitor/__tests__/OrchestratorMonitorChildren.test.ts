import type { TrackedSubagent } from "@tracepilot/types";
import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ params: {} }),
}));

import ActiveSubagentsPanel from "../ActiveSubagentsPanel.vue";
import ActiveTasksPanel from "../ActiveTasksPanel.vue";
import CompletedSubagentsPanel from "../CompletedSubagentsPanel.vue";
import OrchestratorActivityFeed from "../OrchestratorActivityFeed.vue";
import OrchestratorHeaderBar from "../OrchestratorHeaderBar.vue";
import OrchestratorHealthPanel from "../OrchestratorHealthPanel.vue";
import OrchestratorStatsGrid from "../OrchestratorStatsGrid.vue";
import OrchestratorStatusHero from "../OrchestratorStatusHero.vue";

beforeEach(() => {
  setupPinia();
});

function sub(overrides: Partial<TrackedSubagent> = {}): TrackedSubagent {
  return {
    taskId: "task-xyz-1",
    agentName: "code-review",
    status: "running",
    startedAt: "2026-04-01T10:00:00Z",
    completedAt: null,
    error: null,
    ...overrides,
  };
}

describe("OrchestratorHeaderBar", () => {
  const baseProps = {
    isStopped: true,
    starting: false,
    stopping: false,
    hasModels: true,
    selectedModel: "m-1",
    selectedModelName: "Model One",
    selectedModelTier: "standard",
    modelTiers: [
      {
        id: "standard",
        label: "Standard",
        desc: "",
        order: 1,
        models: [
          { id: "m-1", name: "Model One", tier: "standard" },
          { id: "m-2", name: "Model Two", tier: "standard" },
        ],
      },
    ],
    showModelPicker: false,
    modelDropdownStyle: {},
    refreshing: false,
    autoRefreshEnabled: true,
    autoRefreshInterval: 5,
  };

  it("mounts with title and emits start", async () => {
    const wrapper = mount(OrchestratorHeaderBar, { props: baseProps });
    expect(wrapper.text()).toContain("Orchestrator Monitor");
    await wrapper.find(".start-btn").trigger("click");
    expect(wrapper.emitted("start")).toBeTruthy();
  });

  it("emits stop when not stopped", async () => {
    const wrapper = mount(OrchestratorHeaderBar, {
      props: { ...baseProps, isStopped: false },
    });
    await wrapper.find(".stop-btn").trigger("click");
    expect(wrapper.emitted("stop")).toBeTruthy();
  });

  it("emits toggle-model-picker on picker click", async () => {
    const wrapper = mount(OrchestratorHeaderBar, { props: baseProps });
    await wrapper.find(".model-picker-toggle").trigger("click");
    expect(wrapper.emitted("toggle-model-picker")).toBeTruthy();
  });
});

describe("OrchestratorStatusHero", () => {
  it("renders state label & emits view-session", async () => {
    const wrapper = mount(OrchestratorStatusHero, {
      props: {
        stateLabel: "Running",
        stateColorClass: "state-healthy",
        heartbeatDisplay: "5s ago",
        ringDasharray: "327",
        isRunning: true,
        pid: 1234,
        uptimeDisplay: "2m 30s",
        sessionUuid: "abc",
        needsRestart: false,
        error: null,
      },
    });
    expect(wrapper.text()).toContain("Running");
    expect(wrapper.text()).toContain("5s ago");
    expect(wrapper.text()).toContain("1234");
    await wrapper.find(".session-hero-btn").trigger("click");
    expect(wrapper.emitted("view-session")).toBeTruthy();
  });
});

describe("OrchestratorStatsGrid", () => {
  it("renders heartbeat + fallback values", () => {
    const wrapper = mount(OrchestratorStatsGrid, {
      props: {
        heartbeatAgeSecs: 42,
        heartbeatColor: "success",
        lastCycle: 7,
        activeTaskCount: 3,
        lastIngestedCount: 12,
      },
    });
    expect(wrapper.text()).toContain("42s");
    expect(wrapper.text()).toContain("Heartbeat Age");
  });
});

describe("ActiveTasksPanel", () => {
  const fnProps = {
    subagentLabel: (id: string) => `Label:${id}`,
    resolveTask: () => null,
    subagentStartTime: () => null,
    truncateId: (id: string, len = 12) => (id.length > len ? `${id.slice(0, len)}…` : id),
    elapsedSince: () => "0:10",
  };

  it("renders empty state when no tasks", () => {
    const wrapper = mount(ActiveTasksPanel, {
      props: {
        activeTaskIds: [],
        activeTaskCount: 0,
        hasHealth: true,
        isRunning: true,
        ...fnProps,
      },
    });
    expect(wrapper.text()).toContain("No active tasks");
  });

  it("renders task cards & emits view-task", async () => {
    const wrapper = mount(ActiveTasksPanel, {
      props: {
        activeTaskIds: ["task-1"],
        activeTaskCount: 1,
        hasHealth: true,
        isRunning: true,
        ...fnProps,
      },
    });
    expect(wrapper.text()).toContain("Label:task-1");
    await wrapper.find(".active-task-card").trigger("click");
    expect(wrapper.emitted("view-task")?.[0]).toEqual(["task-1"]);
  });
});

describe("ActiveSubagentsPanel", () => {
  it("renders waiting message when no session & no agents", () => {
    const wrapper = mount(ActiveSubagentsPanel, {
      props: {
        agents: [],
        sessionUuid: null,
        subagentLabel: () => "x",
        truncateId: (id: string) => id,
        elapsedSince: () => "0:00",
      },
    });
    expect(wrapper.text()).toContain("Waiting for session discovery");
  });

  it("renders agent card & emits view-task", async () => {
    const wrapper = mount(ActiveSubagentsPanel, {
      props: {
        agents: [sub({ status: "running" })],
        sessionUuid: "abc",
        subagentLabel: () => "Agent X",
        truncateId: (id: string) => id,
        elapsedSince: () => "0:10",
      },
    });
    expect(wrapper.text()).toContain("Agent X");
    await wrapper.find(".sa-link").trigger("click");
    expect(wrapper.emitted("view-task")).toBeTruthy();
  });
});

describe("CompletedSubagentsPanel", () => {
  it("renders empty state", () => {
    const wrapper = mount(CompletedSubagentsPanel, {
      props: {
        agents: [],
        subagentLabel: () => "x",
        truncateId: (id: string) => id,
        truncateError: (e: string | null) => e ?? "",
        durationBetween: () => "—",
      },
    });
    expect(wrapper.text()).toContain("No completed subagents");
  });

  it("renders failed card with error", () => {
    const wrapper = mount(CompletedSubagentsPanel, {
      props: {
        agents: [
          sub({
            status: "failed",
            completedAt: "2026-04-01T10:05:00Z",
            error: "boom",
          }),
        ],
        subagentLabel: () => "Broken",
        truncateId: (id: string) => id,
        truncateError: (e: string | null) => e ?? "",
        durationBetween: () => "5m 0s",
      },
    });
    expect(wrapper.text()).toContain("Broken");
    expect(wrapper.text()).toContain("boom");
    expect(wrapper.find(".card-failed").exists()).toBe(true);
  });
});

describe("OrchestratorActivityFeed", () => {
  it("renders entries", () => {
    const wrapper = mount(OrchestratorActivityFeed, {
      props: {
        entries: [
          {
            id: "e1",
            timestamp: "2026-04-01T10:00:00Z",
            icon: "✓",
            label: "Did a thing",
            detail: "details",
            eventType: "subagent.completed",
          },
        ],
        isRunning: true,
        formatActivityTime: () => "now",
      },
    });
    expect(wrapper.text()).toContain("Did a thing");
    expect(wrapper.text()).toContain("details");
  });

  it("renders empty state when idle", () => {
    const wrapper = mount(OrchestratorActivityFeed, {
      props: {
        entries: [],
        isRunning: false,
        formatActivityTime: () => "",
      },
    });
    expect(wrapper.text()).toContain("Start the orchestrator");
  });
});

describe("OrchestratorHealthPanel", () => {
  it("renders badge & toggles on click", async () => {
    const wrapper = mount(OrchestratorHealthPanel, {
      props: {
        healthExpanded: false,
        healthStatus: "healthy",
        needsRestart: false,
        error: null,
        truncateError: (e: string | null) => e ?? "",
      },
    });
    expect(wrapper.text()).toContain("healthy");
    expect(wrapper.text()).toContain("Expand");
    await wrapper.find(".collapse-toggle").trigger("click");
    expect(wrapper.emitted("toggle")).toBeTruthy();
  });

  it("renders grid when expanded", () => {
    const wrapper = mount(OrchestratorHealthPanel, {
      props: {
        healthExpanded: true,
        healthStatus: "stopped",
        needsRestart: true,
        error: "oops",
        truncateError: (e: string | null) => e ?? "",
      },
    });
    expect(wrapper.text()).toContain("Needs Restart");
    expect(wrapper.text()).toContain("Yes");
    expect(wrapper.text()).toContain("Recovery Policy");
  });
});
