import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import Badge from "../components/Badge.vue";

describe("Badge", () => {
  it("renders slot content", () => {
    const wrapper = mount(Badge, {
      slots: { default: "Hello Badge" },
    });
    expect(wrapper.text()).toBe("Hello Badge");
  });

  it("applies correct classes for accent variant", () => {
    const wrapper = mount(Badge, {
      props: { variant: "accent" },
      slots: { default: "Accent" },
    });
    expect(wrapper.classes()).toContain("bg-blue-500/10");
  });

  it("applies correct classes for success variant", () => {
    const wrapper = mount(Badge, {
      props: { variant: "success" },
      slots: { default: "Success" },
    });
    expect(wrapper.classes()).toContain("bg-green-500/10");
  });

  it("applies correct classes for warning variant", () => {
    const wrapper = mount(Badge, {
      props: { variant: "warning" },
      slots: { default: "Warning" },
    });
    expect(wrapper.classes()).toContain("bg-yellow-500/10");
  });

  it("applies correct classes for error variant", () => {
    const wrapper = mount(Badge, {
      props: { variant: "error" },
      slots: { default: "Error" },
    });
    expect(wrapper.classes()).toContain("bg-red-500/10");
  });

  it("applies correct classes for purple variant", () => {
    const wrapper = mount(Badge, {
      props: { variant: "purple" },
      slots: { default: "Purple" },
    });
    expect(wrapper.classes()).toContain("bg-purple-500/10");
  });

  it("uses default variant when no prop passed", () => {
    const wrapper = mount(Badge, {
      slots: { default: "Default" },
    });
    expect(wrapper.classes()).toContain("text-xs");
    expect(wrapper.classes()).not.toContain("bg-blue-500/10");
    expect(wrapper.classes()).not.toContain("bg-green-500/10");
  });
});
