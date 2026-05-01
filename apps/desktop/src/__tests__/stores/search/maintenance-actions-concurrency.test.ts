// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { setupPinia } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { mocks, resetAllMocks, setupDefaultMocks } from "./setup";
import { useSearchStore } from "../../../stores/search";

describe("useSearchStore – FTS maintenance concurrency", () => {
  beforeEach(() => {
    setupPinia();
    resetAllMocks();
    setupDefaultMocks();
  });

  it("runIntegrityCheck: concurrent calls deduplicate and only latest result is written", async () => {
    let resolveFirst: (value: string) => void;
    let resolveSecond: (value: string) => void;
    const firstPromise = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });

    mocks.ftsIntegrityCheck.mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

    const store = useSearchStore();

    const call1 = store.runIntegrityCheck();
    const call2 = store.runIntegrityCheck();

    // Resolve newer call first
    resolveSecond!("integrity check passed - 0 errors");
    await call2;
    expect(store.maintenanceMessage).toBe("integrity check passed - 0 errors");

    // Resolve older call (should be ignored)
    resolveFirst!("stale result - 5 warnings");
    await call1;

    // Verify stale result did NOT overwrite newer result
    expect(store.maintenanceMessage).toBe("integrity check passed - 0 errors");
  });

  it("runIntegrityCheck: stale error does not overwrite newer successful result", async () => {
    let resolveSecond: (value: string) => void;
    let rejectFirst: (reason?: unknown) => void;
    const firstPromise = new Promise<string>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const secondPromise = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });

    mocks.ftsIntegrityCheck.mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

    const store = useSearchStore();

    const call1 = store.runIntegrityCheck();
    const call2 = store.runIntegrityCheck();

    // Resolve second (newer) call with success
    resolveSecond!("integrity ok");
    await call2;
    expect(store.maintenanceMessage).toBe("integrity ok");

    // Reject first (older) call (should be ignored)
    rejectFirst!(new Error("database locked"));
    await call1;

    // Verify stale error did NOT overwrite successful result
    expect(store.maintenanceMessage).toBe("integrity ok");
  });

  it("runOptimize: concurrent calls deduplicate and only latest result is written", async () => {
    let resolveFirst: (value: string) => void;
    let resolveSecond: (value: string) => void;
    const firstPromise = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });

    mocks.ftsOptimize.mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);
    mocks.ftsHealth.mockResolvedValue({
      inSync: true,
      indexedSessions: 10,
      totalSessions: 10,
      totalContentRows: 100,
      pendingSessions: 0,
      dbSizeBytes: 1024,
    });

    const store = useSearchStore();

    const call1 = store.runOptimize();
    const call2 = store.runOptimize();

    // Resolve newer call first
    resolveSecond!("optimized 200 pages");
    await call2;
    expect(store.maintenanceMessage).toBe("optimized 200 pages");

    // Resolve older call (should be ignored)
    resolveFirst!("stale - optimized 100 pages");
    await call1;

    // Verify stale result did NOT overwrite newer result
    expect(store.maintenanceMessage).toBe("optimized 200 pages");
  });

  it("runOptimize: stale error does not overwrite newer successful result", async () => {
    let resolveSecond: (value: string) => void;
    let rejectFirst: (reason?: unknown) => void;
    const firstPromise = new Promise<string>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const secondPromise = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });

    mocks.ftsOptimize.mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);
    mocks.ftsHealth.mockResolvedValue({
      inSync: true,
      indexedSessions: 10,
      totalSessions: 10,
      totalContentRows: 100,
      pendingSessions: 0,
      dbSizeBytes: 1024,
    });

    const store = useSearchStore();

    const call1 = store.runOptimize();
    const call2 = store.runOptimize();

    // Resolve second (newer) call with success
    resolveSecond!("optimize complete");
    await call2;
    expect(store.maintenanceMessage).toBe("optimize complete");

    // Reject first (older) call (should be ignored)
    rejectFirst!(new Error("write conflict"));
    await call1;

    // Verify stale error did NOT overwrite successful result
    expect(store.maintenanceMessage).toBe("optimize complete");
  });

  it("runOptimize: fetchHealth() is called after successful optimize regardless of staleness", async () => {
    mocks.ftsOptimize.mockResolvedValue("done");
    mocks.ftsHealth.mockResolvedValue({
      inSync: true,
      indexedSessions: 10,
      totalSessions: 10,
      totalContentRows: 100,
      pendingSessions: 0,
      dbSizeBytes: 1024,
    });

    const store = useSearchStore();

    await store.runOptimize();

    // Verify fetchHealth was called to refresh health info
    expect(mocks.ftsHealth).toHaveBeenCalledTimes(1);
  });

  it("runOptimize: fetchHealth() is NOT called when optimize fails", async () => {
    mocks.ftsOptimize.mockRejectedValue(new Error("failed"));

    const store = useSearchStore();

    await store.runOptimize();

    // Verify fetchHealth was NOT called since optimize failed
    expect(mocks.ftsHealth).not.toHaveBeenCalled();
  });
});
