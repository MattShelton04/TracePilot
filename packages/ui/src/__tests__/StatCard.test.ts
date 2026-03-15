import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import StatCard from "../components/StatCard.vue";

describe("StatCard", () => {
  it("renders value and label", () => {
    const wrapper = mount(StatCard, {
      props: { value: 42, label: "Sessions" },
    });
    expect(wrapper.text()).toContain("42");
    expect(wrapper.text()).toContain("Sessions");
  });

  it("uses stat-card design system class", () => {
    const wrapper = mount(StatCard, {
      props: { value: 10, label: "Count" },
    });
    expect(wrapper.find(".stat-card").exists()).toBe(true);
    expect(wrapper.find(".stat-card-value").exists()).toBe(true);
    expect(wrapper.find(".stat-card-label").exists()).toBe(true);
  });

  it("applies color class to value", () => {
    const wrapper = mount(StatCard, {
      props: { value: 5, label: "Errors", color: "danger" },
    });
    expect(wrapper.find(".stat-card-value").classes()).toContain("danger");
  });

  it("defaults to accent color", () => {
    const wrapper = mount(StatCard, {
      props: { value: 5, label: "Items" },
    });
    expect(wrapper.find(".stat-card-value").classes()).toContain("accent");
  });

  it("applies gradient-value class when gradient prop is true", () => {
    const wrapper = mount(StatCard, {
      props: { value: "1.2K", label: "Total", gradient: true },
    });
    expect(wrapper.find(".gradient-value").exists()).toBe(true);
  });

  it("does not apply gradient-value when gradient is false", () => {
    const wrapper = mount(StatCard, {
      props: { value: "1.2K", label: "Total", gradient: false },
    });
    expect(wrapper.find(".gradient-value").exists()).toBe(false);
  });

  it("shows trend when trend prop provided", () => {
    const wrapper = mount(StatCard, {
      props: { value: 42, label: "Sessions", trend: "+12.5%", trendDirection: "up" },
    });
    expect(wrapper.text()).toContain("+12.5%");
    expect(wrapper.find(".stat-card-trend").classes()).toContain("up");
  });

  it("shows down arrow for downward trend", () => {
    const wrapper = mount(StatCard, {
      props: { value: 42, label: "Sessions", trend: "-3.2%", trendDirection: "down" },
    });
    expect(wrapper.text()).toContain("-3.2%");
    expect(wrapper.find(".stat-card-trend").classes()).toContain("down");
  });

  it("does not show trend when no trend prop", () => {
    const wrapper = mount(StatCard, {
      props: { value: 42, label: "Sessions" },
    });
    expect(wrapper.find(".stat-card-trend").exists()).toBe(false);
  });

  it("renders string values", () => {
    const wrapper = mount(StatCard, {
      props: { value: "$12.50", label: "Cost" },
    });
    expect(wrapper.text()).toContain("$12.50");
  });
});
