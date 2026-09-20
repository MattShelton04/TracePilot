// biome-ignore-all assist/source/organizeImports: mocks must be registered before the store import.
import { setupPinia } from "@tracepilot/test-utils";
import type { AgentUsageSummary } from "@tracepilot/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentsList: vi.fn(),
  agentsUsageSummary: vi.fn(),
  agentsCreate: vi.fn(),
  agentsDelete: vi.fn(),
  agentsSetOverride: vi.fn(),
  agentsSetDisabled: vi.fn(),
}));

vi.mock("@tracepilot/client", () => ({
  agentsList: (...args: unknown[]) => mocks.agentsList(...args),
  agentsUsageSummary: (...args: unknown[]) => mocks.agentsUsageSummary(...args),
  agentsCreate: (...args: unknown[]) => mocks.agentsCreate(...args),
  agentsDelete: (...args: unknown[]) => mocks.agentsDelete(...args),
  agentsSetOverride: (...args: unknown[]) => mocks.agentsSetOverride(...args),
  agentsSetDisabled: (...args: unknown[]) => mocks.agentsSetDisabled(...args),
}));

import { useAgentsStore } from "../../stores/agents";
import {
  agentCatalog as catalog,
  agentDefinition as definition,
  agentSettings as settings,
  agentUsage as usage,
} from "@tracepilot/client/mock";

function summary(agents: ReturnType<typeof usage>[]): AgentUsageSummary {
  return {
    totalRuns: agents.reduce((sum, agent) => sum + agent.runs, 0),
    totalSessions: 1,
    failedRuns: agents.reduce((sum, agent) => sum + agent.failed, 0),
    cancelledRuns: 0,
    incompleteRuns: 0,
    maxDepth: 1,
    peakParallelism: 2,
    runsWithCredits: 0,
    totalOwnNanoAiu: 0,
    agents,
    mainAgentSelections: [],
  };
}

describe("useAgentsStore", () => {
  beforeEach(() => {
    setupPinia();
    localStorage.clear();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.agentsList.mockResolvedValue(catalog([definition("reviewer")]));
    mocks.agentsUsageSummary.mockResolvedValue(summary([usage("reviewer")]));
  });

  it("loads definitions even when the usage query fails", async () => {
    mocks.agentsUsageSummary.mockRejectedValue(new Error("index missing"));
    const store = useAgentsStore();
    await store.loadAll();

    expect(store.entries).toHaveLength(1);
    expect(store.error).toBeNull();
    expect(store.usageError).toContain("index missing");
  });

  it("re-queries usage with the new bounds when the range changes", async () => {
    const store = useAgentsStore();
    await store.loadAll();
    mocks.agentsUsageSummary.mockClear();

    expect(store.range).toBe("all");
    await store.setRange("90d");
    expect(mocks.agentsUsageSummary).toHaveBeenCalledWith({
      fromDate: expect.any(String),
      toDate: expect.any(String),
    });

    mocks.agentsUsageSummary.mockClear();
    await store.setRange("90d");
    expect(mocks.agentsUsageSummary).not.toHaveBeenCalled();
  });

  it("counts entries per scope, including session-only agents", async () => {
    mocks.agentsList.mockResolvedValue(
      catalog([definition("reviewer"), definition("explore", { scope: "builtin" })]),
    );
    mocks.agentsUsageSummary.mockResolvedValue(summary([usage("ghost-agent")]));

    const store = useAgentsStore();
    await store.loadAll();

    expect(store.scopeCounts).toMatchObject({ builtin: 1, personal: 1, unresolved: 1 });
    expect(store.hasCustomAgents).toBe(true);
  });

  it("narrows the grid by scope, and clears again", async () => {
    mocks.agentsUsageSummary.mockResolvedValue(summary([usage("ghost-agent")]));
    const store = useAgentsStore();
    await store.loadAll();

    store.scope = "unresolved";
    expect(store.scope).toBe("unresolved");
    expect(store.filteredEntries.map((entry) => entry.name)).toEqual(["ghost-agent"]);

    store.clearFilters();
    expect(store.filteredEntries).toHaveLength(2);
  });

  it("applies the settings a mutation returns without a full reload", async () => {
    const store = useAgentsStore();
    await store.loadCatalog();
    mocks.agentsList.mockClear();
    mocks.agentsSetDisabled.mockResolvedValue(settings({ disabled: ["reviewer"] }));

    expect(await store.setDisabled("reviewer", true)).toBe(true);
    expect(store.catalog?.settings.disabled).toEqual(["reviewer"]);
    expect(mocks.agentsList).not.toHaveBeenCalled();
    expect(store.entries[0]?.flags).toContain("disabled");
  });

  it("reports a failed create rather than pretending it worked", async () => {
    mocks.agentsCreate.mockRejectedValue(new Error("name taken"));
    const store = useAgentsStore();
    await store.loadCatalog();

    expect(await store.createAgent("personal", "reviewer", "")).toBeNull();
    expect(store.error).toContain("name taken");
    store.clearError();
    expect(store.error).toBeNull();
  });
});
