/**
 * Tests for AbortSignal + timeout support on `invokePlugin` / `createInvoke`.
 * Wave 53 — see packages/client/src/invoke.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the Tauri core module with a controllable invoke mock.
const tauriInvokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => tauriInvokeMock(...args),
}));

import { clearIpcPerfLog, createInvoke, getIpcPerfLog, invokePlugin } from "../invoke.js";

function setTauri(enabled: boolean): void {
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  if (enabled) {
    g.window = { __TAURI_INTERNALS__: {} };
  } else {
    delete g.window;
  }
}

describe("invoke cancellation / timeout", () => {
  beforeEach(() => {
    tauriInvokeMock.mockReset();
    clearIpcPerfLog();
    setTauri(true);
  });

  afterEach(() => {
    setTauri(false);
  });

  it("rejects immediately when signal is already aborted", async () => {
    tauriInvokeMock.mockResolvedValue("should-not-be-returned");
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(invokePlugin("list_sessions", {}, { signal: ctrl.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    // Tauri invoke must not have been called in the pre-aborted fast path.
    expect(tauriInvokeMock).not.toHaveBeenCalled();

    const log = getIpcPerfLog();
    expect(log.at(-1)).toMatchObject({ cmd: "list_sessions", failed: true });
  });

  it("rejects with AbortError when the signal aborts mid-flight", async () => {
    // Never-resolving promise simulates a long-running Tauri call.
    tauriInvokeMock.mockImplementation(() => new Promise(() => {}));
    const ctrl = new AbortController();

    const pending = invokePlugin("list_sessions", {}, { signal: ctrl.signal });
    // Abort after microtask flush so the race handler is wired up.
    await Promise.resolve();
    ctrl.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(getIpcPerfLog().at(-1)).toMatchObject({ cmd: "list_sessions", failed: true });
  });

  it("rejects with TimeoutError after timeoutMs elapses", async () => {
    vi.useFakeTimers();
    try {
      tauriInvokeMock.mockImplementation(() => new Promise(() => {}));
      const pending = invokePlugin("list_sessions", {}, { timeoutMs: 25 });
      // Attach catch handler synchronously to avoid unhandled rejection noise.
      const assertion = expect(pending).rejects.toMatchObject({
        name: "TimeoutError",
        message: "IPC timeout after 25ms",
      });
      await vi.advanceTimersByTimeAsync(30);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
    expect(getIpcPerfLog().at(-1)).toMatchObject({ cmd: "list_sessions", failed: true });
  });

  it("passes through the success path unchanged when no options supplied", async () => {
    tauriInvokeMock.mockResolvedValue({ hello: "world" });
    const result = await invokePlugin<{ hello: string }>("list_sessions", { a: 1 });
    expect(result).toEqual({ hello: "world" });
    expect(tauriInvokeMock).toHaveBeenCalledWith("plugin:tracepilot|list_sessions", { a: 1 });
    expect(getIpcPerfLog().at(-1)).toMatchObject({ cmd: "list_sessions", failed: false });
  });

  it("createInvoke honours a pre-aborted signal in mock-fallback mode", async () => {
    setTauri(false);
    const fallback = vi.fn(() => "mock");
    const invoke = createInvoke("test", fallback as never);
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(invoke("list_sessions", {}, { signal: ctrl.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fallback).not.toHaveBeenCalled();
  });
});
