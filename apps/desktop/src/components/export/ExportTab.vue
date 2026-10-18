<script setup lang="ts">
import { exportSessionFolderZip, exportSessions, getSessionSections } from "@tracepilot/client";
import {
  resolveSessionSource,
  type SectionId,
  type SessionSectionsInfo,
  sourceCapabilities,
} from "@tracepilot/types";
import { formatBytes, useAsyncGuard, useToast } from "@tracepilot/ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { runUiAction } from "@/composables/useAsyncAction";
import { browseForSavePath } from "@/composables/useBrowseDirectory";
import { sourceSupportsSection, useExportConfig } from "@/composables/useExportConfig";
import { useExportPreview } from "@/composables/useExportPreview";
import { usePreferencesStore } from "@/stores/preferences";
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
const prefs = usePreferencesStore();
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

const selectedSession = computed(() =>
  sessionsStore.sessions.find((s) => s.id === selectedSessionId.value),
);

// The sessions the list shows: with "Hide empty sessions" on, sessions
// without turns are left out, unless one is already chosen (Export opened
// from it). Compare offers the same.
const sessionOptions = computed(() => {
  if (!prefs.hideEmptySessions) return sessionsStore.sessions;
  return sessionsStore.sessions.filter(
    (s) => (s.turnCount ?? 0) > 0 || s.id === selectedSessionId.value,
  );
});

// Sections the selected session's source cannot supply are neither offered
// nor requested, whatever the preset enabled.
const selectedCapabilities = computed(() => sourceCapabilities(selectedSession.value?.source));

function sectionAvailable(sectionId: SectionId): boolean {
  return sourceSupportsSection(sectionId, selectedCapabilities.value);
}

const exportSections = computed(() => sectionsArray.value.filter(sectionAvailable));

// Raw Zip copies Copilot's session folder as laid out on disk; the backend
// refuses it for other sources, so it isn't offered for them. A zip selection
// carried over from a Copilot session falls back to JSON.
const zipAvailable = computed(
  () => resolveSessionSource(selectedSession.value?.source) === "copilot",
);

watch(
  zipAvailable,
  (available) => {
    if (!available && format.value === "zip") format.value = "json";
  },
  { immediate: true },
);

const {
  preview,
  loading: previewLoading,
  error: previewError,
} = useExportPreview(selectedSessionId, format, exportSections, contentDetail, redaction);

// ── Session Sections Info ────────────────────────────────────

const sectionsInfo = ref<SessionSectionsInfo | null>(null);
// A large session answers much later than a small one, so only the latest
// selection's answer may land.
const sectionsGuard = useAsyncGuard();

async function loadSectionsInfo(sessionId: string) {
  const token = sectionsGuard.start();
  // Drop the previous session's stats and "(empty)" hints while this one loads.
  sectionsInfo.value = null;
  if (!sessionId) return;
  try {
    const info = await getSessionSections(sessionId);
    if (sectionsGuard.isValid(token)) sectionsInfo.value = info;
  } catch {
    // Leave it null: no stats line and no "(empty)" hints for this session.
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

  const ext: ExportExtension = format.value === "json" ? "tpx.json" : "md";

  const session = selectedSession.value;
  const defaultName = buildExportFilename({
    summary: session?.summary,
    repository: session?.repository,
    extension: ext,
  });

  const filters =
    format.value === "json"
      ? [{ name: "TracePilot Export (.tpx.json)", extensions: ["json"] }]
      : [{ name: "Markdown", extensions: ["md"] }];

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
        sections: exportSections.value,
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

  // The selectedSessionId watcher loads the section info.
  if (querySessionId) {
    selectedSessionId.value = querySessionId;
    if (queryPreset) {
      applyPreset(queryPreset);
    }
  }
});

watch(selectedSessionId, (id) => loadSectionsInfo(id), { immediate: true });

onUnmounted(() => sectionsGuard.invalidate());
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
        :sessions="sessionOptions"
        :selected-session-id="selectedSessionId"
        :selected-session="selectedSession"
        :sections-info="sectionsInfo"
        @select="selectSession"
      />

      <ExportFormatSelector v-model="format" :zip-available="zipAvailable" />

      <ExportSectionsPanel
        v-if="!isZip"
        :enabled-sections="enabledSections"
        :content-detail="contentDetail"
        :redaction="redaction"
        :section-has-data="sectionHasData"
        :section-available="sectionAvailable"
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
          :disabled="!selectedSessionId || exporting || (!isZip && exportSections.length === 0)"
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
