import type { ToolAnalysisData, ToolUsageEntry } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  failureRate,
  formatCallTime,
  formatCellCount,
  formatToolTime,
  heatLevel,
  isFailing,
  rankTools,
  summarizeHeatmap,
  toolDayRows,
  toolFailures,
  toolKind,
  toolTimeSplit,
} from "@/utils/toolAnalysis";

function tool(
  name: string,
  calls: number,
  failed: number,
  avg: number,
  extra = {},
): ToolUsageEntry {
  return {
    name,
    callCount: calls,
    failureCount: failed,
    successRate: calls ? (calls - failed) / calls : 1,
    avgDurationMs: avg,
    totalDurationMs: calls * avg,
    ...extra,
  };
}

const TOOLS = [
  tool("view", 100, 1, 100),
  tool("shell", 40, 4, 2_000),
  tool("web_fetch", 5, 3, 1_500),
  tool("general-purpose", 4, 0, 300_000),
  tool("ask_user", 2, 0, 120_000),
];

describe("toolKind", () => {
  it("separates subagent runs and waits for the user from ordinary tools", () => {
    expect(toolKind({ name: "view" })).toBe("tool");
    expect(toolKind({ name: "task" })).toBe("agent");
    expect(toolKind({ name: "read_agent" })).toBe("agent");
    expect(toolKind({ name: "explore" })).toBe("agent");
    expect(toolKind({ name: "ask_user" })).toBe("wait");
    // Claude Code names the agent type canonically and `Agent` natively.
    expect(
      toolKind({
        name: "my-custom-agent",
        nativeTools: [
          { name: "Agent", source: "claudeCode", callCount: 1, successRate: 1, avgDurationMs: 1 },
        ],
      }),
    ).toBe("agent");
  });
});

describe("failures", () => {
  it("uses the recorded count and estimates it for older payloads", () => {
    expect(toolFailures(tool("shell", 40, 4, 1))).toBe(4);
    const old = { ...tool("shell", 40, 4, 1), failureCount: undefined };
    expect(toolFailures(old)).toBe(4);
    expect(failureRate(tool("shell", 40, 4, 1))).toBe(0.1);
  });

  it("only flags a tool with enough calls to judge", () => {
    expect(isFailing(tool("shell", 40, 4, 1))).toBe(true);
    expect(isFailing(tool("web_fetch", 5, 3, 1))).toBe(false);
    expect(isFailing(tool("view", 100, 1, 1))).toBe(false);
  });
});

describe("toolTimeSplit", () => {
  it("sums time and calls by kind", () => {
    const split = toolTimeSplit(TOOLS);
    expect(split.ms).toEqual({
      tool: 100 * 100 + 40 * 2_000 + 5 * 1_500,
      agent: 1_200_000,
      wait: 240_000,
    });
    expect(split.calls).toEqual({ tool: 145, agent: 4, wait: 2 });
    expect(split.totalMs).toBe(split.ms.tool + split.ms.agent + split.ms.wait);
  });
});

describe("rankTools", () => {
  const names = (tools: ToolUsageEntry[]) => tools.map((t) => t.name);

  it("ranks by calls, average and total time", () => {
    expect(names(rankTools(TOOLS, "calls"))[0]).toBe("view");
    expect(names(rankTools(TOOLS, "slowest")).slice(0, 2)).toEqual(["general-purpose", "ask_user"]);
    expect(names(rankTools(TOOLS, "time"))[0]).toBe("general-purpose");
  });

  it("ranks failure rate over judged tools first, so one small sample cannot lead", () => {
    // web_fetch fails 60% of 5 calls; shell 10% of 40.
    expect(names(rankTools(TOOLS, "failures")).slice(0, 3)).toEqual(["shell", "view", "web_fetch"]);
  });

  it("leaves its input in place", () => {
    const input = [...TOOLS];
    rankTools(input, "slowest");
    expect(input).toEqual(TOOLS);
  });
});

describe("toolDayRows", () => {
  const data = {
    callsByDay: [{ date: "2026-03-02", calls: 10, failures: 2, durationMs: 5_000 }],
  } as ToolAnalysisData;
  const days = ["2026-03-01", "2026-03-02"];

  it("stacks failed calls on the rest and zero-fills quiet days", () => {
    const { series, rows } = toolDayRows(data, days, "calls");
    expect(series.map((s) => s.label)).toEqual(["Calls", "Failed"]);
    expect(rows.map((r) => r.values)).toEqual([
      [0, 0],
      [8, 2],
    ]);
    expect(rows[1]).toMatchObject({ runs: 10, errors: 2 });
  });

  it("charts failures or time alone", () => {
    expect(toolDayRows(data, days, "failures").rows[1].values).toEqual([2]);
    expect(toolDayRows(data, days, "time").rows[1].values).toEqual([5_000]);
  });

  it("draws an empty range from payloads without the series", () => {
    const rows = toolDayRows({} as ToolAnalysisData, days, "calls").rows;
    expect(rows.every((r) => r.values.every((v) => v === 0))).toBe(true);
  });
});

describe("heatmap", () => {
  it("totals weekdays and hours and finds the busiest slot", () => {
    const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    grid[2][14] = 30;
    grid[2][9] = 10;
    grid[6][14] = 10;
    const summary = summarizeHeatmap(grid);
    expect(summary.total).toBe(50);
    expect(summary.dayTotals[2]).toBe(40);
    expect(summary.hourTotals[14]).toBe(40);
    expect(summary.peak).toEqual({ day: 2, hour: 14, count: 30 });
    expect(summary.peakHour).toBe(14);
    expect(summary.weekdayShare).toBe(0.8);
  });

  it("has no peak when nothing ran", () => {
    const summary = summarizeHeatmap(
      Array.from({ length: 7 }, () => new Array<number>(24).fill(0)),
    );
    expect(summary.peak).toBeNull();
    expect(summary.peakHour).toBeNull();
  });

  it("labels cells in at most four characters", () => {
    expect([0, 7, 940, 1_000, 2_840, 9_960, 12_300, 999_600].map(formatCellCount)).toEqual([
      "",
      "7",
      "940",
      "1k",
      "2.8k",
      "10k",
      "12k",
      "1M",
    ]);
  });

  it("shades cells in five steps, empty cells apart", () => {
    expect(heatLevel(0, 100)).toBe(0);
    expect(heatLevel(1, 100)).toBe(1);
    expect(heatLevel(50, 100)).toBe(3);
    expect(heatLevel(100, 100)).toBe(5);
  });
});

describe("time formats", () => {
  it("reads one call to a whole millisecond or a tenth of a second", () => {
    expect(formatCallTime(131.68)).toBe("132ms");
    expect(formatCallTime(6_622)).toBe("6.6s");
    expect(formatCallTime(125_091)).toBe("2m 5s");
  });

  it("reads summed time in seconds, minutes, then hours", () => {
    expect(formatToolTime(0)).toBe("0ms");
    expect(formatToolTime(45_400)).toBe("45s");
    expect(formatToolTime(2_874_000)).toBe("48m");
    expect(formatToolTime(5_400_000)).toBe("1.5h");
    expect(formatToolTime(3_268_000_000)).toBe("908h");
  });
});
