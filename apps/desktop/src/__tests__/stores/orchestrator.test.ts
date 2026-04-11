import type { EventsResponse, HealthCheckResult } from "@tracepilot/types";
import { setupPinia } from "@tracepilot/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOrchestratorStore } from "@/stores/orchestrator";

const mockGetAvailableModels = vi.fn();
const mockGetSessionEvents = vi.fn();
const mockTaskAttribution = vi.fn();
const mockTaskIngestResults = vi.fn();
const mockTaskOrchestratorHealth = vi.fn();
const mockTaskOrchestratorStart = vi.fn();
const mockTaskOrchestratorStop = vi.fn();

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    getAvailableModels: (...args: unknown[]) => mockGetAvailableModels(...args),
    getSessionEvents: (...args: unknown[]) => mockGetSessionEvents(...args),
    taskAttribution: (...args: unknown[]) => mockTaskAttribution(...args),
    taskIngestResults: (...args: unknown[]) => mockTaskIngestResults(...args),
    taskOrchestratorHealth: (...args: unknown[]) => mockTaskOrchestratorHealth(...args),
    taskOrchestratorStart: (...args: unknown[]) => mockTaskOrchestratorStart(...args),
    taskOrchestratorStop: (...args: unknown[]) => mockTaskOrchestratorStop(...args),
  });
});

const HEALTH_RUNNING: HealthCheckResult = {
  health: "healthy",
  heartbeatAgeSecs: 1,
  lastCycle: 1,
  activeTasks: [],
  needsRestart: false,
  sessionUuid: "session-1",
  sessionPath: "/tmp/session",
};

describe("useOrchestratorStore", () => {
  beforeEach(() => {
    setupPinia();
    mockGetAvailableModels.mockReset();
    mockGetSessionEvents.mockReset();
    mockTaskAttribution.mockReset();
    mockTaskIngestResults.mockReset();
    mockTaskOrchestratorHealth.mockReset();
    mockTaskOrchestratorStart.mockReset();
    mockTaskOrchestratorStop.mockReset();

    mockTaskIngestResults.mockResolvedValue(0);
    mockGetSessionEvents.mockResolvedValue({
      events: [],
      totalCount: 0,
      hasMore: false,
      allEventTypes: [],
    } satisfies EventsResponse);
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("refreshActivity tolerates malformed events and still returns valid entries", async () => {
    mockGetSessionEvents.mockResolvedValue({
      events: [
        {
          id: "valid",
          timestamp: "2026-01-01T00:00:00Z",
          eventType: "tool.execution_start",
          data: { toolName: "view", arguments: { path: "/tmp/valid.txt" } },
        },
        {
          id: "malformed",
          timestamp: "2026-01-01T00:00:01Z",
          eventType: "tool.execution_start",
          data: { toolName: "read", arguments: { path: 123 } },
        },
      ],
      totalCount: 2,
      hasMore: false,
      allEventTypes: ["tool.execution_start"],
    } satisfies EventsResponse);

    const store = useOrchestratorStore();
    store.stopPolling();
    store.health = HEALTH_RUNNING;

    await store.refreshActivity();

    expect(store.activityFeed).toEqual([
      {
        id: "malformed",
        timestamp: "2026-01-01T00:00:01Z",
        icon: "📖",
        label: "Reading file",
        detail: "",
        eventType: "tool.execution_start",
      },
      {
        id: "valid",
        timestamp: "2026-01-01T00:00:00Z",
        icon: "📖",
        label: "Reading file",
        detail: "valid.txt",
        eventType: "tool.execution_start",
      },
    ]);
  });
});
