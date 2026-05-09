import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TokenBudgetBar from "../components/TokenBudgetBar.vue";

describe("TokenBudgetBar", () => {
  it("renders default label and ratio + percent", () => {
    const w = mount(TokenBudgetBar, { props: { used: 1000, total: 4000 } });
    expect(w.attributes("data-tp-component")).toBe("TokenBudgetBar");
    expect(w.text()).toContain("Context window");
    expect(w.text()).toContain("1,000 / 4,000");
    expect(w.text()).toContain("(25 %)");
  });

  it("applies ok tone below warn threshold", () => {
    const w = mount(TokenBudgetBar, { props: { used: 100, total: 1000 } });
    expect(w.classes()).toContain("tbb--ok");
  });

  it("applies warn tone at default 75% threshold", () => {
    const w = mount(TokenBudgetBar, { props: { used: 800, total: 1000 } });
    expect(w.classes()).toContain("tbb--warn");
  });

  it("applies danger tone at default 90% threshold", () => {
    const w = mount(TokenBudgetBar, { props: { used: 950, total: 1000 } });
    expect(w.classes()).toContain("tbb--danger");
  });

  it("respects custom thresholds", () => {
    const w = mount(TokenBudgetBar, {
      props: { used: 50, total: 100, thresholds: { warn: 0.4, danger: 0.6 } },
    });
    expect(w.classes()).toContain("tbb--warn");
  });

  it("renders progressbar role with aria-valuenow / valuetext", () => {
    const w = mount(TokenBudgetBar, { props: { used: 250, total: 1000, label: "Tokens" } });
    const bar = w.find('[role="progressbar"]');
    expect(bar.attributes("aria-valuenow")).toBe("25");
    expect(bar.attributes("aria-valuemin")).toBe("0");
    expect(bar.attributes("aria-valuemax")).toBe("100");
    expect(bar.attributes("aria-label")).toBe("Tokens");
    expect(bar.attributes("aria-valuetext")).toContain("250");
    expect(bar.attributes("aria-valuetext")).toContain("1,000");
  });

  it("clamps fill width at 100% on overflow", () => {
    const w = mount(TokenBudgetBar, { props: { used: 5000, total: 1000 } });
    const fill = w.find(".tbb__fill");
    expect((fill.element as HTMLElement).style.width).toBe("100%");
    expect(w.classes()).toContain("tbb--danger");
  });

  it("hides ratio / percent when disabled", () => {
    const w = mount(TokenBudgetBar, {
      props: { used: 100, total: 1000, showRatio: false, showPercent: false },
    });
    expect(w.text()).not.toContain("/");
    expect(w.text()).not.toContain("%");
  });

  it("applies sm size class", () => {
    const w = mount(TokenBudgetBar, { props: { used: 0, total: 100, size: "sm" } });
    expect(w.classes()).toContain("tbb--sm");
  });

  it("guards division by zero", () => {
    const w = mount(TokenBudgetBar, { props: { used: 100, total: 0 } });
    expect(w.find('[role="progressbar"]').attributes("aria-valuenow")).toBe("0");
  });
});
