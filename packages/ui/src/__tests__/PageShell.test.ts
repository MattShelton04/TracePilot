import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PageShell from "../components/PageShell.vue";

describe("PageShell", () => {
  it("renders slot content", () => {
    const wrapper = mount(PageShell, {
      slots: { default: "<h1>Title</h1><p>Body</p>" },
    });
    expect(wrapper.text()).toContain("Title");
    expect(wrapper.text()).toContain("Body");
  });

  it("wraps content in page-content and page-content-inner", () => {
    const wrapper = mount(PageShell, {
      slots: { default: "Content" },
    });
    expect(wrapper.find(".page-content").exists()).toBe(true);
    expect(wrapper.find(".page-content-inner").exists()).toBe(true);
  });

  it("omits page-content-inner when fluid", () => {
    const wrapper = mount(PageShell, {
      props: { fluid: true },
      slots: { default: "Content" },
    });
    expect(wrapper.find(".page-content").exists()).toBe(true);
    expect(wrapper.find(".page-content-inner").exists()).toBe(false);
  });

  it("keeps page-content-inner by default", () => {
    const wrapper = mount(PageShell, {
      slots: { default: "Content" },
    });
    expect(wrapper.find(".page-content-inner").exists()).toBe(true);
  });
});
