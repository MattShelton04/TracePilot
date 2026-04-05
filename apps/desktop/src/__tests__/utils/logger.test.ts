import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @tauri-apps/plugin-log BEFORE importing the logger
const mockDebug = vi.fn().mockResolvedValue(undefined);
const mockInfo = vi.fn().mockResolvedValue(undefined);
const mockWarn = vi.fn().mockResolvedValue(undefined);
const mockError = vi.fn().mockResolvedValue(undefined);
const mockTrace = vi.fn().mockResolvedValue(undefined);
const mockAttachConsole = vi.fn().mockResolvedValue(() => {});

vi.mock("@tauri-apps/plugin-log", () => ({
  debug: mockDebug,
  info: mockInfo,
  warn: mockWarn,
  error: mockError,
  trace: mockTrace,
  attachConsole: mockAttachConsole,
}));

import { stringifyExtra } from "@/utils/logger";

describe("stringifyExtra", () => {
  it("returns string as-is", () => {
    expect(stringifyExtra("hello")).toBe("hello");
  });

  it("serializes Error with stack", () => {
    const err = new Error("test error");
    const result = stringifyExtra(err);
    expect(result).toContain("test error");
    // Stack trace should be present
    expect(result).toContain("Error: test error");
  });

  it("serializes Error without stack", () => {
    const err = new Error("no stack");
    err.stack = undefined;
    expect(stringifyExtra(err)).toBe("no stack");
  });

  it("serializes objects as JSON", () => {
    const obj = { foo: "bar", count: 42 };
    expect(stringifyExtra(obj)).toBe('{"foo":"bar","count":42}');
  });

  it("serializes numbers", () => {
    expect(stringifyExtra(42)).toBe("42");
  });

  it("serializes null", () => {
    expect(stringifyExtra(null)).toBe("null");
  });

  it("serializes undefined", () => {
    expect(stringifyExtra(undefined)).toBe("undefined");
  });

  it("handles circular references gracefully", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    // JSON.stringify will throw, should fall back to String() → '[object Object]'
    const result = stringifyExtra(obj);
    expect(result).toBe("[object Object]");
  });

  it("handles objects with throwing toString()", () => {
    const evil = {
      toString() {
        throw new Error("boom");
      },
      toJSON() {
        throw new Error("boom");
      },
    };
    // Must not throw — logging should never crash the caller
    const result = stringifyExtra(evil);
    expect(result).toBe("[unserializable]");
  });

  it("serializes symbols via String() fallback", () => {
    const result = stringifyExtra(Symbol("test"));
    expect(result).toBe("Symbol(test)");
  });
});

describe("logError / logWarn / logInfo / logDebug (non-Tauri)", () => {
  // In the test environment, isTauri is false because __TAURI_INTERNALS__
  // is not defined. The facade functions should call console.* but NOT
  // call the async backend logging functions.

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("logError calls console.error with all arguments", async () => {
    const { logError } = await import("@/utils/logger");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("test");
    logError("prefix:", err);
    expect(spy).toHaveBeenCalledWith("prefix:", err);
    spy.mockRestore();
  });

  it("logWarn calls console.warn with all arguments", async () => {
    const { logWarn } = await import("@/utils/logger");
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("[test] something went wrong", { detail: 1 });
    expect(spy).toHaveBeenCalledWith("[test] something went wrong", { detail: 1 });
    spy.mockRestore();
  });

  it("logInfo calls console.info", async () => {
    const { logInfo } = await import("@/utils/logger");
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logInfo("info message");
    expect(spy).toHaveBeenCalledWith("info message");
    spy.mockRestore();
  });

  it("logDebug calls console.debug", async () => {
    const { logDebug } = await import("@/utils/logger");
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    logDebug("debug message");
    expect(spy).toHaveBeenCalledWith("debug message");
    spy.mockRestore();
  });

  it("logError does not double-log in non-Tauri mode", async () => {
    const { logError } = await import("@/utils/logger");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("test message");
    // Should be called exactly once (facade call), not twice (facade + fallback)
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("logWarn does not double-log in non-Tauri mode", async () => {
    const { logWarn } = await import("@/utils/logger");
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("test message");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("facade function signatures", () => {
  it("logError and logWarn are assignable to the same variable type", async () => {
    const { logError, logWarn } = await import("@/utils/logger");
    // This tests that both can be used as a dynamic logFn (as in sessionDetail.ts)
    const logFn: (msg: string, ...extra: unknown[]) => void = logError;
    expect(typeof logFn).toBe("function");

    const logFn2: (msg: string, ...extra: unknown[]) => void = logWarn;
    expect(typeof logFn2).toBe("function");
  });
});

// ── Tauri-specific tests ───────────────────────────────────────────
// By defining __TAURI_INTERNALS__, we can test the code paths that
// are only active in the Tauri environment.

describe("logging facades (Tauri mode)", () => {
  beforeEach(() => {
    // @ts-expect-error - testing Tauri-specific global
    window.__TAURI_INTERNALS__ = {};
    vi.resetModules(); // Force re-import of logger module
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // @ts-expect-error - cleanup global
    delete window.__TAURI_INTERNALS__;
    vi.resetModules();
  });

  it("logInfo calls console.info and dispatches to backend", async () => {
    const { logInfo } = await import("@/utils/logger");
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    logInfo("hello", { world: true });

    expect(consoleSpy).toHaveBeenCalledWith("hello", { world: true });
    // Wait for async dispatch to settle
    await vi.waitFor(() => {
      expect(mockInfo).toHaveBeenCalledWith('hello {"world":true}');
    });
  });

  it("logError calls console.error and dispatches to backend", async () => {
    const { logError } = await import("@/utils/logger");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logError("critical failure", new Error("boom"));

    expect(consoleSpy).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mockError).toHaveBeenCalledWith(expect.stringContaining("critical failure Error: boom"));
    });
  });

  it("reports backend failure once per streak", async () => {
    const { logWarn } = await import("@/utils/logger");
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockWarn.mockRejectedValueOnce(new Error("write failed"));

    // First call fails, should log to console
    logWarn("first message");
    await vi.waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledTimes(2); // Original call + fallback
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[TracePilot] Failed to write frontend log to backend. Further backend log errors will be suppressed until a write succeeds.",
        expect.any(Object),
      );
    });

    // Second call fails, should be suppressed
    mockWarn.mockRejectedValueOnce(new Error("write failed again"));
    logWarn("second message");
    await vi.runAllTimersAsync();

    // Should not have logged another warning
    expect(consoleWarnSpy).toHaveBeenCalledTimes(3); // Original call only
  });

  it("resets failure suppression after a successful write", async () => {
    const { logWarn } = await import("@/utils/logger");
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Fail, then succeed, then fail again
    mockWarn.mockRejectedValueOnce(new Error("first fail"));
    mockWarn.mockResolvedValueOnce(undefined);
    mockWarn.mockRejectedValueOnce(new Error("second fail"));

    // First failure
    logWarn("message 1");
    await vi.waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to write frontend log"),
        expect.any(Object),
      );
    });
    expect(consoleWarnSpy).toHaveBeenCalledTimes(2);

    // Successful write
    logWarn("message 2");
    await vi.runAllTimersAsync();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(3); // Just the "message 2" call

    // Third failure should log again
    logWarn("message 3");
    await vi.waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to write frontend log"),
        expect.any(Object),
      );
    });
    expect(consoleWarnSpy).toHaveBeenCalledTimes(5);
  });
});
