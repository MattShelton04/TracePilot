import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import { useModifierWheelZoom } from "@/composables/useModifierWheelZoom";

function wheel(init: WheelEventInit) {
  return new WheelEvent("wheel", { cancelable: true, ...init });
}

describe("useModifierWheelZoom", () => {
  afterEach(() => vi.useRealTimers());

  it("zooms on Ctrl or ⌘ + wheel and leaves a plain wheel to the page", () => {
    const zoom = vi.fn();
    const scope = effectScope();
    const wheelZoom = scope.run(() => useModifierWheelZoom(zoom))!;

    const plain = wheel({ deltaY: 120 });
    wheelZoom.onWheel(plain);
    expect(zoom).not.toHaveBeenCalled();
    expect(plain.defaultPrevented).toBe(false);

    for (const init of [{ ctrlKey: true }, { metaKey: true }]) {
      const gated = wheel({ deltaY: 120, ...init });
      wheelZoom.onWheel(gated);
      expect(gated.defaultPrevented).toBe(true);
    }
    expect(zoom).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it("flashes the hint for vertical scrolls only", () => {
    vi.useFakeTimers();
    const scope = effectScope();
    const wheelZoom = scope.run(() => useModifierWheelZoom(vi.fn()))!;

    wheelZoom.onWheel(wheel({ deltaX: 80, deltaY: 5 }));
    expect(wheelZoom.hintVisible.value).toBe(false);

    wheelZoom.onWheel(wheel({ deltaY: 80 }));
    expect(wheelZoom.hintVisible.value).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(wheelZoom.hintVisible.value).toBe(false);
    scope.stop();
  });
});
