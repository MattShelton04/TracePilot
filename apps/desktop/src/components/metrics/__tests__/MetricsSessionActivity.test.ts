import { setupPinia } from "@tracepilot/test-utils";
import type { SessionSegment } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/stores/preferences";
import MetricsSessionActivity from "../MetricsSessionActivity.vue";

function segment(overrides: Partial<SessionSegment> = {}): SessionSegment {
  return {
    startTimestamp: "2026-07-17T00:00:00Z",
    endTimestamp: "2026-07-17T00:01:00Z",
    tokens: 100,
    totalRequests: 1,
    premiumRequests: 0,
    apiDurationMs: 1000,
    ...overrides,
  };
}

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

  it("does not turn a partial token subtotal into complete activity or model totals", () => {
    const pricing = vi.spyOn(usePreferencesStore(), "computeUsageBasedCostBreakdown");
    const wrapper = mount(MetricsSessionActivity, {
      props: {
        metrics: {
          sessionSegments: [
            segment({
              modelMetrics: { "gpt-5.5": { usage: { inputTokens: 100 } } },
            }),
          ],
        },
      },
    });
    expect(wrapper.get(".hero-val").text()).toBe("—");
    expect(wrapper.get(".model-tokens").text()).toBe("— tokens");
    expect(wrapper.get(".model-row .cost-pill").text()).toBe("—");
    expect(wrapper.get(".activity-tile-costs .cost-pill").text()).toBe("—");
    expect(pricing).not.toHaveBeenCalled();
    pricing.mockRestore();
  });

  it("retains complete model rows when the activity total is unknown", () => {
    const wrapper = mount(MetricsSessionActivity, {
      props: {
        metrics: {
          sessionSegments: [
            segment({
              tokens: 220,
              modelMetrics: {
                "gpt-5.5": { usage: { inputTokens: 100, outputTokens: 20 } },
                "gpt-5.4": { usage: { inputTokens: 100 } },
              },
            }),
          ],
        },
      },
    });
    expect(wrapper.get(".hero-val").text()).toBe("—");
    expect(wrapper.get(".activity-tile-costs .cost-pill").text()).toBe("—");
    const known = wrapper
      .findAll(".model-row")
      .find((row) => row.get(".model-name").text() === "gpt-5.5");
    expect(known?.get(".model-tokens").text()).toBe("120 tokens");
    expect(known?.get(".cost-pill").text()).not.toBe("—");
    expect(known?.get(".cost-pill").attributes("title")).toBe(
      "Estimated AI Credits from GitHub token rates",
    );
    expect(wrapper.findAll(".model-row")).toHaveLength(2);
  });

  it("shows missing activity telemetry as unavailable rather than zero", () => {
    const wrapper = mount(MetricsSessionActivity, {
      props: { metrics: { sessionSegments: [segment({ tokens: 0 })] } },
    });
    expect(wrapper.get(".hero-val").text()).toBe("—");
    expect(wrapper.get(".activity-tile-costs .cost-pill").text()).toBe("—");
    expect(wrapper.findAll(".model-row")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("No interaction recorded");
  });

  it("keeps a backend-shaped empty activity unavailable and shows its legacy fallback", () => {
    const wrapper = mount(MetricsSessionActivity, {
      props: {
        metrics: {
          sessionSegments: [segment({ tokens: 0, modelMetrics: {}, premiumRequests: 3 })],
        },
      },
    });
    expect(wrapper.text()).not.toContain("No interaction recorded");
    expect(wrapper.get(".hero-val").text()).toBe("—");
    expect(wrapper.get(".activity-tile-costs .cost-pill").text()).toBe("—");
    expect(wrapper.text()).toContain("Legacy Premium");
    expect(wrapper.get(".premium-val").text()).toBe("3.0");
  });

  it("retains positive observed model credits without inventing a zero activity credit total", () => {
    const wrapper = mount(MetricsSessionActivity, {
      props: {
        metrics: {
          sessionSegments: [
            segment({
              tokens: 0,
              modelMetrics: {
                model: { totalNanoAiu: 1_000_000_000, usage: { inputTokens: 0, outputTokens: 0 } },
              },
            }),
          ],
        },
      },
    });
    expect(wrapper.get(".hero-val").text()).toBe("0");
    expect(wrapper.get(".model-row .cost-pill").text()).toBe("1 AIC");
    expect(wrapper.get(".model-row .cost-pill").attributes("title")).toBe("Observed AI Credits");
    expect(wrapper.get(".activity-tile-costs .cost-pill").text()).toBe("—");
  });

  it.each([
    undefined,
    { inputTokens: 0, outputTokens: 0 },
  ])("retains observed zero credits with token coverage %s", (usage) => {
    const pricing = vi.spyOn(usePreferencesStore(), "computeUsageBasedCostBreakdown");
    const wrapper = mount(MetricsSessionActivity, {
      props: {
        metrics: {
          sessionSegments: [
            segment({
              tokens: 0,
              totalNanoAiu: 0,
              modelMetrics: { "gpt-5.5": { usage, totalNanoAiu: 0 } },
            }),
          ],
        },
      },
    });
    expect(wrapper.get(".hero-val").text()).toBe(usage ? "0" : "—");
    expect(wrapper.get(".model-tokens").text()).toBe(usage ? "0 tokens" : "— tokens");
    expect(wrapper.get(".model-row .cost-pill").text()).toBe("0 AIC");
    expect(wrapper.get(".activity-tile-costs .cost-pill").text()).toBe("0 AIC");
    expect(wrapper.get(".activity-tile-costs .cost-pill").attributes("title")).toBe(
      "Observed AI Credits",
    );
    expect(pricing).not.toHaveBeenCalled();
    pricing.mockRestore();
  });

  it("prices only visible complete activities and reprices the next page", async () => {
    const pricing = vi.spyOn(usePreferencesStore(), "computeUsageBasedCostBreakdown");
    const wrapper = mount(MetricsSessionActivity, {
      props: {
        metrics: {
          sessionSegments: Array.from({ length: 7 }, (_, index) =>
            segment({
              tokens: 120,
              modelMetrics: {
                [index === 6 ? "gpt-5.4" : "gpt-5.5"]: {
                  usage: { inputTokens: 100, outputTokens: 20 },
                },
              },
            }),
          ),
        },
      },
    });
    expect(wrapper.findAll(".hero-val").every((node) => node.text() === "120")).toBe(true);
    expect(pricing).toHaveBeenCalledTimes(12);
    expect(pricing.mock.calls.every(([name]) => name === "gpt-5.5")).toBe(true);
    pricing.mockClear();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Next activities")
      ?.trigger("click");
    expect(wrapper.findAll(".activity-tile")).toHaveLength(1);
    expect(pricing).toHaveBeenCalledTimes(2);
    expect(pricing.mock.calls.every(([name]) => name === "gpt-5.4")).toBe(true);
    pricing.mockRestore();
  });
});
