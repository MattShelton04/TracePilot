import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TerminologyLegend from "../components/TerminologyLegend.vue";

const sampleItems = [
  { term: "Turn", definition: "A single model interaction" },
  { term: "Tool Call", definition: "An invocation of an external tool" },
  { term: "Agent", definition: "An autonomous task runner" },
];

describe("TerminologyLegend", () => {
  it("renders the toggle button", () => {
    const wrapper = mount(TerminologyLegend, { props: { items: sampleItems } });
    const btn = wrapper.find("button.terminology-toggle");
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain("Terminology");
  });

  it("hides items by default", () => {
    const wrapper = mount(TerminologyLegend, { props: { items: sampleItems } });
    expect(wrapper.find("dl").exists()).toBe(false);
  });

  it("shows items when toggle is clicked", async () => {
    const wrapper = mount(TerminologyLegend, { props: { items: sampleItems } });
    await wrapper.find("button.terminology-toggle").trigger("click");
    expect(wrapper.find("dl").exists()).toBe(true);
  });

  it("renders correct number of term entries", async () => {
    const wrapper = mount(TerminologyLegend, { props: { items: sampleItems } });
    await wrapper.find("button.terminology-toggle").trigger("click");
    const entries = wrapper.findAll(".term-entry");
    expect(entries).toHaveLength(3);
  });

  it("updates aria-expanded attribute on toggle", async () => {
    const wrapper = mount(TerminologyLegend, { props: { items: sampleItems } });
    const btn = wrapper.find("button.terminology-toggle");
    expect(btn.attributes("aria-expanded")).toBe("false");
    await btn.trigger("click");
    expect(btn.attributes("aria-expanded")).toBe("true");
  });
});
