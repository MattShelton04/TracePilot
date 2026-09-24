import { describe, expect, it } from "vitest";
import {
  getReasoningHeadings,
  getReasoningSections,
  getReasoningSummary,
} from "../utils/reasoning";

describe("getReasoningSummary", () => {
  it.each([
    ["**Inspecting session data**\n\nDetails", "Inspecting session data"],
    ["\r\n ** Checking compatibility ** \r\nDetails", "Checking compatibility"],
    ["**分析兼容性**", "分析兼容性"],
    ["**First heading**\n\nDetails\n\n**Later heading**\nMore", "First heading, Later heading"],
  ])("extracts the headings of %j", (text, expected) => {
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
    expect(getReasoningSections(text)).toEqual([{ heading: null, body: text }]);
  });
});

describe("getReasoningHeadings", () => {
  it("lists every standalone heading once, in order", () => {
    const text = "**Plan**\nA\n\n**Check**\nB\n\n**Plan**\nC";
    expect(getReasoningHeadings(text)).toEqual(["Plan", "Check"]);
  });

  it("ignores headings inside code fences, inline emphasis and indented lines", () => {
    const text = "**Plan**\n```\n**Not a heading**\n```\nThe **bold** word\n  **Indented**";
    expect(getReasoningHeadings(text)).toEqual(["Plan"]);
  });
});

describe("getReasoningSections", () => {
  it.each([
    [
      "**Inspecting session data**\n\nDetails",
      [{ heading: "Inspecting session data", body: "Details" }],
    ],
    [
      "\r\n ** Checking compatibility ** \r\n\t\r\n    Indented details\r\n",
      [{ heading: "Checking compatibility", body: "    Indented details\r\n" }],
    ],
    ["**分析兼容性**", [{ heading: "分析兼容性", body: "" }]],
    [
      "**First heading**\n\nDetails\n\n**Later heading**\nMore",
      [
        { heading: "First heading", body: "Details" },
        { heading: "Later heading", body: "More" },
      ],
    ],
    [
      "**First heading**\n**Second heading**\nDetails",
      [
        { heading: "First heading", body: "" },
        { heading: "Second heading", body: "Details" },
      ],
    ],
  ])("splits %j at its headings", (text, expected) => {
    expect(getReasoningSections(text)).toEqual(expected);
  });
});
