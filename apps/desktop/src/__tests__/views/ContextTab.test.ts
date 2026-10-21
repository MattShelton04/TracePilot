import { getSessionRequestLog } from "@tracepilot/client";
import { setupPinia } from "@tracepilot/test-utils";
import type { RequestLog } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { reactive } from "vue";
import { resetSessionTabViews } from "@/composables/useSessionTabViews";
import ContextTab from "@/views/tabs/ContextTab.vue";
import { ChartStub, makeDetailStore, requestLog, response, timeline } from "./contextTabFixtures";

const loadTimeline = vi.fn();
const loadFullResult = vi.fn();
const navigateToConversation = vi.fn();
let detailStore: ReturnType<typeof makeDetailStore>;
let contextCaptureEnabled = false;

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({ getSessionRequestLog: vi.fn() });
});

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
    isFeatureEnabled: () => contextCaptureEnabled,
    computeUsageBasedCostBreakdown: () => ({ aiCredits: 0.123 }),
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
        ToolTypeDonut: { template: '<div class="tool-donut-stub" />' },
        ContextCapturePanel: { template: '<div class="capture-panel-stub">Snapshots</div>' },
        RecordedRequestsPanel: { template: '<div class="recorded-requests-stub">Recorded</div>' },
      },
    },
  });
}

