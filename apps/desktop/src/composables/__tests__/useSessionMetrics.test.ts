import type { ShutdownMetrics } from "@tracepilot/types";
import { describe, expect, it, vi } from "vitest";
import { totalTokens, wholesaleCost } from "../useSessionMetrics";

describe("useSessionMetrics", () => {
  describe("totalTokens", () => {
    it("should return 0 when m is null", () => {
      expect(totalTokens(null)).toBe(0);
    });

    it("should return 0 when m.modelMetrics is missing", () => {
      const m = {} as ShutdownMetrics;
      expect(totalTokens(m)).toBe(0);
    });

    it("should return 0 when m.modelMetrics is null", () => {
      const m = { modelMetrics: null } as unknown as ShutdownMetrics;
      expect(totalTokens(m)).toBe(0);
    });

    it("should return 0 when m.modelMetrics is empty", () => {
      const m = { modelMetrics: {} } as ShutdownMetrics;
      expect(totalTokens(m)).toBe(0);
    });

    it("should correctly sum inputTokens and outputTokens across multiple models", () => {
      const m = {
        modelMetrics: {
          "model-a": { usage: { inputTokens: 10, outputTokens: 20 } },
          "model-b": { usage: { inputTokens: 5, outputTokens: 15 } },
        },
      } as ShutdownMetrics;
      expect(totalTokens(m)).toBe(50); // 10 + 20 + 5 + 15
    });

    it("should handle missing inputTokens or outputTokens gracefully", () => {
      const m = {
        modelMetrics: {
          "model-a": { usage: { inputTokens: 10 } }, // missing outputTokens
          "model-b": { usage: { outputTokens: 15 } }, // missing inputTokens
          "model-c": { usage: {} }, // missing both
          "model-d": {}, // missing usage
        },
      } as ShutdownMetrics;
      expect(totalTokens(m)).toBe(25); // 10 + 0 + 0 + 15 + 0 + 0
    });
  });

  describe("wholesaleCost", () => {
    it("should return 0 when ShutdownMetrics is null", () => {
      const computeWholesaleCost = vi.fn();
      const result = wholesaleCost(null, computeWholesaleCost);
      expect(result).toBe(0);
      expect(computeWholesaleCost).not.toHaveBeenCalled();
    });

    it("should return 0 when modelMetrics is undefined", () => {
      const metrics = {
        modelMetrics: undefined,
      } as unknown as ShutdownMetrics;

      const computeWholesaleCost = vi.fn();
      const result = wholesaleCost(metrics, computeWholesaleCost);
      expect(result).toBe(0);
      expect(computeWholesaleCost).not.toHaveBeenCalled();
    });

    it("should return 0 when modelMetrics is null", () => {
      const metrics = { modelMetrics: null } as unknown as ShutdownMetrics;
      const computeWholesaleCost = vi.fn();
      expect(wholesaleCost(metrics, computeWholesaleCost)).toBe(0);
      expect(computeWholesaleCost).not.toHaveBeenCalled();
    });

    it("should return 0 when modelMetrics is empty", () => {
      const metrics = { modelMetrics: {} } as ShutdownMetrics;
      const computeWholesaleCost = vi.fn();
      expect(wholesaleCost(metrics, computeWholesaleCost)).toBe(0);
      expect(computeWholesaleCost).not.toHaveBeenCalled();
    });

    it("should calculate total cost across multiple models", () => {
      const computeWholesaleCost = vi.fn((model, input, cache, output) => {
        if (model === "model-a") return (input + cache + output) * 0.1;
        if (model === "model-b") return (input + cache + output) * 0.2;
        return 0;
      });

      const metrics = {
        modelMetrics: {
          "model-a": {
            usage: { inputTokens: 10, cacheReadTokens: 5, outputTokens: 20 },
          },
          "model-b": {
            usage: { inputTokens: 100, cacheReadTokens: 50, outputTokens: 200 },
          },
        },
      } as ShutdownMetrics;

      const result = wholesaleCost(metrics, computeWholesaleCost);

      // model-a cost: (10 + 5 + 20) * 0.1 = 3.5
      // model-b cost: (100 + 50 + 200) * 0.2 = 70.0
      expect(result).toBe(73.5);
      expect(computeWholesaleCost).toHaveBeenCalledTimes(2);
      expect(computeWholesaleCost).toHaveBeenCalledWith("model-a", 10, 5, 20, 0);
      expect(computeWholesaleCost).toHaveBeenCalledWith("model-b", 100, 50, 200, 0);
    });

    it("should default to 0 for missing token counts", () => {
      const computeWholesaleCost = vi.fn((_model, input, cache, output) => {
        return input + cache + output;
      });

      const metrics = {
        modelMetrics: {
          "model-c": { usage: { inputTokens: 15 } },
          "model-d": { usage: undefined },
          "model-e": { usage: { outputTokens: 25 } },
        },
      } as ShutdownMetrics;

      const result = wholesaleCost(metrics, computeWholesaleCost);

      expect(result).toBe(40); // 15 + 0 + 25
      expect(computeWholesaleCost).toHaveBeenCalledTimes(3);
      expect(computeWholesaleCost).toHaveBeenCalledWith("model-c", 15, 0, 0, 0);
      expect(computeWholesaleCost).toHaveBeenCalledWith("model-d", 0, 0, 0, 0);
      expect(computeWholesaleCost).toHaveBeenCalledWith("model-e", 0, 0, 25, 0);
    });

    it("should treat a null return from computeWholesaleCost as 0", () => {
      const computeWholesaleCost = vi.fn((model) => {
        if (model === "model-f") return 10.5;
        if (model === "model-g") return null;
        return 0;
      });

      const metrics = {
        modelMetrics: {
          "model-f": { usage: { inputTokens: 1 } },
          "model-g": { usage: { inputTokens: 2 } },
        },
      } as ShutdownMetrics;

      const result = wholesaleCost(metrics, computeWholesaleCost);
      expect(result).toBe(10.5);
      expect(computeWholesaleCost).toHaveBeenCalledTimes(2);
    });
  });
});
