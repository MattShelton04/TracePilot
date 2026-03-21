import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { isDevBuild } from '@tracepilot/client';
import { ref } from 'vue';

export type AutoUpdateStatus = 'idle' | 'checking' | 'downloading' | 'installing' | 'done' | 'error';

const status = ref<AutoUpdateStatus>('idle');
const progress = ref(0);
const errorMessage = ref<string | null>(null);
const isDevMode = ref<boolean | null>(null);

async function detectDevMode(): Promise<boolean> {
  if (isDevMode.value !== null) return isDevMode.value;
  try {
    isDevMode.value = await isDevBuild();
  } catch {
    // If the command fails (e.g. browser mock), assume dev
    isDevMode.value = true;
  }
  return isDevMode.value;
}

/**
 * Download and install the latest update, then relaunch the app.
 * Only works for production (non-dev) builds.
 */
async function installUpdate(): Promise<void> {
  const isDev = await detectDevMode();
  if (isDev) {
    errorMessage.value = 'Auto-update is not available in dev mode. Use git pull instead.';
    status.value = 'error';
    return;
  }

  status.value = 'checking';
  errorMessage.value = null;
  progress.value = 0;

  try {
    const update = await check();

    if (!update) {
      status.value = 'idle';
      return;
    }

    status.value = 'downloading';
    let totalBytes = 0;
    let downloadedBytes = 0;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          totalBytes = event.data.contentLength ?? 0;
          break;
        case 'Progress':
          downloadedBytes += event.data.chunkLength;
          progress.value = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
          break;
        case 'Finished':
          status.value = 'installing';
          progress.value = 100;
          break;
      }
    });

    status.value = 'done';
    await relaunch();
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Auto-update failed';
    status.value = 'error';
  }
}

export function useAutoUpdate() {
  return {
    status,
    progress,
    errorMessage,
    isDevMode,
    detectDevMode,
    installUpdate,
  };
}
