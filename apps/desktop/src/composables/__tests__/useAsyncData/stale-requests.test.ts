import { useAsyncData } from "@tracepilot/ui";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { setupUseAsyncDataTest } from "./setup";

setupUseAsyncDataTest();

describe("useAsyncData stale request prevention", () => {
  it("should ignore results from superseded requests", async () => {
    let resolveFirst!: (value: string) => void;
    let resolveSecond!: (value: string) => void;

    const firstPromise = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });

    const asyncFn = vi.fn().mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

    const { data, execute } = useAsyncData(asyncFn);

    const first = execute();
    const second = execute();

    resolveSecond?.("second");
    await second;

    expect(data.value).toBe("second");

    resolveFirst?.("first");
    await first;

    expect(data.value).toBe("second");
  });

  it("should ignore errors from superseded requests", async () => {
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: (value: string) => void;

    const firstPromise = new Promise<string>((_, reject) => {
      rejectFirst = reject;
    });
    const secondPromise = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });

    const asyncFn = vi.fn().mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

    const { data, error, execute } = useAsyncData(asyncFn);

    const first = execute();
    const second = execute();

    resolveSecond?.("success");
    await second;

    expect(data.value).toBe("success");
    expect(error.value).toBeNull();

    rejectFirst?.(new Error("old error"));
    await first;

    expect(error.value).toBeNull();
  });

  it("should not update loading state for stale requests", async () => {
    let resolveFirst!: (value: string) => void;
    let resolveSecond!: (value: string) => void;

    const firstPromise = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });

    const asyncFn = vi.fn().mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

    const { loading, execute } = useAsyncData(asyncFn);

    execute();
    execute();

    expect(loading.value).toBe(true);

    resolveSecond?.("second");
    await nextTick();

    expect(loading.value).toBe(false);

    resolveFirst?.("first");
    await nextTick();

    expect(loading.value).toBe(false);
  });
});
