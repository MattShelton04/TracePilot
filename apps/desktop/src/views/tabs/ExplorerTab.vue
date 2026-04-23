<script setup lang="ts">
import "@/styles/features/session-explorer.css";
import type { SessionFileType } from "@tracepilot/types";
import { FileBrowserTree, FileContentViewer, useAutoRefresh } from "@tracepilot/ui";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useSessionFiles } from "@/composables/useSessionFiles";
import { usePreferencesStore } from "@/stores/preferences";

const store = useSessionDetailContext();
const prefs = usePreferencesStore();

const sessionFiles = useSessionFiles(() => store.sessionId);

async function onViewFile(path: string) {
  const entry = sessionFiles.files.find((f) => f.path === path);
  const fileType: SessionFileType = entry?.fileType ?? "text";
  await sessionFiles.selectFile(path, fileType);
}

// ── Drag-to-resize ──────────────────────────────────────────────────────────
const treeWidth = ref(240);
const isDragging = ref(false);

let activeDragCleanup: (() => void) | null = null;

function startDrag(e: MouseEvent) {
  isDragging.value = true;
  const startX = e.clientX;
  const startWidth = treeWidth.value;

  function onMove(e: MouseEvent) {
    treeWidth.value = Math.max(160, Math.min(500, startWidth + (e.clientX - startX)));
  }

  function onUp() {
    isDragging.value = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    activeDragCleanup = null;
  }

  activeDragCleanup = () => {
    isDragging.value = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

onBeforeUnmount(() => {
  activeDragCleanup?.();
});

// ── Auto-refresh ────────────────────────────────────────────────────────────
// Silent refresh: the composable defaults `reload()` to silent=true so the
// file list / viewer DOM stays mounted and scroll position survives.
useAutoRefresh({
  onRefresh: () => sessionFiles.reload(),
  enabled: computed(() => prefs.autoRefreshEnabled),
  intervalSeconds: computed(() => prefs.autoRefreshIntervalSeconds),
});

// ── New-file highlight (bonus) ─────────────────────────────────────────────
// Clear the transient highlight set after ~1.6s so the CSS fade can play.
const NEW_PATH_FADE_MS = 1600;
let newPathTimer: ReturnType<typeof setTimeout> | null = null;
let viewerPulseTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => sessionFiles.newFilePaths,
  (set) => {
    if (set.size === 0) return;
    if (newPathTimer) clearTimeout(newPathTimer);
    newPathTimer = setTimeout(() => {
      sessionFiles.ackNewPaths();
      newPathTimer = null;
    }, NEW_PATH_FADE_MS);
  },
);
const highlightedPaths = computed(() => sessionFiles.newFilePaths);

// Clear content-changed highlight shortly after it flips so the viewer pulse fades.
const CONTENT_FADE_MS = 1600;
watch(
  () => sessionFiles.contentChangedAt,
  (ts) => {
    if (!ts) return;
    if (viewerPulseTimer) clearTimeout(viewerPulseTimer);
    viewerPulseTimer = setTimeout(() => {
      sessionFiles.ackContentChanged();
      viewerPulseTimer = null;
    }, CONTENT_FADE_MS);
  },
);
const viewerChanged = computed(() => sessionFiles.contentChangedAt !== null);

onBeforeUnmount(() => {
  if (newPathTimer) clearTimeout(newPathTimer);
  if (viewerPulseTimer) clearTimeout(viewerPulseTimer);
});
</script>

<template>
  <div class="explorer-tab" :class="{ 'explorer-tab--dragging': isDragging }">
    <div class="explorer-tab__tree" :style="{ width: `${treeWidth}px` }">
      <FileBrowserTree
        :entries="sessionFiles.files"
        :loading="sessionFiles.filesLoading"
        :selected-path="sessionFiles.selectedPath ?? undefined"
        :highlighted-paths="highlightedPaths"
        title="Session Files"
        :auto-collapse-threshold="10"
        @view-file="onViewFile"
      />
    </div>

    <div
      class="explorer-tab__divider"
      role="separator"
      aria-label="Resize panes"
      @mousedown.prevent="startDrag"
    />

    <div class="explorer-tab__viewer" :class="{ 'explorer-tab__viewer--changed': viewerChanged }">
      <FileContentViewer
        :file-path="sessionFiles.selectedPath ?? undefined"
        :content="sessionFiles.fileContent ?? undefined"
        :file-type="sessionFiles.selectedFileType ?? undefined"
        :db-data="sessionFiles.dbData ?? undefined"
        :loading="sessionFiles.fileContentLoading"
        :error="sessionFiles.fileContentError"
      />
    </div>
  </div>
</template>

<style scoped>
.explorer-tab {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.explorer-tab--dragging {
  user-select: none;
  cursor: col-resize;
}

.explorer-tab__tree {
  min-width: 160px;
  max-width: 500px;
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.explorer-tab__divider {
  width: 5px;
  flex-shrink: 0;
  background: var(--border-default);
  cursor: col-resize;
  transition: background var(--transition-fast);
  position: relative;
}

.explorer-tab__divider::after {
  content: "";
  position: absolute;
  inset: 0 -3px;
}

.explorer-tab__divider:hover,
.explorer-tab--dragging .explorer-tab__divider {
  background: var(--accent-fg);
  opacity: 0.6;
}

.explorer-tab__viewer {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* Bonus: briefly highlight the viewer when the currently-open file's
   content was updated on disk by an auto-refresh. Pure outline pulse — no
   layout shift. */
.explorer-tab__viewer--changed::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 0 2px var(--success-fg);
  opacity: 0;
  animation: explorer-viewer-pulse 1.6s ease-out;
}
@keyframes explorer-viewer-pulse {
  0%   { opacity: 0.45; }
  60%  { opacity: 0.18; }
  100% { opacity: 0; }
}
</style>
