import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ReportIntentRenderer from "../components/renderers/ReportIntentRenderer.vue";

describe("ReportIntentRenderer", () => {
  it("combines intent with the actual returned acknowledgment and lifecycle", async () => {
    const tc = { toolName: "report_intent", isComplete: false };
    const wrapper = mount(ReportIntentRenderer, {
      props: { args: { intent: "Inspect rendering" }, tc },
    });
    expect(wrapper.find(".rs--pending").exists()).toBe(true);
    expect(wrapper.text()).toContain("Recording intent");
    await wrapper.setProps({
      content: "Intent could not be recorded.",
      tc: { ...tc, isComplete: true, success: false },
    });
    expect(wrapper.findAll(".rs")).toHaveLength(1);
    expect(wrapper.find(".rs--error").exists()).toBe(true);
    expect(wrapper.find(".intent-response").text()).toBe("Intent could not be recorded.");
    expect(wrapper.find(".intent-text").text()).toBe("Inspect rendering");
  });
  it("renders intent text", () => {
    const wrapper = mount(ReportIntentRenderer, {
      props: { args: { intent: "Exploring codebase" } },
    });
    expect(wrapper.find(".intent-text").text()).toBe("Exploring codebase");
  });

  it("shows intent icon", () => {
    const wrapper = mount(ReportIntentRenderer, {
      props: { args: { intent: "Testing" } },
    });
    expect(wrapper.find(".intent-renderer").exists()).toBe(true);
  });

  it("does not render when intent is missing", () => {
    const wrapper = mount(ReportIntentRenderer, {
      props: { args: {} },
    });
    expect(wrapper.find(".intent-renderer").exists()).toBe(false);
  });
});
