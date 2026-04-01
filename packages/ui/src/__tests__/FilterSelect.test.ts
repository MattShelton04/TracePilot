import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import FilterSelect from "../components/FilterSelect.vue";

describe("FilterSelect", () => {
  const options = ["cli", "vscode", "jetbrains"];

  it("renders options from prop", () => {
    const wrapper = mount(FilterSelect, {
      props: { options },
    });
    const optionEls = wrapper.findAll("option");
    // placeholder + 3 options
    expect(optionEls).toHaveLength(4);
    expect(optionEls[1].text()).toBe("cli");
    expect(optionEls[2].text()).toBe("vscode");
    expect(optionEls[3].text()).toBe("jetbrains");
  });

  it("shows placeholder as first option", () => {
    const wrapper = mount(FilterSelect, {
      props: { options, placeholder: "Host type" },
    });
    const firstOption = wrapper.find("option");
    expect(firstOption.text()).toBe("Host type");
    expect(firstOption.attributes("value")).toBe("");
  });

  it("shows default placeholder when none provided", () => {
    const wrapper = mount(FilterSelect, {
      props: { options },
    });
    const firstOption = wrapper.find("option");
    expect(firstOption.text()).toBe("All");
  });

  it("emits update:modelValue on change", async () => {
    const wrapper = mount(FilterSelect, {
      props: { options },
    });
    await wrapper.find("select").setValue("vscode");
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeDefined();
    if (!emitted) throw new Error("Expected update:modelValue emission");
    expect(emitted[emitted.length - 1]).toEqual(["vscode"]);
  });

  it("emits null when 'All' selected", async () => {
    const wrapper = mount(FilterSelect, {
      props: { options, modelValue: "cli" },
    });
    await wrapper.find("select").setValue("");
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeDefined();
    if (!emitted) throw new Error("Expected update:modelValue emission");
    expect(emitted[emitted.length - 1]).toEqual([null]);
  });
});
