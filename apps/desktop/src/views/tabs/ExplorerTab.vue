<script setup lang="ts">
import "@/styles/features/session-explorer.css";
import type { SessionFileType } from "@tracepilot/types";
import { useAutoRefresh } from "@tracepilot/ui";
import { FileBrowserTree, FileContentViewer } from "@tracepilot/ui";
import { computed, onBeforeUnmount, ref } from "vue";
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
useAutoRefresh({
  onRefresh: () => sessionFiles.reload(),
  enabled: computed(() => prefs.autoRefreshEnabled),
  intervalSeconds: computed(() => prefs.autoRefreshIntervalSeconds),
});
</script>

<template>
  <div class="explorer-tab" :class="{ 'explorer-tab--dragging': isDragging }">
    <div class="explorer-tab__tree" :style="{ width: `${treeWidth}px` }">
      <FileBrowserTree
        :entries="sessionFiles.files"
        :loading="sessionFiles.filesLoading"
        :selected-path="sessionFiles.selectedPath ?? undefined"
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

    <div class="explorer-tab__viewer">
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
}
</style>
