import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { useProgressiveList } from "../useProgressiveList";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("useProgressiveList", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function setup(initial: number[]) {
    const items = ref(initial);
    const scope = effectScope();
    const list = scope.run(() => useProgressiveList(() => items.value, { initial: 10, step: 5 }))!;
    return { items, scope, ...list };
  }

  it("renders a short list at once", () => {
    const { visible, complete, scope } = setup(range(4));
    expect(visible.value).toHaveLength(4);
    expect(complete.value).toBe(true);
    scope.stop();
  });

  it("renders a long list in frame-sized chunks", () => {
    const { visible, complete, scope } = setup(range(22));
    expect(visible.value).toEqual(range(10));
    expect(complete.value).toBe(false);
    vi.advanceTimersByTime(16);
    expect(visible.value).toHaveLength(15);
    vi.advanceTimersByTime(32);
    expect(visible.value).toHaveLength(22);
    expect(complete.value).toBe(true);
    scope.stop();
  });

  it("starts over from the first chunk when the list narrows", async () => {
    const { items, visible, scope } = setup(range(30));
    vi.advanceTimersByTime(16 * 10);
    expect(visible.value).toHaveLength(30);

    items.value = range(3);
    await nextTick();
    expect(visible.value).toHaveLength(3);

    items.value = range(30);
    await nextTick();
    expect(visible.value).toHaveLength(10);
    vi.advanceTimersByTime(16 * 10);
    expect(visible.value).toHaveLength(30);
    scope.stop();
  });

  it("keeps what is rendered when the list grows", async () => {
    const { items, visible, scope } = setup(range(12));
    vi.advanceTimersByTime(16);
    expect(visible.value).toHaveLength(12);

    items.value = range(40);
    await nextTick();
    expect(visible.value).toHaveLength(15);
    scope.stop();
  });

  it("stops scheduling frames once disposed", () => {
    const { visible, scope } = setup(range(50));
    scope.stop();
    vi.advanceTimersByTime(16 * 10);
    expect(visible.value).toHaveLength(10);
  });
});
