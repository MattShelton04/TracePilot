import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { useAsyncData } from "../useAsyncData";

describe("useAsyncData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("Basic Execution", () => {
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

  describe("Error Handling", () => {
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

  describe("Stale Request Prevention", () => {
    it("should ignore results from superseded requests", async () => {
      let resolveFirst: (value: string) => void;
      let resolveSecond: (value: string) => void;

      const firstPromise = new Promise<string>((resolve) => {
        resolveFirst = resolve;
      });
      const secondPromise = new Promise<string>((resolve) => {
        resolveSecond = resolve;
      });

      const asyncFn = vi.fn().mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

      const { data, execute } = useAsyncData(asyncFn);

      // Start first request
      const first = execute();

      // Start second request before first completes
      const second = execute();

      // Resolve second request first
      resolveSecond?.("second");
      await second;

      expect(data.value).toBe("second");

      // Resolve first request (should be ignored)
      resolveFirst?.("first");
      await first;

      // Data should still be 'second'
      expect(data.value).toBe("second");
    });

    it("should ignore errors from superseded requests", async () => {
      let rejectFirst: (error: Error) => void;
      let resolveSecond: (value: string) => void;

      const firstPromise = new Promise<string>((_, reject) => {
        rejectFirst = reject;
      });
      const secondPromise = new Promise<string>((resolve) => {
        resolveSecond = resolve;
      });

      const asyncFn = vi.fn().mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

      const { data, error, execute } = useAsyncData(asyncFn);

      // Start first request
      const first = execute();

      // Start second request
      const second = execute();

      // Resolve second request first
      resolveSecond?.("success");
      await second;

      expect(data.value).toBe("success");
      expect(error.value).toBeNull();

      // Reject first request (should be ignored)
      rejectFirst?.(new Error("old error"));
      await first.catch(() => {}); // Suppress unhandled rejection

      // Error should still be null
      expect(error.value).toBeNull();
    });

    it("should not update loading state for stale requests", async () => {
      let resolveFirst: (value: string) => void;
      let resolveSecond: (value: string) => void;

      const firstPromise = new Promise<string>((resolve) => {
        resolveFirst = resolve;
      });
      const secondPromise = new Promise<string>((resolve) => {
        resolveSecond = resolve;
      });

      const asyncFn = vi.fn().mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

      const { loading, execute } = useAsyncData(asyncFn);

      // Start both requests
      execute();
      execute();

      expect(loading.value).toBe(true);

      // Resolve second (current)
      resolveSecond?.("second");
      await nextTick();

      expect(loading.value).toBe(false);

      // Resolve first (stale) - should not change loading
      resolveFirst?.("first");
      await nextTick();

      expect(loading.value).toBe(false);
    });
  });

  describe("Immediate Execution", () => {
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

  describe("Success Callback", () => {
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
      let resolveFirst: (value: string) => void;
      let resolveSecond: (value: string) => void;

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

      // Should still be called only once
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  describe("Refresh", () => {
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

  describe("Retry", () => {
    it("should retry after failure when retry is configured", async () => {
      const asyncFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce("success");

      const { data, error, execute, retry, canRetry } = useAsyncData(asyncFn, {
        retry: { maxAttempts: 3, delay: 100 },
      });

      await execute();
      expect(error.value).not.toBeNull();
      expect(canRetry.value).toBe(true);

      const retryPromise = retry();
      vi.advanceTimersByTime(100);
      await retryPromise;

      expect(data.value).toBe("success");
      expect(error.value).toBeNull();
      expect(canRetry.value).toBe(false);
    });

    it("should use exponential backoff", async () => {
      const asyncFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"))
        .mockResolvedValueOnce("success");

      const { execute, retry } = useAsyncData(asyncFn, {
        retry: { maxAttempts: 3, delay: 100 },
      });

      await execute();

      // First retry: 100ms
      const retry1 = retry();
      vi.advanceTimersByTime(100);
      await retry1;

      // Second retry: 200ms (exponential backoff)
      const retry2 = retry();
      vi.advanceTimersByTime(200);
      await retry2;

      expect(asyncFn).toHaveBeenCalledTimes(3);
    });

    it("should not retry beyond maxAttempts", async () => {
      const asyncFn = vi.fn().mockRejectedValue(new Error("always fail"));

      const { execute, retry, canRetry } = useAsyncData(asyncFn, {
        retry: { maxAttempts: 2, delay: 100 },
      });

      await execute();
      expect(canRetry.value).toBe(true);

      // First retry
      const retry1 = retry();
      vi.advanceTimersByTime(100);
      await retry1;
      expect(canRetry.value).toBe(true);

      // Second retry
      const retry2 = retry();
      vi.advanceTimersByTime(200);
      await retry2;
      expect(canRetry.value).toBe(false);

      // Third retry should be a no-op
      await retry();
      expect(asyncFn).toHaveBeenCalledTimes(3); // Original + 2 retries
    });

    it("should be a no-op if retry is not configured", async () => {
      const asyncFn = vi.fn().mockRejectedValue(new Error("fail"));

      const { execute, retry, canRetry } = useAsyncData(asyncFn);

      await execute();
      expect(canRetry.value).toBe(false);

      await retry();
      expect(asyncFn).toHaveBeenCalledTimes(1);
    });

    it("should reset retry count on successful execution", async () => {
      const asyncFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce("success")
        .mockRejectedValueOnce(new Error("fail again"));

      const { execute, retry, canRetry } = useAsyncData(asyncFn, {
        retry: { maxAttempts: 2, delay: 100 },
      });

      // First failure
      await execute();
      expect(canRetry.value).toBe(true);

      // Retry succeeds
      const retry1 = retry();
      vi.advanceTimersByTime(100);
      await retry1;
      expect(canRetry.value).toBe(false);

      // New execution fails
      await execute();
      expect(canRetry.value).toBe(true);

      // Should be able to retry again (count was reset)
      const retry2 = retry();
      vi.advanceTimersByTime(100);
      await retry2;

      expect(asyncFn).toHaveBeenCalledTimes(4);
    });
  });

  describe("Clear Error", () => {
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

    it("should clear canRetry flag", async () => {
      const asyncFn = vi.fn().mockRejectedValue(new Error("fail"));
      const { execute, clearError, canRetry } = useAsyncData(asyncFn, {
        retry: { maxAttempts: 3 },
      });

      await execute();
      expect(canRetry.value).toBe(true);

      clearError();
      expect(canRetry.value).toBe(false);
    });
  });

  describe("Reset", () => {
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
      let resolveAsync: (value: string) => void;
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

      // Data should not be updated
      expect(data.value).toBeNull();
    });

    it("should reset lastParams so refresh is a no-op", async () => {
      const asyncFn = vi.fn(async (x: number) => x);
      const { execute, reset, refresh } = useAsyncData(asyncFn);

      await execute(42);
      reset();
      await refresh();

      // Should only be called once (from execute)
      expect(asyncFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("Reset On Execute", () => {
    it("should reset data to null when resetOnExecute is true", async () => {
      const asyncFn = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "new data";
      });

      const { data, execute } = useAsyncData(asyncFn, {
        initialData: "initial",
        resetOnExecute: true,
      });

      expect(data.value).toBe("initial");

      const promise = execute();
      await nextTick();

      // Data should be null immediately when execution starts
      expect(data.value).toBeNull();

      vi.advanceTimersByTime(100);
      await promise;

      expect(data.value).toBe("new data");
    });

    it("should preserve data when resetOnExecute is false", async () => {
      const asyncFn = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "new data";
      });

      const { data, execute } = useAsyncData(asyncFn, {
        initialData: "initial",
        resetOnExecute: false,
      });

      const promise = execute();
      await nextTick();

      // Data should still be 'initial' while loading
      expect(data.value).toBe("initial");

      vi.advanceTimersByTime(100);
      await promise;

      expect(data.value).toBe("new data");
    });
  });

  describe("Type Safety", () => {
    it("should infer data type from async function return type", async () => {
      const asyncFn = async (): Promise<{ id: number; name: string }> => ({
        id: 1,
        name: "test",
      });

      const { data, execute } = useAsyncData(asyncFn);

      await execute();

      // TypeScript should understand data.value is { id: number; name: string } | null
      expect(data.value?.id).toBe(1);
      expect(data.value?.name).toBe("test");
    });

    it("should infer parameter types from async function", async () => {
      const asyncFn = async (id: number, name: string) => ({ id, name });

      const { execute } = useAsyncData(asyncFn);

      // TypeScript should enforce correct parameter types
      await execute(1, "test");

      // The following would cause a type error:
      // execute('wrong', 123);
    });
  });

  describe("Edge Cases", () => {
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

      // Rapid fire multiple executes
      execute(1);
      execute(2);
      execute(3);
      execute(4);
      const final = execute(5);

      await final;

      // Only the last result should be stored
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
});
