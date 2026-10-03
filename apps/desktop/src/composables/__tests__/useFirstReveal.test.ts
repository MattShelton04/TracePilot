import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

async function freshComposable() {
  vi.resetModules();
  return (await import("../useFirstReveal")).useFirstReveal;
}

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query }));
}

describe("useFirstReveal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reveals once per key, after the data is ready, for a short window", async () => {
    const useFirstReveal = await freshComposable();
    const ready = ref(false);
    const scope = effectScope();
    const { revealing } = scope.run(() => useFirstReveal({ key: "metrics:a", ready }))!;

    expect(revealing.value).toBe(false);
    ready.value = true;
    await nextTick();
    expect(revealing.value).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(revealing.value).toBe(false);
    scope.stop();

    // Returning to the same view does not replay; another session does.
    const again = effectScope();
    const same = again.run(() => useFirstReveal({ key: "metrics:a", ready: true }))!;
    const other = again.run(() => useFirstReveal({ key: "metrics:b", ready: true }))!;
    expect(same.revealing.value).toBe(false);
    expect(other.revealing.value).toBe(true);
    again.stop();
  });

  it("does nothing with reduced motion", async () => {
    stubReducedMotion(true);
    const useFirstReveal = await freshComposable();
    const scope = effectScope();
    const { revealing } = scope.run(() => useFirstReveal({ key: "analytics", ready: true }))!;

    expect(revealing.value).toBe(false);
    scope.stop();
  });
});
