import { IPC_EVENTS, reindexSessions } from "@tracepilot/client";
import { createDeferred, type Deferred } from "@tracepilot/test-utils";
import { getDesignToken } from "@tracepilot/ui";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { logError } from "@/utils/logger";
import { safeListen } from "@/utils/tauriEvents";
import IndexingLoadingScreen from "../IndexingLoadingScreen.vue";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../__tests__/mocks/client");
  return createClientMock({ reindexSessions: vi.fn() });
});
vi.mock("@tracepilot/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tracepilot/ui")>()),
  getDesignToken: vi.fn(),
}));
vi.mock("@/utils/tauriEvents", () => ({ safeListen: vi.fn() }));
vi.mock("@/utils/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

const SceneStub = defineComponent({
  inheritAttrs: false,
  setup(_, { expose }) {
    expose({
      showLaneEllipses: vi.fn(),
      setLaneEllipseOpacity: vi.fn(),
      setGlobalSpeedMult: vi.fn(),
      decelerate: vi.fn(),
      clearSeedNodes: vi.fn(),
      createNode: vi.fn(),
      createSeedNode: vi.fn(),
      emitPulse: vi.fn(),
      scaleFactor: 1,
    });
    return () => null;
  },
});

describe("IndexingLoadingScreen readiness", () => {
  let wrapper: VueWrapper | undefined;
  let reindex: Deferred<[number, number]>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    vi.mocked(getDesignToken).mockReturnValue("180ms");
    vi.mocked(safeListen).mockImplementation(async () => vi.fn<() => void>());
    reindex = createDeferred<[number, number]>();
    vi.mocked(reindexSessions).mockReturnValue(reindex.promise);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function mountScreen() {
    wrapper = mount(IndexingLoadingScreen, {
      props: { totalSessions: 3 },
      global: { stubs: { IndexingOrbitalScene: SceneStub } },
    });
    await flushPromises();
    expect(reindexSessions).toHaveBeenCalledTimes(1);
    return wrapper;
  }

  it("waits for its own reindex after an unrelated finish event", async () => {
    const screen = await mountScreen();
    const finish = vi
      .mocked(safeListen)
      .mock.calls.find(([event]) => event === IPC_EVENTS.INDEXING_FINISHED)?.[1];
    expect(finish).toBeDefined();
    finish?.({ event: IPC_EVENTS.INDEXING_FINISHED, id: 0, payload: null });

    // Also exceeds the old minimum display plus completion sequence.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(screen.emitted("complete")).toBeUndefined();
    expect(screen.get(".indexing-loading-screen").classes()).not.toContain("fade-out");

    reindex.resolve([3, 3]);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(179);
    expect(screen.emitted("complete")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.emitted("complete")).toHaveLength(1);
  });

  it.each([
    "180ms",
    "0.18s",
  ])("finishes its own successful request without a finish event (%s token)", async (duration) => {
    vi.mocked(getDesignToken).mockReturnValue(duration);
    const screen = await mountScreen();
    reindex.resolve([3, 3]);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(180);

    expect(getDesignToken).toHaveBeenCalledWith("--duration-normal");
    expect(screen.emitted("complete")).toHaveLength(1);
    expect(logError).not.toHaveBeenCalled();
  });

  it("keeps the logged rejection recovery", async () => {
    const screen = await mountScreen();
    const failure = new Error("Index unavailable");
    reindex.reject(failure);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(180);

    expect(logError).toHaveBeenCalledWith("[indexing] Indexing failed (non-fatal):", failure);
    expect(screen.emitted("complete")).toHaveLength(1);
  });

  it.each([
    "resolve",
    "reject",
  ])("does not complete after its pending request settles via %s after unmount", async (settlement) => {
    const screen = await mountScreen();
    screen.unmount();
    wrapper = undefined;
    if (settlement === "resolve") reindex.resolve([3, 3]);
    else reindex.reject(new Error("Index unavailable"));
    await flushPromises();
    await vi.runAllTimersAsync();

    expect(screen.emitted("complete")).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
