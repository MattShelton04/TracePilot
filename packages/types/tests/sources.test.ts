import { describe, expect, it } from "vitest";
import {
  isNonCopilotSource,
  resolveSessionSource,
  resumeCommand,
  sourceCapabilities,
  sourceLabel,
} from "../src/sources.js";

describe("session sources", () => {
  it("treats a missing source as Copilot", () => {
    expect(resolveSessionSource(undefined)).toBe("copilot");
    expect(resolveSessionSource(null)).toBe("copilot");
    expect(sourceLabel(undefined)).toBe("Copilot");
    expect(isNonCopilotSource(undefined)).toBe(false);
    expect(sourceCapabilities(undefined)).toBe(sourceCapabilities("copilot"));
  });

  it("gives Copilot every capability except hidden roles and background tasks", () => {
    const caps = sourceCapabilities("copilot");
    const { hasHiddenRoles, hasBackgroundTasks, ...rest } = caps;
    expect(hasHiddenRoles).toBe(false);
    expect(hasBackgroundTasks).toBe(false);
    expect(Object.values(rest).every(Boolean)).toBe(true);
  });

  it("labels Claude Code and withholds Copilot-only capabilities", () => {
    expect(sourceLabel("claudeCode")).toBe("Claude Code");
    expect(isNonCopilotSource("claudeCode")).toBe(true);
    const caps = sourceCapabilities("claudeCode");
    expect(caps.canResume).toBe(false);
    expect(caps.canSteer).toBe(false);
    expect(caps.hasAic).toBe(false);
    expect(caps.hasTodos).toBe(false);
    expect(caps.hasExplorer).toBe(false);
    expect(caps.hasBackgroundTasks).toBe(true);
  });

  it.each([
    ["copilot", "copilot --resume s-1"],
    [undefined, "copilot --resume s-1"],
    ["claudeCode", "claude --resume s-1"],
  ] as const)("builds the copyable resume command for %s", (source, expected) => {
    expect(resumeCommand(source, "s-1", "copilot")).toBe(expected);
  });

  it("resumes Copilot through the configured CLI command and Claude Code through claude", () => {
    expect(resumeCommand("copilot", "s-1", "gh copilot")).toBe("gh copilot --resume s-1");
    expect(resumeCommand("claudeCode", "s-1", "gh copilot")).toBe("claude --resume s-1");
  });
});
