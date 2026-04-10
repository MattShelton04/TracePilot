import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDebug = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockInfo = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockWarn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockError = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockTrace = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockDetach = vi.fn();
const mockAttachConsole = vi.fn<() => Promise<() => void>>().mockResolvedValue(mockDetach);

vi.mock("@tauri-apps/plugin-log", () => ({
  debug: mockDebug,
  info: mockInfo,
  warn: mockWarn,
  error: mockError,
  trace: mockTrace,
  attachConsole: mockAttachConsole,
}));

async function importLogger() {
  return import("@/utils/logger");
}

async function importLoggerInTauriMode() {
  // `isTauri` is computed at module evaluation time, so each Tauri-path test
  // needs a fresh module instance after setting the global.
  vi.resetModules();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true,
  });
  return importLogger();
}

function removeTauriGlobal() {
  // @ts-expect-error test-only Tauri global
  delete window.__TAURI_INTERNALS__;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
  removeTauriGlobal();
  mockDebug.mockResolvedValue(undefined);
  mockInfo.mockResolvedValue(undefined);
  mockWarn.mockResolvedValue(undefined);
  mockError.mockResolvedValue(undefined);
  mockTrace.mockResolvedValue(undefined);
  mockAttachConsole.mockResolvedValue(mockDetach);
});

afterEach(() => {
  removeTauriGlobal();
  vi.resetModules();
});

describe("stringifyExtra", () => {
  it("returns string as-is", async () => {
    const { stringifyExtra } = await importLogger();
    expect(stringifyExtra("hello")).toBe("hello");
  });

  it("serializes Error with stack", async () => {
    const { stringifyExtra } = await importLogger();
    const err = new Error("test error");
    const result = stringifyExtra(err);
    expect(result).toContain("test error");
    expect(result).toContain("Error: test error");
  });

  it("serializes Error without stack", async () => {
    const { stringifyExtra } = await importLogger();
    const err = new Error("no stack");
    err.stack = undefined;
    expect(stringifyExtra(err)).toBe("no stack");
  });

  it("serializes objects as JSON", async () => {
    const { stringifyExtra } = await importLogger();
    const obj = { foo: "bar", count: 42 };
    expect(stringifyExtra(obj)).toBe('{"foo":"bar","count":42}');
  });

  it("serializes numbers", async () => {
    const { stringifyExtra } = await importLogger();
    expect(stringifyExtra(42)).toBe("42");
  });

  it("serializes null", async () => {
    const { stringifyExtra } = await importLogger();
    expect(stringifyExtra(null)).toBe("null");
  });

  it("serializes undefined", async () => {
    const { stringifyExtra } = await importLogger();
    expect(stringifyExtra(undefined)).toBe("undefined");
  });

  it("handles circular references gracefully", async () => {
    const { stringifyExtra } = await importLogger();
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(stringifyExtra(obj)).toBe("[object Object]");
  });

  it("handles objects with throwing toString()", async () => {
    const { stringifyExtra } = await importLogger();
    const evil = {
      toString() {
        throw new Error("boom");
      },
      toJSON() {
        throw new Error("boom");
      },
    };
    expect(stringifyExtra(evil)).toBe("[unserializable]");
  });

  it("serializes symbols via String() fallback", async () => {
    const { stringifyExtra } = await importLogger();
    expect(stringifyExtra(Symbol("test"))).toBe("Symbol(test)");
  });
});

