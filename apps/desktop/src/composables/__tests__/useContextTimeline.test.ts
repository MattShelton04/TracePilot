import type { ContextTimelineResponse } from "@tracepilot/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTimeline = vi.fn();
const checkFreshness = vi.fn();

vi.mock("@tracepilot/client", () => ({
  getSessionContextTimeline: (...args: unknown[]) => getTimeline(...args),
  checkSessionFreshness: (...args: unknown[]) => checkFreshness(...args),
}));

import {
  clearContextTimelineCache,
  getCachedContextTimeline,
  loadContextTimeline,
} from "../useContextTimeline";

const response: ContextTimelineResponse = {
  eventsFileSize: 100,
  eventsFileMtime: 200,
  timeline: {
    points: [],
    events: [],
    compactions: [],
    topToolCalls: [],
    toolTypes: [],
    turnCount: 0,
    observedPointCount: 0,
    estimatedPointCount: 0,
    compactionStartCount: 0,
    compactionCompleteCount: 0,
    pairedCompactionCount: 0,
    methodology: "test",
  },
};

describe("useContextTimeline cache", () => {
  beforeEach(() => {
    clearContextTimelineCache();
    getTimeline.mockReset().mockResolvedValue(response);
    checkFreshness.mockReset().mockResolvedValue({
      eventsFileSize: 100,
      eventsFileMtime: 200,
    });
  });

  it("reuses a cached timeline when events.jsonl is unchanged", async () => {
    await loadContextTimeline("session-a");
    const second = await loadContextTimeline("session-a");

    expect(second).toBe(response);
    expect(getTimeline).toHaveBeenCalledTimes(1);
    expect(checkFreshness).toHaveBeenCalledTimes(1);
    expect(getCachedContextTimeline("session-a")).toBe(response);
  });

  it("rebuilds when the lightweight freshness probe changes", async () => {
    await loadContextTimeline("session-a");
    checkFreshness.mockResolvedValueOnce({ eventsFileSize: 101, eventsFileMtime: 201 });
    getTimeline.mockResolvedValueOnce({
      ...response,
      eventsFileSize: 101,
      eventsFileMtime: 201,
    });

    const changed = await loadContextTimeline("session-a");
    expect(changed.eventsFileSize).toBe(101);
    expect(getTimeline).toHaveBeenCalledTimes(2);
  });
});
