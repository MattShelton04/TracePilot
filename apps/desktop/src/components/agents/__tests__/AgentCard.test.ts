import { agentDefinition as definition, agentUsage as usage } from "@tracepilot/client/mock";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEntry } from "@/utils/agents/entries";
import AgentCard from "../AgentCard.vue";

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

enableAutoUnmount(afterEach);
beforeEach(() => vi.clearAllMocks());

function entry(overrides: Partial<AgentEntry> = {}): AgentEntry {
  const def = definition("explore", {
    fields: { ...definition("explore").fields, models: ["gpt-5.4-mini"], tools: ["grep", "glob"] },
  });
  return {
    key: def.id,
    name: def.name,
    displayName: null,
    description: def.description,
    kind: "definition",
    scope: "personal",
    definition: def,
    usage: null,
    override: null,
    disabled: false,
    flags: [],
    ...overrides,
  };
}

function mountCard(agent: AgentEntry) {
  return mount(AgentCard, { props: { entry: agent, range: "30d" as const } });
}

describe("AgentCard", () => {
  it("opens the agent from the title button", async () => {
    const agent = entry();
    const wrapper = mountCard(agent);
    const open = wrapper.get<HTMLButtonElement>(".definition-card__open");
    expect(open.attributes("aria-label")).toBe("Open agent explore");
    await open.trigger("click");
    expect(wrapper.emitted("open")?.[0]?.[0]).toEqual(agent);
  });

  it("shows the definition's models and tool count", () => {
    const wrapper = mountCard(entry());
    expect(wrapper.get(".agent-card__models").text()).toContain("gpt-5.4-mini");
    expect(wrapper.text()).toContain("2 tools");
  });

  it("shows the override's model instead of the definition's, and says so", () => {
    const wrapper = mountCard(
      entry({ override: { model: "claude-opus-5", effortLevel: null, contextTier: null } }),
    );
    const models = wrapper.get(".agent-card__models");
    expect(models.text()).toContain("claude-opus-5");
    expect(models.text()).not.toContain("gpt-5.4-mini");
    expect(models.attributes("title")).toContain("definition says gpt-5.4-mini");
  });

  it("reports no runs rather than a misleading zero", () => {
    const wrapper = mountCard(entry());
    expect(wrapper.text()).toContain("No runs in this range");
    expect(wrapper.find(".usage-sparkline").exists()).toBe(false);
  });

  it("summarises usage and draws a sparkline once there are runs", () => {
    const wrapper = mountCard(
      entry({
        usage: usage("explore", {
          runs: 120,
          failed: 3,
          durationMs: { count: 120, min: 1, p25: 2, p50: 38_000, p75: 4, p90: 5, max: 6 },
          dailyRuns: [
            { date: "2026-09-17", runs: 4 },
            { date: "2026-09-18", runs: 9 },
          ],
        }),
      }),
    );
    const stats = wrapper.findAll(".usage-card-summary__stat").map((stat) => stat.text());
    expect(stats[0]).toContain("runs");
    expect(stats[0]).toContain("120");
    expect(stats[1]).toContain("38s");
    expect(stats[2]).toContain("2.5%");
    expect(wrapper.find(".usage-sparkline").exists()).toBe(true);
  });

  it("labels a built-in with no definition file rather than calling it unresolved", () => {
    const wrapper = mountCard(
      entry({ kind: "embedded", scope: "builtin", definition: null, usage: usage("explore") }),
    );
    expect(wrapper.text()).toContain("Definition unavailable");
    expect(wrapper.text()).toContain("Built-in");
  });
});
