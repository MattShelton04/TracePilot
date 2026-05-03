import { useAsyncData } from "@tracepilot/ui";
import { describe, expect, it, vi } from "vitest";
import { setupUseAsyncDataTest } from "./setup";

setupUseAsyncDataTest();

describe("useAsyncData refresh", () => {
  it("should re-execute with last parameters", async () => {
    const asyncFn = vi.fn(async (x: number) => x * 2);
    const { data, execute, refresh } = useAsyncData(asyncFn);

    await execute(5);
    expect(data.value).toBe(10);

    await refresh();
    expect(data.value).toBe(10);
    expect(asyncFn).toHaveBeenCalledTimes(2);
    expect(asyncFn).toHaveBeenNthCalledWith(1, 5);
    expect(asyncFn).toHaveBeenNthCalledWith(2, 5);
  });

  it("should be a no-op if execute was never called", async () => {
    const asyncFn = vi.fn(async () => "data");
    const { refresh } = useAsyncData(asyncFn);

    await refresh();

    expect(asyncFn).not.toHaveBeenCalled();
  });

  it("should use most recent parameters", async () => {
    const asyncFn = vi.fn(async (x: number) => x);
    const { data, execute, refresh } = useAsyncData(asyncFn);

    await execute(1);
    await execute(2);
    await execute(3);

    await refresh();

    expect(data.value).toBe(3);
    expect(asyncFn).toHaveBeenLastCalledWith(3);
  });
});

describe("useAsyncData clearError", () => {
  it("should clear error message", async () => {
    const asyncFn = vi.fn().mockRejectedValue(new Error("fail"));
    const { error, execute, clearError } = useAsyncData(asyncFn);

    await execute();
    expect(error.value).not.toBeNull();

    clearError();
    expect(error.value).toBeNull();
  });

  it("should not affect data or loading", async () => {
    const asyncFn = vi.fn().mockRejectedValue(new Error("fail"));
    const { data, loading, execute, clearError } = useAsyncData(asyncFn, {
      initialData: "initial",
    });

    await execute();

    clearError();

    expect(data.value).toBe("initial");
    expect(loading.value).toBe(false);
  });
});

describe("useAsyncData reset", () => {
  it("should reset all state to initial values", async () => {
    const asyncFn = vi.fn(async (x: number) => x * 2);
    const { data, loading, error, execute, reset } = useAsyncData(asyncFn, {
      initialData: 42,
    });

    await execute(5);
    expect(data.value).toBe(10);

    reset();

    expect(data.value).toBe(42);
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  it("should invalidate in-flight requests", async () => {
    let resolveAsync!: (value: string) => void;
    const asyncPromise = new Promise<string>((resolve) => {
      resolveAsync = resolve;
    });

    const asyncFn = vi.fn().mockReturnValue(asyncPromise);
    const { data, loading, execute, reset } = useAsyncData(asyncFn);

    const promise = execute();
    expect(loading.value).toBe(true);

    reset();
    expect(loading.value).toBe(false);

    resolveAsync?.("result");
    await promise;

    expect(data.value).toBeNull();
  });

  it("should reset lastParams so refresh is a no-op", async () => {
    const asyncFn = vi.fn(async (x: number) => x);
    const { execute, reset, refresh } = useAsyncData(asyncFn);

    await execute(42);
    reset();
    await refresh();

    expect(asyncFn).toHaveBeenCalledTimes(1);
  });
});
