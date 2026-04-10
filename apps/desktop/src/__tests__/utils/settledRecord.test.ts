import { describe, expect, it } from "vitest";
import { allSettledRecord } from "../../utils/settledRecord";

describe("allSettledRecord", () => {
  it("returns an empty object for an empty input", async () => {
    const result = await allSettledRecord({});
    expect(result).toEqual({});
  });

  it("maps a single fulfilled result to its key", async () => {
    const result = await allSettledRecord({ value: Promise.resolve(42) });
    expect(result.value).toEqual({ status: "fulfilled", value: 42 });
  });

  it("maps a single rejected result to its key", async () => {
    const error = new Error("boom");
    const result = await allSettledRecord({ value: Promise.reject(error) });
    expect(result.value).toEqual({ status: "rejected", reason: error });
  });

  it("maps multiple fulfilled results to correct keys", async () => {
    const result = await allSettledRecord({
      agents: Promise.resolve(["agent-a"]),
      config: Promise.resolve({ model: "claude" }),
      count: Promise.resolve(5),
    });
    expect(result.agents).toEqual({ status: "fulfilled", value: ["agent-a"] });
    expect(result.config).toEqual({ status: "fulfilled", value: { model: "claude" } });
    expect(result.count).toEqual({ status: "fulfilled", value: 5 });
  });

  it("handles mixed fulfilled and rejected results", async () => {
    const error = new Error("network error");
    const result = await allSettledRecord({
      ok: Promise.resolve("data"),
      bad: Promise.reject(error),
      fine: Promise.resolve(true),
    });
    expect(result.ok).toEqual({ status: "fulfilled", value: "data" });
    expect(result.bad).toEqual({ status: "rejected", reason: error });
    expect(result.fine).toEqual({ status: "fulfilled", value: true });
  });

  it("handles all-rejected results", async () => {
    const e1 = new Error("first");
    const e2 = new Error("second");
    const result = await allSettledRecord({
      a: Promise.reject(e1),
      b: Promise.reject(e2),
    });
    expect(result.a).toEqual({ status: "rejected", reason: e1 });
    expect(result.b).toEqual({ status: "rejected", reason: e2 });
  });

  it("preserves key-to-result mapping regardless of promise settlement order", async () => {
    // slowFirst settles after fastSecond to verify ordering is key-based, not race-based
    let resolveFirst!: (v: string) => void;
    const slowFirst = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const fastSecond = Promise.resolve("fast");

    const resultPromise = allSettledRecord({ first: slowFirst, second: fastSecond });
    resolveFirst("slow");
    const result = await resultPromise;

    expect(result.first).toEqual({ status: "fulfilled", value: "slow" });
    expect(result.second).toEqual({ status: "fulfilled", value: "fast" });
  });

  it("composes with Object.values to produce an array of settled results", async () => {
    // Mirrors the aggregateSettledErrors(Object.values(settled)) pattern used by stores
    const error = new Error("failed");
    const result = await allSettledRecord({
      a: Promise.resolve(1),
      b: Promise.reject(error),
      c: Promise.resolve(3),
    });

    const values = Object.values(result);
    expect(values).toHaveLength(3);
    const rejected = values.filter((r) => r.status === "rejected");
    const fulfilled = values.filter((r) => r.status === "fulfilled");
    expect(rejected).toHaveLength(1);
    expect(fulfilled).toHaveLength(2);
    expect((rejected[0] as PromiseRejectedResult).reason).toBe(error);
  });

  it("supports mixed value types with correct TypeScript inference", async () => {
    const result = await allSettledRecord({
      num: Promise.resolve(1),
      str: Promise.resolve("hello"),
      arr: Promise.resolve([true]),
    });

    // TypeScript should infer result.num as PromiseSettledResult<number>, etc.
    if (result.num.status === "fulfilled") {
      const _num: number = result.num.value;
      expect(_num).toBe(1);
    }
    if (result.str.status === "fulfilled") {
      const _str: string = result.str.value;
      expect(_str).toBe("hello");
    }
    if (result.arr.status === "fulfilled") {
      const _arr: boolean[] = result.arr.value;
      expect(_arr).toEqual([true]);
    }
  });
});
