import type { ToolAnalysisData, ToolUsageEntry } from "@tracepilot/types";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import ToolKpis from "@/components/toolAnalysis/ToolKpis.vue";

enableAutoUnmount(afterEach);

function tool(name: string, calls: number, failed: number): ToolUsageEntry {
  return {
    name,
    callCount: calls,
    failureCount: failed,
    successRate: calls ? (calls - failed) / calls : 0,
    avgDurationMs: 100,
    totalDurationMs: calls * 100,
    nativeTools: [],
  };
}

function data(tools: ToolUsageEntry[]): ToolAnalysisData {
  return {
    totalCalls: tools.reduce((sum, entry) => sum + entry.callCount, 0),
    successRate: 0,
    avgDurationMs: 100,
    mostUsedTool: tools[0]?.name ?? "N/A",
    tools,
    activityHeatmap: [],
  };
}

describe("ToolKpis Failed card", () => {
  it("names the call threshold behind its worst tool on the card", () => {
    // powershell is judged (10+ calls); bash and store_memory fail more often but on few calls.
    const wrapper = mount(ToolKpis, {
      props: {
        data: data([tool("powershell", 100, 8), tool("bash", 4, 1), tool("store_memory", 2, 1)]),
        rows: [],
      },
    });
    const note = wrapper.findAll(".ad-kpi-note")[1].text().replace(/\s+/g, " ");
    expect(note).toContain("10 calls");
    expect(note).toContain("worst with 10+ calls: powershell (8%)");
  });
});
