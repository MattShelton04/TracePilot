import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import AgentsManagerView from "@/views/agents/AgentsManagerView.vue";
import SkillsManagerView from "@/views/skills/SkillsManagerView.vue";

const { getSkillsStore, getAgentsStore } = vi.hoisted(() => ({
  getSkillsStore: vi.fn(),
  getAgentsStore: vi.fn(),
}));
vi.mock("@/stores/skills", () => ({ useSkillsStore: getSkillsStore }));
vi.mock("@/stores/agents", () => ({ useAgentsStore: getAgentsStore }));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}));
vi.mock("@/router/navigation", () => ({ pushRoute: vi.fn() }));

enableAutoUnmount(afterEach);
beforeEach(() => vi.clearAllMocks());

const MISSING_CLI = "No Copilot CLI installation was found, so its built-in skills are not listed.";
const BROKEN_SKILL = "missing required field `description`";

function skillsStore(diagnostics: { path: string; message: string; severity: string }[]) {
  return reactive({
    error: null as string | null,
    loading: false,
    initialized: true,
    tokenBudget: { enabledTokens: 0, totalSkills: 0, enabledSkills: 0 },
    globalSkills: [],
    repoSkills: [],
    builtinSkills: [],
    missingSkills: [],
    entries: [],
    filteredSkills: [],
    unusedEnabledSkills: [],
    usedSkillCount: 0,
    diagnostics,
    searchQuery: "",
    filterScope: "all",
    filterFlags: new Set(),
    flagCounts: {},
    sort: "uses",
    range: "90d",
    usage: null,
    usageLoading: false,
    usageError: null,
    loadAll: vi.fn(),
    loadSkills: vi.fn(),
    setRange: vi.fn(),
    setFilterScope: vi.fn(),
    toggleFlag: vi.fn(),
    showOnlyFlag: vi.fn(),
    clearFilters: vi.fn(),
    createSkill: vi.fn(),
    clearError: vi.fn(),
  });
}

function agentsStore(diagnostics: { path: string; message: string; severity: string }[]) {
  return reactive({
    error: null as string | null,
    loading: false,
    initialized: true,
    catalog: {
      definitions: [],
      diagnostics,
      personalDir: "/home/alice/.copilot/agents",
      repoRoots: [],
      cliVersion: null,
      settings: { overrides: [], disabledAgents: [], shapeError: null },
    },
    catalogLoading: false,
    entries: [],
    filteredEntries: [],
    scopeCounts: {},
    flags: new Set<string>(),
    search: "",
    scope: "all",
    sort: "runs",
    range: "90d",
    usage: null,
    usageLoading: false,
    usageError: null,
    loadAll: vi.fn(),
    setRange: vi.fn(),
    toggleFlag: vi.fn(),
    clearFilters: vi.fn(),
  });
}

describe("discovery diagnostics", () => {
  it("separates a missing CLI installation from skills that failed to load", async () => {
    getSkillsStore.mockReturnValue(
      skillsStore([
        { path: "/home/alice/.copilot/pkg", message: MISSING_CLI, severity: "warning" },
        {
          path: "/home/alice/.copilot/skills/broken/SKILL.md",
          message: BROKEN_SKILL,
          severity: "error",
        },
      ]),
    );
    const wrapper = mount(SkillsManagerView, { attachTo: document.body });
    await flushPromises();

    const summary = wrapper.get("details summary").text();
    expect(summary).toContain("1 skill could not be loaded");
    expect(wrapper.get("details").text()).toContain(BROKEN_SKILL);
    expect(wrapper.get("details").text()).not.toContain(MISSING_CLI);
    expect(wrapper.text()).toContain("Built-in skills unavailable");
    expect(wrapper.text()).toContain(MISSING_CLI);
  });

  it("omits the failure list when only a missing installation is reported", async () => {
    getSkillsStore.mockReturnValue(
      skillsStore([
        { path: "/home/alice/.copilot/pkg", message: MISSING_CLI, severity: "warning" },
      ]),
    );
    const wrapper = mount(SkillsManagerView, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find("details").exists()).toBe(false);
    expect(wrapper.text()).toContain("Built-in skills unavailable");
  });

  it("applies the same split to agent definitions", async () => {
    const missingAgents = MISSING_CLI.replace("skills", "agents");
    getAgentsStore.mockReturnValue(
      agentsStore([
        { path: "/home/alice/.copilot/pkg", message: missingAgents, severity: "warning" },
        {
          path: "/home/alice/.copilot/agents/broken.agent.md",
          message: "could not be parsed",
          severity: "error",
        },
      ]),
    );
    const wrapper = mount(AgentsManagerView, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.get("details summary").text()).toContain("1 definition could not be read");
    expect(wrapper.get("details").text()).not.toContain(missingAgents);
    expect(wrapper.text()).toContain("Built-in agents unavailable");
  });
});
