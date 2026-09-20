import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUsageSummary } from "../useUsageSummary";

beforeEach(() => localStorage.clear());

describe("definition usage ranges", () => {
  it("defaults to all time and restores a saved choice", async () => {
    const query = vi.fn().mockResolvedValue({ uses: 4 });
    const slice = createUsageSummary(query, "usage-test");
    expect(slice.range.value).toBe("all");
    await slice.loadUsage();
    expect(query).toHaveBeenLastCalledWith({ fromDate: null, toDate: null });
    await slice.setRange("30d");
    expect(createUsageSummary(query, "usage-test").range.value).toBe("30d");
  });

  it("discards an older response when a later range wins", async () => {
    let resolveFirst!: (value: number) => void;
    const query = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(2);
    const slice = createUsageSummary<number>(query, "usage-test");
    const first = slice.loadUsage();
    await slice.setRange("30d");
    resolveFirst(1);
    await first;
    expect(slice.usage.value).toBe(2);
    expect(slice.usageLoading.value).toBe(false);
  });

  it("does not label old usage as a new range when the query fails", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(4)
      .mockRejectedValueOnce(new Error("index unavailable"));
    const slice = createUsageSummary<number>(query, "usage-test");
    await slice.loadUsage();
    await slice.setRange("90d");
    await flushPromises();
    expect(slice.usage.value).toBeNull();
    expect(slice.usageError.value).toBe("index unavailable");
  });
});
