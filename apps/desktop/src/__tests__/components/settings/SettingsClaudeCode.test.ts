import {
  type ClaudeCleanupPeriod,
  getClaudeCleanupPeriod,
  IPC_EVENTS,
  validateClaudeConfigDir,
} from "@tracepilot/client";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import SettingsClaudeCode from "@/components/settings/SettingsClaudeCode.vue";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { usePreferencesStore } from "@/stores/preferences";
import { openExternal } from "@/utils/openExternal";

vi.mock("@/utils/openExternal", () => ({ openExternal: vi.fn() }));

const listeners = vi.hoisted(() => new Map<string, Set<() => void>>());
vi.mock("@/utils/tauriEvents", () => ({
  safeListen: vi.fn(async (event: string, handler: () => void) => {
    const handlers = listeners.get(event) ?? new Set();
    handlers.add(handler);
    listeners.set(event, handlers);
    return () => handlers.delete(handler);
  }),
}));

function emit(event: string) {
  for (const handler of listeners.get(event) ?? []) handler();
}

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  const { createDefaultConfig } = await import("@tracepilot/types");
  const config = createDefaultConfig({
    general: { setupComplete: true },
    sources: { claudeCode: { configDir: "C:\\Users\\demo\\.claude" } },
  });
  return createClientMock({
    getConfig: vi.fn(async () => config),
    getClaudeCleanupPeriod: vi.fn(async () => ({
      state: "notSet" as const,
      days: null,
      file: "C:\\Users\\demo\\.claude\\settings.json",
    })),
    validateClaudeConfigDir: vi.fn(),
  });
});

enableAutoUnmount(afterEach);
let pinia: ReturnType<typeof createPinia>;
afterEach(() => disposePinia(pinia));

async function mountSection() {
  const wrapper = mount(SettingsClaudeCode);
  await flushPromises();
  return wrapper;
}

function switchOf(wrapper: Awaited<ReturnType<typeof mountSection>>) {
  return wrapper.get('[role="switch"][aria-label="Claude Code sessions"]');
}

