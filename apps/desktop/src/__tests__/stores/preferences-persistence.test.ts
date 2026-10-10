import { factoryReset, getConfig, saveConfig, updateConfig } from "@tracepilot/client";
import { createDeferred, setupPinia } from "@tracepilot/test-utils";
import { createDefaultConfig, type TracePilotConfig } from "@tracepilot/types";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { usePreferencesStore } from "@/stores/preferences";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({ factoryReset: vi.fn().mockResolvedValue(undefined) });
});

let persisted: TracePilotConfig;
beforeEach(() => {
  setupPinia();
  localStorage.clear();
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(factoryReset).mockReset().mockResolvedValue(undefined);
  persisted = createDefaultConfig();
  vi.mocked(getConfig).mockImplementation(async () => structuredClone(persisted));
  vi.mocked(updateConfig).mockImplementation(async (patch) => {
    // Field-level like the backend, one level deeper for `sources.claudeCode`.
    const { sources, ...sections } = patch;
    for (const section of Object.keys(sections) as (keyof typeof sections)[]) {
      Object.assign(persisted, { [section]: { ...persisted[section], ...sections[section] } });
    }
    if (sources?.claudeCode) Object.assign(persisted.sources.claudeCode, sources.claudeCode);
    return structuredClone(persisted);
  });
});
afterEach(() => {
  usePreferencesStore().$dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("preserves a Data Storage path update when a later theme change is persisted", async () => {
  const store = usePreferencesStore();
  await store.whenReady;
  await store.updateConfigFields({ paths: { sessionStateDir: "D:/copilot/session-state" } });
  expect(store.sessionStateDir).toBe("D:/copilot/session-state");
  store.theme = "light";
  await nextTick();
  await vi.advanceTimersByTimeAsync(350);
  expect(updateConfig).toHaveBeenLastCalledWith({ ui: { theme: "light" } });
  expect(persisted.paths.sessionStateDir).toBe("D:/copilot/session-state");
});

it("does not send stale locally owned fields when another caller changed the backend", async () => {
  const store = usePreferencesStore();
  await store.whenReady;
  persisted.paths.sessionStateDir = "D:/external/session-state";
  store.theme = "light";
  await nextTick();
  await vi.advanceTimersByTimeAsync(350);
  expect(updateConfig).toHaveBeenLastCalledWith({ ui: { theme: "light" } });
  expect(store.sessionStateDir).toBe("D:/external/session-state");
});

it("keeps edits made during a save and persists them in the following write", async () => {
  const store = usePreferencesStore();
  await store.whenReady;
  const save = createDeferred<TracePilotConfig>();
  vi.mocked(updateConfig).mockReturnValueOnce(save.promise);
  store.theme = "light";
  await nextTick();
  await vi.advanceTimersByTimeAsync(350);
  store.theme = "dark";
  await nextTick();
  persisted.ui.theme = "light";
  save.resolve(structuredClone(persisted));
  await vi.advanceTimersByTimeAsync(350);
  expect(store.theme).toBe("dark");
  expect(updateConfig).toHaveBeenLastCalledWith({ ui: { theme: "dark" } });
  expect(persisted.ui.theme).toBe("dark");
});

it("cancels a pending debounced save when its store is disposed", async () => {
  const store = usePreferencesStore();
  await store.whenReady;
  store.theme = "light";
  await nextTick();
  store.$dispose();
  await vi.advanceTimersByTimeAsync(350);
  expect(updateConfig).not.toHaveBeenCalled();
});

it("cancels a pending debounce and keeps preference writes suspended after reset", async () => {
  const store = usePreferencesStore();
  await store.whenReady;
  store.theme = "light";
  await nextTick();
  await store.resetConfig();
  store.uiScale = 1.2;
  await nextTick();
  await vi.advanceTimersByTimeAsync(500);

  expect(factoryReset).toHaveBeenCalledTimes(1);
  expect(updateConfig).not.toHaveBeenCalled();
  await expect(store.updateConfigFields({ ui: { theme: "dark" } })).rejects.toThrow(
    "during factory reset",
  );
  expect(updateConfig).not.toHaveBeenCalled();
});

it("drains an in-flight write and its queued successor before resetting", async () => {
  const store = usePreferencesStore();
  await store.whenReady;
  const saving = createDeferred<TracePilotConfig>();
  vi.mocked(updateConfig).mockReturnValueOnce(saving.promise);
  const first = store.updateConfigFields({ ui: { theme: "light" } });
  await vi.advanceTimersByTimeAsync(0);
  const second = store.updateConfigFields({ ui: { uiScale: 1.2 } });
  await vi.advanceTimersByTimeAsync(0);
  const resetting = store.resetConfig();
  await vi.advanceTimersByTimeAsync(0);
  expect(factoryReset).not.toHaveBeenCalled();
  expect(updateConfig).toHaveBeenCalledTimes(1);

  persisted.ui.theme = "light";
  saving.resolve(structuredClone(persisted));
  await Promise.all([first, second, resetting]);
  expect(updateConfig).toHaveBeenCalledTimes(2);
  expect(factoryReset).toHaveBeenCalledTimes(1);
  expect(vi.mocked(factoryReset).mock.invocationCallOrder[0]).toBeGreaterThan(
    vi.mocked(updateConfig).mock.invocationCallOrder[1]!,
  );
  await vi.advanceTimersByTimeAsync(500);
  expect(updateConfig).toHaveBeenCalledTimes(2);
});

it("finishes an in-flight legacy hydration save before resetting", async () => {
  localStorage.setItem(STORAGE_KEYS.legacyPrefs, JSON.stringify({ theme: "light" }));
  const saving = createDeferred<void>();
  vi.mocked(saveConfig).mockReturnValueOnce(saving.promise);
  const store = usePreferencesStore();
  await vi.advanceTimersByTimeAsync(0);
  expect(saveConfig).toHaveBeenCalledTimes(1);
  const resetting = store.resetConfig();
  await vi.advanceTimersByTimeAsync(0);
  expect(factoryReset).not.toHaveBeenCalled();

  saving.resolve();
  await resetting;
  expect(factoryReset).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(500);
  expect(updateConfig).not.toHaveBeenCalled();
});

it("resumes pending edits when reset fails and allows another reset attempt", async () => {
  const store = usePreferencesStore();
  await store.whenReady;
  store.theme = "light";
  await nextTick();
  vi.mocked(factoryReset).mockRejectedValueOnce(new Error("reset unavailable"));
  await expect(store.resetConfig()).rejects.toThrow("reset unavailable");
  await vi.advanceTimersByTimeAsync(350);
  expect(updateConfig).toHaveBeenLastCalledWith({ ui: { theme: "light" } });
  expect(persisted.ui.theme).toBe("light");

  await store.resetConfig();
  expect(factoryReset).toHaveBeenCalledTimes(2);
});

it("hydrates and autosaves the Claude Code CLI command, keeping the folder", async () => {
  persisted.sources.claudeCode = { configDir: "C:/claude", cliCommand: "claude-dev" };
  const store = usePreferencesStore();
  await store.whenReady;
  expect(store.claudeCliCommand).toBe("claude-dev");
  store.claudeCliCommand = "npx claude";
  await nextTick();
  await vi.advanceTimersByTimeAsync(350);
  expect(updateConfig).toHaveBeenLastCalledWith({
    sources: { claudeCode: { cliCommand: "npx claude" } },
  });
  expect(persisted.sources.claudeCode).toEqual({
    configDir: "C:/claude",
    cliCommand: "npx claude",
  });
});

it("keeps a pending Claude Code CLI command edit when the folder is applied", async () => {
  persisted.sources.claudeCode = { configDir: "C:/claude", cliCommand: "claude-dev" };
  const store = usePreferencesStore();
  await store.whenReady;
  store.claudeCliCommand = "npx claude";
  await nextTick();
  // Apply the folder inside the autosave debounce window.
  await store.updateConfigFields({ sources: { claudeCode: { configDir: "D:/claude" } } });
  await vi.advanceTimersByTimeAsync(350);
  expect(updateConfig).toHaveBeenCalledWith({
    sources: { claudeCode: { configDir: "D:/claude", cliCommand: "npx claude" } },
  });
  expect(store.claudeCliCommand).toBe("npx claude");
  expect(persisted.sources.claudeCode).toEqual({
    configDir: "D:/claude",
    cliCommand: "npx claude",
  });
});
