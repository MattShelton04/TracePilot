import { describe, expect, it } from "vitest";
import { getReasoningBody, getReasoningSummary } from "../utils/reasoning";

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
    expect(getReasoningBody(text)).toBe(text);
  });
});

describe("getReasoningBody", () => {
  it.each([
    ["**Inspecting session data**\n\nDetails", "Details"],
    [
      "\r\n ** Checking compatibility ** \r\n\t\r\n    Indented details\r\n",
      "    Indented details\r\n",
    ],
    ["**分析兼容性**", ""],
    [
      "**First heading**\n\nDetails\n\n**Later heading**\nMore",
      "Details\n\n**Later heading**\nMore",
    ],
    ["**First heading**\n**Second heading**\nDetails", "**Second heading**\nDetails"],
  ])("removes only the recognized opening heading from %j", (text, expected) => {
    expect(getReasoningBody(text)).toBe(expected);
  });
});
