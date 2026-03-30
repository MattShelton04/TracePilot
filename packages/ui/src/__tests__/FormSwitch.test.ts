import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import FormSwitch from "../components/FormSwitch.vue";

describe("FormSwitch", () => {
  it("emits update:modelValue on click", async () => {
    const wrapper = mount(FormSwitch, { props: { modelValue: false } });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([true]);
  });

  it("emits false when toggling off", async () => {
    const wrapper = mount(FormSwitch, { props: { modelValue: true } });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
  });

  it("has role=switch", () => {
    const wrapper = mount(FormSwitch, { props: { modelValue: false } });
    expect(wrapper.find("button").attributes("role")).toBe("switch");
  });

  it("sets aria-checked to match modelValue (false)", () => {
    const wrapper = mount(FormSwitch, { props: { modelValue: false } });
    expect(wrapper.find("button").attributes("aria-checked")).toBe("false");
  });

  it("sets aria-checked to match modelValue (true)", () => {
    const wrapper = mount(FormSwitch, { props: { modelValue: true } });
    expect(wrapper.find("button").attributes("aria-checked")).toBe("true");
  });

  it("applies 'on' class when modelValue is true", () => {
    const wrapper = mount(FormSwitch, { props: { modelValue: true } });
    expect(wrapper.find("button").classes()).toContain("on");
  });

  it("renders label text when provided", () => {
    const wrapper = mount(FormSwitch, {
      props: { modelValue: false, label: "Enable feature" },
    });
    expect(wrapper.text()).toContain("Enable feature");
  });

  it("sets aria-label from label prop", () => {
    const wrapper = mount(FormSwitch, {
      props: { modelValue: false, label: "Dark mode" },
    });
    expect(wrapper.find("button").attributes("aria-label")).toBe("Dark mode");
  });
});
