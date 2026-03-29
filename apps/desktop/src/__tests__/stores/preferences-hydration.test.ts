import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

describe("preferences hydration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("skips hydration gracefully when checkConfigExists is unavailable", async () => {
    const getConfig = vi.fn();
    const saveConfig = vi.fn();
    const logWarn = vi.fn();

    vi.doMock("@tracepilot/client", () => ({
      checkConfigExists: undefined,
      getConfig,
      saveConfig,
    }));
    vi.doMock("@/utils/logger", () => ({
      logWarn,
    }));

    const { usePreferencesStore } = await import("../../stores/preferences");
    setActivePinia(createPinia());
    const store = usePreferencesStore();

    await store.whenReady;

    expect(logWarn).toHaveBeenCalledWith(
      "[preferences] Config check unavailable; skipping hydration and using defaults",
    );
    expect(getConfig).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(store.theme).toBe("dark"); // Defaults remain intact
  });
});
