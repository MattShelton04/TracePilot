import type { AnalyticsData } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { FIXTURE_ANALYTICS } from "../../../__tests__/views/analyticsFixtures";
import AnalyticsMetricPanels from "../AnalyticsMetricPanels.vue";

function metrics(data: AnalyticsData) {
  const wrapper = mount(AnalyticsMetricPanels, { props: { data } });
  return new Map(
    wrapper
      .findAll(".metric-item")
      .map((item) => [item.get(".metric-label").text(), item.get(".metric-value").text()]),
  );
}

describe("AnalyticsMetricPanels", () => {
  it("rounds fractional productivity averages without changing the source data", () => {
    const data = structuredClone(FIXTURE_ANALYTICS);
    Object.assign(data.productivityMetrics, {
      avgTurnsPerSession: 8.555555555555,
      avgToolCallsPerTurn: 1.333333333333,
      avgTokensPerTurn: 896.1805555555555,
      avgTokensPerApiSecond: 150.58343057176197,
    });
    data.totalSessions = 73;
    data.totalCompactions = 8;
    const values = metrics(data);
    expect(values.get("Avg Turns / Session")).toBe("8.6");
    expect(values.get("Avg Tool Calls / Turn")).toBe("1.3");
    expect(values.get("Avg Tokens / Turn")).toBe("896.2");
    expect(values.get("Tokens / API Second")).toBe("150.6");
    expect(values.get("Avg Compactions / Session")).toBe("0.1");
    expect(data.productivityMetrics.avgTokensPerTurn).toBe(896.1805555555555);
  });

  it("keeps compact averages and exact grouped session counts", () => {
    const data = structuredClone(FIXTURE_ANALYTICS);
    data.productivityMetrics.avgTurnsPerSession = 12_345.6789;
    data.productivityMetrics.avgTokensPerTurn = 1_234_567.89;
    data.productivityMetrics.avgTokensPerApiSecond = 999.96;
    data.apiDurationStats.totalSessionsWithDuration = 123_456;
    const values = metrics(data);
    expect(values.get("Avg Turns / Session")).toBe("12.3K");
    expect(values.get("Avg Tokens / Turn")).toBe("1.2M");
    expect(values.get("Tokens / API Second")).toBe("1K");
    expect(values.get("Sessions w/ Data")).toBe("123,456");
  });

  it("renders zero and fractional averages without non-finite text", () => {
    const data = structuredClone(FIXTURE_ANALYTICS);
    Object.assign(data.productivityMetrics, {
      avgTurnsPerSession: 0,
      avgToolCallsPerTurn: 0.25,
      avgTokensPerTurn: Number.NaN,
      avgTokensPerApiSecond: Number.POSITIVE_INFINITY,
    });
    data.totalSessions = 0;
    const values = metrics(data);
    expect(values.get("Avg Turns / Session")).toBe("0.0");
    expect(values.get("Avg Tool Calls / Turn")).toBe("0.3");
    expect(values.get("Avg Tokens / Turn")).toBe("0");
    expect(values.get("Tokens / API Second")).toBe("0");
    expect(values.get("Avg Compactions / Session")).toBe("0");
  });
});
