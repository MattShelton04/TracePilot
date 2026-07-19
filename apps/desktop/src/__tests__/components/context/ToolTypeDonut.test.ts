import type { ContextToolTypeContribution } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ToolTypeDonut from "@/components/context/ToolTypeDonut.vue";

const items: ContextToolTypeContribution[] = [
  {
    toolName: "view",
    callCount: 4,
    errorCount: 0,
    argumentTokens: 20,
    resultTokens: 180,
    totalTokens: 200,
    percentage: 80,
  },
  {
    toolName: "shell",
    callCount: 2,
    errorCount: 1,
    argumentTokens: 10,
    resultTokens: 40,
    totalTokens: 50,
    percentage: 20,
  },
];

describe("ToolTypeDonut", () => {
  it("tracks the actual ring position and clears inside the donut hole", async () => {
    const wrapper = mount(ToolTypeDonut, { props: { items } });
    const svg = wrapper.find("svg");
    Object.defineProperty(svg.element, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    });

    // The same horizontal position crosses the small shell segment above the
    // centre and the larger view segment below it.
    await svg.trigger("mousemove", { clientX: 40, clientY: 40 });
    expect(wrapper.find('[role="tooltip"]').text()).toContain("shell");
    await svg.trigger("mousemove", { clientX: 40, clientY: 160 });

    const tooltip = wrapper.find('[role="tooltip"]');
    expect(tooltip.text()).toContain("view");
    expect(tooltip.text()).toContain("80.0%");
    expect(tooltip.text()).toContain("4 calls");
    expect(tooltip.text()).toContain("180 results");

    await svg.trigger("mousemove", { clientX: 100, clientY: 100 });
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
  });

  it("supports keyboard focus for the same tooltip", async () => {
    const wrapper = mount(ToolTypeDonut, { props: { items } });

    await wrapper.find(".tool-donut__segment").trigger("focus");

    expect(wrapper.find('[role="tooltip"]').text()).toContain("200 tokens");
  });
});
