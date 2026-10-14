import type { ToolAnalysisData, ToolUsageEntry } from "@tracepilot/types";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ToolRankPanel from "@/components/toolAnalysis/ToolRankPanel.vue";
import { resetAnalyticsDashboardViews } from "@/composables/useAnalyticsDashboardViews";

enableAutoUnmount(afterEach);

/** A canonical tool backed by one Claude Code native tool with the same counts. */
function claudeTool(name: string, native: string, calls: number, ok: number, failed: number) {
  const known = ok + failed;
  const successRate = known ? ok / known : 0;
  return {
    name,
    callCount: calls,
    failureCount: failed,
    successRate,
    avgDurationMs: 100,
    totalDurationMs: calls * 100,
    nativeTools: [
      {
        name: native,
        source: "claudeCode",
        callCount: calls,
        failureCount: failed,
        successRate,
        avgDurationMs: 100,
      },
    ],
  } satisfies ToolUsageEntry;
}

function data(tools: ToolUsageEntry[]): ToolAnalysisData {
  return {
    totalCalls: tools.reduce((sum, tool) => sum + tool.callCount, 0),
    successRate: 0,
    avgDurationMs: 100,
    mostUsedTool: tools[0]?.name ?? "N/A",
    tools,
    activityHeatmap: [],
  };
}

/** The Failed cell of the canonical row and of each expanded native row. */
async function failedCells(tool: ToolUsageEntry) {
  const wrapper = mount(ToolRankPanel, { props: { data: data([tool]) } });
  const row = wrapper.get('[data-testid="tool-rank-row"]');
  await row.get("button.tool-rank__toggle").trigger("click");
  const failed = (el: ReturnType<typeof wrapper.get>) => el.findAll('[role="cell"]')[3].text();
  return {
    canonical: failed(row),
    natives: wrapper.findAll(".tool-rank__native").map((native) => failed(native)),
  };
}

describe("ToolRankPanel native rows", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAnalyticsDashboardViews();
  });

  it("rates native failures over all calls, as the canonical row does", async () => {
    // Bash: 10 calls, 8 succeeded, 1 failed, 1 never got a result.
    const cells = await failedCells(claudeTool("shell", "Bash", 10, 8, 1));
    expect(cells.canonical).toBe("10%");
    expect(cells.natives).toEqual(["10%"]);
  });

  it("shows no failure rate for a native tool whose calls have no outcome", async () => {
    // A killed session: the Read call never got a tool_result.
    const cells = await failedCells(claudeTool("view", "Read", 2, 0, 0));
    expect(cells.canonical).toBe("—");
    expect(cells.natives).toEqual(["—"]);
  });
});
