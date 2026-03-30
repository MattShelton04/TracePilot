import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import BtnGroup from "../components/BtnGroup.vue";

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

describe("BtnGroup", () => {
  it("renders all options as buttons", () => {
    const wrapper = mount(BtnGroup, {
      props: { options, modelValue: "a" },
    });
    const buttons = wrapper.findAll("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].text()).toBe("Alpha");
    expect(buttons[1].text()).toBe("Beta");
    expect(buttons[2].text()).toBe("Gamma");
  });

  it("applies active class to active option", () => {
    const wrapper = mount(BtnGroup, {
      props: { options, modelValue: "b" },
    });
    const buttons = wrapper.findAll("button");
    expect(buttons[0].classes()).not.toContain("active");
    expect(buttons[1].classes()).toContain("active");
    expect(buttons[2].classes()).not.toContain("active");
  });

  it("emits update:modelValue on click", async () => {
    const wrapper = mount(BtnGroup, {
      props: { options, modelValue: "a" },
    });
    await wrapper.findAll("button")[2].trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["c"]);
  });

  it("sets aria-pressed on active button", () => {
    const wrapper = mount(BtnGroup, {
      props: { options, modelValue: "a" },
    });
    const buttons = wrapper.findAll("button");
    expect(buttons[0].attributes("aria-pressed")).toBe("true");
    expect(buttons[1].attributes("aria-pressed")).toBe("false");
  });

  it("has role=group on container", () => {
    const wrapper = mount(BtnGroup, {
      props: { options, modelValue: "a" },
    });
    expect(wrapper.find("[role='group']").exists()).toBe(true);
  });
});
