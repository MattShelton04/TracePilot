import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
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

  it("variant=plain suppresses value color class", () => {
    const wrapper = mount(StatCard, {
      props: { value: 5, label: "Errors", variant: "plain" },
    });
    const value = wrapper.find(".stat-card-value");
    expect(value.classes()).not.toContain("accent");
    expect(value.classes()).not.toContain("success");
    expect(value.classes()).not.toContain("warning");
    expect(value.classes()).not.toContain("danger");
    expect(value.classes()).not.toContain("done");
  });

  it("variant=plain still honors gradient", () => {
    const wrapper = mount(StatCard, {
      props: { value: 5, label: "Total", variant: "plain", gradient: true },
    });
    expect(wrapper.find(".stat-card-value").classes()).toContain("gradient-value");
  });

  it("applies accentColor as left border inline style", () => {
    const wrapper = mount(StatCard, {
      props: { value: 3, label: "Rate Limits", accentColor: "var(--warning-fg)" },
    });
    const style = wrapper.find(".stat-card").attributes("style") ?? "";
    expect(style).toContain("border-left");
    expect(style).toContain("var(--warning-fg)");
  });

  it("appends customValueClass to the value element", () => {
    const wrapper = mount(StatCard, {
      props: { value: "+42", label: "Lines", customValueClass: "lines-added-value" },
    });
    expect(wrapper.find(".stat-card-value").classes()).toContain("lines-added-value");
  });

  it("customValueClass applies alongside color class", () => {
    const wrapper = mount(StatCard, {
      props: { value: 1, label: "X", customValueClass: "custom", color: "success" },
    });
    const classes = wrapper.find(".stat-card-value").classes();
    expect(classes).toContain("custom");
    expect(classes).toContain("success");
  });

  it("labelStyle=uppercase adds modifier class to label", () => {
    const wrapper = mount(StatCard, {
      props: { value: 1, label: "Agents", labelStyle: "uppercase" },
    });
    expect(wrapper.find(".stat-card-label").classes()).toContain(
      "stat-card-label--uppercase",
    );
  });

  it("labelStyle defaults to default (no uppercase modifier)", () => {
    const wrapper = mount(StatCard, {
      props: { value: 1, label: "Agents" },
    });
    expect(wrapper.find(".stat-card-label").classes()).not.toContain(
      "stat-card-label--uppercase",
    );
  });
});
