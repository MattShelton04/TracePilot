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

describe("Copilot CLI command setting", () => {
  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    localStorage.clear();
    await usePreferencesStore(pinia).whenReady;
  });

  it("saves safe commands and keeps a command Resume would refuse as an unsaved draft", async () => {
    const prefs = usePreferencesStore(pinia);
    const wrapper = mount(SettingsGeneral);
    await flushPromises();
    const input = wrapper.get<HTMLInputElement>("input[placeholder='copilot']");

    await input.setValue("gh copilot");
    expect(prefs.cliCommand).toBe("gh copilot");
    expect(wrapper.find("[role='alert']").exists()).toBe(false);

    // `validate_cli_command` rejects `=`, so Resume would fail with this saved.
    await input.setValue("copilot --model=x");
    expect(prefs.cliCommand).toBe("gh copilot");
    expect(wrapper.get("[role='alert']").text()).toContain("Not saved");
    // Earlier valid keystrokes may have saved; the alert names what Resume uses.
    expect(wrapper.get("[role='alert']").text()).toContain("Resume uses gh copilot");
    expect(input.attributes("aria-invalid")).toBe("true");
    expect(input.element.value).toBe("copilot --model=x");

    // Blank is valid: it means the default command.
    await input.setValue("");
    expect(prefs.cliCommand).toBe("");
    expect(wrapper.find("[role='alert']").exists()).toBe(false);
  });
});