describe("ContextTab", () => {
  beforeEach(() => {
    setupPinia();
    detailStore = makeDetailStore();
    loadTimeline.mockReset();
    loadFullResult.mockReset();
    vi.mocked(getSessionRequestLog).mockReset();
    vi.mocked(getSessionRequestLog).mockResolvedValue(requestLog(9));
    navigateToConversation.mockReset();
    contextCaptureEnabled = false;
    localStorage.clear();
    resetSessionTabViews();
  });

  it("switches between the timeline and the in-page request snapshots workspace", async () => {
    contextCaptureEnabled = true;
    loadTimeline.mockResolvedValue(response(timeline()));
    const wrapper = mountTab();
    await flushPromises();

    expect(wrapper.find(".capture-panel-stub").exists()).toBe(false);
    await wrapper
      .findAll(".context-tab__view-nav button")
      .find((button) => button.text().includes("Request snapshots"))
      ?.trigger("click");
    expect(wrapper.find(".capture-panel-stub").exists()).toBe(true);
    expect(wrapper.find(".context-tab__stats").exists()).toBe(false);
  });

  it("reopens on remembered request snapshots only where capture is offered", async () => {
    contextCaptureEnabled = true;
    loadTimeline.mockResolvedValue(response(timeline()));
    const first = mountTab();
    await flushPromises();
    await first
      .findAll(".context-tab__view-nav button")
      .find((button) => button.text().includes("Request snapshots"))
      ?.trigger("click");
    first.unmount();

    const reopened = mountTab();
    await flushPromises();
    expect(reopened.find(".capture-panel-stub").exists()).toBe(true);
    reopened.unmount();

    contextCaptureEnabled = false;
    const withoutCapture = mountTab();
    await flushPromises();
    expect(withoutCapture.find(".capture-panel-stub").exists()).toBe(false);
    expect(withoutCapture.find(".context-tab__stats").exists()).toBe(true);
    withoutCapture.unmount();
  });

  it("offers a Claude Code session's recorded requests without the capture flag", async () => {
    detailStore.detail.source = "claudeCode";
    loadTimeline.mockResolvedValue(response(timeline()));
    const wrapper = mountTab();
    await flushPromises();
    expect(getSessionRequestLog).toHaveBeenCalledWith("session-a");

    expect(wrapper.find(".recorded-requests-stub").exists()).toBe(false);
    await wrapper
      .findAll(".context-tab__view-nav button")
      .find((button) => button.text().includes("Recorded requests"))
      ?.trigger("click");
    expect(wrapper.find(".recorded-requests-stub").exists()).toBe(true);
    expect(wrapper.find(".capture-panel-stub").exists()).toBe(false);
    expect(wrapper.find(".context-tab__stats").exists()).toBe(false);
    wrapper.unmount();

    // A Copilot session without capture keeps the timeline alone.
    detailStore.detail.source = undefined;
    const copilot = mountTab();
    await flushPromises();
    expect(copilot.find(".context-tab__view-nav").exists()).toBe(false);
    expect(copilot.find(".recorded-requests-stub").exists()).toBe(false);
    expect(copilot.find(".context-tab__stats").exists()).toBe(true);
    // Only the Claude Code session's log was read.
    expect(getSessionRequestLog).toHaveBeenCalledTimes(1);
  });

  it("re-reads a live session's recorded requests only while that view shows", async () => {
    detailStore.detail.source = "claudeCode";
    loadTimeline.mockResolvedValue(response(timeline()));
    const wrapper = mountTab();
    await flushPromises();
    // The up-front read decides whether the view is offered.
    expect(getSessionRequestLog).toHaveBeenCalledTimes(1);

    // The running poll swaps the detail each tick; the timeline is showing.
    for (const eventCount of [11, 12, 13]) {
      detailStore.detail = { ...detailStore.detail, eventCount };
      await flushPromises();
    }
    expect(getSessionRequestLog).toHaveBeenCalledTimes(1);

    // Switching to it reads the log once, since it went stale meanwhile.
    await wrapper
      .findAll(".context-tab__view-nav button")
      .find((button) => button.text().includes("Recorded requests"))
      ?.trigger("click");
    await flushPromises();
    expect(getSessionRequestLog).toHaveBeenCalledTimes(2);

    // While it shows, each refresh reads it again.
    detailStore.detail = { ...detailStore.detail, eventCount: 14 };
    await flushPromises();
    expect(getSessionRequestLog).toHaveBeenCalledTimes(3);

    // Back on the timeline and again, with nothing new: no read.
    const views = () => wrapper.findAll(".context-tab__view-nav button");
    await views()
      .find((button) => button.text().includes("Context timeline"))
      ?.trigger("click");
    await views()
      .find((button) => button.text().includes("Recorded requests"))
      ?.trigger("click");
    await flushPromises();
    expect(getSessionRequestLog).toHaveBeenCalledTimes(3);
  });

  it("re-reads a live session's empty log now and then until its first records appear", async () => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    detailStore.detail.source = "claudeCode";
    vi.mocked(getSessionRequestLog).mockResolvedValue(requestLog(0));
    loadTimeline.mockResolvedValue(response(timeline()));
    const wrapper = mountTab();
    const tick = async (ms: number) => {
      vi.advanceTimersByTime(ms);
      detailStore.detail = {
        ...detailStore.detail,
        eventCount: detailStore.detail.eventCount + 1,
      };
      await flushPromises();
    };
    await flushPromises();
    expect(wrapper.find(".context-tab__view-nav").exists()).toBe(false);

    // The session writes its first records; ticks within 30 s of the read don't re-read.
    vi.mocked(getSessionRequestLog).mockResolvedValue(requestLog(4));
    for (let i = 0; i < 3; i++) await tick(3_000);
    expect(getSessionRequestLog).toHaveBeenCalledTimes(1);

    // A tick past that re-reads it, and the view is offered.
    await tick(30_000);
    expect(getSessionRequestLog).toHaveBeenCalledTimes(2);
    expect(wrapper.find(".context-tab__view-nav").text()).toContain("Recorded requests");

    // Now it holds records and the timeline shows: ticks only mark it stale.
    await tick(31_000);
    expect(getSessionRequestLog).toHaveBeenCalledTimes(2);
  });

  it("keeps a Claude Code session with no request records on the timeline alone", async () => {
    detailStore.detail.source = "claudeCode";
    vi.mocked(getSessionRequestLog).mockResolvedValue(requestLog(0));
    loadTimeline.mockResolvedValue(response(timeline()));
    const wrapper = mountTab();
    await flushPromises();

    expect(wrapper.find(".context-tab__view-nav").exists()).toBe(false);
    expect(wrapper.find(".recorded-requests-stub").exists()).toBe(false);
    expect(wrapper.find(".context-tab__stats").exists()).toBe(true);
  });

  it("reopens a remembered Recorded requests view without flashing the timeline", async () => {
    detailStore.detail.source = "claudeCode";
    loadTimeline.mockResolvedValue(response(timeline()));
    const first = mountTab();
    await flushPromises();
    await first
      .findAll(".context-tab__view-nav button")
      .find((button) => button.text().includes("Recorded requests"))
      ?.trigger("click");
    first.unmount();

    let resolveLog: (value: RequestLog) => void = () => {};
    vi.mocked(getSessionRequestLog).mockImplementationOnce(
      () => new Promise((resolve) => (resolveLog = resolve)),
    );
    const reopened = mountTab();
    await flushPromises();
    // Still reading: the panel's own loading state, no timeline, no switch yet.
    expect(reopened.find(".recorded-requests-stub").exists()).toBe(true);
    expect(reopened.find(".context-tab__stats").exists()).toBe(false);
    expect(reopened.find(".context-tab__view-nav").exists()).toBe(false);

    resolveLog(requestLog(0));
    await flushPromises();
    // No records after all: the timeline, and the remembered view waits.
    expect(reopened.find(".recorded-requests-stub").exists()).toBe(false);
    expect(reopened.find(".context-tab__stats").exists()).toBe(true);
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

  it("shows tool types and the contribution chart together in the overview", async () => {
    loadTimeline.mockResolvedValue(response(timeline()));
    const wrapper = mountTab();
    await flushPromises();

    expect(wrapper.find(".context-tab__tool-type-panel").exists()).toBe(true);
    expect(wrapper.find(".tool-donut-stub").exists()).toBe(true);
    expect(
      wrapper.findAll(".context-tab__view-switch button").map((button) => button.text()),
    ).toEqual(["Overview", "Expensive calls"]);
  });

  it("shows information on hover, pins it on click, and dismisses it outside", async () => {
    loadTimeline.mockResolvedValue(response(timeline()));
    const wrapper = mountTab();
    await flushPromises();
    const methodology = wrapper.find(".context-tab__methodology");
    const trigger = methodology.find("button");

    await methodology.trigger("mouseenter");
    expect(wrapper.text()).toContain("Source-aware reconstruction");
    await methodology.trigger("mouseleave");
    expect(wrapper.text()).not.toContain("Source-aware reconstruction");

    await trigger.trigger("click");
    await methodology.trigger("mouseleave");
    expect(wrapper.text()).toContain("Source-aware reconstruction");
    document.body.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).not.toContain("Source-aware reconstruction");

    const observed = wrapper
      .find('[aria-label="Explain observed context telemetry"]')
      .element.closest(".context-tab__confidence-anchor");
    observed?.dispatchEvent(new MouseEvent("mouseenter"));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Exact context-layer snapshots");
    wrapper.unmount();
  });

  it("charts a Claude Code session's recorded totals with USD and no request snapshots", async () => {
    contextCaptureEnabled = true;
    detailStore.detail.source = "claudeCode";
    const value = timeline();
    value.points = value.points.map((point) => ({
      ...point,
      totalOnly: true,
      messageTokens: 1,
      toolIoTokens: point.conversationTokens - 1,
      cacheReadTokens: point.totalTokens - 2,
      cacheWriteTokens: 2,
      source: "observed",
    }));
    loadTimeline.mockResolvedValue(response(value));
    const wrapper = mountTab();
    await flushPromises();

    // The second view is Claude Code's own request record, never capture.
    expect(wrapper.findAll(".context-tab__view-nav button").map((button) => button.text())).toEqual(
      ["Context timeline", "Recorded requests"],
    );
    const observed = wrapper
      .find('[aria-label="Explain observed context telemetry"]')
      .element.closest(".context-tab__confidence-anchor");
    observed?.dispatchEvent(new MouseEvent("mouseenter"));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("recorded by each turn's last main-agent model call");
    expect(wrapper.text()).toContain("The layers within each total are estimates.");

    await detailStore.loadTurns();
    detailStore.turns[0].model = "claude-opus-4-6";
    await wrapper.find(".select-chart-point").trigger("click");
    await flushPromises();
    const inspector = wrapper.find(".context-tab__token-grid").text();
    for (const label of ["System & tools", "Messages", "Tool calls & results", "Cache write"]) {
      expect(inspector).toContain(label);
    }
    expect(inspector).not.toContain("Tool definitions");
    expect(wrapper.text()).toContain("Cached-input equivalent");
    expect(wrapper.text()).toContain("< $0.01");
    expect(wrapper.text()).not.toContain("AIC");
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
    expect(wrapper.findAll(".context-tab__turn-tool-list .tool-call-stub")).toHaveLength(1);
    expect(tool.attributes("data-rich")).toBe("true");
    expect(wrapper.find(".context-tab__bounded-tool").exists()).toBe(true);
    expect(wrapper.text()).toContain("Cached-input equivalent");
    // 0.123 AI Credits at $0.01 each is under a cent.
    expect(wrapper.text()).toContain("< $0.01");
    const statHelp = wrapper.findAll(".context-tab__stat-help");
    expect(statHelp).toHaveLength(3);
    expect(statHelp[0]?.attributes("title")).toContain("main-agent system snapshot");
    expect(statHelp[1]?.attributes("title")).toContain("tool-definition total");
    expect(statHelp[2]?.attributes("title")).toContain("Cache-read-only comparison");
    expect(wrapper.findAll(".context-tab__detail-card > .context-tab__footnote")).toHaveLength(1);
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
      contextChangeTokens: 40,
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
    expect(wrapper.find(".context-tab__detail-card").text()).toContain(
      "Change from previous point",
    );
    expect(wrapper.find(".context-tab__detail-card").text()).toContain("+40");
  });
});
