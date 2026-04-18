/**
 * Persisted SDK settings slice.
 *
 * Owns `cliUrl` / `logLevel` preferences backed by `localStorage`. Kept as a
 * manual load/save (not `usePersistedRef`) to preserve the exact byte-for-byte
 * persistence semantics of the original store — writes only happen through
 * `updateSettings`, never reactively.
 */

import { ref } from "vue";
import { STORAGE_KEYS } from "@/config/storageKeys";

const SDK_SETTINGS_KEY = STORAGE_KEYS.sdkSettings;

export interface SdkSettings {
  cliUrl: string;
  logLevel: string;
}

export function loadSdkSettings(): SdkSettings {
  try {
    const raw = localStorage.getItem(SDK_SETTINGS_KEY);
    if (raw) return { cliUrl: "", logLevel: "info", ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { cliUrl: "", logLevel: "info" };
}

export function saveSdkSettings(settings: SdkSettings) {
  localStorage.setItem(SDK_SETTINGS_KEY, JSON.stringify(settings));
}

export function createSettingsSlice() {
  const initial = loadSdkSettings();
  const savedCliUrl = ref(initial.cliUrl);
  const savedLogLevel = ref(initial.logLevel);

  function updateSettings(newCliUrl: string, newLogLevel: string) {
    savedCliUrl.value = newCliUrl;
    savedLogLevel.value = newLogLevel;
    saveSdkSettings({ cliUrl: newCliUrl, logLevel: newLogLevel });
  }

  return { savedCliUrl, savedLogLevel, updateSettings };
}

export type SettingsSlice = ReturnType<typeof createSettingsSlice>;
