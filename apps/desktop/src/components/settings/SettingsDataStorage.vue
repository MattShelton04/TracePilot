<script setup lang="ts">
import { type UnlistenFn } from '@tauri-apps/api/event';
import {
  factoryReset as factoryResetApi,
  getConfig,
  getDbSize,
  getSessionCount as getSessionCountApi,
  reindexSessionsFull as reindexSessionsFullApi,
  saveConfig,
} from '@tracepilot/client';
import type { IndexingProgressPayload } from '@tracepilot/types';
import { ActionButton, FormInput, FormSwitch, SectionPanel, useToast, useConfirmDialog } from '@tracepilot/ui';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { browseForDirectory } from '@/composables/useBrowseDirectory';
import { safeListen } from '@/utils/tauriEvents';
import { useAnalyticsStore } from '@/stores/analytics';
import { useSessionsStore } from '@/stores/sessions';

const sessionsStore = useSessionsStore();
const analyticsStore = useAnalyticsStore();
const toast = useToast();
const { confirm } = useConfirmDialog();

const sessionsDirectory = ref('~/.copilot/sessions/');
const databasePath = ref('');
const databaseSize = ref('—');
const indexedSessionCount = ref(0);
const autoIndexOnLaunch = ref(true);
const reindexResult = ref<string | null>(null);
const resetting = ref(false);
const clearing = ref(false);

// ── Indexing progress ────────────────────────────────────────
const indexingProgress = ref<IndexingProgressPayload | null>(null);
const isIndexing = ref(false);
const unlisteners: UnlistenFn[] = [];

onMounted(async () => {
  unlisteners.push(
    await safeListen<IndexingProgressPayload>('indexing-progress', (event) => {
      indexingProgress.value = event.payload;
    }),
    await safeListen('indexing-started', () => {
      indexingProgress.value = null;
      isIndexing.value = true;
    }),
    await safeListen('indexing-finished', () => {
      indexingProgress.value = null;
      isIndexing.value = false;
    }),
  );
});

onUnmounted(() => {
  for (const unlisten of unlisteners) unlisten();
});

// ── Load config data on mount ────────────────────────────────
onMounted(async () => {
  try {
    const config = await getConfig();
    sessionsDirectory.value = config.paths.sessionStateDir;
    databasePath.value = config.paths.indexDbPath;
    autoIndexOnLaunch.value = config.general.autoIndexOnLaunch;
  } catch {
    /* defaults are fine */
  }

  try {
    const bytes = await getDbSize();
    if (bytes < 1024 * 1024) {
      databaseSize.value = `${(bytes / 1024).toFixed(1)} KB`;
    } else {
      databaseSize.value = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
  } catch {
    /* keep placeholder */
  }

  try {
    indexedSessionCount.value = await getSessionCountApi();
  } catch {
    /* keep 0 */
  }
});

async function browseSessionDir() {
  const selected = await browseForDirectory({
    title: 'Select session-state directory',
    defaultPath: sessionsDirectory.value,
  });
  if (selected) {
    sessionsDirectory.value = selected;
    await persistSessionDir();
  }
}

async function persistSessionDir() {
  try {
    const config = await getConfig();
    config.paths.sessionStateDir = sessionsDirectory.value;
    await saveConfig(config);
  } catch {
    /* non-fatal — local UI still updates */
  }
}

// Persist autoIndexOnLaunch when toggled
watch(autoIndexOnLaunch, async (value) => {
  try {
    const config = await getConfig();
    config.general.autoIndexOnLaunch = value;
    await saveConfig(config);
  } catch {
    /* non-fatal */
  }
});

async function clearCache() {
  clearing.value = true;
  reindexResult.value = null;
  try {
    const [rebuilt, total] = await reindexSessionsFullApi();
    reindexResult.value = `Rebuilt analytics for ${rebuilt} session${rebuilt !== 1 ? 's' : ''}`;
    await sessionsStore.fetchSessions();
    analyticsStore.$reset();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'ALREADY_INDEXING') {
      reindexResult.value = 'Indexing already in progress…';
    } else {
      reindexResult.value = `Error: ${msg}`;
    }
  } finally {
    clearing.value = false;
  }
}

