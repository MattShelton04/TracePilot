import * as client from "@tracepilot/client";
import { createDefaultConfig } from "@tracepilot/types";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { BASE_FONT_SIZE_PX, usePreferencesStore } from "../../stores/preferences";

vi.mock("@tracepilot/client", async () => {
  const actual = await vi.importActual("@tracepilot/client");
  return {
    ...(actual as any),
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
  };
});

describe("usePreferencesStore DOM side effects", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    // Reset document styles
    document.documentElement.style.fontSize = "";
    document.documentElement.style.removeProperty("--content-max-width");
    vi.clearAllMocks();
  });

  it("clamps contentMaxWidth and uiScale on load via applyConfig", async () => {
    const mockConfig = createDefaultConfig();
    mockConfig.ui.contentMaxWidth = 200; // Too small (min 400)
    mockConfig.ui.uiScale = 5.0; // Too large (max 1.3)

    vi.mocked(client.getConfig).mockResolvedValue(mockConfig);

    const store = usePreferencesStore();
    await store.whenReady;

    // Check store state (should be clamped)
    expect(store.contentMaxWidth).toBe(400);
    expect(store.uiScale).toBe(1.3);

    // Check DOM (should match clamped values)
    await nextTick();
    expect(document.documentElement.style.fontSize).toBe(`${BASE_FONT_SIZE_PX * 1.3}px`);
    expect(document.documentElement.style.getPropertyValue("--content-max-width")).toBe("400px");
  });

  it("applies default UI scale to root font-size on initialization", async () => {
    usePreferencesStore();
    await nextTick();
    expect(document.documentElement.style.fontSize).toBe(`${BASE_FONT_SIZE_PX}px`);
  });

  it("updates root font-size when uiScale changes", async () => {
    const store = usePreferencesStore();
    store.uiScale = 1.2;
    await nextTick();
    expect(document.documentElement.style.fontSize).toBe(`${BASE_FONT_SIZE_PX * 1.2}px`);
  });

  it("clamps root font-size even if uiScale is out of range", async () => {
    const store = usePreferencesStore();
    store.uiScale = 2.0; // Out of range (max 1.3)
    await nextTick();
    // applyUiScale clamps to 1.3
    expect(document.documentElement.style.fontSize).toBe(`${BASE_FONT_SIZE_PX * 1.3}px`);
  });

  it("applies default content max width to CSS variable on initialization", async () => {
    usePreferencesStore();
    await nextTick();
    expect(document.documentElement.style.getPropertyValue("--content-max-width")).toBe("1600px");
  });

  it("updates --content-max-width when contentMaxWidth changes", async () => {
    const store = usePreferencesStore();
    store.contentMaxWidth = 1600;
    await nextTick();
    expect(document.documentElement.style.getPropertyValue("--content-max-width")).toBe("1600px");
  });

  it("sets --content-max-width to none when contentMaxWidth is 0", async () => {
    const store = usePreferencesStore();
    store.contentMaxWidth = 0;
    await nextTick();
    expect(document.documentElement.style.getPropertyValue("--content-max-width")).toBe("none");
  });

  it("triggers auto-save when sessionStateDir changes", async () => {
    vi.useFakeTimers();

    const mockConfig = createDefaultConfig();
    vi.mocked(client.getConfig).mockResolvedValue(mockConfig);
    vi.mocked(client.saveConfig).mockResolvedValue(undefined);
    // checkConfigExists is spread from the actual client which falls through
    // to mock mode — mock it here to return true so hydrate() loads the config.
    const checkConfigSpy = vi.spyOn(client, "checkConfigExists").mockResolvedValue(true);

    const store = usePreferencesStore();
    await store.whenReady;

    // Clear any initial save calls from hydration
    vi.mocked(client.saveConfig).mockClear();
    vi.mocked(client.getConfig).mockResolvedValue(createDefaultConfig());

    // Change sessionStateDir — should trigger the watcher → scheduleSave
    store.sessionStateDir = "/new/session/dir";
    await nextTick();

    // Advance past the 300ms debounce
    vi.advanceTimersByTime(350);

    // Wait for the async save to complete
    await vi.runAllTimersAsync();
    await nextTick();

    // saveConfig should have been called with the updated sessionStateDir
    expect(client.saveConfig).toHaveBeenCalled();
    const savedConfig = vi.mocked(client.saveConfig).mock.calls[0][0];
    expect(savedConfig.paths.sessionStateDir).toBe("/new/session/dir");

    checkConfigSpy.mockRestore();
    vi.useRealTimers();
  });
});
