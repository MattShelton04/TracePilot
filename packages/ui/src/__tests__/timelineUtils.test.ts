import type { TurnToolCall } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import type { TimeSpanItem } from "../utils/timelineUtils";
import { detectParallelIds, timeSpansOverlap, toTimeSpan } from "../utils/timelineUtils";

function makeTc(overrides: Partial<TurnToolCall> = {}): TurnToolCall {
  return { toolName: "view", isComplete: true, ...overrides };
}

describe("toTimeSpan", () => {
  it("converts a valid TurnToolCall with startedAt and completedAt", () => {
    const tc = makeTc({
      toolCallId: "tc1",
      startedAt: "2024-01-01T00:00:00Z",
      completedAt: "2024-01-01T00:00:05Z",
    });
    const span = toTimeSpan(tc);
    expect(span).not.toBeNull();
    if (!span) throw new Error("span should not be null");
    expect(span.id).toBe("tc1");
    expect(span.startMs).toBe(new Date("2024-01-01T00:00:00Z").getTime());
    expect(span.endMs).toBe(new Date("2024-01-01T00:00:05Z").getTime());
  });

  it("returns null when startedAt is missing", () => {
    const tc = makeTc({ toolCallId: "tc2" });
    expect(toTimeSpan(tc)).toBeNull();
  });

  it("returns null for NaN start date", () => {
    const tc = makeTc({ toolCallId: "tc3", startedAt: "not-a-date" });
    expect(toTimeSpan(tc)).toBeNull();
  });

  it("falls back to durationMs when completedAt is missing", () => {
    const tc = makeTc({
      toolCallId: "tc4",
      startedAt: "2024-01-01T00:00:00Z",
      durationMs: 3000,
    });
    const span = toTimeSpan(tc);
    expect(span).not.toBeNull();
    if (!span) throw new Error("span should not be null");
    const expectedStart = new Date("2024-01-01T00:00:00Z").getTime();
    expect(span.startMs).toBe(expectedStart);
    expect(span.endMs).toBe(expectedStart + 3000);
  });

  it("uses toolName as id when toolCallId is missing", () => {
    const tc = makeTc({
      toolName: "grep",
      startedAt: "2024-01-01T00:00:00Z",
      completedAt: "2024-01-01T00:00:01Z",
    });
    const span = toTimeSpan(tc);
    expect(span).not.toBeNull();
    if (!span) throw new Error("span should not be null");
    expect(span.id).toBe("grep");
  });
});

describe("timeSpansOverlap", () => {
  const a: TimeSpanItem = { id: "a", startMs: 0, endMs: 10 };
  const b: TimeSpanItem = { id: "b", startMs: 5, endMs: 15 };
  const c: TimeSpanItem = { id: "c", startMs: 10, endMs: 20 };
  const d: TimeSpanItem = { id: "d", startMs: 20, endMs: 30 };
  const inner: TimeSpanItem = { id: "inner", startMs: 2, endMs: 8 };

  it("detects overlapping spans", () => {
    expect(timeSpansOverlap(a, b)).toBe(true);
  });

  it("detects non-overlapping spans", () => {
    expect(timeSpansOverlap(a, d)).toBe(false);
  });

  it("treats adjacent spans (touching edges) as non-overlapping", () => {
    expect(timeSpansOverlap(a, c)).toBe(false);
  });

  it("detects one span contained within another", () => {
    expect(timeSpansOverlap(a, inner)).toBe(true);
  });
});

describe("detectParallelIds", () => {
  it("returns empty set when no overlaps exist", () => {
    const items: TimeSpanItem[] = [
      { id: "a", startMs: 0, endMs: 5 },
      { id: "b", startMs: 10, endMs: 15 },
      { id: "c", startMs: 20, endMs: 25 },
    ];
    expect(detectParallelIds(items).size).toBe(0);
  });

  it("returns two ids when they overlap", () => {
    const items: TimeSpanItem[] = [
      { id: "a", startMs: 0, endMs: 10 },
      { id: "b", startMs: 5, endMs: 15 },
    ];
    const result = detectParallelIds(items);
    expect(result).toEqual(new Set(["a", "b"]));
  });

  it("handles three items with partial overlaps", () => {
    const items: TimeSpanItem[] = [
      { id: "a", startMs: 0, endMs: 10 },
      { id: "b", startMs: 5, endMs: 15 },
      { id: "c", startMs: 20, endMs: 30 },
    ];
    const result = detectParallelIds(items);
    expect(result).toEqual(new Set(["a", "b"]));
    expect(result.has("c")).toBe(false);
  });

  it("returns empty set for empty input", () => {
    expect(detectParallelIds([]).size).toBe(0);
  });

  it("handles unsorted input by start time", () => {
    const items: TimeSpanItem[] = [
      { id: "c", startMs: 20, endMs: 30 },
      { id: "a", startMs: 0, endMs: 10 },
      { id: "b", startMs: 5, endMs: 15 },
    ];
    const result = detectParallelIds(items);
    expect(result).toEqual(new Set(["a", "b"]));
  });

  it("ignores spans with non-positive duration", () => {
    const items: TimeSpanItem[] = [
      { id: "a", startMs: 0, endMs: 0 },
      { id: "b", startMs: 10, endMs: 5 },
      { id: "c", startMs: 20, endMs: 25 },
    ];
    expect(detectParallelIds(items)).toEqual(new Set());
  });

  it("marks all overlapping ids when many run concurrently", () => {
    const items: TimeSpanItem[] = [
      { id: "a", startMs: 0, endMs: 50 },
      { id: "b", startMs: 10, endMs: 60 },
      { id: "c", startMs: 20, endMs: 70 },
      { id: "d", startMs: 80, endMs: 90 },
    ];
    const result = detectParallelIds(items);
    expect(result).toEqual(new Set(["a", "b", "c"]));
    expect(result.has("d")).toBe(false);
  });
});
