import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import * as logger from "@/utils/logger";
import {
  clearPerfLog,
  dumpPerfSummary,
  getPerfLog,
  getSlowEntries,
  usePerfMonitor,
} from "../usePerfMonitor";

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
    expect(loggerSpy).toHaveBeenCalledWith("[perf] Performance summary", {
      totalGroups: 0,
      shownGroups: 0,
      entries: [],
    });

    consoleSpy.mockRestore();
  });

  it("caps serialized summary entries at 20 groups", () => {
    const loggerSpy = vi.spyOn(logger, "logInfo");
    const perfLog = getPerfLog() as unknown as Array<{
      name: string;
      duration: number;
      timestamp: number;
    }>;
    for (let i = 0; i < 25; i++) {
      perfLog.push({
        name: `Comp${i}:mount`,
        duration: 50 + i,
        timestamp: i,
      });
    }

    dumpPerfSummary();

    expect(loggerSpy).toHaveBeenCalledOnce();
    expect(loggerSpy).toHaveBeenCalledWith(
      "[perf] Performance summary",
      expect.objectContaining({
        totalGroups: 25,
        shownGroups: 20,
        entries: expect.any(Array),
      }),
    );
    const payload = loggerSpy.mock.calls[0]?.[1] as { entries: unknown[] };
    expect(payload.entries).toHaveLength(20);
  });

  it("logs slow mount warnings through logger facade", async () => {
    const loggerSpy = vi.spyOn(logger, "logWarn");
    const perfNowSpy = vi.spyOn(performance, "now");
    let now = 0;
    perfNowSpy.mockImplementation(() => {
      now += 100;
      return now;
    });

    const TestComponent = defineComponent({
      setup() {
        usePerfMonitor("SlowComponent");
        return () => null;
      },
    });

    mount(TestComponent);
    await nextTick();

    expect(loggerSpy).toHaveBeenCalledOnce();
    expect(loggerSpy.mock.calls[0]?.[0]).toMatch(
      /^\[perf\] Slow mount: SlowComponent took \d+\.\dms$/,
    );

    perfNowSpy.mockRestore();
  });
});
