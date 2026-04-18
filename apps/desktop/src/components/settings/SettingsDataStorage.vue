<script setup lang="ts">
import {
  factoryReset as factoryResetApi,
  getConfig,
  getDbSize,
  getSessionCount as getSessionCountApi,
  rebuildSearchIndex as rebuildSearchIndexApi,
  reindexSessionsFull as reindexSessionsFullApi,
  saveConfig,
} from "@tracepilot/client";
import type { IndexingProgressPayload } from "@tracepilot/types";
import {
  ActionButton,
  FormInput,
  formatBytes,
  SectionPanel,
  toErrorMessage,
  useConfirmDialog,
  useToast,
} from "@tracepilot/ui";
import { onMounted, ref } from "vue";
import { browseForDirectory } from "@/composables/useBrowseDirectory";
import { useIndexingEvents } from "@/composables/useIndexingEvents";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { useAnalyticsStore } from "@/stores/analytics";
import { useSessionsStore } from "@/stores/sessions";
import { isAlreadyIndexingError } from "@/utils/backendErrors";
import { logWarn } from "@/utils/logger";

const sessionsStore = useSessionsStore();
const analyticsStore = useAnalyticsStore();
const toast = useToast();
const { confirm } = useConfirmDialog();

const sessionsDirectory = ref("");
const databasePath = ref("");
const databaseSize = ref("—");
const indexedSessionCount = ref(0);
const reindexResult = ref<string | null>(null);
const resetting = ref(false);
const clearing = ref(false);
const searchRebuilding = ref(false);
const searchRebuildResult = ref<string | null>(null);

// ── Indexing progress ────────────────────────────────────────
const indexingProgress = ref<IndexingProgressPayload | null>(null);
const isIndexing = ref(false);

const { setup: setupIndexingEvents } = useIndexingEvents({
  onStarted: () => {
    indexingProgress.value = null;
    isIndexing.value = true;
  },
  onProgress: (p) => {
    indexingProgress.value = p;
  },
  onFinished: () => {
    indexingProgress.value = null;
    isIndexing.value = false;
  },
});

// ── Load config data on mount ────────────────────────────────
onMounted(async () => {
  await setupIndexingEvents();
  try {
    const config = await getConfig();
    sessionsDirectory.value = config.paths.sessionStateDir;
    databasePath.value = config.paths.indexDbPath;
  } catch (e) {
    // Non-critical: defaults are fine
    logWarn("[SettingsDataStorage] Failed to load config:", e);
  }

  try {
    const bytes = await getDbSize();
    databaseSize.value = formatBytes(bytes);
  } catch (e) {
    // Non-critical: keep placeholder
    logWarn("[SettingsDataStorage] Failed to get database size:", e);
  }

  try {
    indexedSessionCount.value = await getSessionCountApi();
  } catch (e) {
    // Non-critical: keep 0
    logWarn("[SettingsDataStorage] Failed to get session count:", e);
  }
});

async function browseSessionDir() {
  const selected = await browseForDirectory({
    title: "Select session-state directory",
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
  } catch (e) {
    // Non-fatal: local UI still updates
    logWarn("[SettingsDataStorage] Failed to persist session directory:", e);
  }
}

async function clearCache() {
  clearing.value = true;
  reindexResult.value = null;
  try {
    const [rebuilt, total] = await reindexSessionsFullApi();
    reindexResult.value = `Rebuilt analytics for ${rebuilt} session${rebuilt !== 1 ? "s" : ""}`;
    await sessionsStore.fetchSessions();
    analyticsStore.$reset();
  } catch (e) {
    if (isAlreadyIndexingError(e)) {
      reindexResult.value = "Indexing already in progress…";
    } else {
      reindexResult.value = `Error: ${toErrorMessage(e)}`;
    }
  } finally {
    clearing.value = false;
  }
}

async function rebuildSearchIndex() {
  searchRebuilding.value = true;
  searchRebuildResult.value = null;
  try {
    const [indexed, total] = await rebuildSearchIndexApi();
    searchRebuildResult.value = `Indexed ${indexed} of ${total} sessions`;
    toast.success("Search index rebuilt successfully");
  } catch (e) {
    if (isAlreadyIndexingError(e)) {
      searchRebuildResult.value = "Search indexing already in progress…";
    } else {
      searchRebuildResult.value = `Error: ${toErrorMessage(e)}`;
    }
  } finally {
    searchRebuilding.value = false;
  }
}

async function handleFactoryReset() {
  const { confirmed } = await confirm({
    title: "Factory Reset",
    message:
      "This will permanently erase all data and restore default settings. This action cannot be undone.",
    variant: "danger",
    confirmLabel: "Yes, Reset Everything",
  });
  if (!confirmed) return;

  resetting.value = true;
  try {
    await factoryResetApi();
    // Clear all TracePilot localStorage keys
    localStorage.removeItem(STORAGE_KEYS.legacyPrefs);
    localStorage.removeItem(STORAGE_KEYS.theme);
    localStorage.removeItem(STORAGE_KEYS.lastSession);
    localStorage.removeItem(STORAGE_KEYS.lastSeenVersion);
    localStorage.removeItem(STORAGE_KEYS.updateCheck);
    localStorage.removeItem(STORAGE_KEYS.dismissedUpdate);
    window.location.reload();
  } catch (e) {
    resetting.value = false;
    toast.error(`Factory reset failed: ${toErrorMessage(e)}`);
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

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Rebuild search index</div>
          <div class="setting-description">
            Rebuild the full-text search index for deep content search across all sessions.
          </div>
        </div>
        <div class="setting-actions">
          <ActionButton size="sm" class="btn-danger" :disabled="searchRebuilding || isIndexing" @click="rebuildSearchIndex">
            {{ searchRebuilding ? 'Rebuilding…' : 'Rebuild' }}
          </ActionButton>
          <span v-if="searchRebuildResult" class="setting-result">{{ searchRebuildResult }}</span>
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
  background: var(--canvas-inset);
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
