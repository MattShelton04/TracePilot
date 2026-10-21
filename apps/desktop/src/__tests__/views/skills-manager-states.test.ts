import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import SkillsManagerView from "@/views/skills/SkillsManagerView.vue";

const { getStore } = vi.hoisted(() => ({ getStore: vi.fn() }));
vi.mock("@/stores/skills", () => ({ useSkillsStore: getStore }));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}));
vi.mock("@/router/navigation", () => ({ pushRoute: vi.fn() }));

enableAutoUnmount(afterEach);
beforeEach(() => vi.clearAllMocks());

const SKILL = {
  name: "audit",
  description: "Audit things",
  directory: "/skills/audit",
  scope: "global",
  enabled: true,
};

type Outcome = { error: string } | { skills: (typeof SKILL)[] };

/** A store whose `loadAll` settles the way the real one does: data or an error. */
function mountView(...outcomes: Outcome[]) {
  const store = reactive({
    error: null as string | null,
    loading: false,
    initialized: false,
    skills: [] as (typeof SKILL)[],
    tokenBudget: { enabledTokens: 0, totalSkills: 0, enabledSkills: 0 },
    globalSkills: [] as unknown[],
    repoSkills: [],
    builtinSkills: [],
    missingSkills: [],
    entries: [] as unknown[],
    filteredSkills: [] as unknown[],
    unusedEnabledSkills: [],
    usedSkillCount: 0,
    diagnostics: [],
    searchQuery: "",
    filterScope: "all",
    filterFlags: new Set(),
    flagCounts: {},
    sort: "uses",
    range: "90d",
    usage: null,
    usageLoading: false,
    usageError: null,
    loadAll: vi.fn(async () => {
      const outcome = outcomes.shift() ?? { skills: [] };
      if ("error" in outcome) {
        store.error = outcome.error;
      } else {
        store.error = null;
        store.skills = outcome.skills;
        store.tokenBudget = {
          enabledTokens: 0,
          totalSkills: outcome.skills.length,
          enabledSkills: 0,
        };
      }
      store.initialized = true;
    }),
    loadSkills: vi.fn(),
    setRange: vi.fn(),
    setFilterScope: vi.fn(),
    toggleFlag: vi.fn(),
    showOnlyFlag: vi.fn(),
    clearFilters: vi.fn(),
    clearError: () => {
      store.error = null;
    },
  });
  getStore.mockReturnValue(store);
  return { store, wrapper: mount(SkillsManagerView, { attachTo: document.body }) };
}

describe("SkillsManagerView load states", () => {
  it("shows one error state instead of zero counts and 'create your first skill'", async () => {
    const { wrapper } = mountView({ error: "skills_list_all failed: access denied" });
    await flushPromises();
    expect(wrapper.text()).toContain("Skills could not be loaded");
    expect(wrapper.text()).toContain("access denied");
    expect(wrapper.find(".stats-strip").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("0 installed");
    expect(wrapper.text()).not.toContain("Create your first skill");
  });

  it("retries the whole page load and shows the catalog once it arrives", async () => {
    const { store, wrapper } = mountView({ error: "access denied" }, { skills: [SKILL] });
    await flushPromises();
    await wrapper.get(".error-state__retry").trigger("click");
    await flushPromises();
    expect(store.loadAll).toHaveBeenLastCalledWith(undefined, true);
    expect(wrapper.find(".error-state").exists()).toBe(false);
    expect(wrapper.get(".stats-strip").text()).toContain("1 installed");
  });

  it("shows the loading placeholder, not the error, while Retry is in flight", async () => {
    const { store, wrapper } = mountView({ error: "access denied" });
    await flushPromises();
    store.loading = true;
    await flushPromises();
    expect(wrapper.find(".definition-loading").exists()).toBe(true);
    expect(wrapper.find(".error-state").exists()).toBe(false);
  });

  it("keeps the catalog visible with an inline error when a toggle fails", async () => {
    const { store, wrapper } = mountView({ skills: [SKILL] });
    await flushPromises();
    store.error = "Could not update skill settings";
    await flushPromises();
    expect(wrapper.find(".error-state").exists()).toBe(false);
    expect(wrapper.find(".stats-strip").exists()).toBe(true);
    expect(wrapper.get(".state-message--error").text()).toContain(
      "Could not update skill settings",
    );
  });

  it("keeps the catalog visible when a later refresh fails", async () => {
    const { wrapper } = mountView({ skills: [SKILL] }, { error: "timeout" });
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Refresh")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.find(".error-state").exists()).toBe(false);
    expect(wrapper.get(".stats-strip").text()).toContain("1 installed");
    expect(wrapper.get(".state-message--error").text()).toContain("timeout");
  });

  it("still offers 'create your first skill' when the catalog is genuinely empty", async () => {
    const { wrapper } = mountView({ skills: [] });
    await flushPromises();
    expect(wrapper.find(".error-state").exists()).toBe(false);
    expect(wrapper.text()).toContain("Create your first skill");
  });
});
