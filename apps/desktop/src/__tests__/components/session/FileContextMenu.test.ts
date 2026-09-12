import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import FileContextMenu from "@/components/session/FileContextMenu.vue";

enableAutoUnmount(afterEach);
afterEach(() => vi.restoreAllMocks());

async function setup(isDirectory = false, canCopyContents = true) {
  const visible = ref(false);
  const position = ref({ x: 300, y: 563 });
  const copyPath = vi.fn(() => {
    visible.value = false;
  });
  const host = mount(
    defineComponent({
      setup: () => () =>
        h("div", [
          h(
            "button",
            {
              onContextmenu: (event: MouseEvent) => {
                event.preventDefault();
                (event.currentTarget as HTMLElement).focus();
                visible.value = true;
              },
            },
            "audit-notes.txt",
          ),
          h(FileContextMenu, {
            visible: visible.value,
            position: position.value,
            entry: { path: "audit-notes.txt", name: "audit-notes.txt", isDirectory },
            canCopyContents,
            onDismiss: () => {
              visible.value = false;
            },
            onCopyPath: copyPath,
          }),
        ]),
    }),
    { attachTo: document.body },
  );
  const opener = host.get<HTMLButtonElement>("button");
  await opener.trigger("contextmenu");
  await flushPromises();
  const menu = () => document.body.querySelector<HTMLElement>(".file-context-menu");
  const key = async (value: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    document.activeElement?.dispatchEvent(event);
    await flushPromises();
    return event;
  };
  return { host, visible, position, opener: opener.element, menu, key, copyPath };
}

describe("Explorer file action menu", () => {
  it("opens a named menu with initial focus, navigates actions and restores focus on Escape", async () => {
    const { menu, key, opener } = await setup();
    expect(menu()?.getAttribute("role")).toBe("menu");
    expect(menu()?.getAttribute("aria-label")).toBe("File actions");
    expect(document.activeElement?.textContent).toBe("Copy File Path");
    for (const [value, label] of [
      ["ArrowDown", "Copy File Contents"],
      ["End", "Open Containing Folder"],
      ["ArrowDown", "Copy File Path"],
      ["ArrowUp", "Open Containing Folder"],
      ["Home", "Copy File Path"],
    ]) {
      expect((await key(value)).defaultPrevented).toBe(true);
      expect(document.activeElement?.textContent?.trim()).toBe(label);
    }
    await key("Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it.each([
    false,
    true,
  ])("dismisses with Tab (shift=%s) and returns to the file", async (shiftKey) => {
    const { menu, key, opener } = await setup();
    expect((await key("Tab", { shiftKey })).defaultPrevented).toBe(true);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("omits contents for a binary file without leaving a keyboard gap", async () => {
    const { menu, key } = await setup(false, false);
    expect(menu()?.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    await key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("Open Containing Folder");
  });

  it("gives a folder its own two actions", async () => {
    const { menu, key } = await setup(true);
    expect(menu()?.getAttribute("aria-label")).toBe("Folder actions");
    expect(document.activeElement?.textContent).toBe("Copy Folder Path");
    await key("End");
    expect(document.activeElement?.textContent).toBe("Open Folder");
    expect(menu()?.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
  });

  it("keeps an edge-anchored menu inside the viewport and adjusts when resized", async () => {
    let menuWidth = 220;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, menuWidth, 150),
    );
    const { menu, position } = await setup();
    position.value = { x: window.innerWidth, y: window.innerHeight };
    await flushPromises();
    expect(menu()?.style.left).toBe(`${window.innerWidth - 228}px`);
    expect(menu()?.style.top).toBe(`${window.innerHeight - 158}px`);
    menuWidth = 300;
    window.dispatchEvent(new Event("resize"));
    await flushPromises();
    expect(menu()?.style.left).toBe(`${window.innerWidth - 308}px`);
  });

  it("dismisses from outside and restores its opener", async () => {
    const { menu, opener } = await setup();
    const backdrop = document.body.querySelector<HTMLElement>(".file-context-backdrop");
    expect(backdrop).not.toBeNull();
    backdrop?.click();
    await flushPromises();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("retains native button activation and emits only its selected action", async () => {
    const { menu, key, copyPath, opener } = await setup();
    expect(document.activeElement?.tagName).toBe("BUTTON");
    expect((await key("Enter")).defaultPrevented).toBe(false);
    (document.activeElement as HTMLButtonElement).click();
    await flushPromises();
    expect(copyPath).toHaveBeenCalledOnce();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
