<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionsStore } from '@/stores/sessions';
import {
  FormSwitch,
  BtnGroup,
  Badge,
  EmptyState,
  MarkdownContent,
  ProgressBar,
  formatBytes,
  useToast,
} from '@tracepilot/ui';
import type { ExportFormat, SectionId, SessionSectionsInfo } from '@tracepilot/types';
import { SECTION_LABELS } from '@tracepilot/types';
import { exportSessions, getSessionSections } from '@tracepilot/client';
import { browseForSavePath } from '@/composables/useBrowseDirectory';
import { logError, logInfo } from '@/utils/logger';
import {
  useExportConfig,
  EXPORT_PRESETS,
  SECTION_GROUPS,
  SECTION_ICONS,
  FORMAT_DESCRIPTIONS,
  type ExportPreset,
} from '@/composables/useExportConfig';
import { useExportPreview } from '@/composables/useExportPreview';
import { useImportFlow } from '@/composables/useImportFlow';

// ── Stores & Composables ─────────────────────────────────────

const sessionsStore = useSessionsStore();
const router = useRouter();
const { success: toastSuccess, error: toastError } = useToast();

const {
  selectedSessionId,
  format,
  enabledSections,
  activePreset,
  sectionsArray,
  allPresets,
  customPresets,
  contentDetail,
  redaction,
  applyPreset,
  toggleSection,
  selectAll,
  selectNone,
  saveAsPreset,
  deleteCustomPreset,
  updateContentDetail,
  updateRedaction,
} = useExportConfig();

const {
  preview,
  loading: previewLoading,
  error: previewError,
} = useExportPreview(selectedSessionId, format, sectionsArray, contentDetail, redaction);

const importFlow = useImportFlow();

// ── Tab State ────────────────────────────────────────────────

type TabId = 'export' | 'import';
const activeTab = ref<TabId>('export');

// ── Session Sections Info (which sections actually have data) ─

const sectionsInfo = ref<SessionSectionsInfo | null>(null);

async function loadSectionsInfo(sessionId: string) {
  if (!sessionId) {
    sectionsInfo.value = null;
    return;
  }
  try {
    sectionsInfo.value = await getSessionSections(sessionId);
  } catch {
    sectionsInfo.value = null;
  }
}

// ── Export Action ────────────────────────────────────────────

const exporting = ref(false);

async function handleExport() {
  if (!selectedSessionId.value) return;

  const ext = format.value === 'json' ? 'tpx.json' : format.value === 'markdown' ? 'md' : 'csv';
  const defaultName = `session-export.${ext}`;

  const outputPath = await browseForSavePath({
    title: 'Save export as',
    defaultPath: defaultName,
  });
  if (!outputPath) return;

  exporting.value = true;
  try {
    const result = await exportSessions({
      sessionIds: [selectedSessionId.value],
      format: format.value,
      sections: sectionsArray.value,
      outputPath,
      contentDetail: contentDetail.value,
      redaction: redaction.value,
    });
    toastSuccess(
      `Exported ${result.sessionsExported} session (${formatBytes(result.fileSizeBytes)})`,
    );
    logInfo(`[export] Saved to ${result.filePath}`);
  } catch (err) {
    logError('[export] Failed:', err);
    toastError(err instanceof Error ? err.message : 'Export failed');
  } finally {
    exporting.value = false;
  }
}

// ── Preview View Toggle ─────────────────────────────────────

type PreviewView = 'raw' | 'rendered';
const previewView = ref<PreviewView>('raw');

// ── Save Preset Dialog ──────────────────────────────────────

const showSavePreset = ref(false);
const newPresetName = ref('');

function handleSavePreset() {
  const name = newPresetName.value.trim();
  if (!name) return;
  saveAsPreset(name);
  newPresetName.value = '';
  showSavePreset.value = false;
  toastSuccess(`Saved preset "${name}"`);
}

// ── Rendered Preview ────────────────────────────────────────

/** Whether the current format supports a rendered view */
const canRenderPreview = computed(() => format.value === 'markdown');

/** For JSON, pretty-print for the raw view */
const formattedPreviewContent = computed(() => {
  if (!preview.value?.content) return '';
  if (format.value === 'json') {
    try {
      return JSON.stringify(JSON.parse(preview.value.content), null, 2);
    } catch {
      return preview.value.content;
    }
  }
  return preview.value.content;
});

