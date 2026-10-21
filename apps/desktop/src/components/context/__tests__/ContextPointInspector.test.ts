import type { ContextCompaction } from "@tracepilot/types";
import { formatNumberFull } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ContextPointInspector from "../ContextPointInspector.vue";

function mountWith(selectedCompaction: ContextCompaction) {
  return mount(ContextPointInspector, {
    props: {
      selectedTimelineEvent: null,
      selectedPoint: null,
      selectedCompaction,
      pointModel: null,
      cachedInputCost: null,
      selectedTurnToolCalls: [],
      selectedTurnToolCall: null,
      loadingTurnTools: false,
      turnsError: null,
      fullResults: new Map(),
      loadingResults: new Set<string>(),
      failedResults: new Set<string>(),
      richEnabledFor: () => false,
    },
  });
}

function compactionStats(wrapper: ReturnType<typeof mountWith>): Record<string, string> {
  const grid = wrapper.get(".context-tab__compaction-details .context-tab__token-grid");
  return Object.fromEntries(
    grid.findAll("div").map((row) => [row.get("dt").text(), row.get("dd").text()]),
  );
}

describe("ContextPointInspector compaction diagnostics", () => {
  it("shows unknown token counts as unknown, not zero", () => {
    // A failed compaction with no post-compaction point: Rust leaves these unset.
    const wrapper = mountWith({
      startTurn: 4,
      completeTurn: 4,
      success: false,
      beforeTokens: null,
      afterTokens: null,
      tokensRemoved: null,
      afterSource: "estimated",
    });
    expect(compactionStats(wrapper)).toEqual({
      Before: "—",
      After: "—",
      Removed: "—",
      Checkpoint: "—",
    });
  });

  it("shows recorded counts, including a real zero", () => {
    const wrapper = mountWith({
      startTurn: 4,
      completeTurn: 5,
      success: true,
      checkpointNumber: 2,
      beforeTokens: 120_000,
      afterTokens: 30_000,
      tokensRemoved: 0,
      afterSource: "observed",
    });
    expect(compactionStats(wrapper)).toEqual({
      Before: formatNumberFull(120_000),
      After: formatNumberFull(30_000),
      Removed: formatNumberFull(0),
      Checkpoint: "2",
    });
  });
});
