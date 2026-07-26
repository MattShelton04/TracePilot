import { getToolResult } from "@tracepilot/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import {
  TOOL_RESULT_CACHE_MAX_ENTRIES,
  useToolResultLoader,
} from "@/composables/useToolResultLoader";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    getToolResult: vi.fn(),
  });
});

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
    expect(formatted).toBe("hello");
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

  it("evicts least-recently-used results at the entry limit", async () => {
    const sessionId = ref("s1");
    const loader = useToolResultLoader(() => sessionId.value);
    mockGetToolResult.mockImplementation(async (_sessionId, toolCallId) => ({
      content: toolCallId,
    }));

    for (let i = 0; i <= TOOL_RESULT_CACHE_MAX_ENTRIES; i++) {
      await loader.loadFullResult(`tc-${i}`);
    }

    expect(loader.fullResults.size).toBe(TOOL_RESULT_CACHE_MAX_ENTRIES);
    expect(loader.fullResultData.size).toBe(TOOL_RESULT_CACHE_MAX_ENTRIES);
    expect(loader.fullResults.has("tc-0")).toBe(false);
    expect(loader.fullResults.has(`tc-${TOOL_RESULT_CACHE_MAX_ENTRIES}`)).toBe(true);
  });
});
