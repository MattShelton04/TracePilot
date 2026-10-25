import { getSessionContextTimeline } from "@tracepilot/client";
import { createDeferred, type Deferred, setupPinia } from "@tracepilot/test-utils";
import type { ContextTimelineResponse } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { clearContextTimelineCache } from "@/composables/useContextTimeline";
import { resetSessionTabViews } from "@/composables/useSessionTabViews";
import ContextTab from "@/views/tabs/ContextTab.vue";
import { ChartStub, makeDetailStore, response, timeline } from "./contextTabFixtures";

// The real timeline loader runs here (cache, freshness probe and in-flight
// sharing); only the IPC calls beneath it are controlled.
let detailStore: ReturnType<typeof makeDetailStore>;
let builds: Deferred<ContextTimelineResponse>[];
let fileSize = 100;

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    getSessionRequestLog: vi.fn(),
    getSessionContextTimeline: vi.fn(),
    checkSessionFreshness: vi.fn(),
  });
});

vi.mock("@/composables/useSessionDetailContext", () => ({
  useSessionDetailContext: () => detailStore,
}));
vi.mock("@/composables/useCheckpointNavigation", () => ({
  useCheckpointNavigation: () => vi.fn(),
}));
vi.mock("@/composables/useConversationNavigation", () => ({
  useConversationNavigation: () => vi.fn(),
}));
vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({
    isRichRenderingEnabled: () => true,
    isFeatureEnabled: () => false,
    computeUsageBasedCostBreakdown: () => ({ aiCredits: 0 }),
  }),
}));
vi.mock("@/composables/useToolResultLoader", () => ({
  useToolResultLoader: () => ({
    fullResults: reactive(new Map<string, string>()),
    loadingResults: reactive(new Set<string>()),
    failedResults: reactive(new Set<string>()),
    loadFullResult: vi.fn(),
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
        ToolTypeDonut: true,
        ContextCapturePanel: true,
        RecordedRequestsPanel: true,
      },
    },
  });
}

/** The session gains an event, and its events file grows with it. */
async function sessionUpdates() {
  detailStore.detail.eventCount += 1;
  fileSize += 40;
  await flushPromises();
}

const shown = (wrapper: ReturnType<typeof mountTab>) =>
  wrapper.find(".selected-chart-value").text();

describe("ContextTab live refresh races", () => {
  let wrapper: ReturnType<typeof mountTab> | null = null;

  beforeEach(async () => {
    setupPinia();
    localStorage.clear();
    resetSessionTabViews();
    clearContextTimelineCache();
    detailStore = makeDetailStore();
    builds = [];
    fileSize = 100;
    const client = await import("@tracepilot/client");
    vi.mocked(client.getSessionContextTimeline).mockReset();
    vi.mocked(client.getSessionContextTimeline).mockImplementation(() => {
      const build = createDeferred<ContextTimelineResponse>();
      builds.push(build);
      return build.promise;
    });
    vi.mocked(client.checkSessionFreshness)
      .mockReset()
      .mockImplementation(async () => ({ eventsFileSize: fileSize }) as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  async function mountWithTimeline() {
    wrapper = mountTab();
    await flushPromises();
    builds[0].resolve(response(timeline(100)));
    await flushPromises();
    await wrapper.find(".select-chart-point").trigger("click");
    expect(shown(wrapper)).toBe("100");
    return wrapper;
  }

  it("shows the newest update when a second one arrives while the first is loading", async () => {
    const tab = await mountWithTimeline();
    await sessionUpdates(); // starts a background refresh
    await sessionUpdates(); // arrives before that refresh returns

    builds[1].resolve(response(timeline(140)));
    await flushPromises();
    builds[2]?.resolve(response(timeline(180)));
    await flushPromises();

    expect(shown(tab)).toBe("180");
    expect(getSessionContextTimeline).toHaveBeenCalledTimes(3);
  });

  it("catches up with an update that lands while the first timeline is loading", async () => {
    wrapper = mountTab();
    await flushPromises();
    await sessionUpdates(); // nothing is shown yet, so nothing refreshes now

    builds[0].resolve(response(timeline(100)));
    await flushPromises();
    builds[1]?.resolve(response(timeline(140)));
    await flushPromises();
    await wrapper.find(".select-chart-point").trigger("click");

    expect(shown(wrapper)).toBe("140");
    expect(getSessionContextTimeline).toHaveBeenCalledTimes(2);
  });

  it("doesn't rebuild when the update leaves the events file as it was", async () => {
    wrapper = mountTab();
    await flushPromises();
    detailStore.detail.updatedAt = "2026-07-18T00:00:09Z";
    await flushPromises();

    builds[0].resolve(response(timeline(100)));
    await flushPromises();

    // The catch-up only probes freshness; the unchanged file reuses the timeline.
    expect(getSessionContextTimeline).toHaveBeenCalledTimes(1);
    await wrapper.find(".select-chart-point").trigger("click");
    expect(shown(wrapper)).toBe("100");
  });
});
