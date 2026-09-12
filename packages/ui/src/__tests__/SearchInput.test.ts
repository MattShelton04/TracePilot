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

  it("clears a controlled query once and returns focus to the input", async () => {
    const wrapper = mount(SearchInput, {
      attachTo: document.body,
      props: { modelValue: "A long search query", shortcutHint: "Ctrl+K" },
    });
    try {
      const button = wrapper.get<HTMLButtonElement>('button[aria-label="Clear search"]');
      expect(button.attributes("type")).toBe("button");
      expect(wrapper.find(".search-shortcut").exists()).toBe(false);
      button.element.focus();
      expect(document.activeElement).toBe(button.element);

      await button.trigger("click");
      expect(wrapper.emitted("update:modelValue")).toEqual([[""]]);
      await wrapper.setProps({ modelValue: "" });

      expect(wrapper.get<HTMLInputElement>("input").element.value).toBe("");
      expect(document.activeElement).toBe(wrapper.get("input").element);
      expect(wrapper.find('button[aria-label="Clear search"]').exists()).toBe(false);
      expect(wrapper.get(".search-shortcut").text()).toBe("Ctrl+K");
    } finally {
      wrapper.unmount();
    }
  });
});
