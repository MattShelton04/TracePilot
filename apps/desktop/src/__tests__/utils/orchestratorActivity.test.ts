import type { SessionEvent } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { toActivityEntries } from "@/utils/orchestratorActivity";

describe("toActivityEntries", () => {
  it("maps known activity event types with existing labels/icons", () => {
    const events: SessionEvent[] = [
      {
        id: "1",
        timestamp: "2026-01-01T00:00:00Z",
        eventType: "tool.execution_start",
        data: { toolName: "task", arguments: { name: "planner" } },
      },
      {
        id: "2",
        timestamp: "2026-01-01T00:00:01Z",
        eventType: "assistant.message",
        data: { content: "Working on it" },
      },
      {
        id: "3",
        timestamp: "2026-01-01T00:00:02Z",
        eventType: "subagent.failed",
        data: { agentName: "reviewer", error: "timeout" },
      },
    ];

    expect(toActivityEntries(events)).toEqual([
      {
        id: "1",
        timestamp: "2026-01-01T00:00:00Z",
        icon: "🚀",
        label: "Dispatched subagent",
        detail: "planner",
        eventType: "tool.execution_start",
      },
      {
        id: "2",
        timestamp: "2026-01-01T00:00:01Z",
        icon: "🤖",
        label: "Orchestrator thinking",
        detail: "Working on it",
        eventType: "assistant.message",
      },
      {
        id: "3",
        timestamp: "2026-01-01T00:00:02Z",
        icon: "❌",
        label: "Subagent failed",
        detail: "timeout",
        eventType: "subagent.failed",
      },
    ]);
  });

  it("handles malformed payloads without throwing and keeps valid entries", () => {
    const events: SessionEvent[] = [
      {
        id: "a",
        timestamp: "2026-01-01T00:00:00Z",
        eventType: "tool.execution_start",
        data: { toolName: "view", arguments: { path: "/tmp/file.txt" } },
      },
      {
        id: "b",
        timestamp: "2026-01-01T00:00:01Z",
        eventType: "tool.execution_start",
        data: { toolName: 42, arguments: 123 },
      },
      {
        id: "c",
        timestamp: "2026-01-01T00:00:02Z",
        eventType: "assistant.message",
        data: { content: { text: "not-a-string" } },
      },
      {
        id: "d",
        timestamp: "2026-01-01T00:00:03Z",
        eventType: "untracked.event",
        data: {},
      },
    ];

    const entries = toActivityEntries(events);

    expect(entries).toEqual([
      {
        id: "a",
        timestamp: "2026-01-01T00:00:00Z",
        icon: "📖",
        label: "Reading file",
        detail: "file.txt",
        eventType: "tool.execution_start",
      },
      {
        id: "b",
        timestamp: "2026-01-01T00:00:01Z",
        icon: "🔧",
        label: "Tool: unknown",
        detail: "",
        eventType: "tool.execution_start",
      },
      {
        id: "c",
        timestamp: "2026-01-01T00:00:02Z",
        icon: "🤖",
        label: "Orchestrator thinking",
        detail: "",
        eventType: "assistant.message",
      },
    ]);
  });

  it("truncates long command strings and falls back when subagent name is missing", () => {
    const longCommand = "x".repeat(95);
    const events: SessionEvent[] = [
      {
        id: "e",
        timestamp: "2026-01-01T00:00:04Z",
        eventType: "tool.execution_start",
        data: { toolName: "bash", arguments: { command: longCommand } },
      },
      {
        id: "f",
        timestamp: "2026-01-01T00:00:05Z",
        eventType: "tool.execution_start",
        data: { toolName: "task", arguments: {} },
      },
    ];

    const entries = toActivityEntries(events);

    expect(entries[0].detail).toBe(`${"x".repeat(80)}…`);
    expect(entries[1].detail).toBe("task");
  });

  it("covers subagent lifecycle and remaining tool branches", () => {
    const events: SessionEvent[] = [
      {
        id: "g",
        timestamp: "2026-01-01T00:00:06Z",
        eventType: "subagent.started",
        data: { agentName: "coder" },
      },
      {
        id: "h",
        timestamp: "2026-01-01T00:00:07Z",
        eventType: "subagent.completed",
        data: { agentName: "coder" },
      },
      {
        id: "i",
        timestamp: "2026-01-01T00:00:08Z",
        eventType: "tool.execution_start",
        data: { toolName: "edit", arguments: { path: "/src/index.ts" } },
      },
      {
        id: "j",
        timestamp: "2026-01-01T00:00:09Z",
        eventType: "tool.execution_start",
        data: { toolName: "create", arguments: { path: "new-file.ts" } },
      },
      {
        id: "k",
        timestamp: "2026-01-01T00:00:10Z",
        eventType: "tool.execution_start",
        data: { toolName: "powershell", arguments: { command: "Get-Date" } },
      },
      {
        id: "l",
        timestamp: "2026-01-01T00:00:11Z",
        eventType: "tool.execution_start",
        data: { toolName: "read_agent", arguments: { agent_id: "agent-42" } },
      },
    ];

    expect(toActivityEntries(events)).toEqual([
      {
        id: "g",
        timestamp: "2026-01-01T00:00:06Z",
        icon: "▶️",
        label: "Subagent started",
        detail: "coder",
        eventType: "subagent.started",
      },
      {
        id: "h",
        timestamp: "2026-01-01T00:00:07Z",
        icon: "✅",
        label: "Subagent completed",
        detail: "coder",
        eventType: "subagent.completed",
      },
      {
        id: "i",
        timestamp: "2026-01-01T00:00:08Z",
        icon: "✏️",
        label: "Writing file (edit)",
        detail: "index.ts",
        eventType: "tool.execution_start",
      },
      {
        id: "j",
        timestamp: "2026-01-01T00:00:09Z",
        icon: "✏️",
        label: "Writing file (create)",
        detail: "new-file.ts",
        eventType: "tool.execution_start",
      },
      {
        id: "k",
        timestamp: "2026-01-01T00:00:10Z",
        icon: "💻",
        label: "Running powershell",
        detail: "Get-Date",
        eventType: "tool.execution_start",
      },
      {
        id: "l",
        timestamp: "2026-01-01T00:00:11Z",
        icon: "👁️",
        label: "Checking subagent",
        detail: "agent-42",
        eventType: "tool.execution_start",
      },
    ]);
  });

  it("generates fallback id from timestamp and index when id is missing", () => {
    const events: SessionEvent[] = [
      {
        id: undefined as unknown as string,
        timestamp: "2026-01-01T00:00:00Z",
        eventType: "subagent.started",
        data: { agentName: "test" },
      },
    ];

    const entries = toActivityEntries(events);
    expect(entries[0].id).toBe("2026-01-01T00:00:00Z-0");
  });
});
