import type { ConversationTurn, SessionSource } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { toolComparisonRows } from "../toolComparisonRows";

describe("tool usage comparison labels", () => {
  const call = (toolName: string, nativeToolName?: string) => ({ toolName, nativeToolName });
  const turnsOf = (...calls: Array<{ toolName: string; nativeToolName?: string }>) =>
    [{ toolCalls: calls }] as unknown as ConversationTurn[];

  function compareTools(
    a: [SessionSource, ConversationTurn[]],
    b: [SessionSource, ConversationTurn[]],
  ) {
    return toolComparisonRows(
      { detail: { source: a[0] }, turns: a[1] },
      { detail: { source: b[0] }, turns: b[1] },
    ).map(({ tool, label, hint, countA, countB }) => ({ tool, label, hint, countA, countB }));
  }

  it("names Claude Code tools natively, as Conversation does, keeping the canonical hint", () => {
    const claude = turnsOf(
      call("shell", "Bash"),
      call("shell", "Bash"),
      call("apply_patch", "Edit"),
      call("apply_patch", "MultiEdit"),
      call("view", "Read"),
      call("create", "Write"),
      call("mcp__synthetic__lookup", "mcp__synthetic__lookup"),
    );
    expect(
      compareTools(["claudeCode", claude], ["claudeCode", turnsOf(call("view", "Read"))]),
    ).toEqual([
      { tool: "shell", label: "Bash", hint: "shell", countA: 2, countB: 0 },
      { tool: "apply_patch", label: "Edit, MultiEdit", hint: "apply_patch", countA: 2, countB: 0 },
      { tool: "view", label: "Read", hint: "view", countA: 1, countB: 1 },
      { tool: "create", label: "Write", hint: "create", countA: 1, countB: 0 },
      {
        tool: "mcp__synthetic__lookup",
        label: "mcp__synthetic__lookup",
        hint: undefined,
        countA: 1,
        countB: 0,
      },
    ]);
  });

  it("keeps Copilot and Claude Code calls of one canonical tool on one row, canonical name first", () => {
    const rows = compareTools(
      ["copilot", turnsOf(call("powershell"), call("powershell"), call("view"))],
      ["claudeCode", turnsOf(call("powershell", "PowerShell"), call("shell", "Bash"))],
    );
    expect(rows).toEqual([
      { tool: "powershell", label: "powershell", hint: "PowerShell", countA: 2, countB: 1 },
      { tool: "view", label: "view", hint: undefined, countA: 1, countB: 0 },
      { tool: "shell", label: "Bash", hint: "shell", countA: 0, countB: 1 },
    ]);
  });

  it("names a canonical tool when two rows would share a native label", () => {
    const rows = compareTools(
      ["claudeCode", turnsOf(call("create", "Write"), call("apply_patch", "Write"))],
      ["claudeCode", []],
    );
    expect(rows.map((row) => row.label).sort()).toEqual(["Write (apply_patch)", "Write (create)"]);
  });
});
