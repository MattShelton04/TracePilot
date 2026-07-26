import { describe, expect, it } from "vitest";
import { calculateDownloadProgress } from "@/composables/useAutoUpdate";

describe("calculateDownloadProgress", () => {
  it("maps downloaded bytes to the full 0-100 range", () => {
    expect(calculateDownloadProgress(0, 1_000)).toBe(0);
    expect(calculateDownloadProgress(500, 1_000)).toBe(50);
    expect(calculateDownloadProgress(1_000, 1_000)).toBe(100);
  });

  it("clamps invalid or oversized progress", () => {
    expect(calculateDownloadProgress(1_100, 1_000)).toBe(100);
    expect(calculateDownloadProgress(-100, 1_000)).toBe(0);
    expect(calculateDownloadProgress(100, 0)).toBe(0);
  });
});
