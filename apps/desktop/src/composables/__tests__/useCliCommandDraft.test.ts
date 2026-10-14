import { describe, expect, it } from "vitest";
import { isSafeCliCommand } from "@/composables/useCliCommandDraft";

// Mirrors `validate_cli_command`: Rust's `is_alphanumeric` plus `- _ . / \ :` and space.
describe("isSafeCliCommand", () => {
  it.each([
    "",
    "copilot",
    "gh copilot",
    "npx claude",
    "C:\\Tools\\copilot.exe",
    "/usr/local/bin/copilot-cli_2",
    "café",
    // Numbers outside Nd (letter and other numbers) and combining marks the
    // Alphabetic property covers are alphanumeric in Rust too.
    "tool\u2167",
    "tool\u00b2",
    "\u0915\u093f",
  ])("accepts %j", (value) => {
    expect(isSafeCliCommand(value)).toBe(true);
  });

  it.each([
    "copilot --model=x",
    "copilot; calc",
    "copilot && calc",
    'copilot "x"',
    "copilot $(x)",
    "copilot\tx",
    "copilot\nx",
    "copilot|more",
    // A combining accent outside the Alphabetic property is not alphanumeric.
    "á",
  ])("rejects %j", (value) => {
    expect(isSafeCliCommand(value)).toBe(false);
  });
});
