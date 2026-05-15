import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import EmptyState from "../components/EmptyState.vue";

describe("EmptyState", () => {
  it("renders default message when no props given", () => {
    const wrapper = mount(EmptyState);
    expect(wrapper.find(".empty-state-desc").text()).toBe("No data found.");
  });

  it("renders custom description prop", () => {
    const wrapper = mount(EmptyState, {
      props: { description: "Nothing here yet." },
    });
    expect(wrapper.find(".empty-state-desc").text()).toBe("Nothing here yet.");
  });

  it("renders icon slot when provided", () => {
    const wrapper = mount(EmptyState, {
      slots: { icon: "🔍" },
    });
    expect(wrapper.find(".empty-state-icon").exists()).toBe(true);
    expect(wrapper.find(".empty-state-icon").text()).toBe("🔍");
  });

  it("does not render icon when no slot provided", () => {
    const wrapper = mount(EmptyState);
    expect(wrapper.find(".empty-state-icon").exists()).toBe(false);
  });

  it("renders title when provided", () => {
    const wrapper = mount(EmptyState, {
      props: { title: "No Results" },
    });
    expect(wrapper.find(".empty-state-title").exists()).toBe(true);
    expect(wrapper.find(".empty-state-title").text()).toBe("No Results");
  });

  it("does not render title when not provided", () => {
    const wrapper = mount(EmptyState);
    expect(wrapper.find(".empty-state-title").exists()).toBe(false);
  });

  it("applies size class for sm", () => {
    const wrapper = mount(EmptyState, {
      props: { size: "sm" },
    });
    expect(wrapper.find(".empty-state").classes()).toContain("empty-state--sm");
  });

  it("applies md size class by default", () => {
    const wrapper = mount(EmptyState);
    expect(wrapper.find(".empty-state").classes()).toContain("empty-state--md");
  });

  it("renders default slot content", () => {
    const wrapper = mount(EmptyState, {
      slots: { default: "<strong>Custom</strong> content" },
    });
    expect(wrapper.find(".empty-state-desc strong").exists()).toBe(true);
    expect(wrapper.find(".empty-state-desc").text()).toBe("Custom content");
  });

  it("renders actions slot when provided", () => {
    const wrapper = mount(EmptyState, {
      slots: { actions: '<button class="btn">Go Back</button>' },
    });
    expect(wrapper.find(".empty-state-actions").exists()).toBe(true);
    expect(wrapper.find(".empty-state-actions .btn").text()).toBe("Go Back");
  });

  it("does not render actions container when no actions slot", () => {
    const wrapper = mount(EmptyState);
    expect(wrapper.find(".empty-state-actions").exists()).toBe(false);
  });

  it("renders all props together", () => {
    const wrapper = mount(EmptyState, {
      props: { title: "Not Found", description: "Page missing." },
      slots: { icon: "404" },
    });
    expect(wrapper.find(".empty-state-icon").text()).toBe("404");
    expect(wrapper.find(".empty-state-title").text()).toBe("Not Found");
    expect(wrapper.find(".empty-state-desc").text()).toBe("Page missing.");
  });
});
