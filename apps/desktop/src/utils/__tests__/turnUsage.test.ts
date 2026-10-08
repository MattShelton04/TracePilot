import { describe, expect, it } from "vitest";
import { turnUsageTitle } from "../turnUsage";

describe("turnUsageTitle", () => {
  it("is absent for turns without recorded calls", () => {
    expect(turnUsageTitle({})).toBeUndefined();
  });

  it("lists output, input with its cache split, and the call count", () => {
    const title = turnUsageTitle({
      usage: {
        modelCalls: 1,
        inputTokens: 1200,
        cacheReadTokens: 1000,
        cacheWriteTokens: 150,
        outputTokens: 80,
        reasoningTokens: 0,
      },
    });
    expect(title).toMatch(
      /^Output 80 · input .+ \(cache read .+, cache write 150\) · 1 model call$/,
    );
  });
});
