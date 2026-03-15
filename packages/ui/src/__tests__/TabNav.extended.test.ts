import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
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
});
