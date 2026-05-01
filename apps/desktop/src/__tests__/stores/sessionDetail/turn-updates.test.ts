// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it } from "vitest";
import {
  buildFreshness,
  FIXTURE_EVENTS_MTIME,
  FIXTURE_TURNS,
  SESSION_ID,
  mocks,
  setupSessionDetailStoreTest,
} from "./setup";
import { useSessionDetailStore } from "@/stores/sessionDetail";

setupSessionDetailStoreTest();

describe("useSessionDetailStore", () => {
  it("updates non-tail turns when refresh returns retrospective subagent completion", async () => {
    const store = useSessionDetailStore();
    await store.loadDetail(SESSION_ID);

    const initialTurns = {
      turns: [
        {
          turnIndex: 0,
          userMessage: "hello",
          assistantMessages: [],
          toolCalls: [
            {
              toolName: "task",
              toolCallId: "sa-1",
              isSubagent: true,
              isComplete: false,
            },
          ],
          isComplete: true,
        },
        {
          turnIndex: 1,
          userMessage: "next",
          assistantMessages: [],
          toolCalls: [],
          isComplete: true,
        },
      ],
      eventsFileSize: 100,
      eventsFileMtime: 1_000,
    };
    mocks.getSessionTurns.mockResolvedValue(initialTurns);
    await store.loadTurns();

    const beforeVersion = store.turnsVersion;
    expect(store.turns[0]?.toolCalls[0]?.isComplete).toBe(false);

    mocks.checkSessionFreshness.mockResolvedValue(buildFreshness(120, 2_000));
    mocks.getSessionTurns.mockResolvedValue({
      turns: [
        {
          turnIndex: 0,
          userMessage: "hello",
          assistantMessages: [],
          toolCalls: [
            {
              toolName: "task",
              toolCallId: "sa-1",
              isSubagent: true,
              isComplete: true,
              success: true,
            },
          ],
          isComplete: true,
        },
        {
          turnIndex: 1,
          userMessage: "next",
          assistantMessages: [],
          toolCalls: [],
          isComplete: true,
        },
      ],
      eventsFileSize: 120,
      eventsFileMtime: 2_000,
    });

    await store.refreshAll();

    expect(store.turns[0]?.toolCalls[0]?.isComplete).toBe(true);
    expect(store.turns[0]?.toolCalls[0]?.success).toBe(true);
    expect(store.turnsVersion).toBeGreaterThan(beforeVersion);
  });

  it("does not bump turnsVersion when refresh turns payload is unchanged", async () => {
    const store = useSessionDetailStore();
    await store.loadDetail(SESSION_ID);
    await store.loadTurns();

    const beforeVersion = store.turnsVersion;
    mocks.checkSessionFreshness.mockResolvedValue({
      eventsFileSize: FIXTURE_TURNS.eventsFileSize + 10,
      eventsFileMtime: FIXTURE_EVENTS_MTIME + 10,
    });
    mocks.getSessionTurns.mockResolvedValue({
      turns: structuredClone(FIXTURE_TURNS.turns),
      eventsFileSize: FIXTURE_TURNS.eventsFileSize + 10,
      eventsFileMtime: FIXTURE_EVENTS_MTIME + 10,
    });

    await store.refreshAll();

    expect(store.turnsVersion).toBe(beforeVersion);
  });

  it("updates turn when only model changes", async () => {
    const store = useSessionDetailStore();
    await store.loadDetail(SESSION_ID);

    mocks.getSessionTurns.mockResolvedValue({
      turns: [
        {
          turnIndex: 0,
          model: "gpt-5.3-codex",
          userMessage: "hello",
          assistantMessages: [],
          toolCalls: [],
          isComplete: true,
        },
      ],
      eventsFileSize: 200,
      eventsFileMtime: 2_500,
    });
    await store.loadTurns();

    const beforeVersion = store.turnsVersion;
    expect(store.turns[0]?.model).toBe("gpt-5.3-codex");

    mocks.checkSessionFreshness.mockResolvedValue(buildFreshness(220, 2_800));
    mocks.getSessionTurns.mockResolvedValue({
      turns: [
        {
          turnIndex: 0,
          model: "claude-sonnet-4.6",
          userMessage: "hello",
          assistantMessages: [],
          toolCalls: [],
          isComplete: true,
        },
      ],
      eventsFileSize: 220,
      eventsFileMtime: 2_800,
    });

    await store.refreshAll();

    expect(store.turns[0]?.model).toBe("claude-sonnet-4.6");
    expect(store.turnsVersion).toBeGreaterThan(beforeVersion);
  });
});
