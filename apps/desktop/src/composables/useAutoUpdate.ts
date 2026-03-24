import { getInstallType } from '@tracepilot/client';
import { ref } from 'vue';
import { toErrorMessage } from '@/utils/errors';

export type AutoUpdateStatus = 'idle' | 'checking' | 'downloading' | 'installing' | 'done' | 'error';
export type InstallType = 'source' | 'installed' | 'portable' | 'unknown';

const status = ref<AutoUpdateStatus>('idle');
const progress = ref(0);
const errorMessage = ref<string | null>(null);
const installType = ref<InstallType>('unknown');

async function detectInstallType(): Promise<InstallType> {
  if (installType.value !== 'unknown') return installType.value;
  try {
    installType.value = (await getInstallType()) as InstallType;
  } catch {
    // Browser mock / non-Tauri environment → treat as source
    installType.value = 'source';
  }
  return installType.value;
}

/**
 * Download and install the latest update, then relaunch the app.
 * Only works for NSIS-installed builds.
 */
async function installUpdate(): Promise<void> {
  const type = await detectInstallType();
  if (type !== 'installed') {
    errorMessage.value = type === 'source'
      ? 'Auto-update is not available in dev mode. Use git pull instead.'
      : 'Auto-update is not available for standalone exe. Download the latest version from GitHub Releases.';
    status.value = 'error';
    return;
  }

  status.value = 'checking';
  errorMessage.value = null;
  progress.value = 0;

  try {
    const { check } = await import('@tauri-apps/plugin-updater');
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
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (e) {
    errorMessage.value = toErrorMessage(e, 'Auto-update failed');
    status.value = 'error';
  }
}

export function useAutoUpdate() {
  return {
    status,
    progress,
    errorMessage,
    installType,
    detectInstallType,
    installUpdate,
  };
}
