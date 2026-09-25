import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { buildAgentCommunications } from "../utils/agentComms/communications";
import { buildAgentDirectory, MAIN_AGENT_KEY } from "../utils/agentComms/directory";
import {
  buildCommsTimeline,
  buildTimeScale,
  type CommsTimeline,
  type CommsTimelineAgent,
  DEFAULT_COMMS_FILTER,
  filterCommsEvents,
  formatTimelineOffset,
  packAgentLanes,
} from "../utils/agentComms/timeline";

const ALPHA_ID = "65f59a0b-dcb7-4bc0-bd1b-1c971ca4edd4";
const BETA_ID = "9fec072e-1ce7-49f2-9378-c9465b7a6b84";
const GAMMA_ID = "0b7f3f55-6a0e-4d8e-9d49-2d1f5b0e7a11";

const at = (s: number) => `2026-09-25T09:00:${String(s).padStart(2, "0")}.000Z`;

function tool(partial: Partial<TurnToolCall> & Pick<TurnToolCall, "toolName">): TurnToolCall {
  return { isComplete: true, success: true, ...partial };
}

function launch(
  key: string,
  name: string,
  agentId: string,
  start: number,
  end: number,
  eventIndex: number,
  parentToolCallId?: string,
): TurnToolCall {
  return tool({
    toolName: "task",
    toolCallId: key,
    isSubagent: true,
    agentId,
    agentStatus: "idle",
    parentToolCallId,
    startedAt: at(start),
    completedAt: at(end),
    eventIndex,
    arguments: { name, agent_type: "general-purpose", prompt: `You are ${name}.` },
  });
}

/**
 * 0s main starts; 5s launches alpha and beta; alpha launches gamma at 8s and
 * messages beta at 10s (beta busy, receives it at 14s); main reads beta at 20s.
 */
function session(): ConversationTurn[] {
  return [
    {
      turnIndex: 0,
      isComplete: true,
      timestamp: at(0),
      endTimestamp: at(30),
      assistantMessages: [],
      toolCalls: [
        launch("launch-alpha", "alpha", ALPHA_ID, 5, 25, 1),
        launch("launch-beta", "beta", BETA_ID, 5, 22, 2),
        launch("launch-gamma", "gamma", GAMMA_ID, 8, 12, 3, "launch-alpha"),
        tool({
          toolName: "view",
          toolCallId: "alpha-view",
          parentToolCallId: "launch-alpha",
          startedAt: at(7),
          completedAt: at(7),
          eventIndex: 4,
        }),
        tool({
          toolName: "write_agent",
          toolCallId: "alpha-msg",
          parentToolCallId: "launch-alpha",
          startedAt: at(10),
          completedAt: at(10),
          eventIndex: 5,
          arguments: { agent_id: BETA_ID, message: "What is 6*7?" },
        }),
        tool({
          toolName: "read_agent",
          toolCallId: "main-read",
          startedAt: at(19),
          completedAt: at(20),
          eventIndex: 7,
          arguments: { agent_id: BETA_ID },
          resultContent: `Agent completed. agent_id: ${BETA_ID}, status: completed\n\n[Turn 0]\n[Response]\n42`,
        }),
      ],
      agentMessages: [
        {
          content: "What is 6*7?",
          recipientToolCallId: "launch-beta",
          senderAgentId: ALPHA_ID,
          senderToolCallId: "launch-alpha",
          isLaunch: false,
          delivery: "queued",
          timestamp: at(14),
          eventIndex: 6,
        },
      ],
    },
  ];
}

function timeline(turns = session()) {
  const directory = buildAgentDirectory(turns, { sessionId: "session-main" });
  return buildCommsTimeline(turns, directory, buildAgentCommunications(turns, directory));
}

describe("buildCommsTimeline", () => {
  it("places the session on one clock from its first timestamp", () => {
    const t = timeline();
    expect(t.originMs).toBe(Date.parse(at(0)));
    expect(t.durationMs).toBe(30_000);
  });

  it("orders agents as a tree: each agent followed by the agents it launched", () => {
    expect(timeline().agents.map((a) => a.name)).toEqual(["Main agent", "alpha", "gamma", "beta"]);
  });

  it("gives each agent its lifespan and the start of each of its tool calls", () => {
    const alpha = timeline().agents.find((a) => a.name === "alpha");
    expect(alpha).toMatchObject({ startMs: 5_000, endMs: 25_000, depth: 1 });
    // alpha's own calls: the gamma launch, a view and the message.
    expect(alpha?.activityMs).toEqual([7_000, 8_000, 10_000]);
    const main = timeline().agents[0];
    expect(main).toMatchObject({ key: MAIN_AGENT_KEY, startMs: 0, endMs: 30_000 });
  });

  it("ends an agent with no recorded completion at its last activity", () => {
    const turns = session();
    const beta = turns[0]?.toolCalls.find((tc) => tc.toolCallId === "launch-beta");
    if (beta) beta.completedAt = undefined;
    // beta was last seen when main read it back at 20s, not at the session end (30s).
    expect(timeline(turns).agents.find((a) => a.name === "beta")?.endMs).toBe(20_000);
  });

  it("times a queued message from its send to its delivery", () => {
    const message = timeline().events.find((e) => e.comm.kind === "message");
    expect(message).toMatchObject({ edge: "peer", fromKey: "launch-alpha", atMs: 10_000 });
    expect(message?.deliveries).toEqual([
      { toKey: "launch-beta", atMs: 14_000, waitMs: 4_000, queued: true },
    ]);
  });

  it("orders events by time and draws reads flowing back to the reader", () => {
    const events = timeline().events;
    expect(events.map((e) => e.edge)).toEqual(["launch", "launch", "launch", "peer", "read"]);
    const read = events[events.length - 1];
    expect(read).toMatchObject({ fromKey: "launch-beta", toKeys: [MAIN_AGENT_KEY], atMs: 20_000 });
    expect(read?.poll).toBe(false);
  });

  it("carries the previous time forward for exchanges with no timestamp", () => {
    const turns = session();
    for (const tc of turns[0]?.toolCalls ?? []) {
      if (tc.toolName === "read_agent") {
        tc.startedAt = undefined;
        tc.completedAt = undefined;
      }
    }
    const read = timeline(turns).events.find((e) => e.comm.kind === "read");
    expect(read?.atMs).toBe(10_000);
  });

  it("returns an empty timeline for a session with no timestamps", () => {
    const t = timeline([{ turnIndex: 0, isComplete: true, assistantMessages: [], toolCalls: [] }]);
    expect(t).toMatchObject({ originMs: 0, durationMs: 0, events: [] });
    expect(t.agents).toHaveLength(1);
  });
});

