import { getConfig, saveConfig } from "@tracepilot/client";
import { setupPinia } from "@tracepilot/test-utils";
import { createDefaultConfig } from "@tracepilot/types";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Component, nextTick } from "vue";
import { usePreferencesStore } from "@/stores/preferences";
import SettingsAppearance from "../SettingsAppearance.vue";
import SettingsPricing from "../SettingsPricing.vue";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../../__tests__/mocks/client");
  return createClientMock();
});

enableAutoUnmount(afterEach);
beforeEach(() => {
  setupPinia();
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(getConfig).mockResolvedValue(createDefaultConfig());
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  usePreferencesStore().$dispose();
});

async function mountSettings(component: Component) {
  const store = usePreferencesStore();
  await store.whenReady;
  await vi.advanceTimersByTimeAsync(350);
  vi.mocked(saveConfig).mockClear();
  return { store, wrapper: mount(component) };
}

describe("content width drafts", () => {
  it("preserves the running layout while typing and saves a whole width on blur", async () => {
    const { store, wrapper } = await mountSettings(SettingsAppearance);
    const input = wrapper.get<HTMLInputElement>("#settings-content-width");
    for (const draft of ["1", "16", "160", "2560"]) {
      await input.setValue(draft);
      expect(store.contentMaxWidth).toBe(1600);
      expect(document.documentElement.style.getPropertyValue("--content-max-width")).toBe("1600px");
    }
    await vi.advanceTimersByTimeAsync(350);
    expect(saveConfig).not.toHaveBeenCalled();
    await input.trigger("blur");
    expect(store.contentMaxWidth).toBe(2560);
    expect(document.documentElement.style.getPropertyValue("--content-max-width")).toBe("2560px");
    await vi.advanceTimersByTimeAsync(350);
    expect(vi.mocked(saveConfig).mock.lastCall?.[0].ui.contentMaxWidth).toBe(2560);
  });

  it.each([
    "1",
    "",
    "-1",
    "400.5",
    "1e309",
  ])("restores invalid width %j without saving it", async (draft) => {
    const { store, wrapper } = await mountSettings(SettingsAppearance);
    const input = wrapper.get<HTMLInputElement>("#settings-content-width");
    await input.setValue(draft);
    await input.trigger("blur");
    expect(input.element.value).toBe("1600");
    expect(store.contentMaxWidth).toBe(1600);
    expect(wrapper.get('[role="alert"]').text()).toContain("Previous width restored");
    await vi.advanceTimersByTimeAsync(350);
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("supports Enter, Escape, minimum width and the Full preset", async () => {
    const { store, wrapper } = await mountSettings(SettingsAppearance);
    const input = wrapper.get<HTMLInputElement>("#settings-content-width");
    await input.setValue("800");
    await input.trigger("keydown", { key: "Escape" });
    expect(input.element.value).toBe("1600");
    await input.setValue("400");
    await input.trigger("keydown", { key: "Enter" });
    expect(store.contentMaxWidth).toBe(400);
    await wrapper.get('[aria-label="Decrease content width by 200 pixels"]').trigger("click");
    expect(store.contentMaxWidth).toBe(400);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Full")!
      .trigger("click");
    expect(store.contentMaxWidth).toBe(0);
    expect(wrapper.find("#settings-content-width").exists()).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--content-max-width")).toBe("none");
    await vi.advanceTimersByTimeAsync(350);
    expect(vi.mocked(saveConfig).mock.lastCall?.[0].ui.contentMaxWidth).toBe(0);
  });

  it("normalizes direct runtime writes before CSS and persistence", async () => {
    const { store } = await mountSettings(SettingsAppearance);
    store.contentMaxWidth = 1;
    expect(store.contentMaxWidth).toBe(400);
    await nextTick();
    expect(document.documentElement.style.getPropertyValue("--content-max-width")).toBe("400px");
    await vi.advanceTimersByTimeAsync(350);
    expect(vi.mocked(saveConfig).mock.lastCall?.[0].ui.contentMaxWidth).toBe(400);
    store.contentMaxWidth = Number.NaN;
    expect(store.contentMaxWidth).toBe(1600);
  });
});

describe("pricing rate drafts", () => {
  it.each([
    "-1",
    "",
    "1e309",
  ])("rejects a new invalid rate %j without adding or saving", async (value) => {
    const { store, wrapper } = await mountSettings(SettingsPricing);
    const count = store.modelWholesalePrices.length;
    await wrapper.get(".pricing-model-input").setValue("audit-invalid-rate");
    const input = wrapper.get(".custom-rate .pricing-input");
    await input.setValue(value);
    const add = wrapper.get<HTMLButtonElement>(".custom-rate button");
    expect(add.element.disabled).toBe(true);
    expect(input.attributes("aria-invalid")).toBe("true");
    expect(wrapper.get("#pricing-new-rate-error").text()).toContain("0 or greater");
    await add.trigger("click");
    expect(store.modelWholesalePrices).toHaveLength(count);
    await vi.advanceTimersByTimeAsync(350);
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("accepts zero and small decimal custom rates", async () => {
    const { store, wrapper } = await mountSettings(SettingsPricing);
    await wrapper.get(".pricing-model-input").setValue("audit-valid-rate");
    await wrapper.get(".custom-rate .pricing-input").setValue("0.00001");
    await wrapper.get(".custom-rate button").trigger("click");
    expect(store.modelWholesalePrices.at(-1)).toMatchObject({
      model: "audit-valid-rate",
      inputPerM: 0.00001,
      cachedInputPerM: 0,
      cacheWritePerM: 0,
      outputPerM: 0,
    });
  });

  it("keeps existing invalid edits unsaved, supports Escape, and commits valid rates", async () => {
    const { store, wrapper } = await mountSettings(SettingsPricing);
    store.modelWholesalePrices = [
      {
        model: "audit-edit-rate",
        inputPerM: 2,
        cachedInputPerM: 0,
        cacheWritePerM: 0,
        outputPerM: 3,
        premiumRequests: 1,
      },
    ];
    await vi.advanceTimersByTimeAsync(350);
    vi.mocked(saveConfig).mockClear();
    const input = wrapper.get<HTMLInputElement>(
      '[aria-label="audit-edit-rate input price per 1M tokens"]',
    );
    for (const value of ["-1", "", "1e309"]) {
      await input.setValue(value);
      await input.trigger("blur");
      expect(store.modelWholesalePrices[0].inputPerM).toBe(2);
      expect(input.attributes("aria-invalid")).toBe("true");
      await vi.advanceTimersByTimeAsync(350);
      expect(saveConfig).not.toHaveBeenCalled();
    }
    await input.trigger("keydown", { key: "Escape" });
    expect(input.element.value).toBe("2");
    expect(input.attributes("aria-invalid")).toBe("false");
    await input.setValue("0.12345");
    expect(store.modelWholesalePrices[0].inputPerM).toBe(2);
    await input.trigger("keydown", { key: "Enter" });
    expect(store.modelWholesalePrices[0].inputPerM).toBe(0.12345);
    await vi.advanceTimersByTimeAsync(350);
    expect(vi.mocked(saveConfig).mock.lastCall?.[0].pricing.models[0].inputPerM).toBe(0.12345);
  });
});
