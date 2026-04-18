import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SegmentedControl from "../components/SegmentedControl.vue";

const options = [
  { value: "all", label: "All", count: 12 },
  { value: "builtin", label: "Built-in" },
  { value: "custom", label: "Custom" },
];

describe("SegmentedControl", () => {
  it("renders option labels", () => {
    const wrapper = mount(SegmentedControl, {
      props: { modelValue: "all", options },
    });
    expect(wrapper.text()).toContain("All");
    expect(wrapper.text()).toContain("Built-in");
    expect(wrapper.text()).toContain("Custom");
  });

  it("marks the active option with aria-checked", () => {
    const wrapper = mount(SegmentedControl, {
      props: { modelValue: "builtin", options },
    });
    const buttons = wrapper.findAll("button");
    expect(buttons[0].attributes("aria-checked")).toBe("false");
    expect(buttons[1].attributes("aria-checked")).toBe("true");
  });

  it("emits update:modelValue on click", async () => {
    const wrapper = mount(SegmentedControl, {
      props: { modelValue: "all", options },
    });
    await wrapper.findAll("button")[2].trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([["custom"]]);
  });

  it("shows count badge when present", () => {
    const wrapper = mount(SegmentedControl, {
      props: { modelValue: "all", options },
    });
    const counts = wrapper.findAll(".segment-count");
    expect(counts.length).toBe(1);
    expect(counts[0].text()).toBe("12");
  });

  it("defaults to square rounded (no pill modifier)", () => {
    const wrapper = mount(SegmentedControl, {
      props: { modelValue: "all", options },
    });
    expect(wrapper.find(".segmented-control").classes()).not.toContain(
      "segmented-control--pill",
    );
    for (const btn of wrapper.findAll("button")) {
      expect(btn.classes()).not.toContain("segment-btn--pill");
    }
  });

  it("rounded=pill applies pill modifier classes", () => {
    const wrapper = mount(SegmentedControl, {
      props: { modelValue: "all", options, rounded: "pill" },
    });
    expect(wrapper.find(".segmented-control").classes()).toContain(
      "segmented-control--pill",
    );
    for (const btn of wrapper.findAll("button")) {
      expect(btn.classes()).toContain("segment-btn--pill");
    }
  });

  it("rounded=square is the default and matches non-specified behavior", () => {
    const wrapper = mount(SegmentedControl, {
      props: { modelValue: "all", options, rounded: "square" },
    });
    expect(wrapper.find(".segmented-control").classes()).not.toContain(
      "segmented-control--pill",
    );
  });
});
