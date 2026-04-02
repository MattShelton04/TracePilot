import { describe, expect, it } from "vitest";
import { getModelById } from "../src/models.js";

describe("getModelById", () => {
  it("should find an exact match by known id", () => {
    const model = getModelById("claude-sonnet-4.6");
    expect(model).toBeDefined();
    expect(model!.id).toBe("claude-sonnet-4.6");
  });

  it("should find a match with different casing", () => {
    const model = getModelById("Claude-Sonnet-4.6");
    expect(model).toBeDefined();
    expect(model!.id).toBe("claude-sonnet-4.6");

    expect(getModelById("CLAUDE-SONNET-4.6")).toBe(model);
  });

  it("should return undefined for an unknown model", () => {
    expect(getModelById("unknown-model-id")).toBeUndefined();
  });

  it("should return undefined for an empty string", () => {
    expect(getModelById("")).toBeUndefined();
  });
});
