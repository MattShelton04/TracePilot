import type { ConversationTurn } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  describeResume,
  findLiveWindow,
  formatCountdown,
  formatIdle,
  idleFractionOfTtl,
  liveCacheStatus,
  mapWindowsToTurns,
  resumeChipLabel,
  windowDetailRows,
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

  it("counts down the latest unresumed window, including ended sessions", () => {
    const pending = makeWindow({ outcome: "pending", resumeAt: null });
    expect(findLiveWindow(makeTimeline([makeWindow(), pending]))).toBe(pending);
    expect(findLiveWindow(makeTimeline([pending, makeWindow()]))).toBeNull();
    expect(findLiveWindow(makeTimeline([{ ...pending, confidence: "estimated" }]))).toBeNull();
    expect(findLiveWindow(makeTimeline([{ ...pending, ttlSeconds: 0 }]))).toBeNull();
    const ended = makeWindow({ ...pending, outcome: "sessionEnded" });
    expect(findLiveWindow(makeTimeline([makeWindow(), ended]))).toBe(ended);
    expect(findLiveWindow(makeTimeline([ended, makeWindow()]))).toBeNull();
    expect(findLiveWindow(makeTimeline([{ ...ended, confidence: "estimated" }]))).toBeNull();
    expect(findLiveWindow(makeTimeline([{ ...ended, confidence: "unavailable" }]))).toBeNull();
    expect(findLiveWindow(makeTimeline([{ ...ended, expiresAt: null }]))).toBeNull();
    expect(findLiveWindow(makeTimeline([{ ...ended, ttlSeconds: 0 }]))).toBeNull();
    expect(
      findLiveWindow(makeTimeline([{ ...ended, resumeAt: "2026-09-12T00:20:00Z" }])),
    ).toBeNull();
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

  it("places agent wakes on the turn they started, not the earlier prompt", () => {
    const turns = [
      turn({ turnIndex: 0, eventIndex: 3, interactionId: "i1" }),
      turn({ turnIndex: 1, interactionId: "i1", timestamp: "2026-09-12T00:45:00Z" }),
    ];
    const wake = makeWindow({
      resumeSource: "agent",
      resumeEventIndex: 40,
      resumeInteractionId: "i1",
      resumeAt: "2026-09-12T00:45:00.000Z",
    });
    expect([...mapWindowsToTurns([wake], turns).keys()]).toEqual([1]);
    const unmatched = { ...wake, resumeAt: "2026-09-12T00:46:00.000Z" };
    expect(mapWindowsToTurns([unmatched], turns).size).toBe(0);
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

describe("idleFractionOfTtl", () => {
  it("measures idle time against the predicted expiry, not the raw TTL", () => {
    // Expiry 15.5 minutes after idle start: 22 minutes idle is past it.
    const window = makeWindow({
      idleStart: "2026-09-12T12:43:09.000Z",
      expiresAt: "2026-09-12T12:58:39.000Z",
      idleSeconds: 22 * 60,
    });
    expect(idleFractionOfTtl(window)).toBeGreaterThan(1);
    expect(idleFractionOfTtl({ ...window, expiresAt: null })).toBeCloseTo(22 / 30);
    expect(idleFractionOfTtl({ ...window, idleSeconds: null })).toBeNull();
  });
});

describe("copy", () => {
  it("describes warm and expired resumes without blaming the user", () => {
    expect(describeResume(makeWindow())).toBe("idle 10m · 20m left");
    expect(describeResume(makeWindow({ resumeOffsetSeconds: -20 }))).toBe(
      "idle 10m · under a minute left",
    );
    const expired = makeWindow({
      outcome: "expired",
      idleSeconds: 47 * 60,
      resumeOffsetSeconds: 17 * 60,
    });
    expect(describeResume(expired)).toBe("idle 47m · expired 17m earlier");
    for (const window of [makeWindow(), expired]) {
      expect(describeResume(window)).not.toMatch(/wasted|predicted/i);
      for (const row of windowDetailRows(window)) expect(row.value).not.toMatch(/wasted/i);
    }
  });

  it("labels each resume outcome", () => {
    expect(resumeChipLabel(makeWindow())).toBe("Cache warm");
    expect(
      resumeChipLabel(
        makeWindow({ prefixChanges: [{ kind: "tools", summary: "+1 tool", details: [] }] }),
      ),
    ).toBe("Likely cache break");
    expect(resumeChipLabel(makeWindow({ outcome: "expired" }))).toBe("Cache expired");
    expect(resumeChipLabel(makeWindow({ outcome: "modelChanged" }))).toBe("Model changed");
  });

  it("labels only estimates and lists re-sent tokens after a miss", () => {
    const rows = (w: Parameters<typeof windowDetailRows>[0]) =>
      Object.fromEntries(windowDetailRows(w).map((r) => [r.label, r.value]));

    const warm = rows(makeWindow());
    expect(warm.Idle).toBe("10m");
    expect(warm.Model).toBe("gpt-5.6-luna · TTL 30m");
    expect(warm.Expiry).toContain("20m after reply");
    expect(warm.Timing).toBeUndefined();
    expect(warm["Re-sent"]).toBeUndefined();

    const estimated = rows(
      makeWindow({ outcome: "expired", confidence: "estimated", resumeSource: "agent" }),
    );
    expect(estimated.Timing).toBe("Estimated");
    expect(estimated["Resumed by"]).toBe("Agent");
    expect(estimated["Re-sent"]).toBe("about 54K tokens");
  });
});
