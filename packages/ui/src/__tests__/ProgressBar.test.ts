import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ProgressBar from "../components/ProgressBar.vue";

describe("ProgressBar", () => {
  it("renders with correct ARIA attributes", () => {
    const wrapper = mount(ProgressBar, {
      props: { percent: 75, ariaLabel: "Loading progress" },
    });
    const bar = wrapper.find("[role='progressbar']");
    expect(bar.exists()).toBe(true);
    expect(bar.attributes("aria-valuenow")).toBe("75");
    expect(bar.attributes("aria-valuemin")).toBe("0");
    expect(bar.attributes("aria-valuemax")).toBe("100");
    expect(bar.attributes("aria-label")).toBe("Loading progress");
  });

  it("uses progress-bar design system class", () => {
    const wrapper = mount(ProgressBar, {
      props: { percent: 50 },
    });
    expect(wrapper.find(".progress-bar").exists()).toBe(true);
    expect(wrapper.find(".progress-bar-fill").exists()).toBe(true);
  });

  it("sets width based on percent", () => {
    const wrapper = mount(ProgressBar, {
      props: { percent: 60 },
    });
    const fill = wrapper.find(".progress-bar-fill");
    expect(fill.attributes("style")).toContain("width: 60%");
  });

  it("clamps percent to 0-100 range", () => {
    const over = mount(ProgressBar, { props: { percent: 150 } });
    expect(over.find(".progress-bar-fill").attributes("style")).toContain("width: 100%");

    const under = mount(ProgressBar, { props: { percent: -20 } });
    expect(under.find(".progress-bar-fill").attributes("style")).toContain("width: 0%");
  });

  it("defaults to accent color", () => {
    const wrapper = mount(ProgressBar, {
      props: { percent: 50 },
    });
    const fill = wrapper.find(".progress-bar-fill");
    expect(fill.attributes("style")).toContain("var(--accent-fg)");
  });

  it("applies success color", () => {
    const wrapper = mount(ProgressBar, {
      props: { percent: 50, color: "success" },
    });
    const fill = wrapper.find(".progress-bar-fill");
    expect(fill.attributes("style")).toContain("var(--success-fg)");
  });

  it("applies warning color", () => {
    const wrapper = mount(ProgressBar, {
      props: { percent: 50, color: "warning" },
    });
    const fill = wrapper.find(".progress-bar-fill");
    expect(fill.attributes("style")).toContain("var(--warning-fg)");
  });

  it("applies danger color", () => {
    const wrapper = mount(ProgressBar, {
      props: { percent: 50, color: "danger" },
    });
    const fill = wrapper.find(".progress-bar-fill");
    expect(fill.attributes("style")).toContain("var(--danger-fg)");
  });
});
