import { setupPinia } from "@tracepilot/test-utils";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../../__tests__/mocks/client");
  return createClientMock();
});

import SettingsPricing from "../SettingsPricing.vue";

describe("SettingsPricing", () => {
  beforeEach(() => {
    setupPinia();
  });

  it("explains the fallback order and removes legacy cost editing", async () => {
    const wrapper = mount(SettingsPricing);
    await flushPromises();

    expect(wrapper.text()).toContain("Observed AIC");
    expect(wrapper.text()).toContain("GitHub rate");
    expect(wrapper.text()).toContain("Local fallback");
    expect(wrapper.text()).not.toContain("Legacy cost per premium request");
    expect(wrapper.findAll(".pricing-group")).toHaveLength(4);
  });

  it("groups search results and opens matching families", async () => {
    const wrapper = mount(SettingsPricing);
    await flushPromises();

    await wrapper
      .find('input[aria-label="Search models or sources"]')
      .setValue("claude-sonnet-4.6");

    const groups = wrapper.findAll(".pricing-group");
    expect(groups).toHaveLength(1);
    expect(groups[0].text()).toContain("Anthropic Claude");
    expect(groups[0].attributes()).toHaveProperty("open");
    expect(wrapper.text()).toContain("claude-sonnet-4.6");
    expect(wrapper.text()).not.toContain("gpt-5.4");
  });
});
