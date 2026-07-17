import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import MetricsSessionActivity from "../MetricsSessionActivity.vue";

describe("MetricsSessionActivity", () => {
  beforeEach(() => setupPinia());

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
