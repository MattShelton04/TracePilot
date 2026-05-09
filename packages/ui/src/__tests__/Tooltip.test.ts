import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Tooltip from "../components/Tooltip.vue";

describe("Tooltip", () => {
  it("renders text bubble with role=tooltip", () => {
    const w = mount(Tooltip, { props: { text: "Hi" }, slots: { default: "<button>x</button>" } });
    const bubble = w.find('[role="tooltip"]');
    expect(bubble.exists()).toBe(true);
    expect(bubble.text()).toBe("Hi");
  });

  it("links wrapper aria-describedby to bubble id", () => {
    const w = mount(Tooltip, { props: { text: "Hi" }, slots: { default: "<i/>" } });
    const id = w.attributes("aria-describedby");
    expect(id).toBeTruthy();
    expect(w.find(`#${id}`).exists()).toBe(true);
  });

  it("applies position class", () => {
    const w = mount(Tooltip, {
      props: { text: "x", position: "right" },
      slots: { default: "<i/>" },
    });
    expect(w.classes()).toContain("tooltip--right");
  });

  it("hides bubble and aria when disabled", () => {
    const w = mount(Tooltip, { props: { text: "x", disabled: true }, slots: { default: "<i/>" } });
    expect(w.find('[role="tooltip"]').exists()).toBe(false);
    expect(w.attributes("aria-describedby")).toBeUndefined();
  });
});
