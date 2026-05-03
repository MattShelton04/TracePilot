import { useAsyncData } from "@tracepilot/ui";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { setupUseAsyncDataTest } from "./setup";

setupUseAsyncDataTest();

describe("useAsyncData immediate execution", () => {
  it("should execute immediately when immediate=true", async () => {
    const asyncFn = vi.fn(async () => "immediate");
    const { data, loading } = useAsyncData(asyncFn, { immediate: true });

    expect(loading.value).toBe(true);

    await vi.runAllTimersAsync();

    expect(data.value).toBe("immediate");
    expect(asyncFn).toHaveBeenCalledTimes(1);
  });

  it("should not execute immediately when immediate=false", () => {
    const asyncFn = vi.fn(async () => "data");
    useAsyncData(asyncFn, { immediate: false });

    expect(asyncFn).not.toHaveBeenCalled();
  });

  it("should execute immediately with default immediate value", () => {
    const asyncFn = vi.fn(async () => "data");
    useAsyncData(asyncFn);

    expect(asyncFn).not.toHaveBeenCalled();
  });
});

describe("useAsyncData success callback", () => {
  it("should call onSuccess when execution succeeds", async () => {
    const onSuccess = vi.fn();
    const asyncFn = vi.fn(async () => "success");

    const { execute } = useAsyncData(asyncFn, { onSuccess });

    await execute();

    expect(onSuccess).toHaveBeenCalledWith("success");
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("should not call onSuccess when execution fails", async () => {
    const onSuccess = vi.fn();
    const asyncFn = vi.fn(async () => {
      throw new Error("fail");
    });

    const { execute } = useAsyncData(asyncFn, { onSuccess });

    await execute();

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("should not call onSuccess for stale requests", async () => {
    const onSuccess = vi.fn();
    let resolveFirst!: (value: string) => void;
    let resolveSecond!: (value: string) => void;

    const firstPromise = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });

    const asyncFn = vi.fn().mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

    const { execute } = useAsyncData(asyncFn, { onSuccess });

    execute();
    execute();

    resolveSecond?.("second");
    await nextTick();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("second");

    resolveFirst?.("first");
    await nextTick();

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
