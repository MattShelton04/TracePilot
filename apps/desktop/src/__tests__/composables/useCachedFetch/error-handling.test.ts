import { useCachedFetch } from "@tracepilot/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("error handling", () => {
  it("handles Error instances", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Network error"));
    const { data, error, loading, fetch } = useCachedFetch({ fetcher });

    await fetch(undefined);

    expect(data.value).toBe(null);
    expect(error.value).toBe("Network error");
    expect(loading.value).toBe(false);
  });

  it("handles non-Error rejection values", async () => {
    const fetcher = vi.fn().mockRejectedValue("string error");
    const { error, fetch } = useCachedFetch({ fetcher });

    await fetch(undefined);

    expect(error.value).toBe("string error");
  });

  it("handles object rejection values", async () => {
    const fetcher = vi.fn().mockRejectedValue({ message: "object error", code: 500 });
    const { error, fetch } = useCachedFetch({ fetcher });

    await fetch(undefined);

    expect(error.value).toBe("object error");
  });

  it("clears previous error on successful retry", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("First fail"))
      .mockResolvedValueOnce({ data: "success" });
    const { data, error, fetch } = useCachedFetch({ fetcher });

    await fetch({ id: 1 });
    expect(error.value).toBe("First fail");

    await fetch({ id: 1 }, { force: true });
    expect(error.value).toBe(null);
    expect(data.value).toEqual({ data: "success" });
  });
});

describe("resetOnError option", () => {
  it("clears data on error when resetOnError is true", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "success" });
    const { data, fetch } = useCachedFetch({ fetcher, resetOnError: true });

    await fetch({ id: 1 });
    expect(data.value).toEqual({ data: "success" });

    // Reconfigure to fail
    fetcher.mockRejectedValueOnce(new Error("fail"));
    await fetch({ id: 2 });

    expect(data.value).toBe(null);
  });

  it("preserves data on error when resetOnError is false", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "success" });
    const { data, fetch } = useCachedFetch({ fetcher, resetOnError: false });

    await fetch({ id: 1 });
    expect(data.value).toEqual({ data: "success" });

    fetcher.mockRejectedValueOnce(new Error("fail"));
    await fetch({ id: 2 });

    // Data should still be from first successful request
    expect(data.value).toEqual({ data: "success" });
  });

  it("resets to initialData on error when resetOnError is true", async () => {
    const initialData = { value: "initial" };
    const fetcher = vi.fn().mockRejectedValue(new Error("fail"));
    const { data, fetch } = useCachedFetch({ fetcher, initialData, resetOnError: true });

    expect(data.value).toEqual(initialData);

    await fetch(undefined);

    expect(data.value).toEqual(initialData);
  });
});
