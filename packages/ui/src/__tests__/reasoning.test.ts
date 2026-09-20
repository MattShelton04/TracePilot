import { describe, expect, it } from "vitest";
import { getReasoningSummary } from "../utils/reasoning";

describe("getReasoningSummary", () => {
  it.each([
    ["**Inspecting session data**\n\nDetails", "Inspecting session data"],
    ["\r\n ** Checking compatibility ** \r\nDetails", "Checking compatibility"],
    ["**分析兼容性**", "分析兼容性"],
    ["**First heading**\n\nDetails\n\n**Later heading**\nMore", "First heading"],
  ])("extracts a complete leading heading from %j", (text, expected) => {
    expect(getReasoningSummary(text)).toBe(expected);
  });

  it.each([
    "",
    "Plain older reasoning",
    "Prose\n\n**Later heading**\nDetails",
    "**Inline emphasis** continues the sentence",
    "**Still streaming",
    "****",
    "**   **",
    "**Multiline\nheading**",
    `**${"x".repeat(161)}**\nBody`,
    "**[Link](https://example.com)**",
    "**<img src=x>**",
    "**`code` heading**",
    "```\n**Code sample**\n```",
    "**Nested *emphasis***",
    "__Unobserved syntax__",
  ])("keeps the generic label for %j", (text) => {
    expect(getReasoningSummary(text)).toBeNull();
  });
});
