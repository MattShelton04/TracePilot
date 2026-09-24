import { describe, expect, it } from "vitest";
import { sessionModel } from "../sessionModel";

describe("sessionModel", () => {
  it("prefers the model derived from events", () => {
    expect(
      sessionModel({
        currentModel: "claude-sonnet-4.6",
        shutdownMetrics: { currentModel: "gpt-5.4" },
      }),
    ).toBe("claude-sonnet-4.6");
  });

  it("falls back to the shutdown record", () => {
    expect(sessionModel({ shutdownMetrics: { currentModel: "gpt-5.4" } })).toBe("gpt-5.4");
  });

  it("returns null when neither is known", () => {
    expect(sessionModel({ currentModel: null, shutdownMetrics: null })).toBeNull();
    expect(sessionModel(null)).toBeNull();
  });
});
