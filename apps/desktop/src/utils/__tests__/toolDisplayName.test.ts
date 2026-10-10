import type { ToolUsageEntry } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  contextToolTypeLabel,
  searchResultToolName,
  searchToolOptionLabel,
  toolAggregateLabel,
  toolDisplayName,
  toolUsageLabel,
  toolUsageNames,
  uniqueToolLabels,
} from "../toolDisplayName";

describe("toolDisplayName", () => {
  it("uses the native name when recorded, else the canonical name", () => {
    expect(toolDisplayName({ toolName: "shell", nativeToolName: "Bash" })).toBe("Bash");
    expect(toolDisplayName({ toolName: "powershell" })).toBe("powershell");
    expect(toolDisplayName({ toolName: "powershell", nativeToolName: null })).toBe("powershell");
  });
});

describe("toolAggregateLabel", () => {
  it("leads with native names from one source, canonical as the hint", () => {
    expect(
      toolAggregateLabel(
        "stop_powershell",
        [
          { name: "KillShell", source: "claudeCode" },
          { name: "TaskStop", source: "claudeCode" },
        ],
        false,
      ),
    ).toEqual({ label: "KillShell, TaskStop", hint: "stop_powershell" });
  });

  it("leads with the canonical name when calls mix sources", () => {
    expect(toolAggregateLabel("shell", [{ name: "Bash", source: "claudeCode" }], true)).toEqual({
      label: "shell",
      hint: "Bash",
    });
  });

  it("keeps canonical-only (Copilot) aggregates unchanged", () => {
    expect(toolAggregateLabel("powershell", [], true)).toEqual({ label: "powershell" });
  });

  it("drops a hint equal to the label (unmapped native tools)", () => {
    expect(
      toolAggregateLabel("Monitor", [{ name: "Monitor", source: "claudeCode" }], false),
    ).toEqual({ label: "Monitor" });
  });
});

describe("uniqueToolLabels", () => {
  it("names the canonical tool when two aggregates share a label", () => {
    expect(
      uniqueToolLabels([
        { canonical: "create", label: { label: "Write", hint: "create" } },
        { canonical: "apply_patch", label: { label: "Write", hint: "apply_patch" } },
        { canonical: "shell", label: { label: "Bash", hint: "shell" } },
      ]),
    ).toEqual(["Write (create)", "Write (apply_patch)", "Bash"]);
  });
});

describe("Tools page labels", () => {
  const entry = (overrides: Partial<ToolUsageEntry>): ToolUsageEntry => ({
    name: "shell",
    callCount: 5,
    successRate: 1,
    avgDurationMs: 1,
    totalDurationMs: 5,
    ...overrides,
  });
  const bash = {
    name: "Bash",
    source: "claudeCode" as const,
    callCount: 5,
    successRate: 1,
    avgDurationMs: 1,
  };

  it("shows a Claude-only tool by its native name", () => {
    expect(toolUsageLabel(entry({ nativeTools: [bash] }))).toEqual({
      label: "Bash",
      hint: "shell",
    });
  });

  it("shows a tool with Copilot calls too by its canonical name", () => {
    expect(toolUsageLabel(entry({ callCount: 9, nativeTools: [bash] }))).toEqual({
      label: "shell",
      hint: "Bash",
    });
  });

  it("leaves Copilot-only tools unchanged", () => {
    expect(toolUsageNames([entry({ name: "powershell" })])).toEqual(["powershell"]);
  });
});

describe("contextToolTypeLabel", () => {
  it("names a session's canonical tool by its native names", () => {
    expect(
      contextToolTypeLabel({ toolName: "ask_user", nativeToolNames: ["AskUserQuestion"] }),
    ).toEqual({ label: "AskUserQuestion", hint: "ask_user" });
    expect(contextToolTypeLabel({ toolName: "view" })).toEqual({ label: "view" });
  });
});

describe("searchResultToolName", () => {
  it("reads the native name from the row metadata", () => {
    expect(
      searchResultToolName({
        toolName: "ask_user",
        metadataJson: '{"nativeToolName":"AskUserQuestion"}',
      }),
    ).toBe("AskUserQuestion");
  });

  it("falls back to the indexed name", () => {
    expect(searchResultToolName({ toolName: "powershell", metadataJson: null })).toBe("powershell");
    expect(searchResultToolName({ toolName: "grep", metadataJson: '{"role":"x"}' })).toBe("grep");
    expect(searchResultToolName({ toolName: "grep", metadataJson: "not json" })).toBe("grep");
    expect(searchResultToolName({ toolName: null, metadataJson: null })).toBeNull();
  });
});

describe("searchToolOptionLabel", () => {
  const claudeOnly = { name: "shell", nativeNames: ["Bash"], sources: ["claudeCode" as const] };
  const mixed = {
    name: "shell",
    nativeNames: ["Bash"],
    sources: ["copilot" as const, "claudeCode" as const],
  };
  const copilotOnly = { name: "powershell", nativeNames: [], sources: ["copilot" as const] };

  it("leads with the native name when every row searched records one", () => {
    expect(searchToolOptionLabel(claudeOnly, null)).toBe("Bash (shell)");
    expect(searchToolOptionLabel(mixed, "claudeCode")).toBe("Bash (shell)");
  });

  it("leads with the canonical name when Copilot rows are searched too", () => {
    expect(searchToolOptionLabel(mixed, null)).toBe("shell (Bash)");
    expect(searchToolOptionLabel(mixed, "copilot")).toBe("shell");
  });

  it("keeps a Copilot tool's canonical name", () => {
    expect(searchToolOptionLabel(copilotOnly, null)).toBe("powershell");
  });
});
