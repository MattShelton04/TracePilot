import type { SkillUsageDetail, SkillUsageStats } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide, reactive } from "vue";
import { type SkillEditorContext, SkillEditorKey } from "@/composables/useSkillEditor";
import SkillRecentInvocations from "../SkillRecentInvocations.vue";
import SkillUsageTab from "../SkillUsageTab.vue";

const pushRoute = vi.hoisted(() => vi.fn());
vi.mock("@/router/navigation", () => ({ pushRoute }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const NOW = "2026-09-20T12:00:00Z";

function stats(overrides: Partial<SkillUsageStats> = {}): SkillUsageStats {
  return {
    name: "frontend-design",
    normalizedName: "frontend-design",
    description: null,
    uses: 40,
    sessions: 12,
    repositories: 2,
    firstUsed: "2026-08-01T00:00:00Z",
    lastUsed: NOW,
    userInvoked: 0,
    agentInvoked: 0,
    unknownTrigger: 40,
    mainAgentUses: 36,
    subagentUses: 4,
    fallbackUses: 0,
    medianContentTokens: 1800,
    usesWithContent: 38,
    latestContentSha256: "sha-current",
    contentVersions: 1,
    paths: [
      {
        path: "C:skills\frontend-designSKILL.md",
        directory: "c:/skills/frontend-design",
        uses: 40,
      },
    ],
    topModels: [],
    topRepositories: [],
    dailyUses: [],
    pluginName: null,
    source: null,
    ...overrides,
  };
}

function detail(overrides: Partial<SkillUsageDetail> = {}): SkillUsageDetail {
  return {
    stats: stats(),
    invokedBy: [{ label: "Main agent", uses: 36 }],
    models: [{ label: "claude-opus-5", uses: 30 }],
    repositories: [{ label: "TracePilot", uses: 40 }],
    recentInvocations: [],
    ...overrides,
  };
}

function mountTab(ctxOverrides: Partial<SkillEditorContext> = {}) {
  const ctx = reactive({
    usage: detail(),
    usageLoading: false,
    usageError: null,
    usageRange: "90d",
    installedSha256: "sha-current",
    tokenUsage: { frontmatterTokens: 120, instructionTokens: 1800 },
    ...ctxOverrides,
  }) as unknown as SkillEditorContext;

  const Harness = defineComponent({
    setup() {
      provide(SkillEditorKey, ctx);
      return () => h(SkillUsageTab);
    },
  });
  return { wrapper: mount(Harness), ctx };
}

describe("SkillUsageTab", () => {
  it("leads with the four figures that answer whether the skill earns its keep", () => {
    const { wrapper } = mountTab();
    const terms = wrapper.findAll(".skill-usage__summary dt").map((dt) => dt.text());
    expect(terms).toEqual(["Uses", "Repositories", "Injected per use", "Listing cost"]);
    expect(wrapper.get(".skill-usage__summary").text()).toContain("~1.8K");
  });

  it("gives the injected-cost median a denominator, since not every use records content", () => {
    const { wrapper } = mountTab();
    expect(wrapper.text()).toContain("median of 38 of 40");
  });

  it("drops the denominator when every use contributed to the median", () => {
    const { wrapper } = mountTab({
      usage: detail({ stats: stats({ usesWithContent: 40 }) }),
    } as never);
    expect(wrapper.text()).toContain("median of 40 uses");
    expect(wrapper.text()).not.toContain("40 of 40");
  });

  it("states that no trigger was recorded rather than drawing an all-unknown bar", () => {
    const { wrapper } = mountTab();
    expect(wrapper.find(".stacked").exists()).toBe(false);
    expect(wrapper.text()).toContain("No invocation in this range recorded who triggered it");
  });

  it("draws the trigger split once the CLI has recorded real triggers", () => {
    const { wrapper } = mountTab({
      usage: detail({ stats: stats({ userInvoked: 10, unknownTrigger: 30 }) }),
    } as never);
    expect(wrapper.find(".stacked").exists()).toBe(true);
  });

  it("says the cost is unknown rather than showing a median of nothing", () => {
    const { wrapper } = mountTab({
      usage: detail({ stats: stats({ medianContentTokens: null, usesWithContent: 0 }) }),
    } as never);
    expect(wrapper.text()).toContain("No content recorded");
  });

  it("explains that an all-unknown trigger split is a CLI version gap, not a measurement", () => {
    const { wrapper } = mountTab();
    expect(wrapper.text()).toContain("not recorded before CLI 1.0.49");
  });

  it("drops that caveat once the CLI has recorded a real trigger", () => {
    const { wrapper } = mountTab({
      usage: detail({ stats: stats({ userInvoked: 10, unknownTrigger: 30 }) }),
    } as never);
    expect(wrapper.text()).not.toContain("not recorded before CLI 1.0.49");
  });

  it("warns that the figures describe an older version when the file has drifted", () => {
    const { wrapper } = mountTab({ installedSha256: "sha-edited" } as never);
    expect(wrapper.get(".skill-usage__notice").text()).toContain("changed since it was last used");
  });

  it("stays quiet about drift when the installed content has not been read", () => {
    const { wrapper } = mountTab({ installedSha256: null } as never);
    expect(wrapper.find(".skill-usage__notice").exists()).toBe(false);
  });

  it("attributes uses with no recorded model rather than under-reporting the total", () => {
    const { wrapper } = mountTab();
    expect(wrapper.text()).toContain("Not recorded");
  });

  it("names the range in the empty state so the reader knows what was searched", () => {
    const { wrapper } = mountTab({
      usage: detail({ stats: stats({ uses: 0 }) }),
      usageRange: "30d",
    } as never);
    expect(wrapper.get(".skill-usage__empty").text()).toBe(
      "This skill was not invoked in 30 days.",
    );
  });

  it("shows a load failure instead of an empty state that would read as 'never used'", () => {
    const { wrapper } = mountTab({ usage: null, usageError: "Index unavailable" } as never);
    expect(wrapper.get('[role="alert"]').text()).toBe("Index unavailable");
    expect(wrapper.find(".skill-usage__empty").exists()).toBe(false);
  });
});

describe("SkillRecentInvocations", () => {
  const record = {
    sessionId: "session-1",
    sessionSummary: "Refine the skills manager",
    repository: "TracePilot",
    timestamp: NOW,
    turnIndex: 7,
    eventIndex: 42,
    trigger: null as string | null,
    agentName: null as string | null,
    model: "claude-opus-5",
    contentTokens: 1800,
  };

  const mountList = (invocations: unknown[]) =>
    mount(SkillRecentInvocations, { props: { invocations } as never });

  it("opens the session conversation at the turn that loaded the skill", async () => {
    const wrapper = mountList([record]);
    await wrapper.get("button").trigger("click");
    expect(pushRoute).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      params: { id: "session-1" },
      query: { turn: "7", event: "42" },
    });
  });

  it("says the trigger is unknown rather than attributing it to the user", () => {
    expect(mountList([record]).text()).toContain("trigger unknown");
  });

  it("names who triggered it once the CLI records that", () => {
    expect(mountList([{ ...record, trigger: "user-invoked" }]).text()).toContain("you");
    expect(mountList([{ ...record, trigger: "agent-invoked" }]).text()).toContain("the model");
  });

  it("falls back to the session id when a session has no summary", () => {
    expect(mountList([{ ...record, sessionSummary: null }]).text()).toContain("session-1");
  });

  it("marks an invocation whose content was never recorded", () => {
    expect(mountList([{ ...record, contentTokens: null }]).text()).toContain("no content recorded");
  });

  it("says the range is empty rather than rendering a bare list", () => {
    expect(mountList([]).text()).toBe("No invocations recorded in this range.");
  });
});
