import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import TabNav from "../components/TabNav.vue";

vi.mock("vue-router", () => ({
  useRoute: () => ({ name: "session-timeline", params: { id: "test-id" } }),
  useRouter: () => ({ push: vi.fn() }),
}));

const tabs = [
  { name: "overview", routeName: "session-overview", label: "Overview" },
  { name: "timeline", routeName: "session-timeline", label: "Timeline", count: 42 },
  { name: "turns", routeName: "session-turns", label: "Turns", count: 0 },
];

describe("TabNav ARIA and design system", () => {
  it("uses tab-nav design system class", () => {
    const wrapper = mount(TabNav, { props: { tabs } });
    expect(wrapper.find(".tab-nav").exists()).toBe(true);
  });

  it("uses tab-nav-item class on each button", () => {
    const wrapper = mount(TabNav, { props: { tabs } });
    const buttons = wrapper.findAll("button");
    buttons.forEach((btn) => {
      expect(btn.classes()).toContain("tab-nav-item");
    });
  });

  it("marks active tab with .active class", () => {
    const wrapper = mount(TabNav, { props: { tabs } });
    const buttons = wrapper.findAll("button");
    // Timeline is active in this mock
    expect(buttons[1].classes()).toContain("active");
    expect(buttons[0].classes()).not.toContain("active");
  });

  it("shows count badges with tab-count class", () => {
    const wrapper = mount(TabNav, { props: { tabs } });
    const counts = wrapper.findAll(".tab-count");
    expect(counts.length).toBe(2); // Timeline (42) and Turns (0)
    expect(counts[0].text()).toBe("42");
    expect(counts[1].text()).toBe("0");
  });

  it("does not show tab-count when count is undefined", () => {
    const wrapper = mount(TabNav, { props: { tabs } });
    const buttons = wrapper.findAll("button");
    // Overview has no count
    expect(buttons[0].find(".tab-count").exists()).toBe(false);
  });

  it("has aria-selected=true on active tab", () => {
    const wrapper = mount(TabNav, { props: { tabs } });
    const buttons = wrapper.findAll("button");
    expect(buttons[1].attributes("aria-selected")).toBe("true");
    expect(buttons[0].attributes("aria-selected")).toBe("false");
  });

  it("renders icon when tab has icon field", () => {
    const iconTabs = [
      { name: "a", routeName: "a", label: "Agents", icon: "🤖" },
      { name: "b", routeName: "b", label: "Backups", icon: "💾" },
    ];
    const wrapper = mount(TabNav, { props: { tabs: iconTabs } });
    const icons = wrapper.findAll(".tab-nav-icon");
    expect(icons.length).toBe(2);
    expect(icons[0].text()).toBe("🤖");
    expect(icons[1].text()).toBe("💾");
  });

  it("omits icon span when tab has no icon", () => {
    const wrapper = mount(TabNav, { props: { tabs } });
    expect(wrapper.find(".tab-nav-icon").exists()).toBe(false);
  });

  it("variant=pill adds pill modifier classes", () => {
    const wrapper = mount(TabNav, { props: { tabs, variant: "pill" } });
    expect(wrapper.find(".tab-nav").classes()).toContain("tab-nav--pill");
    const buttons = wrapper.findAll("button");
    for (const btn of buttons) {
      expect(btn.classes()).toContain("tab-nav-item--pill");
    }
  });

  it("default variant does not apply pill classes", () => {
    const wrapper = mount(TabNav, { props: { tabs } });
    expect(wrapper.find(".tab-nav").classes()).not.toContain("tab-nav--pill");
    expect(wrapper.findAll("button")[0].classes()).not.toContain("tab-nav-item--pill");
  });

  it("staggered=true sets --stagger CSS custom property per tab", () => {
    const wrapper = mount(TabNav, { props: { tabs, staggered: true } });
    const buttons = wrapper.findAll("button");
    expect(buttons[0].attributes("style") ?? "").toContain("--stagger: 0ms");
    expect(buttons[1].attributes("style") ?? "").toContain("--stagger: 50ms");
    expect(buttons[2].attributes("style") ?? "").toContain("--stagger: 100ms");
  });

  it("staggered defaults to false (no --stagger style)", () => {
    const wrapper = mount(TabNav, { props: { tabs } });
    const buttons = wrapper.findAll("button");
    for (const btn of buttons) {
      expect(btn.attributes("style") ?? "").not.toContain("--stagger");
    }
  });
});
