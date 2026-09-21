import type { CacheReuse, LatencyDistribution, RequestPerformance } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  buildCacheReuse,
  buildLatencyMetrics,
  buildPerformanceRow,
  coverageText,
  NO_SAMPLES,
  P95_SUPPRESSED,
  p95Absence,
} from "@/utils/requestPerformance";

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
    requestsReportingReuse: 2,
    requestsWithCounter: 3,
    tokenWeightedRatio: 0.8628,
    cacheReadTokens: 295_259,
    inputTokens: 345_642,
    inconsistentRows: 0,
    ...overrides,
  };
}

function performance(overrides: Partial<RequestPerformance> = {}): RequestPerformance {
  return {
    requestCount: 40,
    sessionCount: 4,
    durationMs: distribution(),
    timeToFirstTokenMs: distribution(),
    outputTtftMs: distribution(),
    interTokenLatencyMs: distribution(),
    cache: cache(),
    ...overrides,
  };
}

describe("p95Absence", () => {
  it("names a below-threshold sample rather than leaving the gap unexplained", () => {
    const suppressed = distribution({ p95: null, coverage: { valid: 3, missing: 0, invalid: 0 } });
    expect(p95Absence(suppressed)).toBe("belowThreshold");

    const [metric] = buildLatencyMetrics(performance({ durationMs: suppressed }));
    expect(metric.p95).toBe(P95_SUPPRESSED);
    // Never zero and never blank: the median beside it is still a real figure.
    expect(metric.p95).not.toBe("0ms");
    expect(metric.median).toBe("4.84s");
  });

  it("separates an empty population from a suppressed one", () => {
    const empty = distribution({
      median: null,
      p95: null,
      coverage: { valid: 0, missing: 12, invalid: 0 },
    });
    expect(p95Absence(empty)).toBe("noSamples");
    const [metric] = buildLatencyMetrics(performance({ durationMs: empty }));
    expect(metric.p95).toBe(NO_SAMPLES);
    expect(metric.median).toBe("—");
  });

  it("reports no absence when a p95 was supplied", () => {
    expect(p95Absence(distribution())).toBeNull();
  });
});

describe("buildLatencyMetrics", () => {
  it("carries each metric's own coverage, because the populations differ", () => {
    const metrics = buildLatencyMetrics(
      performance({
        durationMs: distribution({ coverage: { valid: 40, missing: 0, invalid: 0 } }),
        timeToFirstTokenMs: distribution({ coverage: { valid: 38, missing: 2, invalid: 0 } }),
        outputTtftMs: distribution({ coverage: { valid: 12, missing: 27, invalid: 1 } }),
        interTokenLatencyMs: distribution({ coverage: { valid: 31, missing: 9, invalid: 0 } }),
      }),
    );

    expect(metrics.map((metric) => metric.coverage.valid)).toEqual([40, 38, 12, 31]);
    expect(metrics.map((metric) => metric.coverageText)).toEqual([
      "40 valid",
      "38 valid · 2 not recorded",
      "12 valid · 27 not recorded · 1 invalid",
      "31 valid · 9 not recorded",
    ]);
  });

  it("describes first observable output without offering a reasoning duration", () => {
    const metrics = buildLatencyMetrics(performance());
    const outputTtft = metrics.find((metric) => metric.key === "outputTtftMs");
    expect(outputTtft?.label).toBe("First observable output");
    expect(outputTtft?.note).toContain("not reasoning time");
    // No metric is a derived difference between the two TTFT fields.
    expect(metrics.map((metric) => metric.key)).toEqual([
      "durationMs",
      "timeToFirstTokenMs",
      "outputTtftMs",
      "interTokenLatencyMs",
    ]);
  });
});

describe("buildCacheReuse", () => {
  it("keeps the request-weighted and token-weighted answers apart", () => {
    // Many tiny reusing requests plus one huge request that reused nothing:
    // request-weighted is high, token-weighted is low, and neither summarises
    // the other.
    const view = buildCacheReuse(
      cache({
        requestsReportingReuse: 9,
        requestsWithCounter: 10,
        tokenWeightedRatio: 0.11,
        cacheReadTokens: 11_000,
        inputTokens: 100_000,
      }),
    );

    expect(view.requestWeighted.value).toBe("90%");
    expect(view.tokenWeighted.value).toBe("11%");
    expect(view.requestWeighted.label).toBe("Requests recording any reuse");
    expect(view.tokenWeighted.label).toBe("Cache reads as a share of input tokens");
    expect(view.requestWeighted.detail).toContain("neither population");
  });

  it("shows nothing rather than zero when no request recorded a counter", () => {
    const view = buildCacheReuse(
      cache({
        requestsReportingReuse: 0,
        requestsWithCounter: 0,
        tokenWeightedRatio: null,
        cacheReadTokens: 0,
        inputTokens: 0,
      }),
    );
    expect(view.requestWeighted.value).toBe("—");
    expect(view.tokenWeighted.value).toBe("—");
  });

  it("surfaces contradictory rows instead of clamping them", () => {
    const view = buildCacheReuse(cache({ inconsistentRows: 4 }));
    expect(view.inconsistentRows).toBe(4);
    expect(view.inconsistentNote).toContain("excluded");
    expect(buildCacheReuse(cache()).inconsistentNote).toBeNull();
  });
});

describe("buildPerformanceRow", () => {
  it("labels the overall row without inventing a model name", () => {
    const row = buildPerformanceRow(null, "All models", performance());
    expect(row.model).toBeNull();
    expect(row.label).toBe("All models");
    expect(row.requestCount).toBe(40);
    expect(row.sessionCount).toBe(4);
    expect(row.metrics).toHaveLength(4);
  });
});

describe("coverageText", () => {
  it("omits the categories that recorded nothing", () => {
    expect(coverageText({ valid: 1200, missing: 0, invalid: 0 })).toBe("1,200 valid");
  });
});
