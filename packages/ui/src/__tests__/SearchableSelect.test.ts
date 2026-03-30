import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import SearchableSelect from "../components/SearchableSelect.vue";

describe("SearchableSelect", () => {
  let wrapper: VueWrapper<any>;

  const options = ["main", "develop", "feature-x"];

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    document.body.innerHTML = "";
  });

  const mountComponent = (propsData = {}) => {
    return mount(SearchableSelect, {
      props: {
        modelValue: "main",
        options,
        ...propsData,
      },
      attachTo: document.body,
    });
  };

  it("renders with the initial modelValue", () => {
    wrapper = mountComponent();
    const input = wrapper.find("input");
    expect((input.element as HTMLInputElement).value).toBe("main");
  });

  it("resets to modelValue if allowCustom is false and input is blurred", async () => {
    wrapper = mountComponent({ allowCustom: false });
    const input = wrapper.find("input");

    // Clear and blur
    await input.setValue("not-an-option");

    // Simulate clicking outside to trigger close
    document.dispatchEvent(new MouseEvent("mousedown"));
    await nextTick();

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    expect((input.element as HTMLInputElement).value).toBe("main");
  });

  it("emits custom value if allowCustom is true and input is blurred", async () => {
    wrapper = mountComponent({ allowCustom: true });
    const input = wrapper.find("input");

    await input.setValue("custom-branch");
    document.dispatchEvent(new MouseEvent("mousedown"));
    await nextTick();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    const emitted = wrapper.emitted("update:modelValue")!;
    expect(emitted[0]).toEqual(["custom-branch"]);
  });

  it("emits empty string when cleared and clearable is true", async () => {
    wrapper = mountComponent({ clearable: true, allowCustom: false });
    const input = wrapper.find("input");

    // Clear input
    await input.setValue("");
    document.dispatchEvent(new MouseEvent("mousedown"));
    await nextTick();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    const emitted = wrapper.emitted("update:modelValue")!;
    expect(emitted[0]).toEqual([""]);
  });

  it("does not emit empty string if clearable is false", async () => {
    wrapper = mountComponent({ clearable: false, allowCustom: false });
    const input = wrapper.find("input");

    await input.setValue("");
    document.dispatchEvent(new MouseEvent("mousedown"));
    await nextTick();

    // Should not emit, should revert visually
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    expect((input.element as HTMLInputElement).value).toBe("main");
  });
});
