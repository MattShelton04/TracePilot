import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import { useWizardNavigation } from "../useWizardNavigation";

afterEach(() => vi.useRealTimers());

describe("wizard navigation authority", () => {
  it("applies a live guard consistently to jumps, next, previous and keyboard arrows", async () => {
    vi.useFakeTimers();
    const scope = effectScope();
    const allowLaterSteps = ref(false);
    const locked = ref(false);
    const nav = scope.run(() =>
      useWizardNavigation({
        totalSteps: 5,
        prefersReducedMotion: ref(true),
        slidesViewport: ref(null),
        canNavigate: (step) => !locked.value && (step <= 2 || allowLaterSteps.value),
      }),
    )!;
    try {
      for (const invalid of [-1, 1.5, Number.NaN, 5]) nav.goTo(invalid);
      expect(nav.currentStep.value).toBe(0);
      nav.goTo(4);
      expect(nav.currentStep.value).toBe(0);
      nav.goTo(2);
      await vi.runAllTimersAsync();
      expect(nav.canNext.value).toBe(false);
      nav.next();
      nav.onKeydown(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }));
      expect(nav.currentStep.value).toBe(2);
      allowLaterSteps.value = true;
      expect(nav.canNext.value).toBe(true);
      nav.goTo(4);
      await vi.runAllTimersAsync();
      locked.value = true;
      expect(nav.canPrev.value).toBe(false);
      nav.prev();
      expect(nav.currentStep.value).toBe(4);
      locked.value = false;
      nav.prev();
      expect(nav.currentStep.value).toBe(3);
    } finally {
      scope.stop();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});
