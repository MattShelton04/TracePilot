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
  it("shows complete contribution details on segment hover", async () => {
    const wrapper = mount(ToolTypeDonut, { props: { items } });

    await wrapper.find(".tool-donut__segment").trigger("mouseenter");

    const tooltip = wrapper.find('[role="tooltip"]');
    expect(tooltip.text()).toContain("view");
    expect(tooltip.text()).toContain("80.0%");
    expect(tooltip.text()).toContain("4 calls");
    expect(tooltip.text()).toContain("180 results");
  });

  it("supports keyboard focus for the same tooltip", async () => {
    const wrapper = mount(ToolTypeDonut, { props: { items } });

    await wrapper.find(".tool-donut__segment").trigger("focus");

    expect(wrapper.find('[role="tooltip"]').text()).toContain("200 tokens");
  });
});
