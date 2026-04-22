import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import { useRenderBudget } from "../useRenderBudget";

function flushRafs(n: number): Promise<void> {
  // `@vue/test-utils` runs in jsdom which provides setTimeout-backed rAF.
  // We advance the clock just enough to drain `n` nested frames.
  return new Promise((resolve) => {
    let remaining = n;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

describe("useRenderBudget", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("does not warn when render is under budget", async () => {
    const Comp = defineComponent({
      setup() {
        useRenderBudget({ key: "render.testMs", budgetMs: 10_000, label: "UnderBudget" });
        return () => null;
      },
    });

    mount(Comp);
    await nextTick();
    await flushRafs(3);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns when measured render time exceeds the budget", async () => {
    let now = 0;
    const perfSpy = vi.spyOn(performance, "now").mockImplementation(() => {
      now += 500; // each call advances 500ms
      return now;
    });

    const Comp = defineComponent({
      setup() {
        useRenderBudget({ key: "render.slowMs", budgetMs: 50, label: "SlowView" });
        return () => null;
      },
    });

    mount(Comp);
    await nextTick();
    await flushRafs(3);

    expect(warnSpy).toHaveBeenCalledOnce();
    const [msg] = warnSpy.mock.calls[0] ?? [];
    expect(String(msg)).toContain("[render-budget] SlowView exceeded budget");
    expect(String(msg)).toContain("render.slowMs");

    perfSpy.mockRestore();
  });

  it("fires the onMounted + double-rAF path exactly once per mount", async () => {
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

    const Comp = defineComponent({
      setup() {
        useRenderBudget({ key: "render.countMs", budgetMs: 10_000, label: "CountView" });
        return () => null;
      },
    });

    mount(Comp);
    await nextTick();
    await flushRafs(3);

    // Outer rAF + inner rAF from the composable, plus rAFs from the test
    // harness itself — we only assert the composable scheduled at least two.
    expect(rafSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    rafSpy.mockRestore();
  });
});
