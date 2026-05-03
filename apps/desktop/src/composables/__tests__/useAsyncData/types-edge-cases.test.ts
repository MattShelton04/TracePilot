import { useAsyncData } from "@tracepilot/ui";
import { describe, expect, it, vi } from "vitest";
import { setupUseAsyncDataTest } from "./setup";

setupUseAsyncDataTest();

describe("useAsyncData type safety", () => {
  it("should infer data type from async function return type", async () => {
    const asyncFn = async (): Promise<{ id: number; name: string }> => ({
      id: 1,
      name: "test",
    });

    const { data, execute } = useAsyncData(asyncFn);

    await execute();

    expect(data.value?.id).toBe(1);
    expect(data.value?.name).toBe("test");
  });

  it("should infer parameter types from async function", async () => {
    const asyncFn = async (id: number, name: string) => ({ id, name });

    const { execute } = useAsyncData(asyncFn);

    await execute(1, "test");
  });
});

describe("useAsyncData edge cases", () => {
  it("should handle null or undefined results", async () => {
    const asyncFn = vi.fn(async () => null);
    const { data, execute } = useAsyncData(asyncFn);

    await execute();

    expect(data.value).toBeNull();
  });

  it("should handle async function that returns undefined", async () => {
    const asyncFn = vi.fn(async () => undefined);
    const { data, execute } = useAsyncData(asyncFn);

    await execute();

    expect(data.value).toBeUndefined();
  });

  it("should handle rapid execute calls", async () => {
    const asyncFn = vi.fn(async (x: number) => x);
    const { data, execute } = useAsyncData(asyncFn);

    execute(1);
    execute(2);
    execute(3);
    execute(4);
    const final = execute(5);

    await final;

    expect(data.value).toBe(5);
  });

  it("should handle execute with zero parameters", async () => {
    const asyncFn = vi.fn(async () => "no params");
    const { data, execute } = useAsyncData(asyncFn);

    await execute();

    expect(data.value).toBe("no params");
    expect(asyncFn).toHaveBeenCalledWith();
  });
});
