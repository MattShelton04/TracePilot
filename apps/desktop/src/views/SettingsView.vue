<script setup lang="ts">
// STUB: Settings beyond theme are stored in local component state.
// STUB: Wire to usePreferencesStore or a dedicated settings API for persistence.

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { usePreferencesStore, type ThemeOption, type ModelWholesalePrice, DEFAULT_WHOLESALE_PRICES } from '@/stores/preferences';
import { useSessionsStore } from '@/stores/sessions';
import { useAnalyticsStore } from '@/stores/analytics';
import {
  reindexSessions as reindexSessionsApi,
  reindexSessionsFull as reindexSessionsFullApi,
  getConfig,
  getDbSize,
  getSessionCount as getSessionCountApi,
  factoryReset as factoryResetApi,
  saveConfig,
} from '@tracepilot/client';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { IndexingProgressPayload } from '@tracepilot/types';
import {
  BtnGroup,
  FormSwitch,
  FormInput,
  ActionButton,
  SectionPanel,
  getRegisteredRenderers,
} from '@tracepilot/ui';
import type { RichRenderableToolName } from '@tracepilot/types';
import StubBanner from '@/components/StubBanner.vue';
import LogoIcon from '@/components/icons/LogoIcon.vue';
import { browseForDirectory } from '@/composables/useBrowseDirectory';

const preferences = usePreferencesStore();
const sessionsStore = useSessionsStore();
const analyticsStore = useAnalyticsStore();

// ── General ──────────────────────────────────────────────────
const themeOptions = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const defaultViewOptions = [
  { value: 'sessions', label: 'Sessions' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'health', label: 'Health' },
];

const defaultView = ref('sessions');
const itemsPerPage = ref(20);
const autoRefresh = ref(false);
const autoRefreshInterval = ref(30);

// ── Data & Storage ───────────────────────────────────────────
const sessionsDirectory = ref('~/.copilot/sessions/');
const databasePath = ref('');
const databaseSize = ref('—');
const indexedSessionCount = ref(0);

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
  } catch { /* non-fatal — local UI still updates */ }
}

const autoIndexOnLaunch = ref(true);
const reindexing = ref(false);
const reindexResult = ref<string | null>(null);
const resetting = ref(false);
const resetConfirm = ref(false);

// ── Indexing progress ────────────────────────────────────────
const indexingProgress = ref<IndexingProgressPayload | null>(null);
const isIndexing = ref(false);
const unlisteners: UnlistenFn[] = [];

onMounted(async () => {
  unlisteners.push(
    await listen<IndexingProgressPayload>('indexing-progress', (event) => {
      indexingProgress.value = event.payload;
    }),
    await listen('indexing-started', () => {
      indexingProgress.value = null;
      isIndexing.value = true;
    }),
    await listen('indexing-finished', () => {
      indexingProgress.value = null;
      isIndexing.value = false;
    }),
  );
});

onUnmounted(() => {
  for (const unlisten of unlisteners) unlisten();
});

async function reindexSessions() {
  reindexing.value = true;
  reindexResult.value = null;
  try {
    const [updated, total] = await reindexSessionsApi();
    reindexResult.value = updated > 0
      ? `Updated ${updated} of ${total} session${total !== 1 ? 's' : ''}`
      : `All ${total} sessions up to date`;
    // Refresh stores so the UI reflects the updated index
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
    reindexing.value = false;
  }
}

const clearing = ref(false);

