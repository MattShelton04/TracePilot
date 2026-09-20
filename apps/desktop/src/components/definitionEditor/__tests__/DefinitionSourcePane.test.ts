import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import DefinitionSourcePane from "../DefinitionSourcePane.vue";

enableAutoUnmount(afterEach);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("fits short metadata, caps long content, and preserves manual sizing until reset", async () => {
  let contentHeight = 299.5;
  const observers: Array<() => void> = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return {
      height: this.classList.contains("definition-source__content") ? contentHeight : 1000,
      top: 0,
    } as DOMRect;
  });
  const wrapper = mount(DefinitionSourcePane, {
    slots: { definition: "Frontmatter", default: "Instructions" },
  });
  await nextTick();
  const separator = wrapper.get('[role="separator"]');
  const height = () => Number(separator.attributes("aria-valuenow"));
  const resize = async (next: number) => {
    contentHeight = next;
    for (const notify of observers) notify();
    await nextTick();
  };

  expect(height()).toBe(30);
  await resize(700);
  expect(height()).toBe(45);
  await resize(300);
  await separator.trigger("keydown", { key: "ArrowDown" });
  expect(height()).toBeCloseTo(31.6);
  await resize(350);
  expect(height()).toBeCloseTo(31.6);
  await separator.trigger("keydown", { key: "Enter" });
  expect(height()).toBe(35);

  await separator.trigger("mousedown", { button: 0 });
  document.dispatchEvent(new MouseEvent("mousemove", { clientY: 500 }));
  document.dispatchEvent(new MouseEvent("mouseup"));
  await resize(300);
  expect(height()).toBe(50);
  await separator.trigger("keydown", { key: "Enter" });
  expect(height()).toBe(30);
});
