import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLongTaskObserver, stopLongTaskObserver } from "@/utils/longTaskObserver";
import * as logger from "@/utils/logger";

vi.mock("@/utils/logger", () => ({
  logWarn: vi.fn(),
}));

const mockPerformanceObserver = vi.fn();
const mockDisconnect = vi.fn();
const mockObserve = vi.fn();

mockPerformanceObserver.mockImplementation((callback) => ({
  observe: mockObserve,
  disconnect: mockDisconnect,
  callback,
}));

vi.stubGlobal("PerformanceObserver", mockPerformanceObserver);

describe("longTaskObserver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the internal observer state before each test
    stopLongTaskObserver();
  });

  afterEach(() => {
    stopLongTaskObserver();
  });

  it("should not start if PerformanceObserver is not defined", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    startLongTaskObserver();
    expect(mockPerformanceObserver).not.toHaveBeenCalled();
    vi.stubGlobal("PerformanceObserver", mockPerformanceObserver); // Restore
  });

  it("should create a PerformanceObserver and start observing", () => {
    startLongTaskObserver();
    expect(mockPerformanceObserver).toHaveBeenCalledOnce();
    expect(mockObserve).toHaveBeenCalledWith({ type: "longtask", buffered: false });
  });

  it("should not create a new observer if one is already active", () => {
    startLongTaskObserver();
    startLongTaskObserver();
    expect(mockPerformanceObserver).toHaveBeenCalledOnce();
  });

  it("should log a warning for long tasks", () => {
    const loggerSpy = vi.spyOn(logger, "logWarn");
    startLongTaskObserver();

    const entries = [{ duration: 60, name: "test", startTime: 100 }];
    const list = { getEntries: () => entries };

    // Manually trigger the callback
    const observerInstance = mockPerformanceObserver.mock.results[0].value;
    observerInstance.callback(list);

    expect(loggerSpy).toHaveBeenCalledOnce();
    expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining("[perf] Long task"));
  });

  it("should not log a warning for short tasks", () => {
    const loggerSpy = vi.spyOn(logger, "logWarn");
    startLongTaskObserver();

    const entries = [{ duration: 40, name: "test", startTime: 100 }];
    const list = { getEntries: () => entries };

    const observerInstance = mockPerformanceObserver.mock.results[0].value;
    observerInstance.callback(list);

    expect(loggerSpy).not.toHaveBeenCalled();
  });

  it("stopLongTaskObserver should disconnect the observer", () => {
    startLongTaskObserver();
    stopLongTaskObserver();
    expect(mockDisconnect).toHaveBeenCalledOnce();
  });

  it("stopLongTaskObserver should do nothing if observer is not active", () => {
    stopLongTaskObserver();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });
});
