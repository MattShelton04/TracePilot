import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { createSettingsSlice, loadSdkSettings, saveSdkSettings } from "../settings";

const KEY = STORAGE_KEYS.sdkSettings;

describe("createSettingsSlice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults cliUrl='' and logLevel='info' when storage is empty", () => {
    const slice = createSettingsSlice();
    expect(slice.savedCliUrl.value).toBe("");
    expect(slice.savedLogLevel.value).toBe("info");
  });

  it("hydrates from existing localStorage JSON", () => {
    localStorage.setItem(KEY, JSON.stringify({ cliUrl: "tcp://1.2.3.4:9000", logLevel: "debug" }));
    const slice = createSettingsSlice();
    expect(slice.savedCliUrl.value).toBe("tcp://1.2.3.4:9000");
    expect(slice.savedLogLevel.value).toBe("debug");
  });

  it("updateSettings persists values back to localStorage", () => {
    const slice = createSettingsSlice();
    slice.updateSettings("tcp://host:1", "warn");
    expect(slice.savedCliUrl.value).toBe("tcp://host:1");
    expect(slice.savedLogLevel.value).toBe("warn");
    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ cliUrl: "tcp://host:1", logLevel: "warn" });
  });

  it("loadSdkSettings tolerates malformed JSON and returns defaults", () => {
    localStorage.setItem(KEY, "{not-json");
    expect(loadSdkSettings()).toEqual({ cliUrl: "", logLevel: "info" });
  });

  it("loadSdkSettings fills missing fields with defaults while preserving provided ones", () => {
    localStorage.setItem(KEY, JSON.stringify({ cliUrl: "only-url" }));
    expect(loadSdkSettings()).toEqual({ cliUrl: "only-url", logLevel: "info" });
  });

  it("saveSdkSettings writes JSON under the configured key", () => {
    saveSdkSettings({ cliUrl: "a", logLevel: "b" });
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify({ cliUrl: "a", logLevel: "b" }));
  });
});
