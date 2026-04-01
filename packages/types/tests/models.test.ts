import { describe, expect, it } from "vitest";
import { getModelById, MODEL_REGISTRY } from "../src/models.js";

describe("getModelById", () => {
  it("should find an exact match", () => {
    const model = MODEL_REGISTRY[0];
    expect(getModelById(model.id)).toBe(model);
  });

  it("should find a match with different casing", () => {
    const model = MODEL_REGISTRY[0];
    expect(getModelById(model.id.toUpperCase())).toBe(model);
    expect(getModelById(model.id.toLowerCase())).toBe(model);
  });

  it("should return undefined for an unknown model", () => {
    expect(getModelById("unknown-model-id")).toBeUndefined();
  });
});
