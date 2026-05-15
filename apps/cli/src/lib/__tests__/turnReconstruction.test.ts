import { describe, expect, it } from "vitest";
import { reconstructTurns } from "../turnReconstruction.js";

async function* toAsync<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

describe("reconstructTurns", () => {
  it("returns an empty array when no events are provided", async () => {
    const turns = await reconstructTurns(toAsync<Record<string, unknown>>([]));
    expect(turns).toEqual([]);
  });

  it("reconstructs a multi-turn conversation with user prompts, assistant replies, and tools", async () => {
    const events: Record<string, unknown>[] = [
      { type: "user.message", timestamp: "2025-01-01T00:00:00.000Z", data: { content: "hello" } },
      {
        type: "assistant.turn_start",
        timestamp: "2025-01-01T00:00:01.000Z",
        data: { turnId: "t0" },
      },
      {
        type: "tool.execution_start",
        timestamp: "2025-01-01T00:00:02.000Z",
        data: { toolName: "view", toolCallId: "c1", model: "gpt-5" },
      },
      {
        type: "tool.execution_complete",
        timestamp: "2025-01-01T00:00:03.000Z",
        data: { toolCallId: "c1", success: true },
      },
      {
        type: "assistant.message",
        timestamp: "2025-01-01T00:00:04.000Z",
        data: { content: "Here is the answer." },
      },
      { type: "assistant.turn_end", timestamp: "2025-01-01T00:00:05.000Z", data: { turnId: "t0" } },

      { type: "user.message", timestamp: "2025-01-01T00:01:00.000Z", data: { content: "again" } },
      {
        type: "assistant.turn_start",
        timestamp: "2025-01-01T00:01:01.000Z",
        data: { turnId: "t1" },
      },
      {
        type: "tool.execution_start",
        timestamp: "2025-01-01T00:01:02.000Z",
        data: { toolName: "grep", toolCallId: "c2", model: "gpt-5" },
      },
      {
        type: "tool.execution_complete",
        timestamp: "2025-01-01T00:01:03.000Z",
        data: { toolCallId: "c2", success: false },
      },
      { type: "assistant.turn_end", timestamp: "2025-01-01T00:01:04.000Z", data: { turnId: "t1" } },
    ];

    const turns = await reconstructTurns(toAsync(events));

    expect(turns).toHaveLength(2);

    expect(turns[0]).toMatchObject({
      turnId: "t0",
      model: "gpt-5",
      userMessage: "hello",
      assistantSnippet: "Here is the answer.",
      tools: [{ name: "view", success: true }],
      startTime: "2025-01-01T00:00:01.000Z",
      endTime: "2025-01-01T00:00:05.000Z",
      durationMs: 4000,
    });

    expect(turns[1]).toMatchObject({
      turnId: "t1",
      userMessage: "again",
      tools: [{ name: "grep", success: false }],
      durationMs: 3000,
    });
  });

  it("filters out report_intent tool calls", async () => {
    const events: Record<string, unknown>[] = [
      { type: "assistant.turn_start", timestamp: "2025-01-01T00:00:00.000Z", data: {} },
      {
        type: "tool.execution_start",
        data: { toolName: "report_intent", toolCallId: "c1" },
      },
      {
        type: "tool.execution_complete",
        data: { toolCallId: "c1", success: true },
      },
      { type: "assistant.turn_end", timestamp: "2025-01-01T00:00:01.000Z", data: {} },
    ];
    const turns = await reconstructTurns(toAsync(events));
    expect(turns).toHaveLength(1);
    expect(turns[0].tools).toEqual([]);
  });

  it("skips malformed events without throwing and still emits valid turns", async () => {
    const events: unknown[] = [
      null,
      "not-an-object",
      { /* no type */ data: { content: "ignored" } },
      { type: "user.message", data: { content: "hi" } },
      {
        type: "assistant.turn_start",
        timestamp: "2025-01-01T00:00:00.000Z",
        data: { turnId: "t0" },
      },
      { type: "assistant.message", data: { content: "ok" } },
      { type: "assistant.turn_end", timestamp: "2025-01-01T00:00:02.000Z", data: {} },
    ];
    const turns = await reconstructTurns(toAsync(events as Record<string, unknown>[]));
    expect(turns).toHaveLength(1);
    expect(turns[0].userMessage).toBe("hi");
    expect(turns[0].assistantSnippet).toBe("ok");
    expect(turns[0].durationMs).toBe(2000);
  });
});