// ── Format Options ──────────────────────────────────────────

const formatOptions: { value: ExportFormat; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'csv', label: 'CSV' },
];

// ── Selected Session Info ───────────────────────────────────

const selectedSession = computed(() =>
  sessionsStore.sessions.find((s) => s.id === selectedSessionId.value),
);

// ── Session Search / Filter ─────────────────────────────────

const sessionSearchQuery = ref('');
const sessionDropdownOpen = ref(false);

const filteredSessions = computed(() => {
  const q = sessionSearchQuery.value.toLowerCase().trim();
  if (!q) return sessionsStore.sessions;
  return sessionsStore.sessions.filter((s) => {
    const summary = (s.summary || '').toLowerCase();
    const repo = (s.repository || '').toLowerCase();
    const id = s.id.toLowerCase();
    return summary.includes(q) || repo.includes(q) || id.includes(q);
  });
});

function selectSession(id: string) {
  selectedSessionId.value = id;
  sessionDropdownOpen.value = false;
  sessionSearchQuery.value = '';
}

// ── Lifecycle ───────────────────────────────────────────────

onMounted(() => {
  sessionsStore.fetchSessions();
});

// Watch session changes to load sections info
watch(selectedSessionId, (id) => loadSectionsInfo(id));

// ── Helpers ─────────────────────────────────────────────────

function sectionHasData(sectionId: SectionId): boolean | null {
  const info = sectionsInfo.value;
  if (!info) return null;
  const map: Partial<Record<SectionId, boolean>> = {
    conversation: info.hasConversation,
    events: info.hasEvents,
    todos: info.hasTodos,
    plan: info.hasPlan,
    checkpoints: info.hasCheckpoints,
    metrics: info.hasMetrics,
    health: info.hasHealth,
    incidents: info.hasIncidents,
    rewind_snapshots: info.hasRewindSnapshots,
    custom_tables: info.hasCustomTables,
  };
  return map[sectionId] ?? null;
}

