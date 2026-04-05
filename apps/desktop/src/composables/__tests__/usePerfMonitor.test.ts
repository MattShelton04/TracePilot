import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPerfLog, dumpPerfSummary, getPerfLog, getSlowEntries } from "../usePerfMonitor";
import * as logger from "@/utils/logger";

// usePerfMonitor itself requires a Vue component lifecycle context (getCurrentInstance),
// so we test the exported utility functions directly.

vi.mock("@/utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

describe("usePerfMonitor utilities", () => {
  beforeEach(() => {
    clearPerfLog();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("clearPerfLog empties the log", () => {
    // getPerfLog returns a readonly array reference — clearing should empty it
    expect(getPerfLog().length).toBe(0);
  });

  it("getSlowEntries returns empty when log is empty", () => {
    expect(getSlowEntries()).toEqual([]);
    expect(getSlowEntries(10)).toEqual([]);
  });

  it("dumpPerfSummary does not throw on empty log", () => {
    const spy = vi.spyOn(console, "table").mockImplementation(() => {});
    expect(() => dumpPerfSummary()).not.toThrow();
    spy.mockRestore();
  });

  it("dumpPerfSummary calls console.table and logger", () => {
    const consoleSpy = vi.spyOn(console, "table").mockImplementation(() => {});
    const loggerSpy = vi.spyOn(logger, "logInfo");

    dumpPerfSummary();

    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(loggerSpy).toHaveBeenCalledOnce();
    expect(loggerSpy).toHaveBeenCalledWith("[perf] Performance summary", []);

    consoleSpy.mockRestore();
  });
});
