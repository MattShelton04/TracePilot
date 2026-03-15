import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SectionPanel from "../components/SectionPanel.vue";

describe("SectionPanel", () => {
  it("renders slot content in body", () => {
    const wrapper = mount(SectionPanel, {
      slots: { default: "<p>Panel content</p>" },
    });
    expect(wrapper.text()).toContain("Panel content");
    expect(wrapper.find(".section-panel-body").exists()).toBe(true);
  });

  it("uses section-panel design system class", () => {
    const wrapper = mount(SectionPanel, {
      slots: { default: "Content" },
    });
    expect(wrapper.find(".section-panel").exists()).toBe(true);
  });

  it("renders header when title prop provided", () => {
    const wrapper = mount(SectionPanel, {
      props: { title: "Details" },
      slots: { default: "Content" },
    });
    expect(wrapper.find(".section-panel-header").exists()).toBe(true);
    expect(wrapper.find(".section-panel-header").text()).toBe("Details");
  });

  it("does not render header when no title", () => {
    const wrapper = mount(SectionPanel, {
      slots: { default: "Content" },
    });
    expect(wrapper.find(".section-panel-header").exists()).toBe(false);
  });

  it("wraps content in section-panel-body", () => {
    const wrapper = mount(SectionPanel, {
      slots: { default: "<span class='test-child'>Hello</span>" },
    });
    const body = wrapper.find(".section-panel-body");
    expect(body.exists()).toBe(true);
    expect(body.find(".test-child").exists()).toBe(true);
  });
});
