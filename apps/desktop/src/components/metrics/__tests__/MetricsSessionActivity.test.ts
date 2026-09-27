import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/stores/preferences";
import MetricsSessionActivity from "../MetricsSessionActivity.vue";

describe("MetricsSessionActivity", () => {
  beforeEach(() => setupPinia());

  it("renders only one page of shutdowns and can jump to the latest activity", async () => {
    const pricing = vi.spyOn(usePreferencesStore(), "computeUsageBasedCostBreakdown");
    const wrapper = mount(MetricsSessionActivity, {
      props: {
        metrics: {
          sessionSegments: Array.from({ length: 120 }, (_, index) => ({
            startTimestamp: "2026-07-17T00:00:00Z",
            endTimestamp: "2026-07-17T00:01:00Z",
            tokens: 1000,
            totalRequests: 1,
            premiumRequests: 0,
            apiDurationMs: 1000,
            totalNanoAiu: (index + 1) * 1000000000,
            modelMetrics: {
              "gpt-5.5": {
                totalNanoAiu: 1000000000,
                usage: { inputTokens: 800, outputTokens: 200 },
              },
            },
          })),
        },
      },
    });
    expect(wrapper.findAll(".activity-tile")).toHaveLength(6);
    expect(wrapper.text()).toContain("1–6 of 120 activities");
    // Observed credits do not need token-rate estimates at all.
    expect(pricing).not.toHaveBeenCalled();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Latest activities")
      ?.trigger("click");
    expect(wrapper.findAll(".activity-tile")).toHaveLength(6);
    expect(wrapper.text()).toContain("Activity #120");
    expect(wrapper.text()).toContain("115–120 of 120 activities");
    expect(wrapper.text()).toContain("120 AIC");
    expect(wrapper.text()).toContain("Latest");
    pricing.mockRestore();
  });

  it("shows observed segment and model AIC with their dollar equivalents", () => {
    const wrapper = mount(MetricsSessionActivity, {
      props: {
        metrics: {
          sessionSegments: [
            {
              startTimestamp: "2026-07-17T00:00:00Z",
              endTimestamp: "2026-07-17T00:01:00Z",
              tokens: 1_000,
              totalRequests: 1,
              premiumRequests: 0,
              apiDurationMs: 60_000,
              totalNanoAiu: 2_500_000_000,
              modelMetrics: {
                "gpt-5.5": {
                  totalNanoAiu: 2_500_000_000,
                  usage: { inputTokens: 800, outputTokens: 200 },
                },
              },
            },
          ],
        },
      },
    });

    expect(wrapper.text()).toContain("2.5 AIC");
    expect(wrapper.text()).toContain("$0.03");
    expect(wrapper.find(".activity-tile-costs").text()).toContain("2.5 AIC");
    expect(wrapper.find(".activity-tile-costs").text()).toContain("$0.03");
  });
});
