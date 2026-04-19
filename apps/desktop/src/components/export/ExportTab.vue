<script setup lang="ts">
import { exportSessions, exportSessionFolderZip, getSessionSections } from "@tracepilot/client";
import type { ExportFormat, SectionId, SessionSectionsInfo } from "@tracepilot/types";
import { SECTION_LABELS } from "@tracepilot/types";
import {
  Badge,
  BtnGroup,
  EmptyState,
  FormSwitch,
  formatBytes,
  MarkdownContent,
  useToast,
} from "@tracepilot/ui";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { browseForSavePath } from "@/composables/useBrowseDirectory";
import {
  type ExportPreset,
  FORMAT_DESCRIPTIONS,
  SECTION_GROUPS,
  SECTION_ICONS,
  useExportConfig,
} from "@/composables/useExportConfig";
import { useExportPreview } from "@/composables/useExportPreview";
import { useSessionsStore } from "@/stores/sessions";
import { logError, logInfo } from "@/utils/logger";
import { openExternal } from "@/utils/openExternal";

// ── Stores & Composables ─────────────────────────────────────

const route = useRoute();
const sessionsStore = useSessionsStore();
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
const rawZipMode = ref(false);

async function handleExport() {
  if (!selectedSessionId.value) return;

  if (rawZipMode.value) {
    await handleRawZipExport();
    return;
  }

  const ext = format.value === "json" ? "tpx.json" : format.value === "markdown" ? "md" : "csv";

  // Build a descriptive filename from session name + datetime
  const session = selectedSession.value;
  const slug =
    (session?.summary || session?.repository || "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60) || "session-export";
  const timestamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
  const defaultName = `${slug}-${timestamp}.${ext}`;

  const filters =
    format.value === "json"
      ? [{ name: "TracePilot Export (.tpx.json)", extensions: ["json"] }]
      : format.value === "markdown"
        ? [{ name: "Markdown", extensions: ["md"] }]
        : [{ name: "CSV", extensions: ["csv"] }];

  const outputPath = await browseForSavePath({
    title: "Save export as",
    defaultPath: defaultName,
    filters,
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
    logError("[export] Failed:", err);
    toastError(err instanceof Error ? err.message : "Export failed");
  } finally {
    exporting.value = false;
  }
}

// ── Preview View Toggle ─────────────────────────────────────

async function handleRawZipExport() {
  const session = selectedSession.value;
  const slug =
    (session?.summary || session?.repository || "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60) || "session-export";
  const timestamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
  const defaultName = `${slug}-${timestamp}.zip`;

  const outputPath = await browseForSavePath({
    title: "Save zip archive as",
    defaultPath: defaultName,
    filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
  });
  if (!outputPath) return;

  exporting.value = true;
  try {
    await exportSessionFolderZip(selectedSessionId.value, outputPath);
    toastSuccess("Session folder exported as zip");
    logInfo(`[export] Raw zip saved to ${outputPath}`);
  } catch (err) {
    logError("[export] Raw zip failed:", err);
    toastError(err instanceof Error ? err.message : "Export failed");
  } finally {
    exporting.value = false;
  }
}

type PreviewView = "raw" | "rendered";
const previewView = ref<PreviewView>("raw");

// ── Save Preset Dialog ──────────────────────────────────────

const showSavePreset = ref(false);
const newPresetName = ref("");

function handleSavePreset() {
  const name = newPresetName.value.trim();
  if (!name) return;
  saveAsPreset(name);
  newPresetName.value = "";
  showSavePreset.value = false;
  toastSuccess(`Saved preset "${name}"`);
}

// ── Rendered Preview ────────────────────────────────────────

/** Whether the current format supports a rendered view */
const canRenderPreview = computed(() => format.value === "markdown");

/** For JSON, pretty-print for the raw view */
const formattedPreviewContent = computed(() => {
  if (!preview.value?.content) return "";
  if (format.value === "json") {
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
  { value: "json", label: "JSON" },
  { value: "markdown", label: "Markdown" },
  { value: "csv", label: "CSV" },
];

// ── Selected Session Info ───────────────────────────────────

const selectedSession = computed(() =>
  sessionsStore.sessions.find((s) => s.id === selectedSessionId.value),
);

// ── Session Search / Filter ─────────────────────────────────

const sessionSearchQuery = ref("");
const sessionDropdownOpen = ref(false);

const filteredSessions = computed(() => {
  const q = sessionSearchQuery.value.toLowerCase().trim();
  if (!q) return sessionsStore.sessions;
  return sessionsStore.sessions.filter((s) => {
    const summary = (s.summary || "").toLowerCase();
    const repo = (s.repository || "").toLowerCase();
    const id = s.id.toLowerCase();
    return summary.includes(q) || repo.includes(q) || id.includes(q);
  });
});

function selectSession(id: string) {
  selectedSessionId.value = id;
  sessionDropdownOpen.value = false;
  sessionSearchQuery.value = "";
}

// ── Lifecycle ───────────────────────────────────────────────

onMounted(() => {
  sessionsStore.fetchSessions();

  // Handle navigation from session list (sessionId + optional preset in query)
  const querySessionId = Array.isArray(route.query.sessionId)
    ? route.query.sessionId[0]
    : route.query.sessionId;
  const queryPreset = Array.isArray(route.query.preset)
    ? route.query.preset[0]
    : route.query.preset;

  if (querySessionId) {
    selectedSessionId.value = querySessionId;
    loadSectionsInfo(querySessionId);
    if (queryPreset) {
      applyPreset(queryPreset);
    }
  } else if (selectedSessionId.value) {
    loadSectionsInfo(selectedSessionId.value);
  }
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
    toastSuccess("Copied to clipboard");
  }
}
</script>

<template>
  <div class="export-split">
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
        <BtnGroup v-model="format" :options="formatOptions" @update:model-value="rawZipMode = false" />
        <button
          class="raw-zip-btn"
          :class="{ active: rawZipMode }"
          type="button"
          title="Export the raw session folder as a zip archive"
          @click="rawZipMode = !rawZipMode"
        >
          📦 Raw Zip (session folder)
        </button>
        <p v-if="rawZipMode" class="format-desc-text">
          Raw zip of the session folder — all files exactly as stored on disk. No rendering or filtering.
        </p>
        <p v-else class="format-desc-text">{{ FORMAT_DESCRIPTIONS[format] }}</p>
      </section>

      <!-- Content Sections (hidden in raw zip mode) -->
      <section v-if="!rawZipMode" class="config-section">
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
              :aria-label="`Include ${SECTION_LABELS[sectionId]} section`"
            />
          </div>
        </div>
      </section>

      <!-- Detail Level -->
      <section v-if="!rawZipMode && enabledSections.has('conversation')" class="config-section">
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
            aria-label="Include subagent internals"
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
            aria-label="Include tool call details"
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
            aria-label="Include full tool results"
          />
        </div>
      </section>

      <!-- Privacy / Redaction -->
      <section v-if="!rawZipMode" class="config-section">
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
            aria-label="Anonymize paths"
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
            aria-label="Strip secrets"
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
            aria-label="Strip PII"
          />
        </div>
      </section>

      <!-- Export Button -->
      <div class="export-actions">
        <button
          class="btn btn-primary btn-export"
          :disabled="!selectedSessionId || exporting || (!rawZipMode && sectionsArray.length === 0)"
          @click="handleExport"
        >
          <template v-if="exporting">
            <span class="spinner" /> Exporting…
          </template>
          <template v-else>
            {{ rawZipMode ? 'Export Zip' : 'Export' }}
          </template>
        </button>
        <div class="export-footer-row">
          <span v-if="!rawZipMode && preview" class="text-tertiary">
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
              @open-external="openExternal"
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
</template>
