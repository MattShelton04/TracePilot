import { getModelRequestPerformance } from "@tracepilot/client";
import { setupPinia } from "@tracepilot/test-utils";
import type {
  CacheReuse,
  LatencyDistribution,
  RequestPerformance,
  RequestPerformanceReport,
} from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModelObservedPerformance from "@/components/modelComparison/ModelObservedPerformance.vue";
import { useAnalyticsStore } from "@/stores/analytics";
import { usePreferencesStore } from "@/stores/preferences";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    getModelRequestPerformance: vi.fn(),
    getAnalytics: vi.fn().mockResolvedValue(null),
  });
});

const performanceCall = vi.mocked(getModelRequestPerformance);

function distribution(overrides: Partial<LatencyDistribution> = {}): LatencyDistribution {
  return {
    median: 4845,
    p95: 12_480,
    min: 2104,
    max: 12_480,
    coverage: { valid: 40, missing: 0, invalid: 0 },
    ...overrides,
  };
}

function cache(overrides: Partial<CacheReuse> = {}): CacheReuse {
  return {
    requestsReportingReuse: 9,
    requestsWithCounter: 10,
    tokenWeightedRatio: 0.11,
    cacheReadTokens: 11_000,
    inputTokens: 100_000,
    inconsistentRows: 0,
    ...overrides,
  };
}

function performance(overrides: Partial<RequestPerformance> = {}): RequestPerformance {
  return {
    requestCount: 40,
    sessionCount: 4,
    durationMs: distribution(),
    timeToFirstTokenMs: distribution({ coverage: { valid: 38, missing: 2, invalid: 0 } }),
    // Far fewer rows recorded first observable output than recorded a duration.
    outputTtftMs: distribution({
      p95: null,
      coverage: { valid: 3, missing: 36, invalid: 1 },
    }),
    interTokenLatencyMs: distribution({ coverage: { valid: 31, missing: 9, invalid: 0 } }),
    cache: cache(),
    ...overrides,
  };
}

function respond(report: Partial<RequestPerformanceReport>) {
  return {
    enabled: true,
    report: {
      stale: false,
      lastSuccessAt: null,
      available: true,
      overall: performance(),
      byModel: [{ model: "gpt-5.6-luna", performance: performance() }],
      sessionCount: 4,
      ...report,
    },
  };
}

async function render() {
  const wrapper = mount(ModelObservedPerformance);
  await flushPromises();
  return wrapper;
}

beforeEach(async () => {
  setupPinia();
  performanceCall.mockReset();
  // The preferences store hydrates from config on creation, which would
  // otherwise land after a flag set here.
  await flushPromises();
  usePreferencesStore().featureFlags.sessionStoreEnrichment = true;
});

