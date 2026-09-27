import { getConfig, updateConfig } from "@tracepilot/client";
import { createDeferred, setupPinia } from "@tracepilot/test-utils";
import { createDefaultConfig, type TracePilotConfig } from "@tracepilot/types";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { usePreferencesStore } from "@/stores/preferences";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock();
});

let persisted: TracePilotConfig;
beforeEach(() => {
  setupPinia();
  localStorage.clear();
  vi.useFakeTimers();
  vi.clearAllMocks();
  persisted = createDefaultConfig();
  vi.mocked(getConfig).mockImplementation(async () => persisted);
  vi.mocked(updateConfig).mockImplementation(async (patch) => {
    for (const section of Object.keys(patch) as (keyof typeof patch)[]) {
      Object.assign(persisted, { [section]: { ...persisted[section], ...patch[section] } });
    }
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
