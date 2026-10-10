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

  it("gives Copilot every capability except hidden roles and file history", () => {
    const caps = sourceCapabilities("copilot");
    const { hasHiddenRoles, hasFileHistory, ...rest } = caps;
    expect(hasHiddenRoles).toBe(false);
    expect(hasFileHistory).toBe(false);
    expect(Object.values(rest).every(Boolean)).toBe(true);
  });

  it("labels Claude Code and withholds Copilot-only capabilities", () => {
    expect(sourceLabel("claudeCode")).toBe("Claude Code");
    expect(isNonCopilotSource("claudeCode")).toBe(true);
    const caps = sourceCapabilities("claudeCode");
    // Resumes in a terminal, but exact context capture stays Copilot-only.
    expect(caps.canResume).toBe(false);
    expect(caps.canResumeInTerminal).toBe(true);
    expect(caps.canSteer).toBe(false);
    expect(caps.hasAic).toBe(false);
    expect(caps.hasTodos).toBe(false);
    expect(caps.hasCheckpoints).toBe(false);
    // Plans, file history and the subagent / tool-result folders (C13).
    expect(caps.hasPlan).toBe(true);
    expect(caps.hasFileHistory).toBe(true);
    expect(caps.hasExplorer).toBe(true);
  });

  it.each([
    ["copilot", "copilot --resume s-1"],
    [undefined, "copilot --resume s-1"],
    ["claudeCode", "claude --resume s-1"],
  ] as const)("builds the copyable resume command for %s", (source, expected) => {
    expect(resumeCommand(source, "s-1", { copilot: "copilot" })).toBe(expected);
  });

  it("resumes each source through its own configured CLI command", () => {
    const clis = { copilot: "gh copilot", claudeCode: "npx claude" };
    expect(resumeCommand("copilot", "s-1", clis)).toBe("gh copilot --resume s-1");
    expect(resumeCommand("claudeCode", "s-1", clis)).toBe("npx claude --resume s-1");
    // The Copilot setting never reaches a Claude Code session.
    expect(resumeCommand("claudeCode", "s-1", { copilot: "gh copilot" })).toBe(
      "claude --resume s-1",
    );
    expect(resumeCommand("claudeCode", "s-1", { claudeCode: "  " })).toBe("claude --resume s-1");
  });
});
