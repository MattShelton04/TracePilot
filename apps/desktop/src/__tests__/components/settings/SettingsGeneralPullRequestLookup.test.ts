import { updateConfig } from "@tracepilot/client";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsGeneral from "@/components/settings/SettingsGeneral.vue";
import { usePreferencesStore } from "@/stores/preferences";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock();
});

enableAutoUnmount(afterEach);
let pinia: ReturnType<typeof createPinia>;
afterEach(() => {
  disposePinia(pinia);
  vi.useRealTimers();
});

describe("pull request lookup setting", () => {
  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    localStorage.clear();
    vi.clearAllMocks();
    await usePreferencesStore(pinia).whenReady;
  });

  it("is on by default and saves when switched off", async () => {
    vi.useFakeTimers();
    const prefs = usePreferencesStore(pinia);
    const wrapper = mount(SettingsGeneral);
    await flushPromises();
    const row = wrapper.get('[data-testid="setting-pull-request-lookup"]');
    expect(row.text()).toContain("Look up pull request status with the GitHub CLI");
    const toggle = row.get('[role="switch"]');
    expect(toggle.attributes("aria-checked")).toBe("true");

    await toggle.trigger("click");
    expect(prefs.pullRequestLookup).toBe(false);
    expect(toggle.attributes("aria-checked")).toBe("false");
    await vi.advanceTimersByTimeAsync(350);
    expect(updateConfig).toHaveBeenLastCalledWith({ ui: { pullRequestLookup: false } });
  });
});
