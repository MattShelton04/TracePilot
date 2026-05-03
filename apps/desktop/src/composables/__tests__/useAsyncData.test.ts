import { useAsyncData } from "@tracepilot/ui";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { setupUseAsyncDataTest } from "./useAsyncData/setup";

setupUseAsyncDataTest();

describe("useAsyncData basic execution", () => {
  it("should initialize with default state", () => {
    const { data, loading, error } = useAsyncData(async () => "test");

    expect(data.value).toBeNull();
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  it("should initialize with provided initialData", () => {
    const { data } = useAsyncData(async () => "test", {
      initialData: "initial",
    });

    expect(data.value).toBe("initial");
  });

  it("should set loading to true during execution", async () => {
    const asyncFn = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return "result";
    });

    const { loading, execute } = useAsyncData(asyncFn);

    const promise = execute();
    await nextTick();

    expect(loading.value).toBe(true);

    vi.advanceTimersByTime(100);
    await promise;

    expect(loading.value).toBe(false);
  });

  it("should set data on successful execution", async () => {
    const asyncFn = vi.fn(async () => "success");
    const { data, execute } = useAsyncData(asyncFn);

    await execute();

    expect(data.value).toBe("success");
    expect(asyncFn).toHaveBeenCalledTimes(1);
  });

  it("should pass parameters to async function", async () => {
    const asyncFn = vi.fn(async (a: number, b: string) => `${a}-${b}`);
    const { data, execute } = useAsyncData(asyncFn);

    await execute(42, "test");

    expect(data.value).toBe("42-test");
    expect(asyncFn).toHaveBeenCalledWith(42, "test");
  });

  it("should clear error on successful execution", async () => {
    const asyncFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("success");

    const { error, execute } = useAsyncData(asyncFn);

    await execute();
    expect(error.value).not.toBeNull();

    await execute();
    expect(error.value).toBeNull();
  });
});
