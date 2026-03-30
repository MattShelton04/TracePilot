import { ref } from "vue";

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
  } catch {
    // Outside Tauri context (browser-only dev mode) — keep 'dev'
  }
}

export function useAppVersion() {
  return { appVersion };
}
