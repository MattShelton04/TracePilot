import { makeTurn, makeTurnToolCall, setupPinia } from "@tracepilot/test-utils";
import type { ShutdownMetrics } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { computed } from "vue";
import { useMetricsTabData } from "@/composables/useMetricsTabData";
import { usePreferencesStore } from "@/stores/preferences";
import { modelTokenBreakdown } from "@/utils/metricsTokenBreakdown";
import MetricsAgentBreakdown from "../MetricsAgentBreakdown.vue";
import MetricsCacheBreakdown from "../MetricsCacheBreakdown.vue";
import MetricsModelTable from "../MetricsModelTable.vue";

beforeEach(() => setupPinia());
describe("agent metrics UI", () => {
  it("keeps the current page across usage refreshes and resets it when sorting", async () => {
    const metrics: ShutdownMetrics = {
      agentUsage: {
        eventIndex: 1,
        hasInvalidFields: false,
        agents: Object.fromEntries(
          Array.from({ length: 51 }, (_, index) => [
            `worker-${String(index).padStart(2, "0")}`,
            { modelMetrics: {} },
          ]),
        ),
      },
    };
    const wrapper = mount(MetricsAgentBreakdown, { props: { metrics, turns: [] } });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Next")
      ?.trigger("click");
    const rows = () =>
      wrapper
        .findAll('[data-testid="agent-usage-table"] tbody button')
        .map((button) => button.attributes("title"));
    expect(rows()).toEqual(["worker-49", "worker-50"]);
    await wrapper.setProps({ metrics: { ...metrics } });
    expect(rows()).toEqual(["worker-49", "worker-50"]);
    await wrapper.get('button[aria-label="Sort by Agent"]').trigger("click");
    expect(rows()).toHaveLength(50);
    wrapper.unmount();
  });
  it("selects main usage on opening and sorts headers with unknown values last", async () => {
    const metrics: ShutdownMetrics = {
      agentUsage: {
        eventIndex: 1,
        hasInvalidFields: false,
        agents: {
          main: {
            totalNanoAiu: 1e9,
            modelMetrics: {
              luna: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40 } },
            },
          },
          paid: { totalNanoAiu: 2e9, modelMetrics: {} },
          free: { totalNanoAiu: 0, modelMetrics: {} },
          unknown: { modelMetrics: {} },
        },
      },
    };
    const turns = [
      makeTurn({
        toolCalls: ["paid", "free", "unknown"].map((id) =>
          makeTurnToolCall({
            toolCallId: `launch-${id}`,
            agentId: id,
            agentDisplayName: id,
            isSubagent: true,
          }),
        ),
      }),
    ];
    const wrapper = mount(MetricsAgentBreakdown, { props: { metrics, turns } });
    const rowIds = () =>
      wrapper
        .findAll('[data-testid="agent-usage-table"] tbody button')
        .map((button) => button.attributes("title"));
    expect(wrapper.get('[data-testid="agent-usage-detail"]').text()).toContain(
      "Main agent · Own usage",
    );
    expect(
      wrapper.get('[data-testid="agent-usage-detail"] [role="meter"]').attributes("aria-valuenow"),
    ).toBe("40");
    expect(wrapper.find("select").exists()).toBe(false);
    expect(rowIds()).toEqual(["main", "paid", "free", "unknown"]);
    const credits = wrapper.get('button[aria-label="Sort by Recorded credits"]');
    await credits.trigger("click");
    expect(rowIds()).toEqual(["paid", "main", "free", "unknown"]);
    expect(credits.element.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    await credits.trigger("click");
    expect(rowIds()).toEqual(["free", "main", "paid", "unknown"]);
    expect(credits.element.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    // Refreshes must preserve both sort state and the chosen worker.
    await wrapper.get('tbody button[title="paid"]').trigger("click");
    await wrapper.setProps({ metrics: { ...metrics } });
    expect(rowIds()).toEqual(["free", "main", "paid", "unknown"]);
    expect(wrapper.get('[data-testid="agent-usage-detail"]').text()).toContain("paid · Own usage");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Reset to hierarchy")
      ?.trigger("click");
    expect(rowIds()).toEqual(["main", "paid", "free", "unknown"]);
    wrapper.unmount();
  });
  it("does not chart made-up proportions or estimate agent costs from incomplete usage", () => {
    const data = useMetricsTabData(
      computed(() => ({
        modelMetrics: {
          known: { usage: { inputTokens: 100, outputTokens: 20 } },
          partial: { usage: { inputTokens: 100 } },
        },
      })),
      usePreferencesStore(),
      true,
    );
    expect(data.tokenBreakdown.value.total).toBeNull();
    expect(data.modelEntries.value.every((row) => row.aiCreditSource === "unavailable")).toBe(true);
    const table = mount(MetricsModelTable, {
      props: {
        modelEntries: data.modelEntries.value,
        totalTokens: data.totalTokens.value,
        hasReasoningData: false,
      },
    });
    expect(table.text()).not.toContain("Token Distribution");
    expect(table.text()).toContain("Unavailable");
  });
  it("shows observed zero, selects model/cache detail and opens the correct activity", async () => {
    const metrics: ShutdownMetrics = {
      agentUsage: {
        eventIndex: 1,
        hasInvalidFields: false,
        agents: {
          worker: {
            totalNanoAiu: 0,
            modelMetrics: {
              luna: {
                totalNanoAiu: 0,
                usage: {
                  inputTokens: 100,
                  outputTokens: 20,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                },
              },
            },
          },
        },
      },
    };
    const wrapper = mount(MetricsAgentBreakdown, {
      props: {
        metrics,
        turns: [
          makeTurn({
            toolCalls: [
              makeTurnToolCall({
                toolCallId: "launch",
                agentId: "worker",
                agentDisplayName: "Worker",
                isSubagent: true,
              }),
            ],
          }),
        ],
      },
    });
    expect(wrapper.text()).toContain("0 AIC");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Worker")
      ?.trigger("click");
    expect(wrapper.get('[data-testid="agent-usage-detail"]').text()).toContain("Cache Breakdown");
    expect(wrapper.get('[data-testid="agent-usage-detail"]').text()).toContain("Observed");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Open agent activity")
      ?.trigger("click");
    expect(wrapper.emitted("activity")).toEqual([["launch"]]);
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(wrapper.text()).toContain("Rows include descendants and overlap");
  });
  it("explains missing historical usage and preserves a zero-hit cache section", () => {
    const wrapper = mount(MetricsAgentBreakdown, { props: { metrics: {}, turns: [] } });
    expect(wrapper.text()).toContain("Per-agent usage was not recorded");
    const cache = mount(MetricsCacheBreakdown, {
      props: {
        breakdown: modelTokenBreakdown({
          usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0 },
        }),
      },
    });
    expect(cache.get('[role="meter"]').attributes("aria-valuenow")).toBe("0");
    expect(cache.text()).toContain("0.0%");
    expect(cache.text()).toContain("Not served from cache");
    expect(cache.text()).not.toContain("Cache write");
  });
});
