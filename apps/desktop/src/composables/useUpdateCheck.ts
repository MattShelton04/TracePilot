import { getVersion } from '@tauri-apps/api/app';
import { checkForUpdates } from '@tracepilot/client';
import type { UpdateCheckResult } from '@tracepilot/types';
import { toErrorMessage } from '@tracepilot/ui';
import { ref } from 'vue';

const CACHE_KEY = 'tracepilot-update-check';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const updateResult = ref<UpdateCheckResult | null>(null);
export const updateCheckLoading = ref(false);
export const updateCheckError = ref<string | null>(null);

async function getCurrentVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return 'dev';
  }
}

export async function runUpdateCheck(force = false): Promise<void> {
  updateCheckLoading.value = true;
  updateCheckError.value = null;

  try {
    const currentVersion = await getCurrentVersion();

    // Respect 24-hour cache unless forced
    if (!force) {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const { timestamp, result, forVersion } = JSON.parse(cached) as {
            timestamp: number;
            result: UpdateCheckResult;
            forVersion?: string;
          };
          // Invalidate cache if version changed or TTL expired
          if (forVersion === currentVersion && Date.now() - timestamp < CACHE_TTL_MS) {
            updateResult.value = result;
            return;
          }
        }
      } catch {
        // Corrupt cache — clear it and continue to live check
        localStorage.removeItem(CACHE_KEY);
      }
    }

    const result = await checkForUpdates();
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ timestamp: Date.now(), result, forVersion: currentVersion }),
    );
    updateResult.value = result;
  } catch (err: unknown) {
    updateCheckError.value = toErrorMessage(e, 'Update check failed');
  } finally {
    updateCheckLoading.value = false;
  }
}

export function clearUpdateCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

export function useUpdateCheck() {
  return { updateResult, updateCheckLoading, updateCheckError, runUpdateCheck, clearUpdateCache };
}