describe("ModelObservedPerformance", () => {
  it("says the source could not be read rather than showing no data", async () => {
    performanceCall.mockResolvedValue(
      respond({ available: false, overall: null, byModel: [], sessionCount: 0 }),
    );
    const wrapper = await render();

    const unavailable = wrapper.get('[data-testid="observed-unavailable"]');
    expect(unavailable.text()).toContain("No session store could be read");
    expect(unavailable.text()).toContain("says nothing about how many requests were made");
    expect(
      wrapper.find('[data-testid="observed-latency-table"] .observed__row--overall').exists(),
    ).toBe(false);
  });

  it("separates an empty population from an unavailable source", async () => {
    performanceCall.mockResolvedValue(
      respond({
        available: true,
        overall: performance({ requestCount: 0, sessionCount: 0 }),
        byModel: [],
        sessionCount: 0,
      }),
    );
    const wrapper = await render();

    expect(wrapper.get('[data-testid="observed-empty"]').text()).toContain(
      "no recorded requests match the selected repository and date range",
    );
    expect(wrapper.find('[data-testid="observed-unavailable"]').exists()).toBe(false);
  });

  it("states why a p95 is missing and never renders it as zero", async () => {
    performanceCall.mockResolvedValue(respond({}));
    const wrapper = await render();

    const overall = wrapper
      .get('[data-testid="observed-latency-table"] .observed__row--overall')
      .text();
    expect(overall).toContain("p95 —");
    expect(overall).not.toContain("p95 0ms");
    expect(wrapper.get('[data-testid="observed-p95-reason"]').text()).toContain(
      "at least 20 valid samples",
    );
  });

  it("shows each metric's own coverage beside it", async () => {
    performanceCall.mockResolvedValue(respond({}));
    const wrapper = await render();

    const overall = wrapper
      .get('[data-testid="observed-latency-table"] .observed__row--overall')
      .text();
    expect(overall).toContain("40 valid");
    expect(overall).toContain("38 valid · 2 not recorded");
    expect(overall).toContain("3 valid · 36 not recorded · 1 invalid");
    expect(overall).toContain("31 valid · 9 not recorded");
  });

  it("labels the two cache-reuse answers separately", async () => {
    performanceCall.mockResolvedValue(respond({}));
    const wrapper = await render();

    const headers = wrapper.findAll("th").map((th) => th.text());
    expect(headers).toContain("Requests recording any reuse");
    expect(headers).toContain("Cache reads / input tokens");

    const text = wrapper.text();
    // Request-weighted 90% and token-weighted 11% are both present and distinct.
    expect(text).toContain("90%");
    expect(text).toContain("11%");
  });

  it("surfaces rows whose cache counters contradict their input", async () => {
    performanceCall.mockResolvedValue(
      respond({
        byModel: [
          {
            model: "gpt-5.6-luna",
            performance: performance({ cache: cache({ inconsistentRows: 4 }) }),
          },
        ],
      }),
    );
    const wrapper = await render();

    expect(wrapper.get('[data-testid="observed-inconsistent"]').text()).toContain(
      "excluded from these figures rather than clamped",
    );
  });

  it("says once that this is observational, not a benchmark", async () => {
    performanceCall.mockResolvedValue(respond({}));
    const wrapper = await render();

    const disclaimers = wrapper.findAll('[data-testid="observed-disclaimer"]');
    expect(disclaimers).toHaveLength(1);
    expect(disclaimers[0].text()).toContain("not controlled benchmarks");
    expect(disclaimers[0].text()).toContain("or a quality ranking");
  });

  it("passes the page's repository and date filters through", async () => {
    performanceCall.mockResolvedValue(respond({}));
    await render();

    const analytics = useAnalyticsStore();
    analytics.selectedRepo = "octo/tracepilot";
    await flushPromises();

    expect(performanceCall).toHaveBeenLastCalledWith(
      expect.objectContaining({ repository: "octo/tracepilot" }),
    );
  });

  it("sorts the models beneath a pinned all-models row, missing figures last", async () => {
    performanceCall.mockResolvedValue(
      respond({
        byModel: [
          { model: "alpha", performance: performance({ requestCount: 5 }) },
          {
            model: "beta",
            performance: performance({
              requestCount: 90,
              durationMs: distribution({ median: 900 }),
            }),
          },
          {
            model: "gamma",
            performance: performance({
              requestCount: 20,
              durationMs: distribution({
                median: null,
                coverage: { valid: 0, missing: 20, invalid: 0 },
              }),
            }),
          },
        ],
      }),
    );
    const wrapper = await render();
    const table = () => wrapper.get('[data-testid="observed-latency-table"]');
    const order = () =>
      table()
        .findAll("tbody tr")
        .map((row) => row.find("td").text());

    // Largest samples first by default.
    expect(order()).toEqual(["All models", "beta", "gamma", "alpha"]);

    await table().get('button[aria-label="Sort by API duration"]').trigger("click");
    expect(order()).toEqual(["All models", "alpha", "beta", "gamma"]);
    await table().get('button[aria-label="Sort by API duration"]').trigger("click");
    expect(order()).toEqual(["All models", "beta", "alpha", "gamma"]);

    await table().get('button[aria-label="Sort by Model"]').trigger("click");
    expect(order()).toEqual(["All models", "alpha", "beta", "gamma"]);
  });

  it("reads nothing and renders nothing while the feature is off", async () => {
    usePreferencesStore().featureFlags.sessionStoreEnrichment = false;
    const wrapper = await render();

    expect(performanceCall).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="observed-request-performance"]').exists()).toBe(false);
  });
});
