import type { ContextTimeline, ContextTimelineResponse, TurnToolCall } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import ContextTab from "@/views/tabs/ContextTab.vue";

const loadTimeline = vi.fn();
const loadFullResult = vi.fn();
let detailStore: ReturnType<typeof makeDetailStore>;

vi.mock("@/composables/useContextTimeline", () => ({
  getCachedContextTimeline: () => null,
  loadContextTimeline: (...args: unknown[]) => loadTimeline(...args),
}));

vi.mock("@/composables/useSessionDetailContext", () => ({
  useSessionDetailContext: () => detailStore,
}));

vi.mock("@/composables/useCheckpointNavigation", () => ({
  useCheckpointNavigation: () => vi.fn(),
}));

vi.mock("@/composables/useToolResultLoader", () => ({
  useToolResultLoader: () => ({
    fullResults: reactive(new Map<string, string>()),
    loadingResults: reactive(new Set<string>()),
    failedResults: reactive(new Set<string>()),
    loadFullResult,
    retryFullResult: vi.fn(),
  }),
}));

const turnToolCall: TurnToolCall = {
  toolCallId: "turn-tool",
  toolName: "shell",
  arguments: { command: "pnpm test" },
  argsSummary: "pnpm test",
  success: true,
  isComplete: true,
};

function makeDetailStore() {
  const store = reactive({
    sessionId: "session-a",
    detail: {
      id: "session-a",
      eventCount: 10,
      turnCount: 1,
      updatedAt: "2026-07-18T00:00:00Z",
    },
    turns: [] as Array<{
      turnIndex: number;
      toolCalls: TurnToolCall[];
    }>,
    turnsVersion: 0,
    turnsError: null as string | null,
    loaded: new Set<string>(),
    async loadTurns() {
      store.turns = [{ turnIndex: 0, toolCalls: [turnToolCall] }];
      store.turnsVersion += 1;
      store.loaded.add("turns");
    },
  });
  return store;
}

function timeline(totalTokens = 100): ContextTimeline {
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
        turn: 1,
        phase: "turn",
        timestamp: "2026-07-18T00:00:00Z",
        systemTokens: 10,
        toolDefinitionTokens: 20,
        conversationTokens: totalTokens - 30,
        totalTokens,
        source: "estimated",
      },
    ],
    compactions: [],
    topToolCalls: [
      {
        turn: 1,
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

function response(value: ContextTimeline): ContextTimelineResponse {
  return { timeline: value, eventsFileSize: value.points[0]?.totalTokens ?? 0 };
}

const ChartStub = {
  props: ["timeline", "selectedPoint", "selectedEvent"],
  emits: ["selectPoint", "selectCompaction", "selectEvent", "clearSelection"],
  template: `
    <div>
      <button class="select-chart-point" @click="$emit('selectPoint', timeline.points[0])">Select</button>
      <span class="selected-chart-value">{{ selectedPoint?.totalTokens ?? 'none' }}</span>
    </div>
  `,
};

function mountTab() {
  return mount(ContextTab, {
    global: {
      stubs: {
        ContextWindowChart: ChartStub,
        SectionPanel: { props: ["title"], template: "<section><slot /></section>" },
        StatCard: true,
        EmptyState: true,
        ErrorAlert: true,
        LoadingSpinner: true,
        ToolCallItem: true,
        ToolTypeDonut: true,
      },
    },
  });
}

describe("ContextTab", () => {
  beforeEach(() => {
    detailStore = makeDetailStore();
    loadTimeline.mockReset();
    loadFullResult.mockReset();
  });

  it("does not show an empty message when expensive tool calls exist and prefetches details", async () => {
    loadTimeline.mockResolvedValue(response(timeline()));
    const wrapper = mountTab();
    await flushPromises();

    expect(wrapper.text()).not.toContain("No tool calls were captured for this session.");
    await wrapper.find(".context-tab__ranked-tool").trigger("click");

    expect(loadFullResult).toHaveBeenCalledWith("expensive-tool");
  });

  it("loads and displays tool calls for the selected turn", async () => {
    loadTimeline.mockResolvedValue(response(timeline()));
    const wrapper = mountTab();
    await flushPromises();

    await wrapper.find(".select-chart-point").trigger("click");
    await flushPromises();

    expect(wrapper.find(".context-tab__turn-tool-list").text()).toContain("shell");
    expect(wrapper.find(".context-tab__turn-tool-list").text()).toContain("pnpm test");
  });

  it("silently refreshes live data while preserving the selected point", async () => {
    loadTimeline
      .mockResolvedValueOnce(response(timeline(100)))
      .mockResolvedValueOnce(response(timeline(140)));
    const wrapper = mountTab();
    await flushPromises();
    await wrapper.find(".select-chart-point").trigger("click");
    await flushPromises();

    detailStore.detail.eventCount = 11;
    detailStore.detail.updatedAt = "2026-07-18T00:00:05Z";
    await flushPromises();

    expect(loadTimeline).toHaveBeenCalledTimes(2);
    expect(wrapper.find(".selected-chart-value").text()).toBe("140");
    expect(wrapper.text()).not.toContain("Updating");
  });
});
