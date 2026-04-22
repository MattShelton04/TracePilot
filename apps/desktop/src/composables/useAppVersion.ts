import { ref } from "vue";
import { getTauriAppVersion } from "@/lib/tauri";
import { logWarn } from "@/utils/logger";

const appVersion = ref("dev");
let initialized = false;

export async function initAppVersion(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    const version = await getTauriAppVersion();
    if (version !== null) appVersion.value = version;
  } catch (e) {
    // Tauri app plugin unavailable — keep 'dev'
    logWarn("[useAppVersion] Failed to get version, keeping 'dev'", e);
  }
}

export function useAppVersion() {
  return { appVersion };
}
