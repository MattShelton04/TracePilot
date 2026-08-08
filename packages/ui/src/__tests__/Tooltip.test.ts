import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import Tooltip from "../components/Tooltip.vue";

enableAutoUnmount(afterEach);

describe("Tooltip", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders text bubble with role=tooltip", () => {
    mount(Tooltip, { props: { text: "Hi" }, slots: { default: "<button>x</button>" } });
    const bubble = document.body.querySelector('[role="tooltip"]');
    expect(bubble?.textContent).toBe("Hi");
    expect(bubble?.parentElement).toBe(document.body);
  });

  it("links wrapper aria-describedby to bubble id", () => {
    const w = mount(Tooltip, { props: { text: "Hi" }, slots: { default: "<i/>" } });
    const trigger = w.find('[data-tp-component="Tooltip"]');
    const id = trigger.attributes("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id ?? "")).not.toBeNull();
  });

  it("applies position class", () => {
    const w = mount(Tooltip, {
      props: { text: "x", position: "right" },
      slots: { default: "<i/>" },
    });
    expect(w.find('[data-tp-component="Tooltip"]').classes()).toContain("tooltip--right");
  });

  it("reveals the fixed bubble on hover", async () => {
    const w = mount(Tooltip, { props: { text: "x" }, slots: { default: "<i/>" } });
    await w.find('[data-tp-component="Tooltip"]').trigger("mouseenter");
    await w.vm.$nextTick();

    const bubble = document.body.querySelector('[role="tooltip"]');
    expect(bubble?.classList.contains("tooltip__bubble--visible")).toBe(true);
    expect((bubble as HTMLElement).style.left).toBe("8px");
    expect((bubble as HTMLElement).style.top).toBe("8px");
  });

  it("flips away from a viewport edge instead of being clipped", async () => {
    const w = mount(Tooltip, {
      props: { text: "A wider explanation", position: "left" },
      slots: { default: "<i/>" },
    });
    const trigger = w.find('[data-tp-component="Tooltip"]');
    const bubble = document.body.querySelector('[role="tooltip"]') as HTMLElement;
    vi.spyOn(trigger.element, "getBoundingClientRect").mockReturnValue(new DOMRect(2, 40, 10, 10));
    vi.spyOn(bubble, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 20));

    await trigger.trigger("mouseenter");
    await w.vm.$nextTick();

    expect(bubble.classList.contains("tooltip__bubble--right")).toBe(true);
    expect(bubble.style.left).toBe("18px");
  });

  it("hides bubble and aria when disabled", () => {
    const w = mount(Tooltip, { props: { text: "x", disabled: true }, slots: { default: "<i/>" } });
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    expect(w.find('[data-tp-component="Tooltip"]').attributes("aria-describedby")).toBeUndefined();
  });
});
