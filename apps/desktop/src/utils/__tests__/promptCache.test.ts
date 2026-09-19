import type { ConversationTurn } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  describeResume,
  describeWindowDetail,
  findLiveWindow,
  formatCountdown,
  formatIdle,
  liveCacheStatus,
  mapWindowsToTurns,
  resumeChipLabel,
} from "@/utils/promptCache";
import { makeTimeline, makeWindow } from "./promptCacheFixtures";

const turn = (overrides: Partial<ConversationTurn>): ConversationTurn =>
  ({
    turnIndex: 0,
    assistantMessages: [],
    toolCalls: [],
    isComplete: true,
    ...overrides,
  }) as ConversationTurn;

describe("formatting", () => {
  it("formats idle durations compactly", () => {
    expect(formatIdle(null)).toBe("—");
    expect(formatIdle(45)).toBe("45s");
    expect(formatIdle(17 * 60 + 20)).toBe("17m");
    expect(formatIdle(3600)).toBe("1h");
    expect(formatIdle(3900)).toBe("1h 5m");
    expect(formatIdle(86_400 + 3 * 3600)).toBe("1d 3h");
  });

  it("formats countdowns and clamps below zero", () => {
    expect(formatCountdown(17 * 60_000 + 42_000)).toBe("17:42");
    expect(formatCountdown(3_725_000)).toBe("1:02:05");
    expect(formatCountdown(-5_000)).toBe("0:00");
  });
});

describe("live countdown", () => {
  const expiresAt = "2026-09-12T00:30:00.000Z";
  const at = (time: string) => Date.parse(`2026-09-12T${time}Z`);

  it("moves from warm to expiring to expired", () => {
    expect(liveCacheStatus(expiresAt, at("00:20:00"))?.state).toBe("warm");
    expect(liveCacheStatus(expiresAt, at("00:25:00"))?.state).toBe("expiring");
    expect(liveCacheStatus(expiresAt, at("00:30:00"))?.state).toBe("expired");
    expect(liveCacheStatus(expiresAt, at("00:31:00"))?.remainingMs).toBe(-60_000);
    expect(liveCacheStatus("not a date", at("00:00:00"))).toBeNull();
  });

  it("only counts down a pending window predicted by the CLI", () => {
    const pending = makeWindow({ outcome: "pending", resumeAt: null });
    expect(findLiveWindow(makeTimeline([makeWindow(), pending]))).toBe(pending);
    expect(findLiveWindow(makeTimeline([pending, makeWindow()]))).toBeNull();
    expect(findLiveWindow(makeTimeline([{ ...pending, confidence: "estimated" }]))).toBeNull();
    expect(findLiveWindow(makeTimeline([{ ...pending, ttlSeconds: 0 }]))).toBeNull();
    expect(findLiveWindow(makeTimeline([{ ...pending, outcome: "sessionEnded" }]))).toBeNull();
    expect(findLiveWindow(null)).toBeNull();
  });
});

describe("mapWindowsToTurns", () => {
  it("matches by event index, then interaction id, then timestamp", () => {
    const turns = [
      turn({ turnIndex: 0, eventIndex: 3, interactionId: "i1" }),
      turn({ turnIndex: 1, eventIndex: 12, interactionId: "i2" }),
      turn({ turnIndex: 2, interactionId: "i3" }),
      turn({ turnIndex: 3, timestamp: "2026-09-12T02:00:00Z" }),
    ];
    const windows = [
      makeWindow({ index: 0 }),
      makeWindow({ index: 1, resumeEventIndex: 99, resumeInteractionId: "i3" }),
      makeWindow({
        index: 2,
        resumeEventIndex: null,
        resumeInteractionId: null,
        resumeAt: "2026-09-12T02:00:00.000Z",
      }),
    ];
    const map = mapWindowsToTurns(windows, turns);
    expect([...map.entries()].map(([turnIndex, w]) => [turnIndex, w.index])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ]);
  });

  it("skips windows without a timing claim or a resume", () => {
    const turns = [turn({ turnIndex: 1, eventIndex: 12 })];
    const hidden = [
      makeWindow({ confidence: "unavailable", outcome: "unknown" }),
      makeWindow({ outcome: "pending", resumeAt: null }),
    ];
    expect(mapWindowsToTurns(hidden, turns).size).toBe(0);
  });
});

describe("copy", () => {
  it("describes warm and expired resumes without blaming the user", () => {
    expect(describeResume(makeWindow())).toBe("idle 10m · cache warm, 20m before expiry");
    const expired = makeWindow({
      outcome: "expired",
      idleSeconds: 47 * 60,
      resumeOffsetSeconds: 17 * 60,
    });
    expect(describeResume(expired)).toBe("idle 47m · cache expired 17m before this reply");
    expect(describeResume({ ...expired, resumeSource: "agent" })).toBe(
      "idle 47m · cache expired 17m before the agent resumed",
    );
    for (const window of [makeWindow(), expired]) {
      expect(describeResume(window)).not.toMatch(/wasted/i);
      expect(describeWindowDetail(window)).not.toMatch(/wasted/i);
    }
  });

  it("labels likely cache breaks and cold resumes", () => {
    expect(resumeChipLabel(makeWindow())).toBe("Warm resume");
    expect(
      resumeChipLabel(
        makeWindow({ prefixChanges: [{ kind: "tools", summary: "+1 tool", details: [] }] }),
      ),
    ).toBe("Likely cache break");
    expect(resumeChipLabel(makeWindow({ outcome: "expired" }))).toBe("Cold resume");
    expect(resumeChipLabel(makeWindow({ outcome: "modelChanged" }))).toBe("Cold resume");
  });

  it("qualifies re-sent tokens with the confidence level", () => {
    const detail = describeWindowDetail(
      makeWindow({
        outcome: "expired",
        confidence: "estimated",
        prefixChanges: [{ kind: "effort", summary: "Effort high → xhigh", details: [] }],
      }),
    );
    expect(detail).toContain("Estimated");
    expect(detail).toContain("about 54K tokens re-sent without cache");
    expect(detail).toContain("Likely cache break: Effort high → xhigh");
  });
});
