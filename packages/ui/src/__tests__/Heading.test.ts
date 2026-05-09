import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Heading from "../components/Heading.vue";

describe("Heading", () => {
  it("renders an h1 by default for level=1", () => {
    const wrapper = mount(Heading, {
      props: { level: 1 },
      slots: { default: "Title" },
    });
    expect(wrapper.element.tagName).toBe("H1");
    expect(wrapper.text()).toBe("Title");
    expect(wrapper.classes()).toContain("heading--1");
    expect(wrapper.classes()).toContain("heading--w600");
  });

  it("maps level 2 to an h2 element with heading--2 class", () => {
    const wrapper = mount(Heading, {
      props: { level: 2 },
      slots: { default: "Section" },
    });
    expect(wrapper.element.tagName).toBe("H2");
    expect(wrapper.classes()).toContain("heading--2");
  });

  it("respects `as` override decoupled from level (h2 visual size, h1 semantic tag)", () => {
    const wrapper = mount(Heading, {
      props: { level: 2, as: "h1" },
      slots: { default: "Hybrid" },
    });
    expect(wrapper.element.tagName).toBe("H1");
    expect(wrapper.classes()).toContain("heading--2");
  });

  it("applies weight modifier", () => {
    const wrapper = mount(Heading, {
      props: { level: 3, weight: 700 },
      slots: { default: "Bold" },
    });
    expect(wrapper.classes()).toContain("heading--w700");
  });

  it("applies truncate modifier", () => {
    const wrapper = mount(Heading, {
      props: { level: 3, truncate: true },
      slots: { default: "Long" },
    });
    expect(wrapper.classes()).toContain("heading--truncate");
  });

  it("applies mono modifier", () => {
    const wrapper = mount(Heading, {
      props: { level: 3, mono: true },
      slots: { default: "abc-123" },
    });
    expect(wrapper.classes()).toContain("heading--mono");
  });

  it("exposes data-tp-component selector", () => {
    const wrapper = mount(Heading, {
      props: { level: 1 },
      slots: { default: "T" },
    });
    expect(wrapper.attributes("data-tp-component")).toBe("Heading");
  });
});
