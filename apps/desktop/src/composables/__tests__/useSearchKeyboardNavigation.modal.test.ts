// The real window capture-phase listener with the real syntax guide modal on
// top (the sibling test file mocks Vue's lifecycle hooks, so it can't do this).
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, nextTick, ref } from "vue";
import SearchSyntaxHelpModal from "@/components/search/SearchSyntaxHelpModal.vue";
import { useSearchKeyboardNavigation } from "../useSearchKeyboardNavigation";

enableAutoUnmount(afterEach);

function key(target: EventTarget, name: string) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
  );
}

async function setup() {
  const onClearAll = vi.fn();
  const onToggleExpand = vi.fn();
  let nav!: ReturnType<typeof useSearchKeyboardNavigation>;
  mount(
    defineComponent({
      setup() {
        const input = ref<HTMLInputElement | null>(null);
        nav = useSearchKeyboardNavigation({
          searchInputRef: input,
          results: computed(() => [{ id: 1 }, { id: 2 }]),
          hasQuery: computed(() => true),
          onClearAll,
          onToggleExpand,
        });
        return () => h("div", [h("input", { ref: input }), h("p", { tabindex: -1 }, "results")]);
      },
    }),
    { attachTo: document.body },
  );
  const visible = ref(true);
  mount(
    defineComponent({
      setup: () => () =>
        h(SearchSyntaxHelpModal, {
          visible: visible.value,
          onClose: () => {
            visible.value = false;
          },
        }),
    }),
    { attachTo: document.body },
  );
  await nextTick();
  await nextTick();
  // Clicking the guide's text focuses its tabindex="-1" dialog panel.
  const panel = document.querySelector<HTMLElement>(".syntax-help-modal");
  if (!panel) throw new Error("syntax guide did not render");
  panel.focus();
  return { onClearAll, onToggleExpand, nav, visible, panel };
}

describe("search result keys while a modal is open", () => {
  it("Escape closes the syntax guide and keeps the search", async () => {
    const { onClearAll, visible, panel } = await setup();
    key(panel, "Escape");
    await nextTick();
    expect({ cleared: onClearAll.mock.calls.length, modalOpen: visible.value }).toEqual({
      cleared: 0,
      modalOpen: false,
    });

    // Once the guide is gone, Escape clears the search as before.
    await nextTick();
    key(document.querySelector("p") as HTMLElement, "Escape");
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("j, arrows and Enter in the guide leave the results behind it alone", async () => {
    const { nav, onToggleExpand, panel } = await setup();
    for (const name of ["j", "ArrowDown", "Enter"]) {
      key(panel, name);
      expect(nav.focusedResultIndex.value).toBe(-1);
    }
    expect(onToggleExpand).not.toHaveBeenCalled();
  });
});
