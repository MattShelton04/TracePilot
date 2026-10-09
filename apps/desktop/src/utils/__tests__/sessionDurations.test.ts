import { describe, expect, it } from "vitest";
import { formatRecordedDuration } from "../sessionDurations";

describe("formatRecordedDuration", () => {
  it("shows a dash when nothing was recorded, not 0ms", () => {
    expect(formatRecordedDuration(0)).toBe("—");
    expect(formatRecordedDuration(null)).toBe("—");
    expect(formatRecordedDuration(undefined)).toBe("—");
  });

  it("formats a recorded duration", () => {
    expect(formatRecordedDuration(8_400)).toBe("8.4s");
  });
});
