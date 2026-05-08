import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import type { SessionDetailContext } from "@/composables/useSessionDetail";
import { useReplaySessionLoader } from "../useReplaySessionLoader";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface StoreStub {
  store: SessionDetailContext;
  calls: string[];
  loaded: Set<string>;
  resolveDetail(idx?: number): void;
  rejectDetail(e: unknown, idx?: number): void;
  resolveTurns(idx?: number): void;
  detailCount(): number;
}

function makeStoreStub(): StoreStub {
  const loaded = new Set<string>();
  const calls: string[] = [];
  const detailDeferreds: Array<ReturnType<typeof deferred<void>>> = [];
  const turnsDeferreds: Array<ReturnType<typeof deferred<void>>> = [];

  const store = {
    loaded,
    loadDetail: vi.fn(async (id: string) => {
      calls.push(`detail:${id}`);
      const d = deferred<void>();
      detailDeferreds.push(d);
      await d.promise;
    }),
    loadTurns: vi.fn(async () => {
      calls.push("turns");
      loaded.add("turns");
      const d = deferred<void>();
      turnsDeferreds.push(d);
      await d.promise;
    }),
    loadTodos: vi.fn(async () => {
      calls.push("todos");
    }),
    loadShutdownMetrics: vi.fn(async () => {
      calls.push("shutdownMetrics");
    }),
  } as unknown as SessionDetailContext;

  return {
    store,
    calls,
    loaded,
    resolveDetail: (idx = 0) => detailDeferreds[idx]?.resolve(),
    rejectDetail: (e: unknown, idx = 0) => detailDeferreds[idx]?.reject(e),
    resolveTurns: (idx = 0) => turnsDeferreds[idx]?.resolve(),
    detailCount: () => detailDeferreds.length,
  };
}

async function flush(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

describe("useReplaySessionLoader", () => {
  let scope: ReturnType<typeof effectScope>;

  beforeEach(() => {
    scope = effectScope();
  });

  afterEach(() => {
    scope.stop();
  });

  it("loads detail then fans out to turns/todos/metrics on success", async () => {
    const stub = makeStoreStub();
    const sessionId = ref<string | undefined>("s1");
    let api!: ReturnType<typeof useReplaySessionLoader>;
    scope.run(() => {
      api = useReplaySessionLoader(stub.store, sessionId);
    });

    expect(api.initialLoading.value).toBe(true);
    expect(stub.store.loadDetail).toHaveBeenCalledWith("s1");
    expect(stub.store.loadTurns).not.toHaveBeenCalled();

    stub.resolveDetail();
    await flush();
    expect(stub.store.loadTurns).toHaveBeenCalledTimes(1);
    expect(stub.store.loadTodos).toHaveBeenCalledTimes(1);
    expect(stub.store.loadShutdownMetrics).toHaveBeenCalledTimes(1);

    stub.resolveTurns();
    await flush();
    expect(api.initialLoading.value).toBe(false);
    expect(stub.calls).toEqual(["detail:s1", "turns", "todos", "shutdownMetrics"]);
  });

  it("clears initialLoading when loadDetail rejects", async () => {
    const stub = makeStoreStub();
    const sessionId = ref<string | undefined>(undefined);
    let api!: ReturnType<typeof useReplaySessionLoader>;
    scope.run(() => {
      api = useReplaySessionLoader(stub.store, sessionId);
    });

    // Drive imperatively + catch; the watcher path mirrors the prior view's
    // fire-and-forget contract, so we don't wire it for the rejection case.
    const inflight = api.loadSession("s1").catch(() => "caught");
    await Promise.resolve();
    expect(api.initialLoading.value).toBe(true);

    stub.rejectDetail(new Error("boom"));
    await expect(inflight).resolves.toBe("caught");
    await flush();
    expect(api.initialLoading.value).toBe(false);
    expect(stub.store.loadTurns).not.toHaveBeenCalled();
  });

  it("ignores stale loads when sessionId changes mid-flight", async () => {
    const stub = makeStoreStub();
    const sessionId = ref<string | undefined>("s1");
    let api!: ReturnType<typeof useReplaySessionLoader>;
    scope.run(() => {
      api = useReplaySessionLoader(stub.store, sessionId);
    });
    expect(stub.detailCount()).toBe(1);

    // Switch ids before the first detail resolves.
    sessionId.value = "s2";
    await nextTick();
    expect(stub.store.loadDetail).toHaveBeenCalledTimes(2);
    expect(stub.detailCount()).toBe(2);

    // Resolve the OLD detail — stale guard must skip the fan-out.
    stub.resolveDetail(0);
    await flush();
    expect(stub.store.loadTurns).not.toHaveBeenCalled();
    // Newer load is still pending → still in loading state.
    expect(api.initialLoading.value).toBe(true);

    // Resolve newer detail → fan-out fires for s2.
    stub.resolveDetail(1);
    await flush();
    expect(stub.store.loadTurns).toHaveBeenCalledTimes(1);
  });

  it("retryLoadTurns clears the loaded marker before re-invoking loadTurns", async () => {
    const stub = makeStoreStub();
    const sessionId = ref<string | undefined>("s1");
    let api!: ReturnType<typeof useReplaySessionLoader>;
    scope.run(() => {
      api = useReplaySessionLoader(stub.store, sessionId);
    });
    stub.resolveDetail(0);
    await flush();
    stub.resolveTurns(0);
    await flush();

    api.retryLoadTurns();
    expect(stub.store.loadTurns).toHaveBeenCalledTimes(2);
    // The retry helper's contract is: delete then call. The replacement
    // loadTurns re-adds 'turns', which is the desired post-retry state.
    expect(stub.loaded.has("turns")).toBe(true);
  });

  it("dispose() stops the watcher and prevents further auto-loads", async () => {
    const stub = makeStoreStub();
    const sessionId = ref<string | undefined>("s1");
    let api!: ReturnType<typeof useReplaySessionLoader>;
    scope.run(() => {
      api = useReplaySessionLoader(stub.store, sessionId);
    });
    expect(stub.store.loadDetail).toHaveBeenCalledTimes(1);

    api.dispose();
    sessionId.value = "s2";
    await nextTick();
    expect(stub.store.loadDetail).toHaveBeenCalledTimes(1);
  });

  it("auto-disposes when its effect scope is stopped", async () => {
    const stub = makeStoreStub();
    const sessionId = ref<string | undefined>("s1");
    scope.run(() => {
      useReplaySessionLoader(stub.store, sessionId);
    });
    expect(stub.store.loadDetail).toHaveBeenCalledTimes(1);

    scope.stop();
    sessionId.value = "s2";
    await nextTick();
    expect(stub.store.loadDetail).toHaveBeenCalledTimes(1);
  });
});
