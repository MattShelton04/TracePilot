<script setup lang="ts">
// STUB: Settings beyond theme are stored in local component state.
// STUB: Wire to usePreferencesStore or a dedicated settings API for persistence.

import { ref, computed } from 'vue';
import { usePreferencesStore, type ThemeOption } from '@/stores/preferences';
import { useSessionsStore } from '@/stores/sessions';
import {
  BtnGroup,
  FormSwitch,
  FormInput,
  ActionButton,
  SectionPanel,
} from '@tracepilot/ui';
import StubBanner from '@/components/StubBanner.vue';

const preferences = usePreferencesStore();
const sessionsStore = useSessionsStore();

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
// STUB: Browse button should open Tauri native file dialog (dialog.open)
// STUB: Currently shows a text input — wire to Tauri fs dialog in production
const sessionsDirectory = ref('~/.claude/sessions/');

// STUB: Database size is mocked — wire to backend stat query
const databaseSize = ref('42.5 MB');

const autoIndexOnLaunch = ref(true);
const reindexing = ref(false);

async function reindexSessions() {
  // STUB: Reindex triggers backend session re-scan
  reindexing.value = true;
  setTimeout(() => {
    reindexing.value = false;
  }, 2000);
}

// STUB: Clear cache functionality not yet implemented
function clearCache() {
  // no-op stub
}

// ── Health Scoring ───────────────────────────────────────────
const healthScoringEnabled = ref(true);

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
const sessionCount = computed(() => sessionsStore.sessions.length);
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
                Path to Claude Code session data
              </div>
            </div>
            <div class="setting-control-group">
              <FormInput
                v-model="sessionsDirectory"
                style="width: 240px; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem"
              />
              <!-- STUB: Browse button should open Tauri native file dialog (dialog.open) -->
              <ActionButton size="sm" @click="() => {}">Browse…</ActionButton>
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
                Rescan the sessions directory
              </div>
            </div>
            <ActionButton
              size="sm"
              :disabled="reindexing"
              @click="reindexSessions"
            >
              {{ reindexing ? 'Reindexing…' : 'Reindex' }}
            </ActionButton>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Clear cache</div>
              <div class="setting-description">
                Remove cached session data
              </div>
            </div>
            <!-- STUB: Clear cache functionality not yet implemented -->
            <ActionButton size="sm" class="btn-danger" @click="clearCache">
              Clear Cache
            </ActionButton>
          </div>
        </SectionPanel>
      </div>

      <!-- ════════ 3. Health Scoring ════════ -->
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

      <!-- ════════ 4. Keyboard Shortcuts ════════ -->
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

      <!-- ════════ 5. About ════════ -->
      <div class="settings-section">
        <div class="settings-section-title">About</div>
        <SectionPanel>
          <div class="about-content">
            <div class="about-brand">
              <div class="about-brand-icon" aria-hidden="true">⏱</div>
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
  font-size: 22px;
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
</style>
