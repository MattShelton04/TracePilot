import { useCachedFetch } from "@tracepilot/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lifecycle hooks", () => {
  it("calls onSuccess with fetched data for successful requests", async () => {
    const mockData = { value: "test" };
    const fetcher = vi.fn().mockResolvedValue(mockData);
    const onSuccess = vi.fn();
    const { fetch } = useCachedFetch({ fetcher, onSuccess });

    await fetch(undefined);

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(mockData);
  });

  it("calls onError with error message for failed requests", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Network error"));
    const onError = vi.fn();
    const { fetch } = useCachedFetch({ fetcher, onError });

    await fetch(undefined);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Network error");
  });

  it("calls onFinally after successful requests", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "test" });
    const onFinally = vi.fn();
    const { fetch } = useCachedFetch({ fetcher, onFinally });

    await fetch(undefined);

    expect(onFinally).toHaveBeenCalledTimes(1);
  });

  it("calls onFinally after failed requests", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("fail"));
    const onFinally = vi.fn();
    const { fetch } = useCachedFetch({ fetcher, onFinally });

    await fetch(undefined);

    expect(onFinally).toHaveBeenCalledTimes(1);
  });

  it("does not call onSuccess for stale requests", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const fetcher = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
    const onSuccess = vi.fn();
    const { fetch } = useCachedFetch<unknown, { id: number }>({ fetcher, onSuccess });

    const req1 = fetch({ id: 1 });
    const req2 = fetch({ id: 2 });

    // Complete second request first
    resolvers[1]({ value: "second" });
    await req2;
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith({ value: "second" });

    // Complete first request (stale)
    resolvers[0]({ value: "first" });
    await req1;

    // onSuccess should not have been called again
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("does not call onError for stale requests", async () => {
    const resolvers: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];
    const fetcher = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          resolvers.push({ resolve, reject });
        }),
    );
    const onError = vi.fn();
    const { fetch } = useCachedFetch<unknown, { id: number }>({ fetcher, onError });

    const req1 = fetch({ id: 1 });
    const req2 = fetch({ id: 2 });

    // Second request succeeds
    resolvers[1].resolve({ value: "success" });
    await req2;
    expect(onError).not.toHaveBeenCalled();

    // First request fails (stale)
    resolvers[0].reject(new Error("stale error"));
    await req1;

    // onError should not have been called
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not call onFinally for stale requests", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const fetcher = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
    const onFinally = vi.fn();
    const { fetch } = useCachedFetch<unknown, { id: number }>({ fetcher, onFinally });

    const req1 = fetch({ id: 1 });
    const req2 = fetch({ id: 2 });

    // Complete second request
    resolvers[1]({ value: "second" });
    await req2;
    expect(onFinally).toHaveBeenCalledTimes(1);

    // Complete first request (stale)
    resolvers[0]({ value: "first" });
    await req1;

    // onFinally should not have been called again
    expect(onFinally).toHaveBeenCalledTimes(1);
  });

  it("handles onSuccess throwing an error gracefully", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "test" });
    const onSuccess = vi.fn(() => {
      throw new Error("Callback error");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { data, error, fetch } = useCachedFetch({ fetcher, onSuccess });

    await fetch(undefined);

    // Data should still be set despite callback error
    expect(data.value).toEqual({ data: "test" });
    expect(error.value).toBe(null);
    expect(onSuccess).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("onSuccess"),
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it("handles onError throwing an error gracefully", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const onError = vi.fn(() => {
      throw new Error("Callback error");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { error, fetch } = useCachedFetch({ fetcher, onError });

    await fetch(undefined);

    // Error should still be set despite callback error
    expect(error.value).toBe("fetch failed");
    expect(onError).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("onError"),
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it("handles onFinally throwing an error gracefully", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "test" });
    const onFinally = vi.fn(() => {
      throw new Error("Callback error");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { data, fetch } = useCachedFetch({ fetcher, onFinally });

    await fetch(undefined);

    // Data should still be set despite callback error
    expect(data.value).toEqual({ data: "test" });
    expect(onFinally).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("onFinally"),
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });
});
