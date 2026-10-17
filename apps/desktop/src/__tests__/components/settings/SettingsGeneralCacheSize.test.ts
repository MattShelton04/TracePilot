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
afterEach(() => disposePinia(pinia));

describe("Recent sessions kept ready setting", () => {
  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    localStorage.clear();
    await usePreferencesStore(pinia).whenReady;
  });

  async function setup() {
    const prefs = usePreferencesStore(pinia);
    const wrapper = mount(SettingsGeneral);
    await flushPromises();
    const input = wrapper.get<HTMLInputElement>("input[aria-label='Recent sessions kept ready']");
    return { prefs, input };
  }

  it("lets the user clear the field and type a new value, saving it on blur", async () => {
    const { prefs, input } = await setup();
    expect(input.element.value).toBe("10");

    await input.setValue("");
    expect(input.element.value).toBe("");
    await input.setValue("5");
    await input.setValue("50");
    expect(prefs.sessionCacheSize).toBe(10);
    expect(input.element.value).toBe("50");

    await input.trigger("blur");
    expect(prefs.sessionCacheSize).toBe(50);
    expect(input.element.value).toBe("50");
  });

  it("saves the clamped value on Enter or blur and shows what it saved", async () => {
    const { prefs, input } = await setup();

    await input.setValue("-3");
    await input.trigger("keydown", { key: "Enter" });
    expect(prefs.sessionCacheSize).toBe(1);
    expect(input.element.value).toBe("1");

    await input.setValue("900");
    await input.trigger("blur");
    expect(prefs.sessionCacheSize).toBe(100);
    expect(input.element.value).toBe("100");

    // Clamping to the value already saved still corrects the field.
    await input.setValue("1000");
    await input.trigger("blur");
    expect(prefs.sessionCacheSize).toBe(100);
    expect(input.element.value).toBe("100");
  });

  it("restores the saved value when the field is left blank or Escape is pressed", async () => {
    const { prefs, input } = await setup();
    prefs.sessionCacheSize = 25;
    await flushPromises();
    expect(input.element.value).toBe("25");

    await input.setValue("");
    await input.trigger("blur");
    expect(prefs.sessionCacheSize).toBe(25);
    expect(input.element.value).toBe("25");

    await input.setValue("40");
    await input.trigger("keydown", { key: "Escape" });
    expect(prefs.sessionCacheSize).toBe(25);
    expect(input.element.value).toBe("25");
  });
});
