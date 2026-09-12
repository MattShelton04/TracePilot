import { describe, expect, it } from "vitest";
import { combinedTokenBreakdown, modelTokenBreakdown } from "../metricsTokenBreakdown";

describe("shutdown token breakdown", () => {
  it("partitions cache input and includes reasoning only once", () => {
    expect(
      modelTokenBreakdown({
        usage: {
          inputTokens: 1000,
          outputTokens: 100,
          cacheReadTokens: 600,
          cacheWriteTokens: 300,
          reasoningTokens: 40,
        },
      }),
    ).toMatchObject({
      input: 1000,
      cacheRead: 600,
      cacheWrite: 300,
      uncached: 100,
      notCached: 400,
      output: 100,
      reasoning: 40,
      total: 1100,
      cacheRatio: 0.6,
      inconsistent: false,
    });
  });
  it("keeps recorded zero distinct from missing fields and falls back to token details", () => {
    expect(
      modelTokenBreakdown({ usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0 } }),
    ).toMatchObject({
      cacheRead: 0,
      cacheWrite: null,
      uncached: null,
      notCached: 100,
      cacheRatio: 0,
    });
    expect(
      modelTokenBreakdown({
        usage: { inputTokens: 100, outputTokens: 0 },
        tokenDetails: {
          cache_read: { tokenCount: 0 },
          cache_write: { tokenCount: 20 },
          input: { tokenCount: 80 },
        },
      }),
    ).toMatchObject({ cacheRead: 0, cacheWrite: 20, uncached: 80 });
  });
  it("does not manufacture complete totals from partially missing model telemetry", () => {
    const result = combinedTokenBreakdown([
      { usage: { inputTokens: 100, cacheReadTokens: 10, cacheWriteTokens: 20 } },
      { usage: { inputTokens: 50, cacheReadTokens: 0 } },
    ]);
    expect(result).toMatchObject({
      input: 150,
      cacheRead: 10,
      cacheWrite: null,
      uncached: null,
      total: null,
    });
    expect(combinedTokenBreakdown([]).input).toBeNull();
  });
  it("flags inconsistent categories without creating negative uncached tokens", () => {
    expect(
      modelTokenBreakdown({
        usage: {
          inputTokens: 10,
          outputTokens: 1,
          cacheReadTokens: 20,
          cacheWriteTokens: 0,
          reasoningTokens: 5,
        },
      }),
    ).toMatchObject({ uncached: null, cacheRatio: null, inconsistent: true });
  });
});
