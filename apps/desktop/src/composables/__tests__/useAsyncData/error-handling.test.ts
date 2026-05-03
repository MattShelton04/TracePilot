import { useAsyncData } from "@tracepilot/ui";
import { describe, expect, it, vi } from "vitest";
import { setupUseAsyncDataTest } from "./setup";

setupUseAsyncDataTest();

describe("useAsyncData error handling", () => {
  it("should set error on failed execution", async () => {
    const asyncFn = vi.fn(async () => {
      throw new Error("Test error");
    });

    const { error, execute } = useAsyncData(asyncFn);

    await execute();

    expect(error.value).toContain("Test error");
  });

  it("should not set data on failed execution", async () => {
    const asyncFn = vi.fn(async () => {
      throw new Error("fail");
    });

    const { data, execute } = useAsyncData(asyncFn);

    await execute();

    expect(data.value).toBeNull();
  });

  it("should use custom onError handler", async () => {
    const asyncFn = vi.fn(async () => {
      throw new Error("Custom error");
    });

    const onError = vi.fn((e: unknown) => `Custom: ${(e as Error).message}`);
    const { error, execute } = useAsyncData(asyncFn, { onError });

    await execute();

    expect(onError).toHaveBeenCalled();
    expect(error.value).toBe("Custom: Custom error");
  });

  it("should handle non-Error objects", async () => {
    const asyncFn = vi.fn(async () => {
      throw "string error";
    });

    const { error, execute } = useAsyncData(asyncFn);

    await execute();

    expect(error.value).toBeTruthy();
  });

  it("should set loading to false after error", async () => {
    const asyncFn = vi.fn(async () => {
      throw new Error("fail");
    });

    const { loading, execute } = useAsyncData(asyncFn);

    await execute();

    expect(loading.value).toBe(false);
  });
});
