// Data and stubs shared by the Context tab tests; the module mocks stay in each test file.
import type {
  ContextTimeline,
  ContextTimelineResponse,
  RequestLog,
  TurnToolCall,
} from "@tracepilot/types";
import { reactive } from "vue";

export const turnToolCall: TurnToolCall = {
  toolCallId: "turn-tool",
  toolName: "shell",
  eventIndex: 7,
  arguments: { command: "pnpm test" },
  argsSummary: "pnpm test",
  success: true,
  isComplete: true,
};
export const nestedSubagentToolCall: TurnToolCall = {
  toolCallId: "nested-tool",
  parentToolCallId: "subagent-call",
  toolName: "view",
  success: true,
  isComplete: true,
};

export function makeDetailStore() {
  const store = reactive({
    sessionId: "session-a",
    detail: {
      id: "session-a",
      source: undefined as "claudeCode" | undefined,
      eventCount: 10,
      turnCount: 1,
      updatedAt: "2026-07-18T00:00:00Z",
    },
    turns: [] as Array<{
      turnIndex: number;
      toolCalls: TurnToolCall[];
      model?: string;
    }>,
    turnsVersion: 0,
    turnsError: null as string | null,
    loaded: new Set<string>(),
    async loadTurns() {
      store.turns = [
        {
          turnIndex: 0,
          toolCalls: [turnToolCall, nestedSubagentToolCall],
          model: "gpt-5.6-luna",
        },
        { turnIndex: 1, toolCalls: [] },
      ];
      store.turnsVersion += 1;
      store.loaded.add("turns");
    },
  });
  return store;
}

export function timeline(totalTokens = 100): ContextTimeline {
  return {
    turnCount: 1,
    observedPointCount: 0,
    estimatedPointCount: 1,
    compactionStartCount: 0,
    compactionCompleteCount: 0,
    pairedCompactionCount: 0,
    methodology: "test",
    events: [],
    points: [
      {
        turn: 0,
        phase: "turn",
        timestamp: "2026-07-18T00:00:00Z",
        systemTokens: 10,
        toolDefinitionTokens: 20,
        conversationTokens: totalTokens - 30,
        contextChangeTokens: null,
        totalTokens,
        source: "estimated",
      },
    ],
    compactions: [],
    topToolCalls: [
      {
        turn: 0,
        toolCallId: "expensive-tool",
        toolName: "view",
        argumentTokens: 5,
        resultTokens: 95,
        totalTokens: 100,
        success: true,
        argumentsPreview: '{"path":"large.txt"}',
        resultPreview: "preview",
      },
    ],
    toolTypes: [
      {
        toolName: "view",
        callCount: 1,
        errorCount: 0,
        argumentTokens: 5,
        resultTokens: 95,
        totalTokens: 100,
        percentage: 100,
      },
    ],
  };
}

export function response(value: ContextTimeline): ContextTimelineResponse {
  return { timeline: value, eventsFileSize: value.points[0]?.totalTokens ?? 0 };
}

export const ChartStub = {
  props: ["timeline", "selectedPoint", "selectedEvent"],
  emits: ["selectPoint", "selectCompaction", "selectEvent", "clearSelection"],
  template: `
    <div>
      <button class="select-chart-point" @click="$emit('selectPoint', timeline.points[0])">Select</button>
      <button
        v-if="timeline.events[0]"
        class="select-chart-event"
        @click="$emit('selectEvent', timeline.events[0])"
      >
        Select event
      </button>
      <span class="selected-chart-value">{{ selectedPoint?.totalTokens ?? 'none' }}</span>
    </div>
  `,
};

/** A request log with `records` records and nothing else; the panel is stubbed. */
export function requestLog(records: number): RequestLog {
  return {
    shapes: [],
    omittedShapes: 0,
    omittedShapeHashes: [],
    calls: [],
    totalCalls: 0,
    callsWithoutShape: 0,
    models: [],
    agents: [],
    records,
    unreadableRecords: 0,
    files: 1,
    unreadableFiles: 0,
  };
}
