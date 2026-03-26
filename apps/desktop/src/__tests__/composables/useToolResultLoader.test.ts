import { ref, nextTick } from "vue";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useToolResultLoader } from "@/composables/useToolResultLoader";
import { getToolResult } from "@tracepilot/client";

vi.mock("@tracepilot/client", () => ({
  getToolResult: vi.fn(),
}));

const mockGetToolResult = vi.mocked(getToolResult);

describe("useToolResultLoader", () => {
  beforeEach(() => {
    mockGetToolResult.mockReset();
  });

  it("stores both raw and formatted full results", async () => {
    const sessionId = ref("s1");
    const loader = useToolResultLoader(() => sessionId.value);
    const payload = { content: "hello", extra: 1 };
    mockGetToolResult.mockResolvedValue(payload);

    await loader.loadFullResult("tc1");

    const formatted = loader.fullResults.get("tc1");
    expect(typeof formatted).toBe("string");
    expect(formatted).toContain("hello");
    const data = loader.fullResultData.get("tc1");
    expect(data?.formatted).toBe(formatted);
    expect(data?.raw).toEqual(payload);
  });

  it("drops stale responses when session changes mid-request", async () => {
    const sessionId = ref("s1");
    const loader = useToolResultLoader(() => sessionId.value);

    let resolveResult: ((v: unknown) => void) | undefined;
    mockGetToolResult.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResult = resolve;
        }),
    );

    const loadPromise = loader.loadFullResult("tc2");
    sessionId.value = "s2";
    await nextTick(); // clear triggered by watch
    resolveResult?.("late value");
    await loadPromise;

    expect(loader.fullResults.size).toBe(0);
    expect(loader.fullResultData.size).toBe(0);
    expect(loader.failedResults.has("tc2")).toBe(false);
    expect(loader.loadingResults.has("tc2")).toBe(false);
  });

  it("marks failures without retaining stale data", async () => {
    const sessionId = ref("s1");
    const loader = useToolResultLoader(() => sessionId.value);
    mockGetToolResult.mockRejectedValue(new Error("boom"));

    await loader.loadFullResult("tc3");

    expect(loader.failedResults.has("tc3")).toBe(true);
    expect(loader.fullResults.has("tc3")).toBe(false);
    expect(loader.fullResultData.has("tc3")).toBe(false);
    expect(loader.loadingResults.has("tc3")).toBe(false);
  });
});
