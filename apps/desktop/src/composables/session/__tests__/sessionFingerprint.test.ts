import { describe, expect, it } from "vitest";
import {
  buildEventsFingerprint,
  computeDeepCompareIndexes,
  hashText,
  isSameEventsFingerprint,
  messageFingerprint,
  type toolCallFingerprint,
  turnFingerprint,
} from "@/composables/session/sessionFingerprint";

const msg = (overrides: Partial<Parameters<typeof messageFingerprint>[0]> = {}) =>
  ({
    content: "hello",
    ...overrides,
  }) as Parameters<typeof messageFingerprint>[0];

const tc = (overrides: Partial<Parameters<typeof toolCallFingerprint>[0]> = {}) =>
  ({
    toolName: "bash",
    isSubagent: false,
    isComplete: true,
    ...overrides,
  }) as Parameters<typeof toolCallFingerprint>[0];

const mkTurn = (
  overrides: Partial<Parameters<typeof turnFingerprint>[0]> = {},
): Parameters<typeof turnFingerprint>[0] =>
  ({
    turnIndex: 0,
    userMessage: "hi",
    assistantMessages: [],
    toolCalls: [],
    isComplete: true,
    ...overrides,
  }) as Parameters<typeof turnFingerprint>[0];

describe("hashText", () => {
  it("is deterministic and unsigned", () => {
    const h = hashText("the quick brown fox");
    expect(h).toBe(hashText("the quick brown fox"));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it("differs for distinct inputs", () => {
    expect(hashText("a")).not.toBe(hashText("b"));
  });

  it("handles empty strings without throwing", () => {
    expect(typeof hashText("")).toBe("number");
  });
});

describe("events fingerprint", () => {
  it("builds with nullable mtime", () => {
    expect(buildEventsFingerprint(10)).toEqual({ size: 10, mtime: null });
    expect(buildEventsFingerprint(10, 7)).toEqual({ size: 10, mtime: 7 });
  });

  it("equality is structural", () => {
    expect(
      isSameEventsFingerprint(buildEventsFingerprint(5, 1), buildEventsFingerprint(5, 1)),
    ).toBe(true);
    expect(
      isSameEventsFingerprint(buildEventsFingerprint(5, 1), buildEventsFingerprint(5, 2)),
    ).toBe(false);
    expect(
      isSameEventsFingerprint(buildEventsFingerprint(1, null), buildEventsFingerprint(2, null)),
    ).toBe(false);
  });
});

describe("messageFingerprint / toolCallFingerprint / turnFingerprint", () => {
  it("is stable for equal inputs and changes when fields differ", () => {
    const a = turnFingerprint(mkTurn({ userMessage: "hi" }));
    const b = turnFingerprint(mkTurn({ userMessage: "hi" }));
    const c = turnFingerprint(mkTurn({ userMessage: "bye" }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("detects changes in nested messages and tool calls", () => {
    const base = mkTurn({
      assistantMessages: [msg({ content: "x" })],
      toolCalls: [tc({ toolName: "bash", isComplete: true })],
    });
    const changedMsg = mkTurn({
      assistantMessages: [msg({ content: "y" })],
      toolCalls: [tc({ toolName: "bash", isComplete: true })],
    });
    const changedTc = mkTurn({
      assistantMessages: [msg({ content: "x" })],
      toolCalls: [tc({ toolName: "bash", isComplete: false })],
    });
    expect(turnFingerprint(base)).not.toBe(turnFingerprint(changedMsg));
    expect(turnFingerprint(base)).not.toBe(turnFingerprint(changedTc));
  });

  it("messageFingerprint encodes attribution fields", () => {
    const plain = messageFingerprint(msg({ content: "x" }));
    const attributed = messageFingerprint(
      msg({ content: "x", parentToolCallId: "p", agentDisplayName: "A" }),
    );
    expect(plain).not.toBe(attributed);
  });
});

describe("computeDeepCompareIndexes", () => {
  it("returns empty set for empty list", () => {
    expect(computeDeepCompareIndexes([])).toEqual(new Set());
  });

  it("always includes the last index", () => {
    const turns = [mkTurn({ turnIndex: 0 }), mkTurn({ turnIndex: 1 })];
    expect(computeDeepCompareIndexes(turns).has(1)).toBe(true);
  });

  it("adds indexes with in-flight subagent tool calls", () => {
    const turns = [
      mkTurn({
        turnIndex: 0,
        toolCalls: [tc({ isSubagent: true, isComplete: false })],
      }),
      mkTurn({ turnIndex: 1, toolCalls: [tc({ isSubagent: false })] }),
      mkTurn({
        turnIndex: 2,
        toolCalls: [tc({ isSubagent: true, isComplete: true })],
      }),
    ];
    const idxs = computeDeepCompareIndexes(turns);
    expect(idxs.has(0)).toBe(true);
    expect(idxs.has(2)).toBe(true); // last
    expect(idxs.has(1)).toBe(false);
  });
});
