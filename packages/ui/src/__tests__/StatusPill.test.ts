import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import StatusPill from "../components/StatusPill.vue";

describe("StatusPill", () => {
  it("renders the label text", () => {
    const wrapper = mount(StatusPill, { props: { tone: "success", label: "Passed" } });
    expect(wrapper.find(".pill__label").text()).toBe("Passed");
  });

  it("applies tone class", () => {
    const wrapper = mount(StatusPill, { props: { tone: "danger", label: "Failed" } });
    expect(wrapper.classes()).toContain("pill--danger");
    expect(wrapper.classes()).toContain("pill--subtle");
  });

  it("applies size modifier (xs)", () => {
    const wrapper = mount(StatusPill, { props: { tone: "neutral", label: "n/a", size: "xs" } });
    expect(wrapper.classes()).toContain("pill--xs");
  });

  it("defaults size to sm", () => {
    const wrapper = mount(StatusPill, { props: { tone: "neutral", label: "n/a" } });
    expect(wrapper.classes()).toContain("pill--sm");
  });

  it("supports solid variant", () => {
    const wrapper = mount(StatusPill, {
      props: { tone: "warning", label: "Warn", variant: "solid" },
    });
    expect(wrapper.classes()).toContain("pill--solid");
    expect(wrapper.classes()).not.toContain("pill--subtle");
  });

  it("renders the icon slot when provided", () => {
    const wrapper = mount(StatusPill, {
      props: { tone: "success", label: "OK" },
      slots: { icon: '<svg class="ic" />' },
    });
    expect(wrapper.find(".pill__icon").exists()).toBe(true);
    expect(wrapper.find(".pill__icon .ic").exists()).toBe(true);
  });

  it("exposes role=status with aria-label matching the label", () => {
    const wrapper = mount(StatusPill, { props: { tone: "accent", label: "Running" } });
    expect(wrapper.attributes("role")).toBe("status");
    expect(wrapper.attributes("aria-label")).toBe("Running");
  });

  it("exposes data-tp-component selector", () => {
    const wrapper = mount(StatusPill, { props: { tone: "neutral", label: "x" } });
    expect(wrapper.attributes("data-tp-component")).toBe("StatusPill");
  });
});
