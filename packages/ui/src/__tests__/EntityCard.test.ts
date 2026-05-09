import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import EntityCard from "../components/EntityCard.vue";

describe("EntityCard", () => {
  it("renders title", () => {
    const wrapper = mount(EntityCard, { props: { title: "My session" } });
    expect(wrapper.find(".ec__title").text()).toBe("My session");
  });

  it("renders meta items with separator", () => {
    const wrapper = mount(EntityCard, {
      props: {
        title: "T",
        meta: [{ label: "main" }, { label: "abc1234", mono: true }],
      },
    });
    const items = wrapper.findAll(".ec__meta-item");
    expect(items).toHaveLength(2);
    expect(items[0].text()).toBe("main");
    expect(items[1].classes()).toContain("ec__meta-item--mono");
    expect(wrapper.findAll(".ec__meta-sep")).toHaveLength(1);
  });

  it("does not render meta section when empty", () => {
    const wrapper = mount(EntityCard, { props: { title: "T" } });
    expect(wrapper.find(".ec__meta").exists()).toBe(false);
  });

  it("becomes interactive when `to` is set: tabindex, role, cursor", () => {
    const wrapper = mount(EntityCard, { props: { title: "T", to: "/x" } });
    expect(wrapper.attributes("tabindex")).toBe("0");
    expect(wrapper.attributes("role")).toBe("button");
    expect(wrapper.classes()).toContain("ec--interactive");
  });

  it("emits activate on Enter when interactive", async () => {
    const wrapper = mount(EntityCard, { props: { title: "T", to: "/x" } });
    await wrapper.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("activate")).toHaveLength(1);
  });

  it("emits activate on click when interactive", async () => {
    const wrapper = mount(EntityCard, { props: { title: "T", to: "/x" } });
    await wrapper.trigger("click");
    expect(wrapper.emitted("activate")).toHaveLength(1);
  });

  it("does not emit activate when click originates inside actions slot", async () => {
    const wrapper = mount(EntityCard, {
      props: { title: "T", to: "/x" },
      slots: { actions: '<button class="a">Go</button>' },
    });
    await wrapper.find(".a").trigger("click");
    expect(wrapper.emitted("activate")).toBeUndefined();
  });

  it("applies aria-selected when selected=true", () => {
    const wrapper = mount(EntityCard, { props: { title: "T", to: "/x", selected: true } });
    expect(wrapper.attributes("aria-selected")).toBe("true");
    expect(wrapper.classes()).toContain("ec--selected");
  });

  it("applies compact density class", () => {
    const wrapper = mount(EntityCard, { props: { title: "T", density: "compact" } });
    expect(wrapper.classes()).toContain("ec--compact");
  });

  it("applies tone class for icon", () => {
    const wrapper = mount(EntityCard, { props: { title: "T", iconTone: "success" } });
    expect(wrapper.classes()).toContain("ec--tone-success");
  });

  it("renders icon and status slots", () => {
    const wrapper = mount(EntityCard, {
      props: { title: "T" },
      slots: {
        icon: '<svg class="ic" />',
        status: '<span class="st">running</span>',
      },
    });
    expect(wrapper.find(".ec__icon .ic").exists()).toBe(true);
    expect(wrapper.find(".ec__status .st").exists()).toBe(true);
  });
});
