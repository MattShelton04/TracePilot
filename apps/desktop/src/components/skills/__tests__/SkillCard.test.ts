import type { SkillSummary, SkillUsageStats } from "@tracepilot/types";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import type { SkillEntry } from "@/utils/skills/entries";
import SkillCard from "../SkillCard.vue";

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/router/navigation", () => ({ pushRoute: vi.fn() }));

enableAutoUnmount(afterEach);
beforeEach(() => vi.clearAllMocks());

function makeSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    name: "audit-skill-with-a-long-name",
    description: "Disposable skill fixture for keyboard navigation",
    directory: "audit-only-skill",
    scope: "global",
    enabled: true,
    frontmatterTokens: 42,
    instructionTokens: 123,
    hasAssets: false,
    assetCount: 0,
    contentSha256: "sha-audit",
    ...overrides,
  };
}

function makeUsage(overrides: Partial<SkillUsageStats> = {}): SkillUsageStats {
  return {
    name: "audit-skill-with-a-long-name",
    normalizedName: "audit-skill-with-a-long-name",
    description: null,
    uses: 12,
    sessions: 4,
    repositories: 2,
    firstUsed: "2026-08-01T00:00:00Z",
    lastUsed: "2026-09-18T00:00:00Z",
    userInvoked: 0,
    agentInvoked: 0,
    unknownTrigger: 12,
    mainAgentUses: 12,
    subagentUses: 0,
    fallbackUses: 0,
    medianContentTokens: 1800,
    usesWithContent: 12,
    latestContentSha256: "sha-audit",
    contentVersions: 1,
    paths: [],
    topModels: [],
    topRepositories: [],
    dailyUses: [],
    pluginName: null,
    source: null,
    ...overrides,
  };
}

function entry(overrides: Partial<SkillEntry> = {}): SkillEntry {
  const skill = overrides.skill === undefined ? makeSkill() : overrides.skill;
  return {
    key: skill?.directory ?? "name:gone",
    name: skill?.name ?? "gone",
    description: skill?.description ?? "",
    kind: "installed",
    scope: skill?.scope ?? "global",
    skill,
    usage: null,
    enabled: skill?.enabled ?? false,
    listingTokens: skill?.frontmatterTokens ?? 0,
    flags: [],
    lastKnownPath: null,
    ...overrides,
  };
}

const props = (overrides: Partial<SkillEntry> = {}) =>
  ({ entry: entry(overrides), range: "90d" }) as const;

