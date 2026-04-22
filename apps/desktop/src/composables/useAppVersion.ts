import { ref } from "vue";
import { isTauri } from "@/lib/mocks";
import { logWarn } from "@/utils/logger";

const appVersion = ref("dev");
let initialized = false;

export async function initAppVersion(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (!isTauri()) return;

  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    appVersion.value = await getVersion();
  } catch (e) {
    // Tauri app plugin unavailable — keep 'dev'
    logWarn("[useAppVersion] Failed to get version, keeping 'dev'", e);
  }
}

export function useAppVersion() {
  return { appVersion };
}
