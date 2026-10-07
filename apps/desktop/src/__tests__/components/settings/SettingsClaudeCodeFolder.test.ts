import { updateConfig, validateClaudeConfigDir } from "@tracepilot/client";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsClaudeCodeFolder from "@/components/settings/SettingsClaudeCodeFolder.vue";
import { usePreferencesStore } from "@/stores/preferences";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  const { createDefaultConfig } = await import("@tracepilot/types");
  const config = createDefaultConfig({
    general: { setupComplete: true },
    features: { claudeCodeSessions: true },
    sources: { claudeCode: { configDir: "C:\\Users\\demo\\.claude" } },
  });
  return createClientMock({
    getConfig: vi.fn(async () => config),
    validateClaudeConfigDir: vi.fn(),
  });
});

enableAutoUnmount(afterEach);
let pinia: ReturnType<typeof createPinia>;
afterEach(() => disposePinia(pinia));

async function mountFolder() {
  const wrapper = mount(SettingsClaudeCodeFolder, { props: { disabled: false } });
  await flushPromises();
  return wrapper;
}

function applyButton(wrapper: Awaited<ReturnType<typeof mountFolder>>) {
  const button = wrapper.findAll("button").find((b) => b.text() === "Apply");
  if (!button) throw new Error("Apply button not found");
  return button;
}

describe("SettingsClaudeCodeFolder", () => {
  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.mocked(updateConfig).mockClear();
    await usePreferencesStore(pinia).whenReady;
  });

  it("shows the saved folder and applies only a changed one", async () => {
    const wrapper = await mountFolder();
    const input = wrapper.get<HTMLInputElement>("#settings-claude-code-folder");
    expect(input.element.value).toBe("C:\\Users\\demo\\.claude");
    expect(applyButton(wrapper).attributes("disabled")).toBeDefined();

    vi.mocked(validateClaudeConfigDir).mockResolvedValueOnce({
      valid: true,
      sessionCount: 2,
      error: null,
    });
    await input.setValue("D:\\claude-config");
    await applyButton(wrapper).trigger("click");
    await flushPromises();

    expect(validateClaudeConfigDir).toHaveBeenCalledWith("D:\\claude-config");
    expect(updateConfig).toHaveBeenCalledWith({
      sources: { claudeCode: { configDir: "D:\\claude-config" } },
    });
    expect(applyButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("does not save a folder that fails validation", async () => {
    const wrapper = await mountFolder();
    vi.mocked(validateClaudeConfigDir).mockResolvedValueOnce({
      valid: false,
      sessionCount: 0,
      error: "Directory does not exist",
    });
    await wrapper.get("#settings-claude-code-folder").setValue("D:\\missing");
    await applyButton(wrapper).trigger("click");
    await flushPromises();

    expect(updateConfig).not.toHaveBeenCalled();
    expect(applyButton(wrapper).attributes("disabled")).toBeUndefined();
  });
});
