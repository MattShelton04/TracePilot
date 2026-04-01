import { describe, expect, it } from "vitest";
import type { ShutdownMetrics } from "@tracepilot/types";
import { totalTokens } from "../useSessionMetrics";

describe("useSessionMetrics", () => {
  describe("totalTokens", () => {
    it("should return 0 when m is null", () => {
      expect(totalTokens(null)).toBe(0);
    });

    it("should return 0 when m.modelMetrics is missing", () => {
      const m = {} as ShutdownMetrics;
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
});