function copiedToClipboard() {
  if (preview.value?.content) {
    navigator.clipboard.writeText(preview.value.content);
    toastSuccess('Copied to clipboard');
  }
}
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <!-- ── Header + Tabs ── -->
      <header class="export-header">
        <div class="header-row">
          <h1>Export & Import</h1>
          <div class="tab-pills">
            <button
              class="tab-pill"
              :class="{ active: activeTab === 'export' }"
              @click="activeTab = 'export'"
            >
              Export
            </button>
            <button
              class="tab-pill"
              :class="{ active: activeTab === 'import' }"
              @click="activeTab = 'import'"
            >
              Import
            </button>
          </div>
        </div>
        <p class="text-secondary">
          {{ activeTab === 'export'
            ? 'Configure and preview your session export'
            : 'Import sessions from a TracePilot archive' }}
        </p>
      </header>

      <!-- ════════════ EXPORT TAB ════════════ -->
      <div v-if="activeTab === 'export'" class="export-split">
        <!-- Left: Config Column -->
        <div class="config-col">
          <!-- Presets -->
          <div class="preset-bar">
            <button
              v-for="preset in allPresets"
              :key="preset.id"
              class="preset-btn"
              :class="{ active: activePreset === preset.id }"
              :title="preset.description"
              @click="applyPreset(preset.id)"
            >
              <span>{{ preset.icon }}</span>
              {{ preset.label }}
              <span
                v-if="customPresets.some((c: ExportPreset) => c.id === preset.id)"
                class="preset-delete"
                title="Delete custom preset"
                @click.stop="deleteCustomPreset(preset.id)"
              >×</span>
            </button>
            <button
              class="preset-btn preset-save-btn"
              title="Save current configuration as a preset"
              @click="showSavePreset = !showSavePreset"
            >
              <span>💾</span>
              Save Preset
            </button>
          </div>
          <div v-if="showSavePreset" class="save-preset-row">
            <input
              v-model="newPresetName"
              class="save-preset-input"
              placeholder="Preset name…"
              @keyup.enter="handleSavePreset"
            />
            <button class="btn btn-primary btn-sm" :disabled="!newPresetName.trim()" @click="handleSavePreset">
              Save
            </button>
            <button class="link-btn" @click="showSavePreset = false">Cancel</button>
          </div>

          <!-- Session Selector (searchable) -->
          <section class="config-section">
            <h3 class="config-section-title">Session</h3>
            <div class="session-picker" @focusin="sessionDropdownOpen = true">
              <input
                v-model="sessionSearchQuery"
                class="session-search-input"
                placeholder="Search sessions…"
                @focus="sessionDropdownOpen = true"
              />
              <div v-if="selectedSession && !sessionSearchQuery" class="session-search-selected" @click="sessionDropdownOpen = true">
                {{ selectedSession.summary || selectedSession.id.slice(0, 12) }} — {{ selectedSession.repository ?? 'unknown' }}
              </div>
              <div v-if="sessionDropdownOpen" class="session-dropdown" @mouseleave="sessionDropdownOpen = false">
                <div v-if="filteredSessions.length === 0" class="session-dropdown-empty">
                  No sessions match "{{ sessionSearchQuery }}"
                </div>
                <div
                  v-for="s in filteredSessions"
                  :key="s.id"
                  class="session-dropdown-item"
                  :class="{ selected: s.id === selectedSessionId }"
                  @click="selectSession(s.id)"
                >
                  <div class="session-dropdown-name">
                    {{ s.summary || s.id.slice(0, 12) }}
                  </div>
                  <div class="session-dropdown-meta">
                    {{ s.repository ?? 'unknown' }}
                    <span v-if="s.currentModel"> · {{ s.currentModel }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="selectedSession" class="session-info">
              <div class="session-info-badges">
                <Badge variant="accent">{{ selectedSession.repository ?? '—' }}</Badge>
                <Badge variant="neutral">{{ selectedSession.currentModel ?? '—' }}</Badge>
              </div>
              <div v-if="sectionsInfo" class="session-info-stats">
                <span v-if="sectionsInfo.turnCount != null">{{ sectionsInfo.turnCount }} turns</span>
                <span v-if="sectionsInfo.eventCount != null">· {{ sectionsInfo.eventCount }} events</span>
              </div>
            </div>
          </section>

          <!-- Format -->
          <section class="config-section">
            <h3 class="config-section-title">Format</h3>
            <BtnGroup v-model="format" :options="formatOptions" />
            <p class="format-desc-text">{{ FORMAT_DESCRIPTIONS[format] }}</p>
          </section>

          <!-- Content Sections -->
          <section class="config-section">
            <div class="section-title-row">
              <h3 class="config-section-title">Content Sections</h3>
              <span class="section-actions">
                <button class="link-btn" @click="selectAll">Select All</button>
                ·
                <button class="link-btn" @click="selectNone">Clear</button>
              </span>
            </div>
            <div v-for="group in SECTION_GROUPS" :key="group.label">
              <div class="toggle-group-label">{{ group.label }}</div>
              <div
                v-for="sectionId in group.sections"
                :key="sectionId"
                class="toggle-row"
              >
                <span class="toggle-row-icon">{{ SECTION_ICONS[sectionId] }}</span>
                <span class="toggle-row-label">
                  {{ SECTION_LABELS[sectionId] }}
                  <span
                    v-if="sectionHasData(sectionId) === false"
                    class="no-data-hint"
                  >(empty)</span>
                </span>
                <FormSwitch
                  :model-value="enabledSections.has(sectionId)"
                  @update:model-value="toggleSection(sectionId)"
                />
              </div>
            </div>
          </section>

          <!-- Detail Level -->
          <section v-if="enabledSections.has('conversation')" class="config-section">
            <h3 class="config-section-title">Detail Level</h3>
            <div class="toggle-row">
              <span class="toggle-row-icon">🤖</span>
              <span class="toggle-row-label">
                Include subagent internals
                <span class="detail-hint">Include subagent reasoning, tool calls &amp; intermediate thoughts</span>
              </span>
              <FormSwitch
                :model-value="contentDetail.includeSubagentInternals"
                @update:model-value="updateContentDetail('includeSubagentInternals', $event)"
              />
            </div>
            <div class="toggle-row">
              <span class="toggle-row-icon">🔧</span>
              <span class="toggle-row-label">
                Tool call details
                <span class="detail-hint">Include arguments &amp; result content</span>
              </span>
              <FormSwitch
                :model-value="contentDetail.includeToolDetails"
                @update:model-value="updateContentDetail('includeToolDetails', $event)"
              />
            </div>
            <div class="toggle-row">
              <span class="toggle-row-icon">📄</span>
              <span class="toggle-row-label">
                Full tool results
                <span class="detail-hint">Include complete output instead of 1KB preview (may be large)</span>
              </span>
              <FormSwitch
                :model-value="contentDetail.includeFullToolResults"
                @update:model-value="updateContentDetail('includeFullToolResults', $event)"
              />
            </div>
          </section>

          <!-- Privacy / Redaction -->
          <section class="config-section">
            <h3 class="config-section-title">Privacy</h3>
            <div class="toggle-row">
              <span class="toggle-row-icon">📁</span>
              <span class="toggle-row-label">
                Anonymize paths
                <span class="detail-hint">Replace filesystem paths with placeholders</span>
              </span>
              <FormSwitch
                :model-value="redaction.anonymizePaths"
                @update:model-value="updateRedaction('anonymizePaths', $event)"
              />
            </div>
            <div class="toggle-row">
              <span class="toggle-row-icon">🔑</span>
              <span class="toggle-row-label">
                Strip secrets
                <span class="detail-hint">Remove API keys, tokens, and credentials</span>
              </span>
              <FormSwitch
                :model-value="redaction.stripSecrets"
                @update:model-value="updateRedaction('stripSecrets', $event)"
              />
            </div>
            <div class="toggle-row">
              <span class="toggle-row-icon">👤</span>
              <span class="toggle-row-label">
                Strip PII
                <span class="detail-hint">Remove emails, IP addresses, and other personal data</span>
              </span>
              <FormSwitch
                :model-value="redaction.stripPii"
                @update:model-value="updateRedaction('stripPii', $event)"
              />
            </div>
          </section>

          <!-- Export Button -->
          <div class="export-actions">
            <button
              class="btn btn-primary btn-export"
              :disabled="!selectedSessionId || exporting || sectionsArray.length === 0"
              @click="handleExport"
            >
              <template v-if="exporting">
                <span class="spinner" /> Exporting…
              </template>
              <template v-else>
                Export
              </template>
            </button>
            <div class="export-footer-row">
              <span v-if="preview" class="text-tertiary">
                ~{{ formatBytes(preview.estimatedSizeBytes) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Right: Preview Column -->
        <div class="preview-col">
          <div class="preview-panel">
            <!-- Preview Header -->
            <div class="preview-header">
              <h3 class="config-section-title" style="margin: 0">Preview</h3>
              <div class="preview-header-right">
                <Badge variant="accent">{{ format.toUpperCase() }}</Badge>
                <div class="view-toggle">
                  <button
                    class="view-toggle-btn"
                    :class="{ active: previewView === 'raw' }"
                    @click="previewView = 'raw'"
                  >
                    Raw
                  </button>
                  <button
                    class="view-toggle-btn"
                    :class="{ active: previewView === 'rendered', disabled: !canRenderPreview }"
                    :disabled="!canRenderPreview"
                    :title="canRenderPreview ? 'Rendered preview' : 'Rendered view is only available for Markdown'"
                    @click="canRenderPreview && (previewView = 'rendered')"
                  >
                    Rendered
                  </button>
                </div>
              </div>
            </div>

            <!-- Preview Body -->
            <div class="preview-body">
              <div v-if="!selectedSessionId" class="preview-empty">
                <EmptyState
                  icon="📤"
                  message="Select a session to preview the export"
                  compact
                />
              </div>
              <div v-else-if="previewLoading" class="preview-loading">
                <span class="spinner" /> Generating preview…
              </div>
              <div v-else-if="previewError" class="preview-error">
                <EmptyState
                  icon="⚠️"
                  :message="previewError"
                  compact
                />
              </div>
              <div v-else-if="preview">
                <!-- Raw view -->
                <pre v-if="previewView === 'raw'" class="preview-code"><code>{{ formattedPreviewContent }}</code></pre>
                <!-- Rendered view: Markdown via MarkdownContent component -->
                <MarkdownContent
                  v-else-if="canRenderPreview"
                  :content="preview.content"
                  :render="true"
                />
                <!-- Rendered view fallback: formats without a renderer -->
                <pre v-else class="preview-code"><code>{{ formattedPreviewContent }}</code></pre>
              </div>
            </div>

            <!-- Preview Footer -->
            <div v-if="preview" class="preview-footer">
              <div class="preview-footer-left">
                <span>{{ preview.sectionCount }} section{{ preview.sectionCount !== 1 ? 's' : '' }}</span>
                <span>·</span>
                <span>~{{ formatBytes(preview.estimatedSizeBytes) }}</span>
              </div>
              <button class="link-btn" @click="copiedToClipboard">
                Copy to Clipboard
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ════════════ IMPORT TAB ════════════ -->
      <div v-if="activeTab === 'import'" class="import-container">
        <!-- Step 1: File Selection -->
        <div v-if="importFlow.step.value === 'select'">
          <div
            class="drop-zone"
            @click="importFlow.browseFile"
          >
            <div class="drop-zone-icon">📂</div>
            <div class="drop-zone-text">
              Drop a <strong>.tpx.json</strong> file here, or click to browse
            </div>
            <div class="drop-zone-hint">Supports TracePilot export files v1.0+</div>
          </div>
          <div v-if="importFlow.error.value" class="import-error">
            ⚠️ {{ importFlow.error.value }}
          </div>
        </div>

        <!-- Step 2: Validating -->
        <div v-if="importFlow.step.value === 'validating'" class="import-validating">
          <div class="import-file-card">
            <span class="import-file-icon">📄</span>
            <div>
              <div class="import-file-name">{{ importFlow.fileName.value }}</div>
              <div class="import-file-meta">Validating…</div>
            </div>
          </div>
          <div class="validation-list">
            <div class="validation-item checking">
              <span class="validation-icon spinner">⟳</span>
              <span class="validation-label">Parsing and validating archive…</span>
            </div>
          </div>
        </div>

        <!-- Step 3: Review -->
        <div v-if="importFlow.step.value === 'review' && importFlow.preview.value">
          <div class="import-file-card">
            <span class="import-file-icon">📄</span>
            <div>
              <div class="import-file-name">{{ importFlow.fileName.value }}</div>
              <div class="import-file-meta">
                {{ importFlow.preview.value.sessions.length }} session(s) ·
                Schema v{{ importFlow.preview.value.schemaVersion }}
                <Badge v-if="importFlow.preview.value.needsMigration" variant="warning">
                  Migration needed
                </Badge>
              </div>
            </div>
          </div>

          <!-- Validation Issues -->
          <div v-if="importFlow.preview.value.issues.length > 0" class="validation-list">
            <div
              v-for="(issue, i) in importFlow.preview.value.issues"
              :key="i"
              class="validation-item"
              :class="{
                'issue-error': issue.severity === 'error',
                'issue-warning': issue.severity === 'warning',
              }"
            >
              <span class="validation-icon">
                {{ issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️' }}
              </span>
              <span class="validation-label">{{ issue.message }}</span>
            </div>
          </div>
          <div v-else class="validation-list">
            <div class="validation-item passed">
              <span class="validation-icon">✅</span>
              <span class="validation-label">Archive is valid</span>
            </div>
          </div>

          <!-- Session List -->
          <section class="config-section" style="margin-top: 20px">
            <h3 class="config-section-title">Sessions to Import</h3>
            <div
              v-for="session in importFlow.preview.value.sessions"
              :key="session.id"
              class="import-session-row"
            >
              <FormSwitch
                :model-value="importFlow.selectedSessions.value.includes(session.id)"
                @update:model-value="importFlow.toggleSession(session.id)"
              />
              <div class="import-session-info">
                <div class="import-session-name">
                  {{ session.summary ?? session.id.slice(0, 12) }}
                </div>
                <div class="import-session-meta">
                  {{ session.repository ?? 'Unknown repo' }}
                  · {{ session.sectionCount }} sections
                  <Badge v-if="session.alreadyExists" variant="warning">Exists</Badge>
                </div>
              </div>
            </div>
          </section>

          <!-- Conflict Strategy -->
          <section class="config-section" style="margin-top: 16px">
            <h3 class="config-section-title">Conflict Handling</h3>
            <BtnGroup
              v-model="importFlow.conflictStrategy.value"
              :options="[
                { value: 'skip', label: 'Skip' },
                { value: 'replace', label: 'Replace' },
                { value: 'duplicate', label: 'Duplicate' },
              ]"
            />
          </section>

          <!-- Error display -->
          <div v-if="importFlow.error.value" class="import-error" style="margin-top: 12px">
            ⚠️ {{ importFlow.error.value }}
          </div>

          <!-- Import Actions -->
          <div class="import-actions">
            <button class="btn btn-secondary" @click="importFlow.reset">
              Cancel
            </button>
            <button
              class="btn btn-primary"
              :disabled="!importFlow.canImport.value"
              @click="importFlow.executeImport"
            >
              Import {{ importFlow.selectedSessions.value.length }} Session(s)
            </button>
          </div>
        </div>

        <!-- Step 4: Importing -->
        <div v-if="importFlow.step.value === 'importing'" class="import-progress-container">
          <div class="import-file-card">
            <span class="import-file-icon">📄</span>
            <div>
              <div class="import-file-name">{{ importFlow.fileName.value }}</div>
              <div class="import-file-meta">Importing…</div>
            </div>
          </div>
          <ProgressBar :percent="importFlow.importProgress.value" color="accent" aria-label="Import progress" />
          <p class="text-secondary import-progress-label">
            {{ importFlow.importProgress.value < 30 ? 'Parsing sessions…'
              : importFlow.importProgress.value < 60 ? 'Restoring data…'
              : importFlow.importProgress.value < 90 ? 'Indexing events…'
              : 'Finalizing…' }}
          </p>
        </div>

        <!-- Step 5: Complete -->
        <div v-if="importFlow.step.value === 'complete'" class="import-success">
          <div class="import-success-icon">✅</div>
          <h2 class="import-success-title">Import Complete</h2>
          <p class="import-success-desc">
            {{ importFlow.importedCount.value }} session(s) imported successfully.
            <template v-if="importFlow.skippedCount.value > 0">
              {{ importFlow.skippedCount.value }} skipped.
            </template>
          </p>
          <div v-if="importFlow.importErrors.value.length > 0" class="import-note-list">
            <div v-for="(err, i) in importFlow.importErrors.value" :key="i" class="import-note">
              ℹ️ {{ err }}
            </div>
          </div>
          <div class="import-actions">
            <button class="btn btn-secondary" @click="importFlow.reset">
              Import Another
            </button>
            <button class="btn btn-primary" @click="router.push({ name: 'sessions' })">
              View Sessions
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Header ────────────────────────────────────────────────── */
.export-header {
  margin-bottom: 24px;
}
.export-header h1 {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.text-secondary {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin: 0;
}
.text-tertiary {
  color: var(--text-tertiary);
  font-size: 0.8rem;
}

/* ── Tab Pills ─────────────────────────────────────────────── */
.tab-pills {
  display: flex;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.tab-pill {
  flex: 1;
  padding: 6px 16px;
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: inherit;
  background: var(--canvas-subtle);
  color: var(--text-secondary);
  border: none;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.tab-pill:not(:last-child) {
  border-right: 1px solid var(--border-default);
}
.tab-pill:hover {
  color: var(--text-primary);
}
.tab-pill.active {
  background: var(--accent-muted);
  color: var(--accent-fg);
  font-weight: 600;
}

/* ── Export Split Layout ───────────────────────────────────── */
.export-split {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 24px;
  align-items: start;
}
@media (max-width: 1000px) {
  .export-split {
    grid-template-columns: 1fr;
  }
  .preview-col {
    order: -1;
  }
}

.config-col,
.preview-col {
  max-height: calc(100vh - 180px);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-default) transparent;
}
.config-col {
  padding: 0 8px;
}
.config-col::-webkit-scrollbar,
.preview-col::-webkit-scrollbar {
  width: 5px;
}
.config-col::-webkit-scrollbar-thumb,
.preview-col::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: 999px;
}

/* ── Preset Bar ────────────────────────────────────────────── */
.preset-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.preset-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
  font-family: inherit;
  border: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.preset-btn:hover {
  border-color: var(--accent-emphasis);
  color: var(--text-primary);
  background: var(--accent-subtle);
}
.preset-btn.active {
  border-color: var(--accent-emphasis);
  color: var(--accent-fg);
  background: var(--accent-muted);
}
.preset-save-btn {
  border-style: dashed;
}
.preset-delete {
  font-size: 0.875rem;
  line-height: 1;
  opacity: 0.5;
  margin-left: 2px;
  cursor: pointer;
}
.preset-delete:hover {
  opacity: 1;
  color: var(--danger-fg, #f85149);
}
.save-preset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.save-preset-input {
  flex: 1;
  padding: 6px 10px;
  font-size: 0.8125rem;
  font-family: inherit;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-default);
  color: var(--text-primary);
  outline: none;
}
.save-preset-input:focus {
  border-color: var(--accent-emphasis);
}
.btn-sm {
  padding: 5px 12px;
  font-size: 0.75rem;
}

/* ── Config Sections ───────────────────────────────────────── */
.config-section {
  margin-bottom: 20px;
}
.config-section-title {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin: 0 0 10px;
}
.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.section-actions {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

/* ── Session Picker (searchable dropdown) ──────────────────── */
.session-picker {
  position: relative;
}
.session-search-input {
  width: 100%;
  padding: 8px 12px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: inherit;
  outline: none;
  cursor: text;
  transition: border-color var(--transition-fast);
  box-sizing: border-box;
}
.session-search-input:focus {
  border-color: var(--accent-emphasis);
}
.session-search-selected {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 8px 12px;
  font-size: 0.8125rem;
  color: var(--text-primary);
  background: var(--canvas-default);
  pointer-events: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.session-search-input:focus + .session-search-selected {
  display: none;
}
.session-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 50;
  margin-top: 4px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  scrollbar-width: thin;
  scrollbar-color: var(--border-default) transparent;
}
.session-dropdown-item {
  padding: 8px 12px;
  cursor: pointer;
  transition: background var(--transition-fast);
}
.session-dropdown-item:hover,
.session-dropdown-item.selected {
  background: var(--accent-subtle);
}
.session-dropdown-item.selected {
  border-left: 2px solid var(--accent-emphasis);
}
.session-dropdown-name {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-dropdown-meta {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-dropdown-empty {
  padding: 12px;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}
.session-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.session-info-badges {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.session-info-stats {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ── Format Description ────────────────────────────────────── */
.format-desc-text {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 8px;
}

/* ── Section Toggle Rows ───────────────────────────────────── */
.toggle-group-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
  padding: 10px 0 4px;
}
.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-muted);
  transition: background var(--transition-fast);
}
.toggle-row:last-child {
  border-bottom: none;
}
.toggle-row:hover {
  background: var(--canvas-subtle);
  margin: 0 -8px;
  padding: 8px 8px;
  border-radius: var(--radius-md);
}
.toggle-row-icon {
  font-size: 14px;
  flex-shrink: 0;
  opacity: 0.7;
  width: 20px;
  text-align: center;
}
.toggle-row-label {
  flex: 1;
  font-size: 0.8125rem;
  font-weight: 500;
}
.no-data-hint {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-weight: 400;
}
.detail-hint {
  display: block;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-weight: 400;
  line-height: 1.3;
}

/* ── Link Button ───────────────────────────────────────────── */
.link-btn {
  background: none;
  border: none;
  color: var(--accent-fg);
  cursor: pointer;
  font-size: inherit;
  font-family: inherit;
  padding: 0;
}
.link-btn:hover {
  text-decoration: underline;
}

/* ── Export Actions ─────────────────────────────────────────── */
.export-actions {
  margin-top: 8px;
}
.btn-export {
  width: 100%;
  padding: 12px 24px;
  font-size: 1rem;
  font-weight: 600;
  border-radius: var(--radius-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.export-footer-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

/* ── Preview Panel ─────────────────────────────────────────── */
.preview-panel {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-inset);
  min-height: 0;
  max-height: calc(100vh - 180px);
}
.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}
.preview-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.view-toggle {
  display: flex;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.view-toggle-btn {
  padding: 3px 10px;
  font-size: 0.6875rem;
  font-weight: 500;
  font-family: inherit;
  background: var(--canvas-subtle);
  color: var(--text-secondary);
  border: none;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.view-toggle-btn:not(:last-child) {
  border-right: 1px solid var(--border-default);
}
.view-toggle-btn.active {
  background: var(--accent-muted);
  color: var(--accent-fg);
  font-weight: 600;
}
.view-toggle-btn.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.preview-body {
  flex: 1;
  overflow: auto;
  padding: 16px;
  min-height: 200px;
}
.preview-empty,
.preview-loading,
.preview-error {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}
.preview-loading {
  color: var(--text-secondary);
  font-size: 0.875rem;
  gap: 8px;
}
.preview-code {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
.preview-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.preview-footer-left {
  display: flex;
  gap: 8px;
}

/* ── Import Container ──────────────────────────────────────── */
.import-container {
  max-width: 700px;
  margin: 0 auto;
}

/* ── Drop Zone ─────────────────────────────────────────────── */
.drop-zone {
  border: 2px dashed var(--border-default);
  border-radius: var(--radius-md);
  padding: 48px 24px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--canvas-subtle);
}
.drop-zone:hover {
  border-color: var(--accent-emphasis);
  background: var(--accent-subtle);
}
.drop-zone-icon {
  font-size: 36px;
  margin-bottom: 12px;
  opacity: 0.5;
}
.drop-zone-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.drop-zone-hint {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

/* ── Import File Card ──────────────────────────────────────── */
.import-file-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  margin-bottom: 20px;
}
.import-file-icon {
  font-size: 28px;
  opacity: 0.7;
}
.import-file-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}
.import-file-meta {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ── Validation Items ──────────────────────────────────────── */
.validation-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.validation-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  background: var(--canvas-subtle);
  transition: all 0.2s;
}
.validation-item.checking {
  border-color: var(--accent-emphasis);
}
.validation-item.passed {
  border-color: var(--success-emphasis);
  background: var(--success-subtle);
}
.validation-item.issue-error {
  border-color: var(--danger-emphasis);
  background: var(--danger-subtle);
}
.validation-item.issue-warning {
  border-color: var(--warning-emphasis);
  background: var(--warning-subtle);
}
.validation-icon {
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}
.validation-label {
  flex: 1;
  color: var(--text-secondary);
}

/* ── Import Session Rows ───────────────────────────────────── */
.import-session-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-muted);
}
.import-session-row:last-child {
  border-bottom: none;
}
.import-session-info {
  flex: 1;
}
.import-session-name {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
}
.import-session-meta {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

/* ── Import Actions ────────────────────────────────────────── */
.import-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 24px;
}

/* ── Import Progress ───────────────────────────────────────── */
.import-progress-container {
  text-align: center;
}
.import-progress-label {
  margin-top: 12px;
  font-size: 0.875rem;
}

/* ── Import Success ────────────────────────────────────────── */
.import-success {
  text-align: center;
  padding: 32px 0;
}
.import-success-icon {
  font-size: 48px;
  margin-bottom: 16px;
}
.import-success-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--success-fg);
  margin: 0 0 8px;
}
.import-success-desc {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin: 0 0 16px;
}

/* ── Import Error ──────────────────────────────────────────── */
.import-error {
  padding: 10px 14px;
  border: 1px solid var(--danger-emphasis);
  border-radius: var(--radius-md);
  background: var(--danger-subtle);
  color: var(--danger-fg);
  font-size: 0.8125rem;
  margin-top: 12px;
}
.import-error-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 500px;
  margin: 0 auto 16px;
}

/* ── Import Notes (info-level messages) ───────────────────── */
.import-note-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 500px;
  margin: 0 auto 16px;
}
.import-note {
  padding: 8px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  color: var(--text-secondary);
  font-size: 0.75rem;
}

/* ── Spinner ───────────────────────────────────────────────── */
@keyframes spin {
  to { transform: rotate(360deg); }
}
.spinner {
  display: inline-block;
  animation: spin 0.8s linear infinite;
}
</style>
