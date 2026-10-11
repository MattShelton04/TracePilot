import { skillsUsageSummary } from "@tracepilot/client";
import { setupPinia } from "@tracepilot/test-utils";
import type {
  SessionSource,
  SkillSummary,
  SkillUsageStats,
  SkillUsageSummary,
} from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { useAnalyticsStore } from "@/stores/analytics";
import AnalyticsSkillsPanel from "../AnalyticsSkillsPanel.vue";

const { getSkillsStore } = vi.hoisted(() => ({ getSkillsStore: vi.fn() }));
vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("@/__tests__/mocks/client");
  return createClientMock({
    checkConfigExists: vi.fn().mockResolvedValue(false),
    getConfig: vi.fn().mockResolvedValue(null),
    skillsUsageSummary: vi.fn(),
  });
});
vi.mock("@/stores/skills", () => ({ useSkillsStore: getSkillsStore }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/router/navigation", () => ({ pushRoute: vi.fn() }));
enableAutoUnmount(afterEach);

function stats(name: string, overrides: Partial<SkillUsageStats> = {}): SkillUsageStats {
  return {
    name,
    normalizedName: name,
    description: null,
    uses: 10,
    sessions: 4,
    repositories: 1,
    firstUsed: "2026-09-01T00:00:00Z",
    lastUsed: "2026-09-18T00:00:00Z",
    userInvoked: 0,
    agentInvoked: 0,
    unknownTrigger: 10,
    mainAgentUses: 10,
    subagentUses: 0,
    fallbackUses: 0,
    medianContentTokens: 900,
    usesWithContent: 10,
    latestContentSha256: `sha-${name}`,
    contentVersions: 1,
    paths: [{ path: `/skills/${name}/SKILL.md`, directory: `/skills/${name}`, uses: 10 }],
    topModels: [],
    topRepositories: [],
    dailyUses: [],
    pluginName: null,
    source: null,
    ...overrides,
  };
}

function installed(name: string, overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    name,
    description: "",
    scope: "global",
    directory: `/skills/${name}`,
    frontmatterTokens: 400,
    instructionTokens: 1200,
    enabled: true,
    hasAssets: false,
    assetCount: 0,
    contentSha256: `sha-${name}`,
    ...overrides,
  };
}

const summary: SkillUsageSummary = {
  totalUses: 30,
  totalSessions: 9,
  unknownTriggerUses: 30,
  fallbackUses: 2,
  totalContentTokens: 24_000,
  usesWithContent: 28,
  skills: [stats("frontend-design", { uses: 20 }), stats("pdf", { uses: 10 })],
};

function setStores(
  options: { repo?: string | null; source?: SessionSource | null; skills?: SkillSummary[] } = {},
) {
  setupPinia();
  const store = useAnalyticsStore();
  store.setTimeRange("custom", "2026-09-01");
  store.setRepo(options.repo ?? null);
  store.setSource(options.source ?? null);
  getSkillsStore.mockReturnValue(
    reactive({ skills: options.skills ?? [], loading: false, loadSkills: vi.fn() }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setStores();
  vi.mocked(skillsUsageSummary).mockResolvedValue(summary);
});

describe("AnalyticsSkillsPanel", () => {
  it("queries the dashboard's range, repository and source", async () => {
    setStores({ repo: "TracePilot", source: "claudeCode" });
    mount(AnalyticsSkillsPanel);
    await flushPromises();
    expect(skillsUsageSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        fromDate: "2026-09-01",
        repo: "TracePilot",
        source: "claudeCode",
      }),
    );
  });

  it("leads with uses, distinct skills, the injected total and uses per session", async () => {
    const wrapper = mount(AnalyticsSkillsPanel);
    await flushPromises();
    expect(wrapper.findAll(".skills-panel__value").map((el) => el.text())).toEqual([
      "30",
      "2",
      "~24K",
      "3.3",
    ]);
    expect(wrapper.text()).toContain("9 sessions");
  });

  it("gives the injected total a denominator when some uses recorded no content", async () => {
    const wrapper = mount(AnalyticsSkillsPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("28 of 30 uses recorded their content");
  });

  it("drops the denominator when every use contributed", async () => {
    vi.mocked(skillsUsageSummary).mockResolvedValue({ ...summary, usesWithContent: 30 });
    const wrapper = mount(AnalyticsSkillsPanel);
    await flushPromises();
    expect(wrapper.text()).not.toContain("recorded their content");
  });

  it("ranks skills by uses and opens each one in the manager", async () => {
    const wrapper = mount(AnalyticsSkillsPanel);
    await flushPromises();
    expect(wrapper.findAll(".skills-panel__name").map((el) => el.text())).toEqual([
      "frontend-design",
      "pdf",
    ]);
    await wrapper.get(".skills-panel__row").trigger("click");
    expect(pushRoute).toHaveBeenCalledWith(expect.anything(), ROUTE_NAMES.skillsManager, {
      query: { q: "frontend-design" },
    });
  });

  it("reports listing estimates across installations without claiming a per-turn total", async () => {
    setStores({ skills: [installed("frontend-design"), installed("never-used")] });
    const wrapper = mount(AnalyticsSkillsPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("1 enabled skill went unused here");
    expect(wrapper.text()).toContain("400 listing tokens across all projects");
  });

  it.each([
    { repo: "TracePilot" },
    { source: "copilot" as const },
  ])("withholds the unused line under a filter, where it would be a guess (%o)", async (filter) => {
    setStores({ ...filter, skills: [installed("frontend-design"), installed("never-used")] });
    const wrapper = mount(AnalyticsSkillsPanel);
    await flushPromises();
    expect(wrapper.text()).not.toContain("went unused here");
  });

  it("says the range had no skill uses rather than showing zeroes", async () => {
    vi.mocked(skillsUsageSummary).mockResolvedValue({
      totalUses: 0,
      totalSessions: 0,
      unknownTriggerUses: 0,
      fallbackUses: 0,
      totalContentTokens: 0,
      usesWithContent: 0,
      skills: [],
    });
    const wrapper = mount(AnalyticsSkillsPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("No skill uses were indexed for this range.");
  });

  it("surfaces a query failure instead of an empty range", async () => {
    vi.mocked(skillsUsageSummary).mockRejectedValue(new Error("index locked"));
    const wrapper = mount(AnalyticsSkillsPanel);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("index locked");
  });
});
