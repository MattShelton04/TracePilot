import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import LoadingSpinner from "../components/LoadingSpinner.vue";

describe("LoadingSpinner", () => {
  it("renders with medium size by default", () => {
    const wrapper = mount(LoadingSpinner);
    const svg = wrapper.find("svg");
    expect(svg.attributes("width")).toBe("24");
    expect(svg.attributes("height")).toBe("24");
  });

  it("renders sm size with correct attributes", () => {
    const wrapper = mount(LoadingSpinner, { props: { size: "sm" } });
    const svg = wrapper.find("svg");
    expect(svg.attributes("width")).toBe("16");
    expect(svg.attributes("height")).toBe("16");
  });

  it("renders lg size with correct attributes", () => {
    const wrapper = mount(LoadingSpinner, { props: { size: "lg" } });
    const svg = wrapper.find("svg");
    expect(svg.attributes("width")).toBe("32");
    expect(svg.attributes("height")).toBe("32");
  });

  it("contains an SVG element", () => {
    const wrapper = mount(LoadingSpinner);
    expect(wrapper.find("svg").exists()).toBe(true);
  });

  it("has role=status for accessibility", () => {
    const wrapper = mount(LoadingSpinner);
    expect(wrapper.attributes("role")).toBe("status");
    expect(wrapper.attributes("aria-label")).toBe("Loading");
  });
});
