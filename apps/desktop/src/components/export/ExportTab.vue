<script setup lang="ts">
import { exportSessionFolderZip, exportSessions, getSessionSections } from "@tracepilot/client";
import type { SectionId, SessionSectionsInfo } from "@tracepilot/types";
import { formatBytes, useToast } from "@tracepilot/ui";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { runUiAction } from "@/composables/useAsyncAction";
import { browseForSavePath } from "@/composables/useBrowseDirectory";
import { useExportConfig } from "@/composables/useExportConfig";
import { useExportPreview } from "@/composables/useExportPreview";
import { useSessionsStore } from "@/stores/sessions";
import { buildExportFilename, type ExportExtension } from "@/utils/exportFilename";
import { logInfo } from "@/utils/logger";
import ExportFormatSelector from "./ExportFormatSelector.vue";
import ExportPresetBar from "./ExportPresetBar.vue";
import ExportPreviewPanel from "./ExportPreviewPanel.vue";
import ExportSectionsPanel from "./ExportSectionsPanel.vue";
import ExportSessionPicker from "./ExportSessionPicker.vue";

// ── Stores & Composables ─────────────────────────────────────

const route = useRoute();
const sessionsStore = useSessionsStore();
const { success: toastSuccess } = useToast();

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

// ── Session Sections Info ────────────────────────────────────

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
    incidents: info.hasIncidents,
    rewind_snapshots: info.hasRewindSnapshots,
    custom_tables: info.hasCustomTables,
  };
  return map[sectionId] ?? null;
}

// ── Selected Session Info ───────────────────────────────────

const selectedSession = computed(() =>
  sessionsStore.sessions.find((s) => s.id === selectedSessionId.value),
);

function selectSession(id: string) {
  selectedSessionId.value = id;
}

// ── Save Preset ─────────────────────────────────────────────

function handleSavePreset(name: string) {
  saveAsPreset(name);
  toastSuccess(`Saved preset "${name}"`);
}

// ── Export Action ────────────────────────────────────────────

const exporting = ref(false);
const isZip = computed(() => format.value === "zip");

async function handleExport() {
  if (!selectedSessionId.value) return;

  if (isZip.value) {
    await handleRawZipExport();
    return;
  }

  const ext: ExportExtension =
    format.value === "json" ? "tpx.json" : format.value === "markdown" ? "md" : "csv";

  const session = selectedSession.value;
  const defaultName = buildExportFilename({
    summary: session?.summary,
    repository: session?.repository,
    extension: ext,
  });

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

  const fmt = format.value;
  if (fmt === "zip") return;

  exporting.value = true;
  const result = await runUiAction({
    errorLabel: "[export]",
    run: () =>
      exportSessions({
        sessionIds: [selectedSessionId.value],
        format: fmt,
        sections: sectionsArray.value,
        outputPath,
        contentDetail: contentDetail.value,
        redaction: redaction.value,
      }),
  });
  exporting.value = false;
  if (result) {
    toastSuccess(
      `Exported ${result.sessionsExported} session (${formatBytes(result.fileSizeBytes)})`,
    );
    logInfo(`[export] Saved to ${result.filePath}`);
  }
}

async function handleRawZipExport() {
  const session = selectedSession.value;
  const defaultName = buildExportFilename({
    summary: session?.summary,
    repository: session?.repository,
    extension: "zip",
  });

  const outputPath = await browseForSavePath({
    title: "Save zip archive as",
    defaultPath: defaultName,
    filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
  });
  if (!outputPath) return;

  exporting.value = true;
  await runUiAction({
    errorLabel: "[export] Raw zip",
    toastSuccess: "Session folder exported as zip",
    run: async () => {
      await exportSessionFolderZip(selectedSessionId.value, outputPath);
      logInfo(`[export] Raw zip saved to ${outputPath}`);
    },
  });
  exporting.value = false;
}

// ── Lifecycle ───────────────────────────────────────────────

onMounted(() => {
  sessionsStore.fetchSessions();

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

watch(selectedSessionId, (id) => loadSectionsInfo(id));
</script>

<template>
  <div class="export-split">
    <!-- Left: Config Column -->
    <div class="config-col">
      <ExportPresetBar
        :all-presets="allPresets"
        :custom-presets="customPresets"
        :active-preset="activePreset"
        @apply="applyPreset"
        @delete="deleteCustomPreset"
        @save="handleSavePreset"
      />

      <ExportSessionPicker
        :sessions="sessionsStore.sessions"
        :selected-session-id="selectedSessionId"
        :selected-session="selectedSession"
        :sections-info="sectionsInfo"
        @select="selectSession"
      />

      <ExportFormatSelector v-model="format" />

      <ExportSectionsPanel
        v-if="!isZip"
        :enabled-sections="enabledSections"
        :content-detail="contentDetail"
        :redaction="redaction"
        :section-has-data="sectionHasData"
        @toggle-section="toggleSection"
        @select-all="selectAll"
        @select-none="selectNone"
        @update-content-detail="updateContentDetail"
        @update-redaction="updateRedaction"
      />

      <!-- Export Button -->
      <div class="export-actions">
        <button
          class="btn btn-primary btn-export"
          :disabled="!selectedSessionId || exporting || (!isZip && sectionsArray.length === 0)"
          @click="handleExport"
        >
          <template v-if="exporting">
            <span class="spinner" /> Exporting…
          </template>
          <template v-else>
            {{ isZip ? 'Export Zip' : 'Export' }}
          </template>
        </button>
        <div class="export-footer-row">
          <span v-if="!isZip && preview" class="text-tertiary">
            ~{{ formatBytes(preview.estimatedSizeBytes) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Right: Preview Column -->
    <ExportPreviewPanel
      :format="format"
      :preview="preview"
      :loading="previewLoading"
      :error="previewError"
      :has-selected-session="!!selectedSessionId"
    />
  </div>
</template>
