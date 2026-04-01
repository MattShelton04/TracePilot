import type { ShutdownMetrics } from "@tracepilot/types";
import { describe, expect, it, vi } from "vitest";
import { wholesaleCost } from "../useSessionMetrics.js";

describe("useSessionMetrics - wholesaleCost", () => {
  it("should return 0 when ShutdownMetrics is null", () => {
    const computeWholesaleCost = vi.fn();
    const result = wholesaleCost(null, computeWholesaleCost);
    expect(result).toBe(0);
    expect(computeWholesaleCost).not.toHaveBeenCalled();
  });

  it("should return 0 when modelMetrics is undefined", () => {
    const computeWholesaleCost = vi.fn();
    const metrics: ShutdownMetrics = {
      modelMetrics: undefined,
    } as any;

    const result = wholesaleCost(metrics, computeWholesaleCost);
    expect(result).toBe(0);
    expect(computeWholesaleCost).not.toHaveBeenCalled();
  });

  it("should calculate total cost across multiple models", () => {
    const computeWholesaleCost = vi.fn((model, input, cache, output) => {
      if (model === "model-a") return (input + cache + output) * 0.1;
      if (model === "model-b") return (input + cache + output) * 0.2;
      return 0;
    });

    const metrics: ShutdownMetrics = {
      modelMetrics: {
        "model-a": {
          usage: { inputTokens: 10, cacheReadTokens: 5, outputTokens: 20 },
        },
        "model-b": {
          usage: { inputTokens: 100, cacheReadTokens: 50, outputTokens: 200 },
        },
      },
    } as any;

    const result = wholesaleCost(metrics, computeWholesaleCost);

    // model-a cost: (10 + 5 + 20) * 0.1 = 35 * 0.1 = 3.5
    // model-b cost: (100 + 50 + 200) * 0.2 = 350 * 0.2 = 70.0
    // total = 73.5
    expect(result).toBe(73.5);

    expect(computeWholesaleCost).toHaveBeenCalledTimes(2);
    expect(computeWholesaleCost).toHaveBeenCalledWith("model-a", 10, 5, 20);
    expect(computeWholesaleCost).toHaveBeenCalledWith("model-b", 100, 50, 200);
  });

  it("should default to 0 for missing token counts", () => {
    const computeWholesaleCost = vi.fn((_model, input, cache, output) => {
      return input + cache + output;
    });

    const metrics: ShutdownMetrics = {
      modelMetrics: {
        "model-c": {
          usage: { inputTokens: 15 }, // missing cache and output
        },
        "model-d": {
          usage: undefined, // missing entire usage object
        },
        "model-e": {
          usage: { outputTokens: 25 }, // missing input and cache
        },
      },
    } as any;

    const result = wholesaleCost(metrics, computeWholesaleCost);

    expect(result).toBe(40); // 15 + 0 + 25
    expect(computeWholesaleCost).toHaveBeenCalledTimes(3);
    expect(computeWholesaleCost).toHaveBeenCalledWith("model-c", 15, 0, 0);
    expect(computeWholesaleCost).toHaveBeenCalledWith("model-d", 0, 0, 0);
    expect(computeWholesaleCost).toHaveBeenCalledWith("model-e", 0, 0, 25);
  });

  it("should treat a null return from computeWholesaleCost as 0", () => {
    const computeWholesaleCost = vi.fn((model) => {
      if (model === "model-f") return 10.5;
      if (model === "model-g") return null;
      return 0;
    });

    const metrics: ShutdownMetrics = {
      modelMetrics: {
        "model-f": { usage: { inputTokens: 1 } },
        "model-g": { usage: { inputTokens: 2 } },
      },
    } as any;

    const result = wholesaleCost(metrics, computeWholesaleCost);

    expect(result).toBe(10.5);
    expect(computeWholesaleCost).toHaveBeenCalledTimes(2);
  });
});
