import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RendererShell from "../components/renderers/RendererShell.vue";

describe("RendererShell", () => {
  it("renders label in header", () => {
    const wrapper = mount(RendererShell, {
      props: { label: "Test Label" },
      slots: { default: "<p>body</p>" },
    });
    expect(wrapper.find(".renderer-shell-label").text()).toBe("Test Label");
  });

  it("renders slot content in body", () => {
    const wrapper = mount(RendererShell, {
      slots: { default: '<div class="test-body">Hello</div>' },
    });
    expect(wrapper.find(".test-body").exists()).toBe(true);
    expect(wrapper.find(".test-body").text()).toBe("Hello");
  });

  it("shows copy button when copyContent is provided", () => {
    const wrapper = mount(RendererShell, {
      props: { copyContent: "some text" },
      slots: { default: "<p>body</p>" },
    });
    expect(wrapper.find(".renderer-shell-copy").exists()).toBe(true);
  });

  it("does not show copy button when no copyContent", () => {
    const wrapper = mount(RendererShell, {
      slots: { default: "<p>body</p>" },
    });
    expect(wrapper.find(".renderer-shell-copy").exists()).toBe(false);
  });

  it("shows error state instead of body when error is provided", () => {
    const wrapper = mount(RendererShell, {
      props: { error: "Something went wrong" },
      slots: { default: "<p>body</p>" },
    });
    expect(wrapper.find(".renderer-shell-error").exists()).toBe(true);
    expect(wrapper.find(".renderer-shell-error").text()).toContain("Something went wrong");
    expect(wrapper.find(".renderer-shell-body").exists()).toBe(false);
  });

  it("shows truncation notice with load button", () => {
    const wrapper = mount(RendererShell, {
      props: { isTruncated: true },
      slots: { default: "<p>body</p>" },
    });
    expect(wrapper.find(".renderer-shell-truncated").exists()).toBe(true);
    expect(wrapper.find(".renderer-shell-load-btn").exists()).toBe(true);
  });

  it("emits load-full when truncation button is clicked", async () => {
    const wrapper = mount(RendererShell, {
      props: { isTruncated: true },
      slots: { default: "<p>body</p>" },
    });
    await wrapper.find(".renderer-shell-load-btn").trigger("click");
    expect(wrapper.emitted("load-full")).toHaveLength(1);
  });

  it("does not show truncation notice when not truncated", () => {
    const wrapper = mount(RendererShell, {
      slots: { default: "<p>body</p>" },
    });
    expect(wrapper.find(".renderer-shell-truncated").exists()).toBe(false);
  });

  it("hides header when no label or copyContent", () => {
    const wrapper = mount(RendererShell, {
      slots: { default: "<p>body</p>" },
    });
    expect(wrapper.find(".renderer-shell-header").exists()).toBe(false);
  });
});
