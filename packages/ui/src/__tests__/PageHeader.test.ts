import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PageHeader from "../components/PageHeader.vue";

describe("PageHeader", () => {
  it("renders title and subtitle on separate lines by default", () => {
    const wrapper = mount(PageHeader, {
      props: { title: "Dashboard", subtitle: "Session overview" },
    });
    expect(wrapper.find(".page-title").text()).toContain("Dashboard");
    expect(wrapper.find(".page-subtitle").exists()).toBe(true);
    expect(wrapper.find(".page-subtitle").text()).toBe("Session overview");
    expect(wrapper.find(".page-subtitle-inline").exists()).toBe(false);
  });

  it("inlineSubtitle renders subtitle inside the title row with a separator", () => {
    const wrapper = mount(PageHeader, {
      props: { title: "Task Presets", subtitle: "12 built-in · 3 custom", inlineSubtitle: true },
    });
    expect(wrapper.find(".page-subtitle").exists()).toBe(false);
    const inline = wrapper.find(".page-subtitle-inline");
    expect(inline.exists()).toBe(true);
    expect(inline.text()).toContain("12 built-in");
    expect(wrapper.find(".page-subtitle-sep").exists()).toBe(true);
  });

  it("does not render inline subtitle element when subtitle is missing", () => {
    const wrapper = mount(PageHeader, {
      props: { title: "Solo", inlineSubtitle: true },
    });
    expect(wrapper.find(".page-subtitle-inline").exists()).toBe(false);
    expect(wrapper.find(".page-subtitle").exists()).toBe(false);
  });

  it("applies default size modifier when size is not provided", () => {
    const wrapper = mount(PageHeader, { props: { title: "Hi" } });
    expect(wrapper.find(".page-header").classes()).toContain("page-header--md");
  });

  it("size=sm applies the sm modifier class", () => {
    const wrapper = mount(PageHeader, { props: { title: "Hi", size: "sm" } });
    expect(wrapper.find(".page-header").classes()).toContain("page-header--sm");
  });

  it("size=lg applies the lg modifier class", () => {
    const wrapper = mount(PageHeader, { props: { title: "Hi", size: "lg" } });
    expect(wrapper.find(".page-header").classes()).toContain("page-header--lg");
  });

  it("renders actions slot when provided", () => {
    const wrapper = mount(PageHeader, {
      props: { title: "T" },
      slots: { actions: '<button class="a-btn">Go</button>' },
    });
    expect(wrapper.find(".title-actions").exists()).toBe(true);
    expect(wrapper.find(".a-btn").exists()).toBe(true);
  });

  it("renders icon slot inside title-icon-tile", () => {
    const wrapper = mount(PageHeader, {
      props: { title: "T" },
      slots: { icon: '<svg class="ic" />' },
    });
    expect(wrapper.find(".title-icon-tile").exists()).toBe(true);
    expect(wrapper.find(".title-icon-tile .ic").exists()).toBe(true);
  });
});
