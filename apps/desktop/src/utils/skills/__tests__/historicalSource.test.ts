import { createHash, webcrypto } from "node:crypto";
import { getSessionEvents } from "@tracepilot/client";
import type { EventsResponse, SkillInvocationRecord } from "@tracepilot/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findHistoricalSkillSource } from "../historicalSource";

vi.mock("@tracepilot/client", () => ({ getSessionEvents: vi.fn() }));

const content = "---\nname: review\ndescription: Review code\n---\nRecorded instructions.";
const hash = createHash("sha256").update(content).digest("hex");

function record(overrides: Partial<SkillInvocationRecord> = {}): SkillInvocationRecord {
  return {
    sessionId: "session-1",
    sessionSummary: null,
    repository: null,
    turnIndex: 2,
    eventIndex: 10,
    timestamp: null,
    skillName: "review",
    path: "C:/project/.github/skills/review/SKILL.md",
    trigger: null,
    agentName: null,
    model: null,
    contentTokens: 20,
    contentSha256: hash,
    origin: "event",
    ...overrides,
  };
}

function events(data: Record<string, unknown>, eventType = "skill.invoked"): EventsResponse {
  return {
    events: [{ eventType, data }],
    totalCount: 30,
    hasMore: true,
    allEventTypes: [eventType],
  };
}

describe("findHistoricalSkillSource", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("crypto", webcrypto);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("recovers content only from the indexed event with a matching name and fingerprint", async () => {
    const invocation = record();
    const windowsContent = `${content.replace(/\n/g, "\r\n")}\r\n`;
    vi.mocked(getSessionEvents).mockResolvedValue(
      events({ name: " Review ", content: windowsContent }),
    );
    expect(await findHistoricalSkillSource([invocation])).toEqual({
      content: windowsContent,
      invocation,
    });
    expect(getSessionEvents).toHaveBeenCalledExactlyOnceWith("session-1", 10, 1);
  });

  it.each([
    [events({ name: "review", content: "A different version" })],
    [events({ name: "other-skill", content })],
    [events({ name: "review", content }, "tool.execution_complete")],
    [events({ name: "review" })],
  ])("rejects a stale event index or an unverified copy", async (response) => {
    vi.mocked(getSessionEvents).mockResolvedValue(response);
    expect(await findHistoricalSkillSource([record()])).toBeNull();
  });

  it("tries an earlier invocation when the most recent session is no longer available", async () => {
    const earlier = record({ sessionId: "earlier", eventIndex: 4 });
    vi.mocked(getSessionEvents)
      .mockRejectedValueOnce(new Error("Session moved"))
      .mockResolvedValueOnce(events({ name: "review", content }));
    expect(await findHistoricalSkillSource([record(), earlier])).toEqual({
      content,
      invocation: earlier,
    });
  });

  it("does not fetch logs for fallback invocations or rows without a fingerprint", async () => {
    expect(
      await findHistoricalSkillSource([
        record({ origin: "tool_call_fallback" }),
        record({ contentSha256: null }),
      ]),
    ).toBeNull();
    expect(getSessionEvents).not.toHaveBeenCalled();
  });

  it("discards a result and stops looking when the selected skill or range changes", async () => {
    let current = true;
    vi.mocked(getSessionEvents).mockImplementation(async () => {
      current = false;
      return events({ name: "review", content });
    });
    expect(await findHistoricalSkillSource([record(), record()], () => current)).toBeNull();
    expect(getSessionEvents).toHaveBeenCalledTimes(1);
  });
});
