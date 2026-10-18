import { setupPinia } from "@tracepilot/test-utils";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../../__tests__/mocks/client");
  return createClientMock();
});

import { ConfirmDialog } from "@tracepilot/ui";
import { defineComponent, h } from "vue";
import { usePreferencesStore } from "@/stores/preferences";
import { DEFAULT_WHOLESALE_PRICES } from "@/stores/preferences/pricing";
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

  it("asks before Reset defaults replaces custom rates, and keeps them on cancel", async () => {
    const host = mount(
      defineComponent({ setup: () => () => h("div", [h(SettingsPricing), h(ConfirmDialog)]) }),
      { attachTo: document.body },
    );
    try {
      await flushPromises();
      const preferences = usePreferencesStore();
      preferences.addWholesalePrice({
        model: "custom-model",
        inputPerM: 1,
        cachedInputPerM: 0.1,
        cacheWritePerM: 0,
        outputPerM: 2,
      });
      const models = () => preferences.modelWholesalePrices.map((p) => p.model);
      const dialog = () => document.body.querySelector<HTMLElement>('[role="alertdialog"]');
      const reset = host.findAll("button").find((b) => b.text() === "Reset defaults");
      if (!reset) throw new Error("Reset defaults button not found");

      reset.element.focus();
      await reset.trigger("click");
      await flushPromises();
      expect(models()).toContain("custom-model");
      expect(dialog()?.textContent).toContain("Reset fallback rates to defaults?");

      dialog()?.querySelector<HTMLButtonElement>(".btn-secondary")?.click();
      await flushPromises();
      expect(dialog()).toBeNull();
      expect(models()).toContain("custom-model");
      expect(document.activeElement).toBe(reset.element);

      await reset.trigger("click");
      await flushPromises();
      dialog()?.querySelector<HTMLButtonElement>(".btn-confirm")?.click();
      await flushPromises();
      expect(models()).not.toContain("custom-model");
      expect(models()).toEqual(DEFAULT_WHOLESALE_PRICES.map((p) => p.model));
    } finally {
      host.unmount();
    }
  });
});
