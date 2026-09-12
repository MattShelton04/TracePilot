import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import Drawer from "../components/Drawer.vue";
import ModalDialog from "../components/ModalDialog.vue";
import { useConfirmDialog } from "../composables/useConfirmDialog";

enableAutoUnmount(afterEach);
afterEach(async () => {
  useConfirmDialog().resolve({ confirmed: false, checked: false });
  await nextTick();
  document.body.innerHTML = "";
});

function button(id: string): HTMLButtonElement {
  return document.getElementById(id) as HTMLButtonElement;
}

function opener(): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = "Open dialog";
  document.body.append(element);
  element.focus();
  return element;
}

function key(target: EventTarget, value: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    key: value,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe("overlay focus ownership", () => {
  it("focuses an initially open dialog and wraps both Tab boundaries", async () => {
    opener();
    mount(ModalDialog, {
      attachTo: document.body,
      props: { visible: true, title: "Example" },
      slots: { default: '<input id="middle"><button id="last">Done</button>' },
    });
    await nextTick();
    const close = document.querySelector('[aria-label="Close Example"]') as HTMLElement;
    expect(document.activeElement).toBe(close);
    key(close, "Tab", true);
    expect(document.activeElement).toBe(button("last"));
    expect(key(button("last"), "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it("skips hidden, inert, disabled fieldset, and unchecked radio controls", async () => {
    mount(ModalDialog, {
      attachTo: document.body,
      props: { visible: true },
      slots: {
        default: `<button id="first">First</button>
          <input type="radio" name="mode" checked id="checked-radio">
          <input type="radio" name="mode" id="unchecked-radio">
          <fieldset disabled><button>Disabled group</button></fieldset>
          <div style="display:none"><button>Hidden parent</button></div>
          <div inert><button>Inert parent</button></div>
          <button disabled>Disabled</button>`,
      },
    });
    await nextTick();
    key(button("first"), "Tab", true);
    expect(document.activeElement).toBe(document.getElementById("checked-radio"));
    key(document.activeElement!, "Tab");
    expect(document.activeElement).toBe(button("first"));
  });

  it("keeps an empty dialog focusable and blocks background focus", async () => {
    const origin = opener();
    mount(ModalDialog, { attachTo: document.body, props: { visible: true } });
    await nextTick();
    const panel = document.querySelector('[role="dialog"]');
    expect(document.activeElement).toBe(panel);
    expect(key(panel!, "Tab").defaultPrevented).toBe(true);
    origin.focus();
    expect(document.activeElement).toBe(panel);
  });

  it("returns focus after closing and does not intercept when closed", async () => {
    const origin = opener();
    const wrapper = mount(ModalDialog, {
      attachTo: document.body,
      props: { visible: false, title: "Example" },
    });
    await wrapper.setProps({ visible: true });
    await nextTick();
    await wrapper.setProps({ visible: false });
    await nextTick();
    expect(document.activeElement).toBe(origin);
    expect(key(origin, "Tab").defaultPrevented).toBe(false);
    key(origin, "Escape");
    expect(wrapper.emitted("update:visible")).toBeUndefined();
  });

  it("returns focus when a conditionally mounted dialog is removed", async () => {
    const origin = opener();
    const wrapper = mount(ModalDialog, {
      attachTo: document.body,
      props: { visible: true, title: "Example" },
    });
    await nextTick();
    wrapper.unmount();
    await nextTick();
    expect(document.activeElement).toBe(origin);
  });

  it("returns non-modal detail focus to a keyboard-focusable SVG node", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const node = document.createElementNS("http://www.w3.org/2000/svg", "g");
    node.setAttribute("tabindex", "0");
    svg.append(node);
    document.body.append(svg);
    node.focus();
    const drawer = mount(Drawer, {
      attachTo: document.body,
      props: { visible: true, title: "Node details", modal: false },
    });
    await nextTick();
    expect(document.activeElement).not.toBe(node);
    await drawer.setProps({ visible: false });
    await nextTick();
    expect(document.activeElement).toBe(node);
  });

  it("closes only the topmost overlay and restores its parent control", async () => {
    opener();
    const parent = mount(ModalDialog, {
      attachTo: document.body,
      props: { visible: true, title: "Parent" },
      slots: { default: '<button id="nested-opener">Open child</button>' },
    });
    await nextTick();
    button("nested-opener").focus();
    const child = mount(Drawer, {
      attachTo: document.body,
      props: { visible: true, title: "Child" },
    });
    await nextTick();
    key(document.activeElement!, "Escape");
    expect(child.emitted("update:visible")).toEqual([[false]]);
    expect(parent.emitted("update:visible")).toBeUndefined();
    await child.setProps({ visible: false });
    await nextTick();
    expect(document.activeElement).toBe(button("nested-opener"));
    key(document.activeElement!, "Escape");
    expect(parent.emitted("update:visible")).toEqual([[false]]);
  });

  it("allows a child popup to consume Escape without closing its dialog", async () => {
    const wrapper = mount(ModalDialog, {
      attachTo: document.body,
      props: { visible: true, title: "Example" },
      slots: { default: '<input id="combobox">' },
    });
    await nextTick();
    const input = document.getElementById("combobox")!;
    input.addEventListener("keydown", (event) => event.preventDefault());
    key(input, "Escape");
    expect(wrapper.emitted("update:visible")).toBeUndefined();
  });

  it("focuses Cancel in a real nested confirmation and restores its opener", async () => {
    const parent = mount(ModalDialog, {
      attachTo: document.body,
      props: { visible: true, title: "Parent" },
      slots: { default: '<button id="confirm-opener">Remove item</button>' },
    });
    mount(ConfirmDialog, { attachTo: document.body });
    await nextTick();
    button("confirm-opener").focus();
    const result = useConfirmDialog().confirm({
      title: "Remove item?",
      message: "This removes the item.",
      variant: "danger",
      confirmLabel: "Remove",
    });
    await nextTick();
    await nextTick();
    const cancel = document.querySelector('[role="alertdialog"] .btn-secondary');
    expect(document.activeElement).toBe(cancel);
    key(document.activeElement!, "Escape");
    expect(await result).toEqual({ confirmed: false, checked: false });
    await nextTick();
    expect(document.activeElement).toBe(button("confirm-opener"));
    expect(parent.emitted("update:visible")).toBeUndefined();
  });

  it("keeps modal focus and Escape ownership when a non-modal drawer opens later", async () => {
    const outside = opener();
    const modal = mount(ModalDialog, {
      attachTo: document.body,
      props: { visible: true, title: "Protected dialog" },
      slots: { default: '<input id="held-field">' },
    });
    await nextTick();
    const field = document.getElementById("held-field")!;
    field.focus();
    const drawer = mount(Drawer, {
      attachTo: document.body,
      props: { visible: true, title: "Alerts", modal: false },
    });
    await nextTick();
    expect(document.activeElement).toBe(field);
    outside.focus();
    const dialog = document.querySelector('[aria-label="Protected dialog"]')!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    key(document.activeElement!, "Escape");
    expect(modal.emitted("update:visible")).toEqual([[false]]);
    expect(drawer.emitted("update:visible")).toBeUndefined();
    await modal.setProps({ visible: false });
    await nextTick();
    const drawerClose = document.querySelector('[aria-label="Close Alerts"]') as HTMLElement;
    drawerClose.focus();
    key(drawerClose, "Escape");
    expect(drawer.emitted("update:visible")).toEqual([[false]]);
  });

  it("leaves focus and page keyboard behavior free for a non-modal drawer", async () => {
    const origin = opener();
    const drawer = mount(Drawer, {
      attachTo: document.body,
      props: { visible: true, title: "Alerts", modal: false },
    });
    await nextTick();
    const close = document.querySelector('[aria-label="Close Alerts"]')!;
    expect(key(close, "Tab").defaultPrevented).toBe(false);
    origin.focus();
    expect(document.activeElement).toBe(origin);
    expect(key(origin, "Escape").defaultPrevented).toBe(false);
    expect(drawer.emitted("update:visible")).toBeUndefined();
    (close as HTMLElement).focus();
    key(close, "Escape");
    expect(drawer.emitted("update:visible")).toEqual([[false]]);
  });

  it("does not leave listeners behind when closed before activation finishes", async () => {
    const origin = opener();
    const wrapper = mount(ModalDialog, {
      attachTo: document.body,
      props: { visible: true, title: "Example" },
    });
    wrapper.unmount();
    await nextTick();
    expect(document.activeElement).toBe(origin);
    expect(key(origin, "Escape").defaultPrevented).toBe(false);
  });
});