describe("SkillCard action semantics", () => {
  it.each([
    " ",
    "Enter",
  ])("allows native %j activation on the separate card button", async (key) => {
    const skill = makeSkill();
    const wrapper = mount(SkillCard, { props: props(), attachTo: document.body });
    expect(wrapper.element.tagName).toBe("ARTICLE");
    expect(wrapper.attributes("tabindex")).toBeUndefined();
    expect(wrapper.attributes("role")).toBeUndefined();

    const open = wrapper.get<HTMLButtonElement>(".definition-card__open");
    expect(open.element.tagName).toBe("BUTTON");
    expect(open.attributes("type")).toBe("button");
    expect(open.attributes("aria-label")).toBe(`Open skill ${skill.name}`);
    expect(open.find("button, input, [tabindex]").exists()).toBe(false);
    open.element.focus();
    for (const type of ["keydown", "keyup"]) {
      const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
      open.element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(document.activeElement).toBe(open.element);
    expect(pushRoute).not.toHaveBeenCalled();

    // jsdom does not synthesize keyboard activation clicks. The native button
    // contract above allows the browser to do so; exercise that click here.
    await open.trigger("click");
    expect(pushRoute).toHaveBeenCalledExactlyOnceWith(expect.anything(), ROUTE_NAMES.skillEditor, {
      params: { name: skill.directory },
    });
  });

  it("keeps Remove and enable controls independent of card navigation", async () => {
    const skill = makeSkill();
    const wrapper = mount(SkillCard, { props: props(), attachTo: document.body });
    const remove = wrapper.get<HTMLButtonElement>('[title="Remove skill"]');
    expect(remove.element.closest(".definition-card__open")).toBeNull();
    remove.element.focus();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    remove.element.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(pushRoute).not.toHaveBeenCalled();
    await remove.trigger("click");
    expect(wrapper.emitted("delete")).toEqual([[skill.directory]]);
    expect(pushRoute).not.toHaveBeenCalled();

    const enabled = wrapper.get<HTMLInputElement>('input[type="checkbox"]');
    expect(enabled.attributes("aria-label")).toBe(`Enable skill ${skill.name}`);
    expect(enabled.element.closest(".definition-card__open")).toBeNull();
    await enabled.setValue(false);
    expect(wrapper.emitted("toggleEnabled")).toEqual([[skill.directory, false]]);
    expect(pushRoute).not.toHaveBeenCalled();

    await wrapper.get('[title="Edit skill"]').trigger("click");
    expect(pushRoute).toHaveBeenCalledOnce();
  });

  it("preserves built-in read-only actions and repository-disabled enablement", async () => {
    const wrapper = mount(SkillCard, {
      props: props({
        skill: makeSkill({ scope: "builtin", enabled: false, disabledReason: "repository" }),
        scope: "builtin",
        enabled: false,
      }),
    });
    expect(wrapper.find('[title="Remove skill"]').exists()).toBe(false);
    expect(wrapper.find('[title="Edit skill"]').exists()).toBe(false);
    const enabled = wrapper.get<HTMLInputElement>('input[type="checkbox"]');
    expect(enabled.element.disabled).toBe(true);
    enabled.element.click();
    expect(wrapper.emitted("toggleEnabled")).toBeUndefined();
    await wrapper.get('[title="View skill"]').trigger("click");
    expect(pushRoute).toHaveBeenCalledOnce();
    expect(wrapper.emitted("delete")).toBeUndefined();
  });
});

describe("SkillCard usage", () => {
  it("shows uses, sessions and injected cost once a skill has been used", () => {
    const wrapper = mount(SkillCard, {
      props: props({ usage: makeUsage() }),
    });

    const stats = wrapper.findAll(".skill-card__stat-value").map((node) => node.text());
    expect(stats).toEqual(["12", "4", "~1.8K"]);
    expect(wrapper.find(".skill-card__idle").exists()).toBe(false);
  });

  it("says a skill went unused rather than showing zeroes", () => {
    const wrapper = mount(SkillCard, { props: props() });

    expect(wrapper.get(".skill-card__idle").text()).toBe("No uses in this range");
    expect(wrapper.find(".skill-card__stat-value").exists()).toBe(false);
  });

  it("renders a daily-uses sparkline only when there is a series to draw", () => {
    const flat = mount(SkillCard, { props: props({ usage: makeUsage({ dailyUses: [] }) }) });
    expect(flat.find(".usage-sparkline").exists()).toBe(false);

    const withTrend = mount(SkillCard, {
      props: props({
        usage: makeUsage({
          firstUsed: "2026-09-01T00:00:00Z",
          dailyUses: [
            { date: "2026-09-01", uses: 2 },
            { date: "2026-09-03", uses: 5 },
          ],
        }),
      }),
    });
    expect(withTrend.find(".usage-sparkline").exists()).toBe(true);
  });

  it("explains each flag it shows", () => {
    const wrapper = mount(SkillCard, {
      props: props({ flags: ["unused", "drifted"] }),
    });

    const text = wrapper.text();
    expect(text).toContain("Unused");
    expect(text).toContain("Changed since used");
  });
});

describe("SkillCard for a skill that is no longer installed", () => {
  const missing = () =>
    props({
      key: "name:deleted-skill",
      name: "deleted-skill",
      description: "",
      kind: "missing",
      scope: "missing",
      skill: null,
      usage: makeUsage({ name: "deleted-skill", normalizedName: "deleted-skill" }),
      enabled: false,
      listingTokens: 0,
      flags: ["missing"],
      lastKnownPath: "C:\\gone\\skills\\deleted-skill\\SKILL.md",
    });

  it("stays static and shows where it was last loaded from", async () => {
    const wrapper = mount(SkillCard, { props: missing() });

    expect(wrapper.classes()).toContain("skill-card--static");
    expect(wrapper.find(".definition-card__open").exists()).toBe(false);
    expect(wrapper.find("input[type=checkbox]").exists()).toBe(false);
    // The card shows the root and the folder; the full path is the title.
    expect(wrapper.get(".skill-card__missing-value").text()).toBe(
      "C:\\gone\\skills\\deleted-skill",
    );
    expect(wrapper.get(".skill-card__missing-path").attributes("title")).toBe(
      "C:\\gone\\skills\\deleted-skill\\SKILL.md",
    );
    expect(wrapper.text()).toContain("Not installed");

    await wrapper.trigger("click");
    expect(pushRoute).not.toHaveBeenCalled();
  });

  it("still reports how much it was used", () => {
    const wrapper = mount(SkillCard, { props: missing() });
    expect(wrapper.findAll(".skill-card__stat-value").map((n) => n.text())).toEqual([
      "12",
      "4",
      "~1.8K",
    ]);
  });
});
