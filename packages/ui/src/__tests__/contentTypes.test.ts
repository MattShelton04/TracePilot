import { describe, expect, it } from "vitest";
import { ALL_CONTENT_TYPES, CONTENT_TYPE_CONFIG, type ContentTypeStyle } from "../utils/contentTypes";

describe("CONTENT_TYPE_CONFIG", () => {
  it("has entries for every SearchContentType", () => {
    const expectedKeys = [
      "user_message",
      "assistant_message",
      "reasoning",
      "tool_call",
      "tool_result",
      "tool_error",
      "error",
      "compaction_summary",
      "system_message",
      "subagent",
      "checkpoint",
    ];
    expect(Object.keys(CONTENT_TYPE_CONFIG).sort()).toEqual(expectedKeys.sort());
  });

  it("every entry has a non-empty label and a hex color", () => {
    for (const [key, style] of Object.entries(CONTENT_TYPE_CONFIG)) {
      expect(style.label, `${key}.label`).toBeTruthy();
      expect(style.color, `${key}.color`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("exports the ContentTypeStyle interface shape", () => {
    const sample: ContentTypeStyle = CONTENT_TYPE_CONFIG.user_message;
    expect(sample).toHaveProperty("label");
    expect(sample).toHaveProperty("color");
  });
});

describe("ALL_CONTENT_TYPES", () => {
  it("contains the same keys as CONTENT_TYPE_CONFIG", () => {
    expect([...ALL_CONTENT_TYPES].sort()).toEqual(Object.keys(CONTENT_TYPE_CONFIG).sort());
  });

  it("has no duplicates", () => {
    const unique = new Set(ALL_CONTENT_TYPES);
    expect(unique.size).toBe(ALL_CONTENT_TYPES.length);
  });
});
