import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { useConfirmDialog } from "../composables/useConfirmDialog";

function setup() {
  const wrapper = mount(
    defineComponent({
      setup() {
        return useConfirmDialog();
      },
      template: "<div />",
    }),
  );
  return wrapper.vm;
}

const defaultOpts = { title: "Delete?", message: "Are you sure?" };

describe("useConfirmDialog", () => {
  beforeEach(() => {
    const { visible, resolve } = useConfirmDialog();
    if (visible.value) {
      resolve({ confirmed: false, checked: false });
    }
  });

  it("has correct initial state", () => {
    const vm = setup();
    expect(vm.visible).toBe(false);
    expect(vm.options).toBeNull();
  });

  it("confirm() opens the dialog", () => {
    const vm = setup();
    vm.confirm(defaultOpts);
    expect(vm.visible).toBe(true);
    expect(vm.options).toMatchObject(defaultOpts);
  });

  it("resolve with confirmed=true closes dialog", async () => {
    const vm = setup();
    const promise = vm.confirm(defaultOpts);
    vm.resolve({ confirmed: true, checked: false });
    const result = await promise;
    expect(result).toEqual({ confirmed: true, checked: false });
    expect(vm.visible).toBe(false);
    expect(vm.options).toBeNull();
  });

  it("resolve with confirmed=false closes dialog", async () => {
    const vm = setup();
    const promise = vm.confirm(defaultOpts);
    vm.resolve({ confirmed: false, checked: false });
    const result = await promise;
    expect(result).toEqual({ confirmed: false, checked: false });
    expect(vm.visible).toBe(false);
  });

  it("supports checkbox option", async () => {
    const vm = setup();
    const promise = vm.confirm({ ...defaultOpts, checkbox: "Force" });
    expect(vm.options?.checkbox).toBe("Force");
    vm.resolve({ confirmed: true, checked: true });
    const result = await promise;
    expect(result).toEqual({ confirmed: true, checked: true });
  });

  it("concurrent call returns cancelled immediately", async () => {
    const vm = setup();
    vm.confirm(defaultOpts);
    const second = await vm.confirm({ title: "Second", message: "msg" });
    expect(second).toEqual({ confirmed: false, checked: false });
    expect(vm.visible).toBe(true);
    expect(vm.options).toMatchObject(defaultOpts);
  });

  it("singleton shares state across instances", () => {
    const vm1 = setup();
    const vm2 = setup();
    vm1.confirm(defaultOpts);
    expect(vm2.visible).toBe(true);
    expect(vm2.options).toMatchObject(defaultOpts);
  });

  it.each(["danger", "warning", "info"] as const)("stores variant '%s' in options", (variant) => {
    const vm = setup();
    vm.confirm({ ...defaultOpts, variant });
    expect(vm.options?.variant).toBe(variant);
  });

  it("propagates custom labels to options", () => {
    const vm = setup();
    vm.confirm({ ...defaultOpts, confirmLabel: "Yes", cancelLabel: "No" });
    expect(vm.options?.confirmLabel).toBe("Yes");
    expect(vm.options?.cancelLabel).toBe("No");
  });
});
