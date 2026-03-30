import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { computed, defineComponent, nextTick, ref } from "vue";
import { useTimelineNavigation } from "../composables/useTimelineNavigation";

function createWrapper(turnCount: number, options?: { onEscape?: () => void }) {
  return mount(
    defineComponent({
      setup() {
        const items = Array.from({ length: turnCount }, (_, i) => ({
          index: i,
        }));
        const turns = ref(items);
        const rootRef = ref<HTMLElement | null>(null);
        const nav = useTimelineNavigation({
          turns: computed(() => turns.value),
          rootRef,
          ...options,
        });
        return { ...nav, turns, rootRef };
      },
      template: '<div ref="rootRef" tabindex="0"><slot /></div>',
    }),
  );
}

describe("useTimelineNavigation", () => {
  it("initial turnIndex is 0", () => {
    const w = createWrapper(5);
    expect(w.vm.turnIndex).toBe(0);
  });

  it("prevTurn does nothing when at index 0", () => {
    const w = createWrapper(5);
    w.vm.prevTurn();
    expect(w.vm.turnIndex).toBe(0);
  });

  it("nextTurn increments index", () => {
    const w = createWrapper(5);
    w.vm.nextTurn();
    expect(w.vm.turnIndex).toBe(1);
  });

  it("nextTurn does nothing at last index", () => {
    const w = createWrapper(3);
    w.vm.jumpTo(2);
    w.vm.nextTurn();
    expect(w.vm.turnIndex).toBe(2);
  });

  it("jumpTo sets index and closes jumpOpen", () => {
    const w = createWrapper(5);
    w.vm.jumpOpen = true;
    w.vm.jumpTo(3);
    expect(w.vm.turnIndex).toBe(3);
    expect(w.vm.jumpOpen).toBe(false);
  });

  it("jumpTo clamps negative index to 0", () => {
    const w = createWrapper(5);
    w.vm.jumpTo(-10);
    expect(w.vm.turnIndex).toBe(0);
  });

  it("jumpTo clamps index above max to last", () => {
    const w = createWrapper(5);
    w.vm.jumpTo(100);
    expect(w.vm.turnIndex).toBe(4);
  });

  it("turnLabel shows correct format", () => {
    const w = createWrapper(5);
    expect(w.vm.turnLabel).toBe("Turn 1 of 5");
    w.vm.nextTurn();
    expect(w.vm.turnLabel).toBe("Turn 2 of 5");
  });

  it("canPrev and canNext computed correctly", () => {
    const w = createWrapper(3);
    expect(w.vm.canPrev).toBe(false);
    expect(w.vm.canNext).toBe(true);

    w.vm.jumpTo(1);
    expect(w.vm.canPrev).toBe(true);
    expect(w.vm.canNext).toBe(true);

    w.vm.jumpTo(2);
    expect(w.vm.canPrev).toBe(true);
    expect(w.vm.canNext).toBe(false);
  });

  it("auto-resets index when turns shrink", async () => {
    const w = createWrapper(5);
    w.vm.jumpTo(4);
    expect(w.vm.turnIndex).toBe(4);

    // Shrink turns from 5 to 2
    w.vm.turns = [{ index: 0 }, { index: 1 }];
    await nextTick();
    expect(w.vm.turnIndex).toBe(1);
  });

  it("empty turns: turnLabel shows 'No turns', canPrev/canNext both false", () => {
    const w = createWrapper(0);
    expect(w.vm.turnLabel).toBe("No turns");
    expect(w.vm.canPrev).toBe(false);
    expect(w.vm.canNext).toBe(false);
  });

  describe("keyboard navigation", () => {
    // Use a wrapper without rootRef so the focus-containment guard is skipped,
    // since jsdom does not reliably update document.activeElement on .focus().
    function createKeyboardWrapper(turnCount: number, options?: { onEscape?: () => void }) {
      return mount(
        defineComponent({
          setup() {
            const items = Array.from({ length: turnCount }, (_, i) => ({
              index: i,
            }));
            const turns = ref(items);
            const nav = useTimelineNavigation({
              turns: computed(() => turns.value),
              ...options,
            });
            return { ...nav, turns };
          },
          template: "<div><slot /></div>",
        }),
      );
    }

    it("ArrowRight calls nextTurn", () => {
      const w = createKeyboardWrapper(5);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      expect(w.vm.turnIndex).toBe(1);
    });

    it("ArrowLeft calls prevTurn", () => {
      const w = createKeyboardWrapper(5);
      w.vm.jumpTo(3);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
      expect(w.vm.turnIndex).toBe(2);
    });

    it("Escape calls onEscape callback", () => {
      const onEscape = vi.fn();
      const _w = createKeyboardWrapper(5, { onEscape });
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(onEscape).toHaveBeenCalledOnce();
    });
  });
});
