import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ToolbarRow from "../components/ToolbarRow.vue";

describe("ToolbarRow", () => {
  it("renders left/right slot content", () => {
    const wrapper = mount(ToolbarRow, {
      slots: {
        left: '<span class="filter">Filter</span>',
        right: '<button class="action">Refresh</button>',
      },
    });
    expect(wrapper.find(".tbr__left .filter").exists()).toBe(true);
    expect(wrapper.find(".tbr__right .action").exists()).toBe(true);
  });

  it("falls back to default slot when no `left` is provided", () => {
    const wrapper = mount(ToolbarRow, {
      slots: { default: '<span class="t">Title</span>' },
    });
    expect(wrapper.find(".tbr__left .t").exists()).toBe(true);
  });

  it("applies density modifier (compact)", () => {
    const wrapper = mount(ToolbarRow, { props: { density: "compact" } });
    expect(wrapper.classes()).toContain("tbr--compact");
  });

  it("applies sticky modifier when sticky=true", () => {
    const wrapper = mount(ToolbarRow, { props: { sticky: true } });
    expect(wrapper.classes()).toContain("tbr--sticky");
  });

  it("applies inline variant", () => {
    const wrapper = mount(ToolbarRow, { props: { variant: "inline" } });
    expect(wrapper.classes()).toContain("tbr--inline");
  });

  it("has role=toolbar for a11y", () => {
    const wrapper = mount(ToolbarRow);
    expect(wrapper.attributes("role")).toBe("toolbar");
  });

  it("does not render center container when no center slot", () => {
    const wrapper = mount(ToolbarRow);
    expect(wrapper.find(".tbr__center").exists()).toBe(false);
  });
});
