import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ReportIntentRenderer from "../components/renderers/ReportIntentRenderer.vue";

describe("ReportIntentRenderer", () => {
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
    expect(wrapper.find(".intent-icon").text()).toBe("🎯");
  });

  it("does not render when intent is missing", () => {
    const wrapper = mount(ReportIntentRenderer, {
      props: { args: {} },
    });
    expect(wrapper.find(".intent-renderer").exists()).toBe(false);
  });
});