async function clearCache() {
  clearing.value = true;
  reindexResult.value = null;
  try {
    // Delete index DB and rebuild everything from scratch
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

async function doFactoryReset() {
  resetting.value = true;
  try {
    await factoryResetApi();
    // Clear frontend preferences so they don't survive the reset
    localStorage.removeItem('tracepilot-prefs');
    window.location.reload();
  } catch (e) {
    resetting.value = false;
    resetConfirm.value = false;
    alert(`Factory reset failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Load real data on mount ──────────────────────────────────
onMounted(async () => {
  try {
    const config = await getConfig();
    sessionsDirectory.value = config.paths.sessionStateDir;
    databasePath.value = config.paths.indexDbPath;
    autoIndexOnLaunch.value = config.general.autoIndexOnLaunch;
  } catch { /* defaults are fine */ }

  try {
    const bytes = await getDbSize();
    if (bytes < 1024 * 1024) {
      databaseSize.value = `${(bytes / 1024).toFixed(1)} KB`;
    } else {
      databaseSize.value = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
  } catch { /* keep placeholder */ }

  try {
    indexedSessionCount.value = await getSessionCountApi();
  } catch { /* keep 0 */ }
});


// ── Tool Visualization ──────────────────────────────────────
const registeredRenderers = getRegisteredRenderers();

// ── Health Scoring ───────────────────────────────────────────
const healthScoringEnabled = ref(true);

// ── Pricing ──────────────────────────────────────────────────
const newModelName = ref('');
const newInputPerM = ref(0);
const newCachedInputPerM = ref(0);
const newOutputPerM = ref(0);

function addModelPrice() {
  if (!newModelName.value.trim()) return;
  preferences.addWholesalePrice({
    model: newModelName.value.trim(),
    inputPerM: newInputPerM.value,
    cachedInputPerM: newCachedInputPerM.value,
    outputPerM: newOutputPerM.value,
  });
  newModelName.value = '';
  newInputPerM.value = 0;
  newCachedInputPerM.value = 0;
  newOutputPerM.value = 0;
}

// STUB: Health scoring thresholds — wire to health scoring config when backend ready
const thresholdGood = ref(80);
const thresholdWarning = ref(50);
const thresholdCritical = ref(50);

// STUB: Health flag configuration stored locally — sync with backend when available
const flagHighRetries = ref(true);
const flagLongDuration = ref(true);
const flagLargeTokenUsage = ref(true);
const flagManyErrors = ref(false);

// ── Keyboard Shortcuts ───────────────────────────────────────
// STUB: Keyboard shortcuts are display-only. Shortcut registration requires
// STUB: global key event listeners or Tauri global shortcuts API.
// STUB: Analysis needed on how to enable shortcuts across the app.
const shortcuts = [
  { action: 'Search sessions', keys: ['⌘', 'K'] },
  { action: 'Toggle theme', keys: ['⌘', 'D'] },
  { action: 'Go to Analytics', keys: ['⌘', '1'] },
  { action: 'Go to Health', keys: ['⌘', '2'] },
  { action: 'Go to Settings', keys: ['⌘', ','] },
  { action: 'Export current', keys: ['⌘', 'E'] },
  { action: 'Navigate back', keys: ['⌘', '['] },
  { action: 'Navigate forward', keys: ['⌘', ']'] },
];

// ── About ────────────────────────────────────────────────────
const appVersion = '0.1.0';
const sessionCount = computed(() => indexedSessionCount.value || sessionsStore.sessions.length);
// STUB: About links use placeholder URLs — update with real repository URLs
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner" style="max-width: 720px">
      <StubBanner message="Settings are stored locally. Backend sync is not yet available." />
      <h1 class="page-title" style="margin-bottom: 24px">Settings</h1>

      <!-- ════════ 1. General ════════ -->
      <div class="settings-section">
        <div class="settings-section-title">General</div>
        <SectionPanel>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Theme</div>
              <div class="setting-description">
                Switch between dark, light, or system preference
              </div>
            </div>
            <BtnGroup
              :options="themeOptions"
              :model-value="preferences.theme"
              @update:model-value="preferences.theme = $event as ThemeOption"
            />
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Default view</div>
              <div class="setting-description">
                Landing page when the app opens
              </div>
            </div>
            <BtnGroup
              :options="defaultViewOptions"
              v-model="defaultView"
            />
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Items per page</div>
              <div class="setting-description">
                Number of sessions shown per page
              </div>
            </div>
            <FormInput
              type="number"
              v-model="itemsPerPage"
              style="width: 80px; text-align: center"
            />
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Auto-refresh</div>
              <div class="setting-description">
                Periodically check for new sessions
              </div>
            </div>
            <div class="setting-control-group">
              <FormSwitch v-model="autoRefresh" />
              <FormInput
                v-if="autoRefresh"
                type="number"
                v-model="autoRefreshInterval"
                placeholder="30"
                style="width: 70px; text-align: center"
              />
              <span v-if="autoRefresh" class="setting-unit">sec</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Hide empty sessions</div>
              <div class="setting-description">
                Filter out sessions with no conversation turns (e.g., auto-created sessions).
                <span v-if="sessionsStore.emptySessionCount > 0" class="empty-count-hint">
                  {{ sessionsStore.emptySessionCount }} empty session{{ sessionsStore.emptySessionCount !== 1 ? 's' : '' }} currently filtered out
                </span>
              </div>
            </div>
            <FormSwitch
              :model-value="preferences.hideEmptySessions"
              @update:model-value="preferences.hideEmptySessions = $event"
            />
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">CLI Command</div>
              <div class="setting-description">
                The command used to resume Copilot sessions (e.g., <code>copilot</code> or <code>gh copilot-cli</code>)
              </div>
            </div>
            <FormInput
              :model-value="preferences.cliCommand"
              @update:model-value="preferences.cliCommand = String($event)"
              type="text"
              placeholder="copilot"
              style="width: 240px"
            />
          </div>
        </SectionPanel>
      </div>

      <!-- ════════ 2. Data & Storage ════════ -->
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
                style="width: 240px; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem"
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
            <!-- STUB: Database size is mocked — wire to backend stat query -->
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

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Reindex sessions</div>
              <div class="setting-description">
                Incrementally scan for new/changed sessions and recompute their analytics. Only re-processes sessions that changed since the last index.
              </div>
            </div>
            <div class="setting-actions">
              <ActionButton
                size="sm"
                :disabled="reindexing || clearing || isIndexing"
                @click="reindexSessions"
              >
                {{ reindexing ? 'Reindexing…' : 'Reindex' }}
              </ActionButton>
              <span v-if="reindexResult" class="setting-result">{{ reindexResult }}</span>
            </div>
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
            <ActionButton size="sm" class="btn-danger" :disabled="clearing || reindexing || isIndexing" @click="clearCache">
              {{ clearing ? 'Rebuilding…' : 'Rebuild' }}
            </ActionButton>
          </div>

          <!-- Danger Zone -->
          <div class="setting-row" style="border-top: 1px solid var(--danger-muted);">
            <div class="setting-info">
              <div class="setting-label" style="color: var(--danger-fg);">Factory Reset</div>
              <div class="setting-description">
                Delete all configuration, index data, and preferences. Re-run setup wizard.
              </div>
            </div>
            <div class="setting-actions">
              <ActionButton
                v-if="!resetConfirm"
                size="sm"
                class="btn-danger"
                @click="resetConfirm = true"
              >
                Reset Everything…
              </ActionButton>
              <template v-else>
                <span class="setting-result" style="color: var(--danger-fg);">Are you sure?</span>
                <ActionButton
                  size="sm"
                  class="btn-danger"
                  :disabled="resetting"
                  @click="doFactoryReset"
                >
                  {{ resetting ? 'Resetting…' : 'Yes, Reset' }}
                </ActionButton>
                <ActionButton size="sm" @click="resetConfirm = false">Cancel</ActionButton>
              </template>
            </div>
          </div>
        </SectionPanel>
      </div>

      <!-- ════════ 3. Pricing ════════ -->
      <div class="settings-section">
        <div class="settings-section-title">Pricing</div>
        <SectionPanel>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Cost per premium request</div>
              <div class="setting-description">
                GitHub Copilot charges per premium request. Cost = premiumRequests × this rate.
              </div>
            </div>
            <div class="setting-control-group">
              <span class="setting-unit">$</span>
              <FormInput
                type="number"
                :model-value="preferences.costPerPremiumRequest"
                @update:model-value="preferences.costPerPremiumRequest = Number($event)"
                step="0.01"
                min="0"
                style="width: 90px; text-align: center"
              />
            </div>
          </div>
        </SectionPanel>

        <div class="pricing-subsection-title">Model Wholesale Prices</div>
        <p class="pricing-description">
          API prices ($ per 1M tokens) used to compute what sessions would cost through direct API access vs. Copilot premium requests.
        </p>

        <SectionPanel>
          <div class="pricing-table-wrapper">
            <table class="data-table pricing-table" aria-label="Model wholesale pricing">
              <thead>
                <tr>
                  <th style="text-align: left;">Model</th>
                  <th>Input / 1M</th>
                  <th>Cached / 1M</th>
                  <th>Output / 1M</th>
                  <th style="width: 40px;"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(price, idx) in preferences.modelWholesalePrices" :key="price.model">
                  <td class="font-mono" style="font-size: 0.75rem;">{{ price.model }}</td>
                  <td style="text-align: center;">
                    <FormInput
                      type="number"
                      :model-value="price.inputPerM"
                      @update:model-value="preferences.modelWholesalePrices[idx].inputPerM = Number($event)"
                      step="0.01"
                      min="0"
                      style="width: 80px; text-align: center; font-size: 0.75rem;"
                    />
                  </td>
                  <td style="text-align: center;">
                    <FormInput
                      type="number"
                      :model-value="price.cachedInputPerM"
                      @update:model-value="preferences.modelWholesalePrices[idx].cachedInputPerM = Number($event)"
                      step="0.001"
                      min="0"
                      style="width: 80px; text-align: center; font-size: 0.75rem;"
                    />
                  </td>
                  <td style="text-align: center;">
                    <FormInput
                      type="number"
                      :model-value="price.outputPerM"
                      @update:model-value="preferences.modelWholesalePrices[idx].outputPerM = Number($event)"
                      step="0.01"
                      min="0"
                      style="width: 80px; text-align: center; font-size: 0.75rem;"
                    />
                  </td>
                  <td style="text-align: center;">
                    <button class="pricing-remove-btn" @click="preferences.removeWholesalePrice(price.model)" title="Remove model">&times;</button>
                  </td>
                </tr>
                <!-- Add new model row -->
                <tr class="pricing-add-row">
                  <td>
                    <FormInput
                      v-model="newModelName"
                      placeholder="model-name"
                      style="width: 140px; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem;"
                    />
                  </td>
                  <td style="text-align: center;">
                    <FormInput
                      type="number"
                      v-model="newInputPerM"
                      step="0.01"
                      min="0"
                      style="width: 80px; text-align: center; font-size: 0.75rem;"
                    />
                  </td>
                  <td style="text-align: center;">
                    <FormInput
                      type="number"
                      v-model="newCachedInputPerM"
                      step="0.001"
                      min="0"
                      style="width: 80px; text-align: center; font-size: 0.75rem;"
                    />
                  </td>
                  <td style="text-align: center;">
                    <FormInput
                      type="number"
                      v-model="newOutputPerM"
                      step="0.01"
                      min="0"
                      style="width: 80px; text-align: center; font-size: 0.75rem;"
                    />
                  </td>
                  <td style="text-align: center;">
                    <button class="pricing-add-btn" @click="addModelPrice" :disabled="!newModelName.trim()" title="Add model">+</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="pricing-actions">
            <ActionButton size="sm" @click="preferences.resetWholesalePrices()">Reset to Defaults</ActionButton>
          </div>
        </SectionPanel>
      </div>

      <!-- ════════ 4. Tool Visualization ════════ -->
      <div class="settings-section">
        <div class="settings-section-title">Tool Visualization</div>
        <SectionPanel>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Rich Tool Rendering</div>
              <div class="setting-description">
                Enable enhanced visualizations for tool call results — syntax-highlighted code,
                diffs, terminal output, file trees, and more. When disabled, tool results display
                as plain text.
              </div>
            </div>
            <FormSwitch
              :model-value="preferences.toolRendering.enabled"
              @update:model-value="preferences.toolRendering.enabled = $event"
              label="Rich Tool Rendering"
            />
          </div>

          <!-- Per-tool overrides -->
          <template v-if="preferences.toolRendering.enabled">
            <div class="tool-viz-divider" />
            <div class="setting-row" style="flex-direction: column; align-items: stretch;">
              <div class="setting-label" style="margin-bottom: 8px;">Per-Tool Overrides</div>
              <div class="setting-description" style="margin-bottom: 8px;">
                Disable rich rendering for specific tool types. Disabled tools fall back to plain text.
              </div>
              <div class="tool-viz-grid">
                <div v-for="renderer in registeredRenderers" :key="renderer.toolName" class="tool-viz-item">
                  <FormSwitch
                    :model-value="preferences.isRichRenderingEnabled(renderer.toolName)"
                    @update:model-value="preferences.setToolRenderingOverride(renderer.toolName as RichRenderableToolName, $event)"
                    :label="renderer.label"
                  />
                </div>
              </div>
            </div>

            <div class="tool-viz-divider" />
            <div class="setting-row" style="justify-content: flex-end;">
              <ActionButton size="sm" @click="preferences.resetToolRendering()">Reset to Defaults</ActionButton>
            </div>
          </template>
        </SectionPanel>
      </div>

      <!-- ════════ 5. Health Scoring ════════ -->
      <div class="settings-section">
        <div class="settings-section-title">Health Scoring</div>
        <SectionPanel>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Enable health scoring</div>
              <div class="setting-description">
                Analyze sessions for potential issues
              </div>
            </div>
            <FormSwitch v-model="healthScoringEnabled" />
          </div>

          <!-- STUB: Health scoring thresholds — wire to health scoring config when backend ready -->
          <div class="setting-row" v-if="healthScoringEnabled">
            <div class="setting-info">
              <div class="setting-label">Score thresholds</div>
              <div class="setting-description">
                Good (&gt;80), Warning (&gt;50), Critical (≤50)
              </div>
            </div>
            <div class="setting-control-group">
              <div class="threshold-input">
                <label class="threshold-label good">Good</label>
                <FormInput
                  type="number"
                  v-model="thresholdGood"
                  style="width: 60px; text-align: center"
                />
              </div>
              <div class="threshold-input">
                <label class="threshold-label warning">Warn</label>
                <FormInput
                  type="number"
                  v-model="thresholdWarning"
                  style="width: 60px; text-align: center"
                />
              </div>
              <div class="threshold-input">
                <label class="threshold-label critical">Crit</label>
                <FormInput
                  type="number"
                  v-model="thresholdCritical"
                  style="width: 60px; text-align: center"
                />
              </div>
            </div>
          </div>

          <!-- STUB: Health flag configuration stored locally — sync with backend when available -->
          <div class="setting-row" v-if="healthScoringEnabled">
            <div class="setting-info">
              <div class="setting-label">Flags to monitor</div>
              <div class="setting-description">
                Conditions that lower a session's health score
              </div>
            </div>
            <div class="flag-checkboxes">
              <label class="flag-checkbox">
                <input type="checkbox" v-model="flagHighRetries" />
                <span>High retries</span>
              </label>
              <label class="flag-checkbox">
                <input type="checkbox" v-model="flagLongDuration" />
                <span>Long duration</span>
              </label>
              <label class="flag-checkbox">
                <input type="checkbox" v-model="flagLargeTokenUsage" />
                <span>Large token usage</span>
              </label>
              <label class="flag-checkbox">
                <input type="checkbox" v-model="flagManyErrors" />
                <span>Many errors</span>
              </label>
            </div>
          </div>
        </SectionPanel>
      </div>

      <!-- ════════ 5. Keyboard Shortcuts ════════ -->
      <div class="settings-section">
        <div class="settings-section-title">Keyboard Shortcuts</div>
        <SectionPanel>
          <div class="shortcuts-table">
            <div
              v-for="s in shortcuts"
              :key="s.action"
              class="shortcut-row"
            >
              <span class="shortcut-action">{{ s.action }}</span>
              <div class="shortcut-keys">
                <span
                  v-for="(key, idx) in s.keys"
                  :key="idx"
                  class="shortcut-key"
                >{{ key }}</span>
              </div>
            </div>
          </div>
          <div class="shortcuts-footer">
            Shortcuts use Tauri's global shortcut API. Custom shortcut
            configuration is planned for a future release.
          </div>
        </SectionPanel>
      </div>

      <!-- ════════ 6. About ════════ -->
      <div class="settings-section">
        <div class="settings-section-title">About</div>
        <SectionPanel>
          <div class="about-content">
            <div class="about-brand">
              <div class="about-brand-icon" aria-hidden="true">
                <LogoIcon :size="40" />
              </div>
              <div>
                <div class="about-app-name">TracePilot</div>
                <div class="about-tagline">
                  Session analytics for AI-assisted development
                </div>
              </div>
            </div>

            <dl class="def-list about-meta">
              <dt>Version</dt>
              <dd>v{{ appVersion }}</dd>
              <dt>Session Count</dt>
              <dd style="font-variant-numeric: tabular-nums">{{ sessionCount }}</dd>
              <dt>Database Size</dt>
              <dd style="font-variant-numeric: tabular-nums">{{ databaseSize }}</dd>
            </dl>

            <!-- STUB: About links use placeholder URLs — update with real repository URLs -->
            <div class="about-links">
              <a href="https://github.com/your-org/tracepilot" target="_blank" rel="noopener">
                GitHub Repository
              </a>
              <a href="https://github.com/your-org/tracepilot/wiki" target="_blank" rel="noopener">
                Documentation
              </a>
              <a href="https://github.com/your-org/tracepilot/issues/new" target="_blank" rel="noopener">
                Report Issue
              </a>
            </div>

            <div class="about-footer">
              Built with Tauri, Rust &amp; Vue
            </div>
          </div>
        </SectionPanel>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Section spacing ──────────────────────────────────────── */
.settings-section {
  margin-bottom: 24px;
}

.settings-section-title {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 10px;
}

/* ── Setting rows ─────────────────────────────────────────── */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-info {
  flex: 1;
  min-width: 0;
}

.setting-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
}

.setting-description {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 1px;
}

.empty-count-hint {
  color: var(--text-placeholder);
  font-style: italic;
}

.setting-control-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.setting-unit {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.setting-value-display {
  font-size: 0.8125rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

/* ── Danger button override ───────────────────────────────── */
.btn-danger {
  color: var(--danger-fg);
  border-color: var(--danger-muted);
}
.btn-danger:hover {
  background: var(--danger-subtle);
}

.setting-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ── Tool Visualization ──────────────────────────────────── */
.tool-viz-divider {
  border-top: 1px solid var(--border-subtle);
  margin: 0;
}
.tool-viz-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 6px 16px;
  padding: 0 4px;
}
.tool-viz-item {
  padding: 4px 0;
}

.setting-result {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

/* ── Health threshold inputs ──────────────────────────────── */
.threshold-input {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.threshold-label {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
}

.threshold-label.good {
  color: var(--success-fg);
}
.threshold-label.warning {
  color: var(--warning-fg);
}
.threshold-label.critical {
  color: var(--danger-fg);
}

/* ── Flag checkboxes ──────────────────────────────────────── */
.flag-checkboxes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.flag-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.flag-checkbox input[type="checkbox"] {
  accent-color: var(--accent-emphasis);
}

/* ── Keyboard shortcuts ───────────────────────────────────── */
.shortcuts-table {
  padding: 10px 16px;
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 0;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 0.8125rem;
  color: var(--text-primary);
}

.shortcut-row:last-child {
  border-bottom: none;
}

.shortcut-keys {
  display: flex;
  gap: 3px;
}

.shortcut-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  padding: 2px 6px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: 4px;
  font-size: 0.625rem;
  font-family: inherit;
  font-weight: 500;
  color: var(--text-secondary);
  line-height: 1.4;
}

.shortcuts-footer {
  padding: 8px 16px 12px;
  font-size: 0.6875rem;
  color: var(--text-placeholder);
  border-top: 1px solid var(--border-subtle);
}

/* ── About ────────────────────────────────────────────────── */
.about-content {
  padding: 16px;
}

.about-brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.about-brand-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, #6366f1, #818cf8);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.3);
}

.about-app-name {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.about-tagline {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.about-meta {
  margin-bottom: 16px;
}

.about-links {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}

.about-links a {
  color: var(--text-link);
  text-decoration: none;
  font-size: 0.8125rem;
  transition: color 100ms ease;
}

.about-links a:hover {
  color: var(--accent-fg);
  text-decoration: underline;
}

.about-footer {
  font-size: 0.6875rem;
  color: var(--text-placeholder);
}

/* ── Pricing section ──────────────────────────────────────── */
.pricing-subsection-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 12px 0 4px;
}

.pricing-description {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-bottom: 10px;
  line-height: 1.5;
}

.pricing-table-wrapper {
  overflow-x: auto;
}

.pricing-table th {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-tertiary);
  padding: 8px 6px;
}

.pricing-table td {
  padding: 4px 6px;
  vertical-align: middle;
}

.pricing-remove-btn {
  background: none;
  border: none;
  color: var(--danger-fg);
  font-size: 1.125rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  line-height: 1;
  opacity: 0.6;
  transition: opacity 100ms ease;
}

.pricing-remove-btn:hover {
  opacity: 1;
  background: var(--danger-subtle);
}

.pricing-add-btn {
  background: none;
  border: 1px solid var(--border-default);
  color: var(--accent-fg);
  font-size: 1rem;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  line-height: 1;
  transition: all 100ms ease;
}

.pricing-add-btn:hover:not(:disabled) {
  background: var(--accent-subtle);
}

.pricing-add-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.pricing-add-row td {
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}

.pricing-actions {
  padding: 10px 16px;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  justify-content: flex-end;
}

/* ── Indexing progress bar ─────────────────────────────────── */
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
