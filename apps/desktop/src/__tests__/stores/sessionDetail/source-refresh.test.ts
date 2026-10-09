// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it, vi } from "vitest";
import {
  createDeferred,
  buildFreshness,
  FIXTURE_DETAIL,
  FIXTURE_TURNS,
  SESSION_ID,
  mocks,
  setupSessionDetailStoreTest,
} from "./setup";
import { useSessionDetailStore } from "@/stores/sessionDetail";

setupSessionDetailStoreTest();

describe("useSessionDetailStore refreshIfSourceChanged", () => {
  const versioned = (sourceVersion: string, size = 1024) => ({
    ...buildFreshness(size),
    sourceVersion,
  });

  async function loadEverything() {
    const store = useSessionDetailStore();
    await store.loadDetail(SESSION_ID);
    await store.loadTurns();
    await store.loadShutdownMetrics();
    await store.loadTodos();
    await store.loadIncidents();
    vi.clearAllMocks();
    return store;
  }

  it("reloads only sections not built from the source while its version is unchanged", async () => {
    const store = await loadEverything();
    mocks.checkSessionFreshness.mockResolvedValue(versioned("v1"));

    await store.refreshIfSourceChanged(); // first tick: nothing to compare against
    expect(mocks.getSessionDetail).toHaveBeenCalledTimes(1);
    expect(mocks.getShutdownMetrics).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    await store.refreshIfSourceChanged();
    expect(mocks.checkSessionFreshness).toHaveBeenCalledTimes(1);
    expect(mocks.getSessionDetail).not.toHaveBeenCalled();
    expect(mocks.getSessionTurns).not.toHaveBeenCalled();
    expect(mocks.getShutdownMetrics).not.toHaveBeenCalled();
    expect(mocks.getSessionTodos).toHaveBeenCalledTimes(1);
    expect(mocks.getSessionIncidents).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mocks.checkSessionFreshness.mockResolvedValue(versioned("v2", 2048));
    await store.refreshIfSourceChanged();
    expect(mocks.getSessionDetail).toHaveBeenCalledTimes(1);
    expect(mocks.getSessionTurns).toHaveBeenCalledTimes(1);
    expect(mocks.getShutdownMetrics).toHaveBeenCalledTimes(1);
  });

  it("makes no plan or file-history call on an unchanged tick", async () => {
    const store = await loadEverything();
    await store.loadPlan();
    await store.loadFileHistory();
    mocks.checkSessionFreshness.mockResolvedValue(versioned("v1"));
    await store.refreshIfSourceChanged();
    expect(mocks.getSessionPlan).toHaveBeenCalledTimes(2); // load + first tick
    expect(mocks.getSessionFileHistory).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    await store.refreshIfSourceChanged();
    expect(mocks.getSessionPlan).not.toHaveBeenCalled();
    expect(mocks.getSessionFileHistory).not.toHaveBeenCalled();
    expect(mocks.getSessionTodos).toHaveBeenCalledTimes(1);
  });

  it("refreshes everything when the freshness probe fails", async () => {
    const store = await loadEverything();
    mocks.checkSessionFreshness.mockResolvedValue(versioned("v1"));
    await store.refreshIfSourceChanged();

    vi.clearAllMocks();
    mocks.checkSessionFreshness.mockRejectedValue(new Error("probe failed"));
    await store.refreshIfSourceChanged();
    expect(mocks.getSessionDetail).toHaveBeenCalledTimes(1);
    expect(mocks.getShutdownMetrics).toHaveBeenCalledTimes(1);
  });

  it("does not carry a version over to another session", async () => {
    const store = await loadEverything();
    mocks.checkSessionFreshness.mockResolvedValue(versioned("same"));
    await store.refreshIfSourceChanged();

    mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: "other-456" });
    await store.loadDetail("other-456");
    vi.clearAllMocks();
    await store.refreshIfSourceChanged();
    expect(mocks.getSessionDetail).toHaveBeenCalledTimes(1);
  });

  it("refreshes a section whose load straddled a tick at a new version", async () => {
    const store = useSessionDetailStore();
    await store.loadDetail(SESSION_ID);
    const turnsAtV0 = createDeferred<typeof FIXTURE_TURNS>();
    const metricsAtV0 = createDeferred<{ totalPremiumRequests: number }>();
    mocks.getSessionTurns.mockReturnValueOnce(turnsAtV0.promise);
    mocks.getShutdownMetrics.mockReturnValueOnce(metricsAtV0.promise);
    const loads = Promise.all([store.loadTurns(), store.loadShutdownMetrics()]);

    // The session writes its last reply (V1) while both loads are in flight,
    // and a tick at V1 records it before they join the loaded sections.
    mocks.checkSessionFreshness.mockResolvedValue(versioned("v1", 2048));
    await store.refreshIfSourceChanged();
    turnsAtV0.resolve(FIXTURE_TURNS);
    metricsAtV0.resolve({ totalPremiumRequests: 5 });
    await loads;

    const twoTurns = [
      ...FIXTURE_TURNS.turns,
      { turnIndex: 1, userMessage: "again", assistantMessages: [], toolCalls: [] },
    ];
    mocks.getSessionTurns.mockResolvedValue({
      ...FIXTURE_TURNS,
      turns: twoTurns,
      eventsFileSize: 2048,
    });
    mocks.getShutdownMetrics.mockResolvedValue({ totalPremiumRequests: 6 });
    await store.refreshIfSourceChanged(); // still V1: the late sections refresh once
    expect(store.turns).toHaveLength(2);
    expect(store.shutdownMetrics).toEqual({ totalPremiumRequests: 6 });

    vi.clearAllMocks();
    mocks.checkSessionFreshness.mockResolvedValue(versioned("v1", 2048));
    await store.refreshIfSourceChanged(); // now every source section is fresh at V1
    expect(mocks.getSessionTurns).not.toHaveBeenCalled();
    expect(mocks.getShutdownMetrics).not.toHaveBeenCalled();
  });

  it("retries a section whose refresh failed at an unchanged version", async () => {
    const store = await loadEverything();
    mocks.checkSessionFreshness.mockResolvedValue(versioned("v1"));
    mocks.getShutdownMetrics.mockRejectedValueOnce(new Error("busy"));
    await store.refreshIfSourceChanged();
    expect(store.metricsError).toBe("busy");

    vi.clearAllMocks();
    mocks.getShutdownMetrics.mockResolvedValue({ totalPremiumRequests: 7 });
    await store.refreshIfSourceChanged();
    expect(mocks.getShutdownMetrics).toHaveBeenCalledTimes(1);
    expect(mocks.getSessionDetail).not.toHaveBeenCalled();
    expect(store.shutdownMetrics).toEqual({ totalPremiumRequests: 7 });
  });
});