describe("filterCommsEvents", () => {
  const events = timeline().events;

  it("keeps everything by default", () => {
    expect(filterCommsEvents(events, DEFAULT_COMMS_FILTER)).toHaveLength(events.length);
  });

  it("filters by kind, agent and text", () => {
    const kinds = (f: Partial<typeof DEFAULT_COMMS_FILTER>) =>
      filterCommsEvents(events, { ...DEFAULT_COMMS_FILTER, ...f }).map((e) => e.comm.kind);
    expect(kinds({ launches: false })).toEqual(["message", "read"]);
    expect(kinds({ agentKey: "launch-beta" })).toEqual(["launch", "message", "read"]);
    expect(kinds({ query: "6*7" })).toEqual(["message"]);
  });
});

describe("formatTimelineOffset", () => {
  it("uses seconds for short sessions and clock time for long ones", () => {
    expect(formatTimelineOffset(4_250, 60_000)).toBe("4.3s");
    expect(formatTimelineOffset(42_000, 60_000)).toBe("42s");
    expect(formatTimelineOffset(185_000, 600_000)).toBe("3:05");
    expect(formatTimelineOffset(3_730_000, 4_000_000)).toBe("1:02:10");
  });
});

function agent(
  key: string,
  startMs: number,
  endMs: number,
  extra: Partial<CommsTimelineAgent> = {},
) {
  return {
    key,
    name: key,
    type: "general-purpose",
    status: "completed",
    isMain: false,
    depth: 1,
    startMs,
    endMs,
    activityMs: [],
    ...extra,
  } satisfies CommsTimelineAgent;
}

describe("buildTimeScale", () => {
  const HOUR = 3_600_000;
  // Work for 10 minutes, idle for 5 hours, then work for 10 more minutes.
  const timeline: CommsTimeline = {
    originMs: 0,
    durationMs: 5 * HOUR + 1_200_000,
    agents: [
      agent("main", 0, 5 * HOUR + 1_200_000, {
        isMain: true,
        depth: 0,
        activityMs: [0, 300_000, 600_000],
      }),
      agent("late", 5 * HOUR + 600_000, 5 * HOUR + 1_200_000, { activityMs: [5 * HOUR + 900_000] }),
    ],
    events: [],
  };
  const scale = buildTimeScale(timeline);

  it("collapses long idle gaps to one marked break", () => {
    expect(scale.breaks).toHaveLength(1);
    expect(scale.breaks[0]).toMatchObject({ atVisualMs: 600_000, realMs: 5 * HOUR });
    expect(scale.durationMs).toBeLessThan(25 * 60_000);
  });

  it("keeps active stretches proportional and maps both ways", () => {
    expect(scale.toVisual(300_000)).toBe(300_000);
    const lateVisual = scale.toVisual(5 * HOUR + 900_000);
    expect(lateVisual - scale.toVisual(5 * HOUR + 600_000)).toBeCloseTo(300_000);
    expect(scale.toReal(lateVisual)).toBeCloseTo(5 * HOUR + 900_000);
  });

  it("leaves a session with no long gaps unchanged", () => {
    const short = buildTimeScale({
      ...timeline,
      durationMs: 600_000,
      agents: [timeline.agents[0] as CommsTimelineAgent],
    });
    expect(short.breaks).toEqual([]);
    expect(short.toVisual(123_456)).toBe(123_456);
  });
});

describe("packAgentLanes", () => {
  it("shares lanes between agents that never overlap, keeping lane 0 for the main agent", () => {
    const lanes = packAgentLanes([
      agent("main", 0, 100, { isMain: true, depth: 0 }),
      agent("a", 0, 10),
      agent("b", 5, 20),
      agent("c", 12, 30),
      agent("d", 21, 40),
    ]);
    expect(Object.fromEntries(lanes)).toEqual({ main: 0, a: 1, b: 2, c: 1, d: 2 });
  });
});
