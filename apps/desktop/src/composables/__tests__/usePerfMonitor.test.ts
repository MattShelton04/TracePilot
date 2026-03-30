import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPerfLog, dumpPerfSummary, getPerfLog, getSlowEntries } from "../usePerfMonitor";

// usePerfMonitor itself requires a Vue component lifecycle context (getCurrentInstance),
// so we test the exported utility functions directly.

describe("usePerfMonitor utilities", () => {
  beforeEach(() => {
    clearPerfLog();
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

  it("dumpPerfSummary calls console.table", () => {
    const spy = vi.spyOn(console, "table").mockImplementation(() => {});
    dumpPerfSummary();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