describe("logError / logWarn / logInfo / logDebug (non-Tauri)", () => {
  it("logError calls console.error with all arguments", async () => {
    const { logError } = await importLogger();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("test");
    logError("prefix:", err);
    expect(spy).toHaveBeenCalledWith("prefix:", err);
    expect(mockError).not.toHaveBeenCalled();
  });

  it("logWarn calls console.warn with all arguments", async () => {
    const { logWarn } = await importLogger();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("[test] something went wrong", { detail: 1 });
    expect(spy).toHaveBeenCalledWith("[test] something went wrong", { detail: 1 });
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("logInfo calls console.info", async () => {
    const { logInfo } = await importLogger();
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logInfo("info message");
    expect(spy).toHaveBeenCalledWith("info message");
    expect(mockInfo).not.toHaveBeenCalled();
  });

  it("logDebug calls console.debug", async () => {
    const { logDebug } = await importLogger();
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    logDebug("debug message");
    expect(spy).toHaveBeenCalledWith("debug message");
    expect(mockDebug).not.toHaveBeenCalled();
  });

  it("logError does not double-log in non-Tauri mode", async () => {
    const { logError } = await importLogger();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("test message");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("logWarn does not double-log in non-Tauri mode", async () => {
    const { logWarn } = await importLogger();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("test message");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("facade function signatures", () => {
  it("logError and logWarn are assignable to the same variable type", async () => {
    const { logError, logWarn } = await importLogger();
    const logFn: (msg: string, ...extra: unknown[]) => void = logError;
    expect(typeof logFn).toBe("function");

    const logFn2: (msg: string, ...extra: unknown[]) => void = logWarn;
    expect(typeof logFn2).toBe("function");
  });
});

describe("logging facades (Tauri mode)", () => {
  it("logInfo calls console.info and dispatches to backend", async () => {
    const { logInfo } = await importLoggerInTauriMode();
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    logInfo("hello", { world: true });

    expect(consoleSpy).toHaveBeenCalledWith("hello", { world: true });
    await vi.waitFor(() => {
      expect(mockInfo).toHaveBeenCalledWith('hello {"world":true}');
    });
  });

  it("logError calls console.error and dispatches to backend", async () => {
    const { logError } = await importLoggerInTauriMode();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logError("critical failure", new Error("boom"));

    expect(consoleSpy).toHaveBeenCalledWith("critical failure", expect.any(Error));
    await vi.waitFor(() => {
      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining("critical failure Error: boom"),
      );
    });
  });

  it("reports backend failure once per streak with diagnostic metadata", async () => {
    const { logWarn } = await importLoggerInTauriMode();
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockWarn.mockRejectedValueOnce(new Error("write failed"));
    mockWarn.mockRejectedValueOnce(new Error("write failed again"));

    logWarn("first message");
    await vi.waitFor(() => {
      expect(
        consoleWarnSpy.mock.calls.some(
          ([message]) =>
            message ===
            "[TracePilot] Failed to write frontend log to backend. Further backend log errors will be suppressed until a write succeeds.",
        ),
      ).toBe(true);
    });
    logWarn("second message");
    await vi.waitFor(() => {
      expect(mockWarn).toHaveBeenCalledTimes(2);
    });

    const fallbackCalls = consoleWarnSpy.mock.calls.filter(
      ([message]) =>
        message ===
        "[TracePilot] Failed to write frontend log to backend. Further backend log errors will be suppressed until a write succeeds.",
    );

    expect(fallbackCalls).toHaveLength(1);
    expect(fallbackCalls[0]?.[1]).toMatchObject({
      originalLevel: "warn",
      originalMessage: "first message",
    });
    expect((fallbackCalls[0]?.[1] as { error: Error }).error).toBeInstanceOf(Error);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(3);
  });

  it("resets failure suppression after a successful write", async () => {
    const { logWarn } = await importLoggerInTauriMode();
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockWarn.mockRejectedValueOnce(new Error("first fail"));
    mockWarn.mockResolvedValueOnce(undefined);
    mockWarn.mockRejectedValueOnce(new Error("second fail"));

    logWarn("message 1");
    await vi.waitFor(() => {
      expect(mockWarn).toHaveBeenCalledTimes(1);
    });
    logWarn("message 2");
    await vi.waitFor(() => {
      expect(mockWarn).toHaveBeenCalledTimes(2);
    });
    logWarn("message 3");
    await vi.waitFor(() => {
      expect(mockWarn).toHaveBeenCalledTimes(3);
    });

    const fallbackCalls = consoleWarnSpy.mock.calls.filter(
      ([message]) =>
        message ===
        "[TracePilot] Failed to write frontend log to backend. Further backend log errors will be suppressed until a write succeeds.",
    );

    expect(fallbackCalls).toHaveLength(2);
    expect(fallbackCalls[0]?.[1]).toMatchObject({ originalMessage: "message 1" });
    expect(fallbackCalls[1]?.[1]).toMatchObject({ originalMessage: "message 3" });
    expect(consoleWarnSpy).toHaveBeenCalledTimes(5);
  });
});

describe("initLogging / teardownLogging", () => {
  it("optionally attaches the backend console bridge and tears it down idempotently", async () => {
    const { initLogging, teardownLogging } = await importLoggerInTauriMode();

    await initLogging({ attachConsole: true });
    expect(mockAttachConsole).toHaveBeenCalledTimes(1);

    teardownLogging();
    teardownLogging();
    expect(mockDetach).toHaveBeenCalledTimes(1);
  });
});
