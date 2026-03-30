import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ReasoningBlock from "../components/ReasoningBlock.vue";

describe("ReasoningBlock", () => {
  it("renders nothing when reasoning array is empty", () => {
    const wrapper = mount(ReasoningBlock, {
      props: { reasoning: [], expanded: false },
    });
    expect(wrapper.find(".reasoning-block").exists()).toBe(false);
  });

  it("renders toggle button with correct count for single block", () => {
    const wrapper = mount(ReasoningBlock, {
      props: { reasoning: ["thinking..."], expanded: false },
    });
    expect(wrapper.find("button").text()).toContain("1 reasoning block");
    expect(wrapper.find("button").text()).not.toContain("blocks");
  });

  it("renders toggle button with plural count for multiple blocks", () => {
    const wrapper = mount(ReasoningBlock, {
      props: { reasoning: ["first", "second", "third"], expanded: false },
    });
    expect(wrapper.find("button").text()).toContain("3 reasoning blocks");
  });

  it("hides content when not expanded", () => {
    const wrapper = mount(ReasoningBlock, {
      props: { reasoning: ["hidden content"], expanded: false },
    });
    expect(wrapper.find(".reasoning-content").exists()).toBe(false);
  });

  it("shows content when expanded", () => {
    const wrapper = mount(ReasoningBlock, {
      props: { reasoning: ["visible content"], expanded: true },
    });
    expect(wrapper.find(".reasoning-content").exists()).toBe(true);
    expect(wrapper.find(".reasoning-content").text()).toContain("visible content");
  });

  it("renders dividers between multiple reasoning blocks", () => {
    const wrapper = mount(ReasoningBlock, {
      props: { reasoning: ["first", "second", "third"], expanded: true },
    });
    const dividers = wrapper.findAll(".reasoning-divider");
    expect(dividers).toHaveLength(2);
  });

  it("does not render divider before first block", () => {
    const wrapper = mount(ReasoningBlock, {
      props: { reasoning: ["only one"], expanded: true },
    });
    expect(wrapper.findAll(".reasoning-divider")).toHaveLength(0);
  });

  it("emits toggle when button is clicked", async () => {
    const wrapper = mount(ReasoningBlock, {
      props: { reasoning: ["content"], expanded: false },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });

  it("sets aria-expanded attribute correctly", () => {
    const collapsed = mount(ReasoningBlock, {
      props: { reasoning: ["content"], expanded: false },
    });
    expect(collapsed.find("button").attributes("aria-expanded")).toBe("false");

    const expanded = mount(ReasoningBlock, {
      props: { reasoning: ["content"], expanded: true },
    });
    expect(expanded.find("button").attributes("aria-expanded")).toBe("true");
  });

  it("renders prefix slot content when provided", () => {
    const wrapper = mount(ReasoningBlock, {
      props: { reasoning: ["content"], expanded: false },
      slots: {
        prefix: '<span class="test-prefix">Agent</span>',
      },
    });
    expect(wrapper.find(".test-prefix").exists()).toBe(true);
    expect(wrapper.find(".test-prefix").text()).toBe("Agent");
  });

  it("has tabindex on expanded content for keyboard accessibility", () => {
    const wrapper = mount(ReasoningBlock, {
      props: { reasoning: ["content"], expanded: true },
    });
    expect(wrapper.find(".reasoning-content").attributes("tabindex")).toBe("0");
  });
});
