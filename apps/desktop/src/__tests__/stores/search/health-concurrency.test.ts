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

  it("fetchHealth: concurrent calls deduplicate and only latest result is written", async () => {
    // Deferred promises to control resolution order
    let resolveFirst: (value: unknown) => void;
    let resolveSecond: (value: unknown) => void;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise((resolve) => {
      resolveSecond = resolve;
    });

    mocks.ftsHealth.mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

    const store = useSearchStore();

    // Start two concurrent calls
    const call1 = store.fetchHealth();
    const call2 = store.fetchHealth();

    // Resolve second (newer) call first
    resolveSecond!({
      inSync: true,
      indexedSessions: 20,
      totalSessions: 20,
      totalContentRows: 200,
      pendingSessions: 0,
      dbSizeBytes: 2048,
    });
    await call2;

    // Verify newer result is written
    expect(store.healthInfo).toEqual({
      inSync: true,
      indexedSessions: 20,
      totalSessions: 20,
      totalContentRows: 200,
      pendingSessions: 0,
      dbSizeBytes: 2048,
    });

    // Resolve first (older) call
    resolveFirst!({
      inSync: false,
      indexedSessions: 10,
      totalSessions: 20,
      totalContentRows: 100,
      pendingSessions: 10,
      dbSizeBytes: 1024,
    });
    await call1;

    // Verify stale result did NOT overwrite newer result
    expect(store.healthInfo).toEqual({
      inSync: true,
      indexedSessions: 20,
      totalSessions: 20,
      totalContentRows: 200,
      pendingSessions: 0,
      dbSizeBytes: 2048,
    });
  });

  it("fetchHealth: stale error does not overwrite newer successful result", async () => {
    let resolveSecond: (value: unknown) => void;
    let rejectFirst: (reason?: unknown) => void;
    const firstPromise = new Promise((_resolve, reject) => {
      rejectFirst = reject;
    });
    const secondPromise = new Promise((resolve) => {
      resolveSecond = resolve;
    });

    mocks.ftsHealth.mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

    const store = useSearchStore();

    const call1 = store.fetchHealth();
    const call2 = store.fetchHealth();

    // Resolve second (newer) call with success
    resolveSecond!({
      inSync: true,
      indexedSessions: 15,
      totalSessions: 15,
      totalContentRows: 150,
      pendingSessions: 0,
      dbSizeBytes: 1536,
    });
    await call2;
    expect(store.healthInfo).toEqual({
      inSync: true,
      indexedSessions: 15,
      totalSessions: 15,
      totalContentRows: 150,
      pendingSessions: 0,
      dbSizeBytes: 1536,
    });

    // Reject first (older) call (should be ignored)
    rejectFirst!(new Error("timeout"));
    await call1.catch(() => {}); // Swallow expected rejection

    // Verify stale error did NOT clear the successful result
    expect(store.healthInfo).toEqual({
      inSync: true,
      indexedSessions: 15,
      totalSessions: 15,
      totalContentRows: 150,
      pendingSessions: 0,
      dbSizeBytes: 1536,
    });
  });

  it("fetchHealth: loading flag not cleared by stale call completion", async () => {
    let resolveFirst: (value: unknown) => void;
    let resolveSecond: (value: unknown) => void;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise((resolve) => {
      resolveSecond = resolve;
    });

    mocks.ftsHealth.mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

    const store = useSearchStore();

    const call1 = store.fetchHealth();
    expect(store.healthLoading).toBe(true);

    const call2 = store.fetchHealth();
    expect(store.healthLoading).toBe(true);

    // Resolve older call first
    resolveFirst!({
      inSync: true,
      indexedSessions: 5,
      totalSessions: 5,
      totalContentRows: 50,
      pendingSessions: 0,
      dbSizeBytes: 512,
    });
    await call1;

    // Loading flag should remain true because newer call is still pending
    expect(store.healthLoading).toBe(true);

    // Resolve newer call
    resolveSecond!({
      inSync: true,
      indexedSessions: 10,
      totalSessions: 10,
      totalContentRows: 100,
      pendingSessions: 0,
      dbSizeBytes: 1024,
    });
    await call2;

    // Now loading flag should be false
    expect(store.healthLoading).toBe(false);
    expect(store.healthInfo).toEqual({
      inSync: true,
      indexedSessions: 10,
      totalSessions: 10,
      totalContentRows: 100,
      pendingSessions: 0,
      dbSizeBytes: 1024,
    });
  });
});
