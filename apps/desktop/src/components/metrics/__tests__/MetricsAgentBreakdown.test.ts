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
