import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SearchInput from "../components/SearchInput.vue";

describe("SearchInput", () => {
  it("renders with placeholder text", () => {
    const wrapper = mount(SearchInput, {
      props: { placeholder: "Find sessions..." },
    });
    const input = wrapper.find("input");
    expect(input.attributes("placeholder")).toBe("Find sessions...");
  });

  it("renders default placeholder when none provided", () => {
    const wrapper = mount(SearchInput);
    const input = wrapper.find("input");
    expect(input.attributes("placeholder")).toBe("Search...");
  });

  it("emits update:modelValue on input", async () => {
    const wrapper = mount(SearchInput);
    const input = wrapper.find("input");
    await input.setValue("test query");
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    const emitted = wrapper.emitted("update:modelValue")!;
    expect(emitted[emitted.length - 1]).toEqual(["test query"]);
  });

  it("has search icon", () => {
    const wrapper = mount(SearchInput);
    expect(wrapper.find("svg").exists()).toBe(true);
  });
});
