import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import StoreMemoryRenderer from "../components/renderers/StoreMemoryRenderer.vue";

describe("StoreMemoryRenderer", () => {
  it("keeps a failed storage response distinct from the submitted memory", () => {
    const wrapper = mount(StoreMemoryRenderer, {
      props: {
        content: "Storage rejected: capacity reached.",
        args: {
          fact: "Use pnpm test.",
          subject: "Repository",
          citations: ["tests/first.ts:1", "tests/second.ts:2"],
        },
        tc: { toolName: "store_memory", isComplete: true, success: false },
      },
    });
    expect(wrapper.find(".rs--error").exists()).toBe(true);
    expect(wrapper.find(".memory-fact").text()).toBe("Use pnpm test.");
    expect(wrapper.find(".memory-response pre").text()).toBe("Storage rejected: capacity reached.");
    expect(wrapper.find(".memory-citations-text").text()).toBe(
      '["tests/first.ts:1","tests/second.ts:2"]',
    );
  });

  it("shows storage confirmation only when it arrives", async () => {
    const tc = { toolName: "store_memory", isComplete: false };
    const wrapper = mount(StoreMemoryRenderer, {
      props: { content: "", args: { fact: "Remember this." }, tc },
    });
    expect(wrapper.find(".rs--pending").exists()).toBe(true);
    expect(wrapper.text()).toContain("Waiting for storage confirmation");
    await wrapper.setProps({
      content: "Memory stored.",
      tc: { ...tc, isComplete: true, success: true },
    });
    expect(wrapper.find(".rs--success").exists()).toBe(true);
    expect(wrapper.find(".memory-response pre").text()).toBe("Memory stored.");
    expect(wrapper.text()).not.toContain("Waiting for storage confirmation");
  });
});
