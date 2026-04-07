import { ref } from "vue";
import { logWarn } from "@/utils/logger";

const appVersion = ref("dev");
let initialized = false;

export async function initAppVersion(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    if (isTauri()) {
      const { getVersion } = await import("@tauri-apps/api/app");
      appVersion.value = await getVersion();
    }
  } catch (e) {
    // Outside Tauri context (browser-only dev mode) — keep 'dev'
    logWarn("[useAppVersion] Failed to get version (likely outside Tauri context), keeping 'dev'", e);
  }
}

export function useAppVersion() {
  return { appVersion };
}
