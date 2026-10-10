import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsClaudeCodeCli from "@/components/settings/SettingsClaudeCodeCli.vue";
import { usePreferencesStore } from "@/stores/preferences";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  const { createDefaultConfig } = await import("@tracepilot/types");
  const config = createDefaultConfig({
    general: { setupComplete: true },
    features: { claudeCodeSessions: true },
    sources: { claudeCode: { configDir: "C:/Users/demo/.claude", cliCommand: "npx claude" } },
  });
  return createClientMock({ getConfig: vi.fn(async () => config) });
});

describe("SettingsClaudeCodeCli", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("shows and edits the Claude Code command preference", async () => {
    const prefs = usePreferencesStore();
    await prefs.whenReady;
    const wrapper = mount(SettingsClaudeCodeCli);
    await flushPromises();
    const input = wrapper.get<HTMLInputElement>("#settings-claude-code-cli");
    expect(input.element.value).toBe("npx claude");
    expect(input.attributes("placeholder")).toBe("claude");
    await input.setValue("D:/tools/claude.exe");
    expect(prefs.claudeCliCommand).toBe("D:/tools/claude.exe");
    expect(wrapper.find("[role='alert']").exists()).toBe(false);

    // A command the backend would refuse is shown as an error and never saved.
    await input.setValue("claude; calc");
    expect(wrapper.get("[role='alert']").text()).toContain("Not saved");
    expect(input.attributes("aria-invalid")).toBe("true");
    expect(prefs.claudeCliCommand).toBe("D:/tools/claude.exe");
    await input.setValue("");
    expect(prefs.claudeCliCommand).toBe("");
    wrapper.unmount();
  });
});