describe("SettingsClaudeCode", () => {
  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    localStorage.clear();
    listeners.clear();
    await usePreferencesStore(pinia).whenReady;
  });

  it("is an experimental section that starts off with its settings hidden", async () => {
    const wrapper = await mountSection();

    expect(wrapper.get(".settings-section-title").text()).toBe("Claude Code");
    expect(wrapper.get(".feature-group-title").text()).toBe("Experimental");
    expect(switchOf(wrapper).attributes("aria-checked")).toBe("false");
    expect(wrapper.findAll(".setting-row")).toHaveLength(1);
    expect(wrapper.find("#settings-claude-code-folder").exists()).toBe(false);
    expect(wrapper.find("#settings-claude-code-cli").exists()).toBe(false);
  });

  it("toggles the same feature flag and shows folder and command while on", async () => {
    const preferences = usePreferencesStore(pinia);
    const wrapper = await mountSection();

    await switchOf(wrapper).trigger("click");
    await flushPromises();
    expect(preferences.isFeatureEnabled("claudeCodeSessions")).toBe(true);
    expect(switchOf(wrapper).attributes("aria-checked")).toBe("true");
    const labels = wrapper.findAll(".setting-label").map((label) => label.text());
    expect(labels).toEqual(["Claude Code sessions", "Claude Code folder", "Claude Code command"]);
    expect(wrapper.get<HTMLInputElement>("#settings-claude-code-folder").element.value).toBe(
      "C:\\Users\\demo\\.claude",
    );

    await switchOf(wrapper).trigger("click");
    await nextTick();
    expect(preferences.isFeatureEnabled("claudeCodeSessions")).toBe(false);
    expect(wrapper.find("#settings-claude-code-folder").exists()).toBe(false);
    expect(wrapper.find("#settings-claude-code-cli").exists()).toBe(false);
  });

  it("holds the folder while an index is running", async () => {
    usePreferencesStore(pinia).toggleFeature("claudeCodeSessions");
    const wrapper = await mountSection();
    const folder = () => wrapper.get<HTMLInputElement>("#settings-claude-code-folder");
    expect(folder().element.disabled).toBe(false);

    emit(IPC_EVENTS.INDEXING_STARTED);
    await nextTick();
    expect(folder().element.disabled).toBe(true);

    emit(IPC_EVENTS.INDEXING_FINISHED);
    await nextTick();
    expect(folder().element.disabled).toBe(false);
  });

  describe("transcript cleanup notice", () => {
    const notice = '[data-tp-component="Banner"]';

    it("explains Claude Code's cleanup, links its docs and stays dismissed", async () => {
      const wrapper = await mountSection();
      expect(wrapper.find(notice).exists()).toBe(false);

      usePreferencesStore(pinia).toggleFeature("claudeCodeSessions");
      await nextTick();
      const banner = wrapper.get(notice);
      expect(banner.text()).toContain(
        "Claude Code deletes transcripts older than cleanupPeriodDays",
      );
      expect(banner.text()).toContain("~/.claude/settings.json");
      expect(banner.text()).toContain("CLAUDE_CONFIG_DIR");

      await banner.get("button.action-btn").trigger("click");
      expect(openExternal).toHaveBeenCalledWith(
        "https://code.claude.com/docs/en/settings-reference#cleanupperioddays",
      );

      await banner.get('button[aria-label="Dismiss"]').trigger("click");
      await nextTick();
      expect(wrapper.find(notice).exists()).toBe(false);
      expect(localStorage.getItem(STORAGE_KEYS.claudeRetentionNoticeDismissed)).toBe("true");

      wrapper.unmount();
      expect((await mountSection()).find(notice).exists()).toBe(false);
    });

    const file = "C:\\Users\\demo\\.claude\\settings.json";
    it.each<[string, Omit<ClaudeCleanupPeriod, "file">, string, boolean]>([
      ["a large value", { state: "set", days: 3650 }, "Your current setting: 3650 days.", false],
      ["a low value", { state: "set", days: 7 }, "7 days, shorter than the 30-day default", true],
      ["zero", { state: "set", days: 0 }, "0 days. Claude Code rejects values below 1", true],
      ["no value", { state: "notSet", days: null }, "not set, so the default of 30 days", false],
      ["no file", { state: "noFile", days: null }, "not set (no settings file)", false],
      ["a bad value", { state: "valueInvalid", days: null }, "not a whole number of days", true],
      ["a bad file", { state: "fileInvalid", days: null }, "couldn't be read as JSON", true],
    ])("shows %s from the user settings file", async (_, result, text, warn) => {
      vi.mocked(getClaudeCleanupPeriod).mockResolvedValueOnce({ ...result, file });
      usePreferencesStore(pinia).toggleFeature("claudeCodeSessions");
      const wrapper = await mountSection();

      const readout = wrapper.get('[data-testid="claude-cleanup-readout"]');
      expect(readout.text()).toContain(text);
      expect(readout.text()).toContain(`Checked ${file}`);
      expect(wrapper.get(notice).classes()).toContain(warn ? "banner--warning" : "banner--info");
    });

    it("flags a blank or unusable folder without naming a file", async () => {
      vi.mocked(getClaudeCleanupPeriod).mockResolvedValueOnce({
        state: "folderInvalid",
        days: null,
        file: "",
      });
      usePreferencesStore(pinia).toggleFeature("claudeCodeSessions");
      const wrapper = await mountSection();

      const readout = wrapper.get('[data-testid="claude-cleanup-readout"]');
      expect(readout.text()).toBe(
        "Your current setting: unknown. The Claude Code folder isn't valid.",
      );
      expect(wrapper.get(notice).classes()).toContain("banner--warning");
    });

    it("says the setting is unknown when it can't be read", async () => {
      vi.mocked(getClaudeCleanupPeriod).mockRejectedValueOnce(new Error("ipc down"));
      usePreferencesStore(pinia).toggleFeature("claudeCodeSessions");
      const wrapper = await mountSection();

      const readout = wrapper.get('[data-testid="claude-cleanup-readout"]');
      expect(readout.text()).toBe("Your current setting: unknown.");
    });

    it("doesn't read the settings file once dismissed", async () => {
      localStorage.setItem(STORAGE_KEYS.claudeRetentionNoticeDismissed, "true");
      vi.mocked(getClaudeCleanupPeriod).mockClear();
      usePreferencesStore(pinia).toggleFeature("claudeCodeSessions");
      await mountSection();

      expect(getClaudeCleanupPeriod).not.toHaveBeenCalled();
    });

    it("re-reads the setting after a new folder is applied", async () => {
      vi.mocked(getClaudeCleanupPeriod).mockClear();
      vi.mocked(getClaudeCleanupPeriod).mockResolvedValueOnce({ state: "set", days: 3650, file });
      usePreferencesStore(pinia).toggleFeature("claudeCodeSessions");
      const wrapper = await mountSection();
      const readout = () => wrapper.get('[data-testid="claude-cleanup-readout"]').text();
      expect(readout()).toContain("3650 days");

      const newFile = "D:\\claude\\settings.json";
      vi.mocked(validateClaudeConfigDir).mockResolvedValueOnce({
        valid: true,
        sessionCount: 1,
        error: null,
      });
      vi.mocked(getClaudeCleanupPeriod).mockResolvedValueOnce({
        state: "set",
        days: 7,
        file: newFile,
      });
      await wrapper.get("#settings-claude-code-folder").setValue("D:\\claude");
      const apply = wrapper.findAll("button").find((button) => button.text() === "Apply");
      await apply?.trigger("click");
      await flushPromises();

      expect(getClaudeCleanupPeriod).toHaveBeenCalledTimes(2);
      expect(readout()).toContain("7 days");
      expect(readout()).toContain(`Checked ${newFile}`);
    });
  });
});
