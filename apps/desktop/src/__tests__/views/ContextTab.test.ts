import type { ContextTimeline, ContextTimelineResponse, TurnToolCall } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import ContextTab from "@/views/tabs/ContextTab.vue";

const loadTimeline = vi.fn();
const loadFullResult = vi.fn();
const navigateToConversation = vi.fn();
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

vi.mock("@/composables/useConversationNavigation", () => ({
  useConversationNavigation: () => navigateToConversation,
}));

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({
    isRichRenderingEnabled: () => true,
  }),
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
  eventIndex: 7,
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
      store.turns = [
        { turnIndex: 0, toolCalls: [turnToolCall] },
        { turnIndex: 1, toolCalls: [] },
      ];
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
        turn: 0,
        phase: "turn",
        timestamp: "2026-07-18T00:00:00Z",
        systemTokens: 10,
        toolDefinitionTokens: 20,
        conversationTokens: totalTokens - 30,
        contextAddedTokens: totalTokens - 30,
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

function response(value: ContextTimeline): ContextTimelineResponse {
  return { timeline: value, eventsFileSize: value.points[0]?.totalTokens ?? 0 };
}

const ChartStub = {
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
        ToolCallItem: {
          props: ["tc", "expanded", "richEnabled"],
          template:
            '<div class="tool-call-stub" :data-tool="tc.toolName" :data-expanded="expanded" :data-rich="richEnabled">{{ tc.toolName }} {{ JSON.stringify(tc.arguments) }}</div>',
        },
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
    navigateToConversation.mockReset();
  });

  it("does not show an empty message when expensive tool calls exist and prefetches details", async () => {
    loadTimeline.mockResolvedValue(response(timeline()));
    const wrapper = mountTab();
    await flushPromises();

    expect(wrapper.text()).not.toContain("No tool calls were captured for this session.");
    await wrapper
      .findAll(".context-tab__view-switch button")
      .find((button) => button.text() === "Expensive calls")
      ?.trigger("click");
    await wrapper.find(".context-tab__ranked-tool").trigger("click");

    expect(loadFullResult).toHaveBeenCalledWith("expensive-tool");
  });

  it("loads and displays tool calls for the selected turn", async () => {
    loadTimeline.mockResolvedValue(response(timeline()));
    const wrapper = mountTab();
    await flushPromises();

    await wrapper.find(".select-chart-point").trigger("click");
    await flushPromises();

    const tool = wrapper.find(".context-tab__turn-tool-list .tool-call-stub");
    expect(tool.text()).toContain("shell");
    expect(tool.text()).toContain("pnpm test");
    expect(tool.attributes("data-rich")).toBe("true");
    expect(wrapper.find(".context-tab__bounded-tool").exists()).toBe(true);
    expect(wrapper.find(".context-tab__selected-inspector .context-tab__turn-tools").exists()).toBe(
      true,
    );
    expect(wrapper.find(".context-tab__tool-conversation-link").exists()).toBe(false);

    await wrapper.find(".context-tab__conversation-link").trigger("click");
    expect(navigateToConversation).toHaveBeenCalledWith({
      turnIndex: 0,
      eventIndex: null,
    });
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

  it("shows the complete user message and deep-links its exact event", async () => {
    const value = timeline();
    const message = "A complete user message that should not be shortened. ".repeat(20);
    value.events = [
      {
        turn: 0,
        eventIndex: 9,
        timestamp: "2026-07-18T00:00:00Z",
        kind: "userMessage",
        label: "User message",
        preview: message,
      },
    ];
    loadTimeline.mockResolvedValue(response(value));
    const wrapper = mountTab();
    await flushPromises();

    await wrapper.find(".select-chart-event").trigger("click");
    expect(wrapper.find(".context-tab__event-preview").text()).toBe(message.trim());

    await wrapper.find(".context-tab__conversation-link").trigger("click");
    expect(navigateToConversation).toHaveBeenCalledWith({
      turnIndex: 0,
      eventIndex: 9,
    });
  });

  it("replaces event details with the selected expensive call's turn stats", async () => {
    const value = timeline();
    value.turnCount = 2;
    value.events = [
      {
        turn: 0,
        eventIndex: 9,
        timestamp: "2026-07-18T00:00:00Z",
        kind: "userMessage",
        label: "User message",
        preview: "first turn message",
      },
    ];
    value.points.push({
      turn: 1,
      phase: "turn",
      timestamp: "2026-07-18T00:01:00Z",
      systemTokens: 10,
      toolDefinitionTokens: 20,
      conversationTokens: 170,
      contextAddedTokens: 40,
      totalTokens: 200,
      source: "estimated",
    });
    value.topToolCalls[0].turn = 1;
    loadTimeline.mockResolvedValue(response(value));
    const wrapper = mountTab();
    await flushPromises();

    await wrapper.find(".select-chart-event").trigger("click");
    expect(wrapper.text()).toContain("first turn message");

    await wrapper
      .findAll(".context-tab__view-switch button")
      .find((button) => button.text() === "Expensive calls")
      ?.trigger("click");
    await wrapper.find(".context-tab__ranked-tool").trigger("click");

    expect(wrapper.find(".context-tab__event-preview").exists()).toBe(false);
    expect(wrapper.find(".context-tab__detail-card").text()).toContain("Turn 1");
    expect(wrapper.find(".context-tab__detail-card").text()).toContain("Added this turn");
    expect(wrapper.find(".context-tab__detail-card").text()).toContain("+40");
  });
});
