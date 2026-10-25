import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  computeEpochStart,
  computeRows,
  computeRulerTicks,
  computeTimelineSpanMs,
  formatRulerOffset,
} from "@/composables/useWaterfallLayout";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const labels = (span: number) => computeRulerTicks(span).map((t) => t.label);

describe("computeRulerTicks", () => {
  it("returns no ticks for an empty or invalid span", () => {
    expect(computeRulerTicks(0)).toEqual([]);
    expect(computeRulerTicks(-5)).toEqual([]);
    expect(computeRulerTicks(Number.NaN)).toEqual([]);
    expect(computeRulerTicks(Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it("labels a short turn from 0s in whole steps", () => {
    expect(labels(12_000)).toEqual(["0s", "2s", "4s", "6s", "8s", "10s", "12s"]);
    expect(labels(900)).toEqual(["0s", "200ms", "400ms", "600ms", "800ms"]);
  });

  it.each([
    [30 * MINUTE, ["0s", "5m", "10m", "15m", "20m", "25m", "30m"]],
    [2 * HOUR, ["0s", "30m", "1h", "1h 30m", "2h"]],
    [2 * HOUR + 40 * MINUTE, ["0s", "30m", "1h", "1h 30m", "2h", "2h 30m"]],
    [5 * HOUR, ["0s", "1h", "2h", "3h", "4h", "5h"]],
    [11 * HOUR, ["0s", "2h", "4h", "6h", "8h", "10h"]],
  ])("keeps a %d ms turn to a readable set of labels", (span, expected) => {
    expect(labels(span)).toEqual(expected);
  });

  it("never draws more than seven ticks, however long the turn", () => {
    for (let span = 100; span < 30 * 24 * HOUR; span = Math.ceil(span * 1.37)) {
      const ticks = computeRulerTicks(span);
      expect(
        ticks.length,
        `${span} ms: ${ticks.map((t) => t.label).join(", ")}`,
      ).toBeLessThanOrEqual(7);
      expect(ticks.length).toBeGreaterThanOrEqual(1);
      expect(ticks.at(-1)?.leftPct).toBeLessThanOrEqual(100);
    }
  });

  it("places ticks proportionally along the span", () => {
    const ticks = computeRulerTicks(2 * HOUR);
    expect(ticks.map((t) => t.leftPct)).toEqual([0, 25, 50, 75, 100]);
  });
});

describe("formatRulerOffset", () => {
  it.each([
    [0, "0s"],
    [500, "500ms"],
    [1_500, "1.5s"],
    [45_000, "45s"],
    [90_000, "1m 30s"],
    [10 * MINUTE, "10m"],
    [HOUR, "1h"],
    [HOUR + 30 * MINUTE, "1h 30m"],
    [26 * HOUR, "26h"],
  ])("formats %d ms as %s", (ms, expected) => {
    expect(formatRulerOffset(ms)).toBe(expected);
  });
});

const at = (time: string) => `2026-03-01T${time}.000Z`;

function tool(id: string, start: string, end: string, extra: Partial<TurnToolCall> = {}) {
  return {
    toolCallId: id,
    toolName: "bash",
    startedAt: at(start),
    completedAt: at(end),
    durationMs: new Date(at(end)).getTime() - new Date(at(start)).getTime(),
    isComplete: true,
    ...extra,
  } satisfies TurnToolCall;
}

function turn(toolCalls: TurnToolCall[], extra: Partial<ConversationTurn> = {}): ConversationTurn {
  return { turnIndex: 0, assistantMessages: [], toolCalls, isComplete: true, ...extra };
}

/** The view's pipeline: anchor, span, then rows. */
function layout(t: ConversationTurn, all: TurnToolCall[] = t.toolCalls) {
  const epoch = computeEpochStart(t);
  const span = computeTimelineSpanMs(t, all, epoch);
  return { epoch, span, rows: computeRows(t, all, span, epoch) };
}

describe("waterfall time anchor", () => {
  it("measures tool bars from the turn's start, not its first tool", () => {
    // The model works for 14s before its first tool, as in the fixture session.
    const t = turn([tool("git-tag", "03:20:21", "03:20:28")], {
      timestamp: at("03:20:07"),
      endTimestamp: at("03:20:35"),
      durationMs: 28_000,
    });
    const { epoch, span, rows } = layout(t);
    expect(epoch).toBe(new Date(at("03:20:07")).getTime());
    expect(span).toBe(28_000);
    expect(rows[0].leftPct).toBeCloseTo(50);
    expect(rows[0].widthPct).toBeCloseTo(25);
  });

  it("places subagent children on the same turn-start axis", () => {
    const agent = tool("agent", "00:00:10", "00:00:30", { isSubagent: true, toolName: "task" });
    const child = tool("child", "00:00:20", "00:00:25", { parentToolCallId: "agent" });
    const t = turn([agent], { timestamp: at("00:00:00"), durationMs: 40_000 });
    const { span, rows } = layout(t, [agent, child]);
    expect(span).toBe(40_000);
    expect(rows.map((r) => [r.id, r.leftPct])).toEqual([
      ["agent", 25],
      ["child", 50],
    ]);
  });

  it("stretches the span to a tool that ends after the turn", () => {
    const t = turn([tool("late", "00:00:05", "00:00:20")], {
      timestamp: at("00:00:00"),
      durationMs: 10_000,
    });
    expect(layout(t).span).toBe(20_000);
  });

  it.each([
    ["has no timestamp", {}],
    ["has an unreadable timestamp", { timestamp: "not a date" }],
  ])("falls back to the first tool's start when the turn %s", (_, extra) => {
    const t = turn([tool("a", "00:00:10", "00:00:15"), tool("b", "00:00:15", "00:00:20")], extra);
    const { epoch, span, rows } = layout(t);
    expect(epoch).toBe(new Date(at("00:00:10")).getTime());
    expect(span).toBe(10_000);
    expect(rows.map((r) => r.leftPct)).toEqual([0, 50]);
  });

  it("falls back to the first tool's start when a tool starts before the turn", () => {
    const t = turn([tool("early", "00:00:00", "00:00:05")], {
      timestamp: at("00:00:02"),
      endTimestamp: at("00:00:10"),
      durationMs: 8_000,
    });
    const { epoch, span, rows } = layout(t);
    expect(epoch).toBe(new Date(at("00:00:00")).getTime());
    // The axis still reaches the turn's end, measured from the new anchor.
    expect(span).toBe(10_000);
    expect(rows[0].leftPct).toBe(0);
  });
});
