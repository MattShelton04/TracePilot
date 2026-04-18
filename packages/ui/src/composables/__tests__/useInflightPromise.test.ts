import { describe, expect, it, vi } from "vitest";
import { useInflightPromise } from "../useInflightPromise";

describe("useInflightPromise", () => {
  it("shares the same promise for concurrent run() calls", async () => {
    const inflight = useInflightPromise<number>();
    const factory = vi.fn(() => Promise.resolve(42));

    const a = inflight.run(factory);
    const b = inflight.run(factory);

    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
    await expect(a).resolves.toBe(42);
  });

  it("clears the slot after the promise resolves", async () => {
    const inflight = useInflightPromise<number>();
    const factory = vi.fn(() => Promise.resolve(1));

    await inflight.run(factory);
    expect(inflight.current()).toBeNull();

    await inflight.run(factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("clears the slot after the promise rejects", async () => {
    const inflight = useInflightPromise<number>();
    const factory = vi.fn(() => Promise.reject(new Error("boom")));

    await expect(inflight.run(factory)).rejects.toThrow("boom");
    expect(inflight.current()).toBeNull();

    // Next call should start fresh
    await expect(inflight.run(factory)).rejects.toThrow("boom");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("clear() forces a restart while a call is pending", async () => {
    const inflight = useInflightPromise<number>();
    let resolveFirst: (v: number) => void = () => {};
    const first = inflight.run(
      () =>
        new Promise<number>((r) => {
          resolveFirst = r;
        }),
    );

    inflight.clear();
    expect(inflight.current()).toBeNull();

    const second = inflight.run(() => Promise.resolve(2));
    expect(second).not.toBe(first);
    resolveFirst(1);

    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
  });
});