async function handleFactoryReset() {
  const { confirmed } = await confirm({
    title: 'Factory Reset',
    message: 'This will permanently erase all data and restore default settings. This action cannot be undone.',
    variant: 'danger',
    confirmLabel: 'Yes, Reset Everything',
  });
  if (!confirmed) return;

  resetting.value = true;
  try {
    await factoryResetApi();
    // Clear all TracePilot localStorage keys
    localStorage.removeItem('tracepilot-prefs');
    localStorage.removeItem('tracepilot-theme');
    localStorage.removeItem('tracepilot-last-session');
    localStorage.removeItem('tracepilot-last-seen-version');
    localStorage.removeItem('tracepilot-update-check');
    localStorage.removeItem('tracepilot-dismissed-update');
    window.location.reload();
  } catch (e) {
    resetting.value = false;
    toast.error(`Factory reset failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

defineExpose({ databaseSize, indexedSessionCount });
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">Data &amp; Storage</div>
    <SectionPanel>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Sessions directory</div>
          <div class="setting-description">
            Path to Copilot session data
          </div>
        </div>
        <div class="setting-control-group">
          <FormInput
            v-model="sessionsDirectory"
            class="input-medium-mono"
            @blur="persistSessionDir"
          />
          <ActionButton size="sm" @click="browseSessionDir">Browse…</ActionButton>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Database size</div>
          <div class="setting-description">
            Current local database size
          </div>
        </div>
        <span class="setting-value-display">{{ databaseSize }}</span>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Auto-index on launch</div>
          <div class="setting-description">
            Scan for new sessions when the app starts
          </div>
        </div>
        <FormSwitch v-model="autoIndexOnLaunch" />
      </div>

      <div v-if="indexingProgress" class="setting-row indexing-progress-row">
        <div class="setting-info">
          <div class="setting-label setting-label-sm">Progress</div>
          <div class="setting-description">
            {{ indexingProgress.current }} / {{ indexingProgress.total }} sessions
          </div>
        </div>
        <div class="indexing-progress-bar-container">
          <div class="indexing-progress-bar" :style="{ width: (indexingProgress.total > 0 ? (indexingProgress.current / indexingProgress.total * 100) : 0) + '%' }" />
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Rebuild analytics</div>
          <div class="setting-description">
            Clear all cached analytics data and recompute from scratch. Use this if analytics appear stale or incorrect.
          </div>
        </div>
        <div class="setting-actions">
          <ActionButton size="sm" class="btn-danger" :disabled="clearing || isIndexing" @click="clearCache">
            {{ clearing ? 'Rebuilding…' : 'Rebuild' }}
          </ActionButton>
          <span v-if="reindexResult" class="setting-result">{{ reindexResult }}</span>
        </div>
      </div>

      <!-- Danger Zone -->
      <div class="setting-row setting-row-danger">
        <div class="setting-info">
          <div class="setting-label setting-label-danger">Factory Reset</div>
          <div class="setting-description">
            Delete all configuration, index data, and preferences. Re-run setup wizard.
          </div>
        </div>
        <div class="setting-actions">
          <ActionButton
            size="sm"
            class="btn-danger"
            :disabled="resetting"
            @click="handleFactoryReset"
          >
            {{ resetting ? 'Resetting…' : 'Reset Everything…' }}
          </ActionButton>
        </div>
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
.indexing-progress-row {
  padding-top: 4px;
  padding-bottom: 4px;
}

.setting-label-sm {
  font-size: 0.75rem;
}

.indexing-progress-bar-container {
  width: 160px;
  height: 6px;
  background: var(--bg-tertiary, #e5e7eb);
  border-radius: 3px;
  overflow: hidden;
  flex-shrink: 0;
}

.indexing-progress-bar {
  height: 100%;
  background: var(--accent-fg, #3b82f6);
  border-radius: 3px;
  transition: width 0.15s ease-out;
}
</style>
