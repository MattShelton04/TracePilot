/**
 * Tests for Wave 60: explicit `enablePerfTracing` / `disablePerfTracing`
 * replaces the previous module-level side-effect in `invoke.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearIpcPerfLog,
  disablePerfTracing,
  enablePerfTracing,
  getIpcPerfLog,
} from "../invoke.js";

type PerfTarget = Record<string, unknown> & {
  __TRACEPILOT_IPC_PERF__?: {
    getIpcPerfLog: typeof getIpcPerfLog;
    clearIpcPerfLog: typeof clearIpcPerfLog;
  };
};

describe("enablePerfTracing / disablePerfTracing", () => {
  afterEach(() => {
    disablePerfTracing();
  });

  it("does not install the hook as a module side-effect", () => {
    // Fresh import above should not have mutated globalThis.
    expect(
      (globalThis as PerfTarget).__TRACEPILOT_IPC_PERF__,
    ).toBeUndefined();
  });

  it("installs the hook on an explicit target", () => {
    const target = {} as PerfTarget;
    enablePerfTracing(target as unknown as typeof globalThis);
    expect(target.__TRACEPILOT_IPC_PERF__).toBeDefined();
    expect(typeof target.__TRACEPILOT_IPC_PERF__?.getIpcPerfLog).toBe("function");
    expect(typeof target.__TRACEPILOT_IPC_PERF__?.clearIpcPerfLog).toBe("function");
  });

  it("is idempotent: preserves an existing contract-compatible hook", () => {
    const target = {} as PerfTarget;
    const existing = { getIpcPerfLog, clearIpcPerfLog };
    target.__TRACEPILOT_IPC_PERF__ = existing;
    enablePerfTracing(target as unknown as typeof globalThis);
    expect(target.__TRACEPILOT_IPC_PERF__).toBe(existing);
  });

  it("replaces a non-conforming value on the target", () => {
    const target = { __TRACEPILOT_IPC_PERF__: 42 } as unknown as PerfTarget;
    enablePerfTracing(target as unknown as typeof globalThis);
    expect(target.__TRACEPILOT_IPC_PERF__).toMatchObject({
      getIpcPerfLog: expect.any(Function),
      clearIpcPerfLog: expect.any(Function),
    });
  });

  it("disablePerfTracing removes the hook", () => {
    const target = {} as PerfTarget;
    enablePerfTracing(target as unknown as typeof globalThis);
    expect(target.__TRACEPILOT_IPC_PERF__).toBeDefined();
    disablePerfTracing(target as unknown as typeof globalThis);
    expect(target.__TRACEPILOT_IPC_PERF__).toBeUndefined();
  });
});
