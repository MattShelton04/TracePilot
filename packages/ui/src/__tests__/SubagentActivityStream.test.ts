import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SubagentActivityStream from "../components/SubagentPanel/SubagentActivityStream.vue";

describe("subagent reasoning previews", () => {
  it.each([
    ["**Checking child changes**\n\nFull details.", "Checking child changes"],
    ["Older plain reasoning\nMore details.", "Older plain reasoning"],
  ])("keeps a readable preview while expanded and collapsed for %j", async (content, preview) => {
    const wrapper = mount(SubagentActivityStream, {
      props: {
        activities: [{ kind: "reasoning", key: "r1", sortKey: 1, content }],
        agentKey: "child",
        renderMarkdown: false,
        fullResults: new Map(),
        loadingResults: new Set<string>(),
        failedResults: new Set<string>(),
      },
    });
    expect(wrapper.get(".sap-reasoning-content").text()).toBe(content);
    expect(wrapper.get(".sap-reasoning-preview").text()).toBe(preview);
    expect(wrapper.get(".sap-reasoning-toggle").attributes("aria-expanded")).toBe("true");
    await wrapper.get(".sap-reasoning-toggle").trigger("click");
    expect(wrapper.get(".sap-reasoning-preview").text()).toBe(preview);
    expect(wrapper.get(".sap-reasoning-toggle").attributes("aria-expanded")).toBe("false");
    expect(wrapper.find(".sap-reasoning-content").exists()).toBe(false);
    await wrapper.get(".sap-reasoning-toggle").trigger("click");
    expect(wrapper.get(".sap-reasoning-preview").text()).toBe(preview);
    expect(wrapper.get(".sap-reasoning-content").text()).toBe(content);
    await wrapper.setProps({ agentKey: "different-child" });
    expect(wrapper.get(".sap-reasoning-content").text()).toBe(content);
    expect(wrapper.get(".sap-reasoning-preview").text()).toBe(preview);
  });
});
