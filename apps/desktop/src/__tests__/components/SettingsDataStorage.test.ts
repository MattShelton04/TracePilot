import { setupPinia } from "@tracepilot/test-utils";
import { createDefaultConfig } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsDataStorage from "@/components/settings/SettingsDataStorage.vue";

const mocks = vi.hoisted(() => ({
  browseForDirectory: vi.fn(),
  getConfig: vi.fn(),
  getDbSize: vi.fn(),
  getSessionCount: vi.fn(),
  saveConfig: vi.fn(),
  validateSessionDir: vi.fn(),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    getConfig: mocks.getConfig,
    getDbSize: mocks.getDbSize,
    getSessionCount: mocks.getSessionCount,
    saveConfig: mocks.saveConfig,
    validateSessionDir: mocks.validateSessionDir,
  });
});

vi.mock("@/composables/useBrowseDirectory", () => ({
  browseForDirectory: mocks.browseForDirectory,
}));

vi.mock("@/composables/useIndexingEvents", () => ({
  useIndexingEvents: () => ({ setup: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@tracepilot/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tracepilot/ui")>();
  return {
    ...actual,
    ActionButton: {
      props: { disabled: Boolean },
      emits: ["click"],
      template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    },
    FormInput: {
      props: { modelValue: String },
      emits: ["update:modelValue"],
      template:
        '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    SectionPanel: { template: "<section><slot /></section>" },
    formatBytes: () => "1 KB",
    toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    useConfirmDialog: () => ({ confirm: vi.fn() }),
    useToast: () => mocks.toast,
  };
});

function config() {
  return createDefaultConfig({
    paths: {
      copilotHome: "C:\\Users\\me\\.copilot",
      sessionStateDir: "C:\\Users\\me\\.copilot\\session-state",
      tracepilotHome: "C:\\Users\\me\\.copilot\\tracepilot",
      indexDbPath: "C:\\Users\\me\\.copilot\\tracepilot\\index.db",
    },
    general: { setupComplete: true },
  });
}

describe("SettingsDataStorage", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    mocks.getConfig.mockImplementation(() => Promise.resolve(config()));
    mocks.getDbSize.mockResolvedValue(1024);
    mocks.getSessionCount.mockResolvedValue(12);
    mocks.saveConfig.mockResolvedValue(undefined);
    mocks.validateSessionDir.mockResolvedValue({ valid: true, sessionCount: 12 });
  });

  it("keeps browsed path changes as a draft until Apply path changes is clicked", async () => {
    const wrapper = mount(SettingsDataStorage);
    await flushPromises();

    expect(wrapper.text()).not.toContain("Sessions directory");

    mocks.browseForDirectory.mockResolvedValue("D:\\TracePilotData");
    const browseButtons = wrapper.findAll("button").filter((button) => button.text() === "Browse…");

    await browseButtons[1].trigger("click");
    await flushPromises();

    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect((wrapper.findAll("input")[1].element as HTMLInputElement).value).toBe(
      "D:\\TracePilotData",
    );

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Apply path changes")
      ?.trigger("click");
    await flushPromises();

    expect(mocks.saveConfig).toHaveBeenCalledOnce();
    expect(mocks.saveConfig.mock.calls[0][0].paths).toMatchObject({
      tracepilotHome: "D:\\TracePilotData",
      indexDbPath: "D:\\TracePilotData\\index.db",
      sessionStateDir: "C:\\Users\\me\\.copilot\\session-state",
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Path settings saved");
  });
});
