import { setupPinia } from "@tracepilot/test-utils";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import SessionTabStrip from "@/components/layout/SessionTabStrip.vue";
import { useSessionTabsStore } from "@/stores/sessionTabs";

const { openSessionWindow } = vi.hoisted(() => ({ openSessionWindow: vi.fn() }));
vi.mock("@tracepilot/client", () => ({ openSessionWindow }));

enableAutoUnmount(afterEach);
beforeEach(() => {
  localStorage.clear();
  setupPinia();
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

async function setup() {
  const store = useSessionTabsStore();
  for (const id of ["one", "two", "three"]) store.openTab(id, `Audit ${id}`);
  const host = mount(
    defineComponent({
      setup: () => () =>
        h("div", [
          h("a", { href: "#/", "data-nav-id": "sessions" }, "Sessions"),
          h(SessionTabStrip, { isSessionRoute: true, onGoHome: () => store.deactivateAll() }),
        ]),
    }),
    { attachTo: document.body },
  );
  await flushPromises();
  const tabs = () => host.findAll<HTMLElement>(".session-tab:not(.home-tab)");
  const key = async (element: Element, value: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    element.dispatchEvent(event);
    await flushPromises();
    return event;
  };
  const menu = () => document.body.querySelector<HTMLElement>(".tab-context-menu");
  async function open(index = 1, x = 300, y = 90) {
    const tab = tabs()[index];
    tab.element.focus();
    await tab.trigger("contextmenu", { clientX: x, clientY: y });
    await flushPromises();
    return tab.element;
  }
  return { store, host, tabs, key, menu, open };
}

describe("session tab keyboard and menu lifecycle", () => {
  it("focuses the named action menu, navigates items and restores its opener on Escape", async () => {
    const { menu, open, key } = await setup();
    const opener = await open();
    expect(menu()?.getAttribute("role")).toBe("menu");
    expect(menu()?.getAttribute("aria-label")).toBe("Session tab actions");
    expect(document.activeElement?.textContent).toBe("Close");
    for (const [value, label] of [
      ["ArrowDown", "Close Others"],
      ["End", "Pop Out to Window"],
      ["Home", "Close"],
      ["ArrowUp", "Pop Out to Window"],
    ]) {
      expect((await key(document.activeElement!, value)).defaultPrevented).toBe(true);
      expect(document.activeElement?.textContent).toBe(label);
    }
    expect((await key(document.activeElement!, "Escape")).defaultPrevented).toBe(true);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect((await key(opener, "Escape")).defaultPrevented).toBe(false);
  });

  it.each([
    false,
    true,
  ])("dismisses with Tab (shift=%s) and returns to the tab", async (shiftKey) => {
    const { menu, open, key } = await setup();
    const opener = await open();
    expect((await key(document.activeElement!, "Tab", { shiftKey })).defaultPrevented).toBe(true);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("dismisses from the backdrop and constrains an edge anchor to the viewport", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("tab-context-menu")
        ? new DOMRect(0, 0, 160, 150)
        : new DOMRect(30, 20, 120, 32);
    });
    const { open, menu } = await setup();
    const opener = await open(1, window.innerWidth - 1, window.innerHeight - 1);
    expect(menu()?.style.left).toBe(`${window.innerWidth - 168}px`);
    expect(menu()?.style.top).toBe(`${window.innerHeight - 158}px`);
    document.body.querySelector<HTMLElement>(".tab-context-backdrop")!.click();
    await flushPromises();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it.each([
    "Enter",
    " ",
  ])("activates a focused session with %j without scrolling", async (value) => {
    const { store, tabs, key } = await setup();
    tabs()[0].element.focus();
    const event = await key(tabs()[0].element, value);
    expect(event.defaultPrevented).toBe(true);
    expect(store.activeTabId).toBe("one");
    expect(tabs()[0].attributes("aria-label")).toBe("Audit one");
  });

  it("retains Home/End activation and makes All sessions an independent native button", async () => {
    const { store, host, tabs, key } = await setup();
    tabs()[1].element.focus();
    await key(tabs()[1].element, "Home");
    expect(store.activeTabId).toBe("one");
    expect(document.activeElement).toBe(tabs()[0].element);
    await key(tabs()[0].element, "End");
    expect(store.activeTabId).toBe("three");
    expect(document.activeElement).toBe(tabs()[2].element);
    const home = host.get<HTMLButtonElement>('button[aria-label="All sessions"]');
    expect(home.element.tabIndex).toBe(0);
    await home.trigger("click");
    expect(store.activeTabId).toBeNull();
    expect(home.attributes("aria-current")).toBe("page");
  });

  it("moves focus to a surviving tab on Delete and to Sessions when the strip disappears", async () => {
    const { store, host, tabs, key } = await setup();
    tabs()[2].element.focus();
    for (const expected of ["two", "one"]) {
      await key(document.activeElement!, "Delete");
      expect(store.activeTabId).toBe(expected);
      expect(document.activeElement).toBe(tabs().at(-1)!.element);
    }
    await key(document.activeElement!, "Delete");
    expect(tabs()).toHaveLength(0);
    expect(document.activeElement).toBe(host.get('[data-nav-id="sessions"]').element);
  });

  it.each([
    "Close",
    "Close Others",
    "Close All",
  ])("restores valid focus after menu action %s", async (action) => {
    const { store, host, tabs, menu, open } = await setup();
    await open(0);
    const item = [...menu()!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === action,
    )!;
    item.click();
    await flushPromises();
    expect(menu()).toBeNull();
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(
      action === "Close" ? ["two", "three"] : action === "Close Others" ? ["one"] : [],
    );
    expect(document.activeElement).toBe(
      action === "Close All"
        ? host.get('[data-nav-id="sessions"]').element
        : tabs().find((tab) => tab.attributes("aria-selected") === "true")!.element,
    );
  });

  it("preserves a close button's native keys and ignores composing or modified tab keys", async () => {
    const { store, tabs, key } = await setup();
    const close = tabs()[0].get<HTMLButtonElement>("button");
    close.element.focus();
    expect((await key(close.element, " ")).defaultPrevented).toBe(false);
    expect(store.activeTabId).toBe("three");
    for (const options of [{ ctrlKey: true }, { isComposing: true }]) {
      expect((await key(tabs()[0].element, "Delete", options)).defaultPrevented).toBe(false);
      expect(store.tabs).toHaveLength(3);
    }
    await close.trigger("click");
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(["two", "three"]);
    expect(document.activeElement).toBe(tabs()[1].element);
  });

  it("dismisses Pop Out immediately while the native request is pending", async () => {
    let finish!: () => void;
    openSessionWindow.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { store, menu, open } = await setup();
    const opener = await open(1);
    [...menu()!.querySelectorAll<HTMLButtonElement>("button")].at(-1)!.click();
    await flushPromises();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(openSessionWindow).toHaveBeenCalledExactlyOnceWith("two", "Audit two");
    finish();
    await flushPromises();
    expect(store.tabs.map((tab) => tab.sessionId)).toEqual(["one", "three"]);
    expect(store.popupSessionIds.has("two")).toBe(true);
  });
});
