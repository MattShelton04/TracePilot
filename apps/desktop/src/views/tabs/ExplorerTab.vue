<script setup lang="ts">
import "@/styles/features/session-explorer.css";
import type { SessionFileType } from "@tracepilot/types";
import { openInExplorer, sessionReadFile } from "@tracepilot/client";
import {
  FileBrowserTree,
  FileContentViewer,
  useAutoRefresh,
  useClipboard,
  useToast,
  normalizePath,
  pathDirname,
} from "@tracepilot/ui";
import FileContextMenu from "@/components/session/FileContextMenu.vue";
import type { FileEntry } from "@tracepilot/types";
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
// Clear the transient highlight set AFTER the fade has fully completed so
// the class removal can't interrupt the animation mid-frame. Matches the
// 1.1s keyframes in FileBrowserTree.vue (+ small safety buffer).
const NEW_PATH_FADE_MS = 1200;
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
const highlightedPaths = computed(() => {
  // Union: newly-appeared files + the selected file when its content was just
  // updated on disk (so the tree entry also flashes alongside the viewer
  // border — a single cohesive "something updated" cue).
  const base = sessionFiles.newFilePaths;
  const selected = sessionFiles.selectedPath;
  if (!viewerChanged.value || !selected) return base;
  if (base.has(selected)) return base;
  const union = new Set<string>(base);
  union.add(selected);
  return union;
});

// Clear content-changed highlight shortly after it flips so the viewer pulse fades.
const CONTENT_FADE_MS = 1100;
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
  document.removeEventListener("click", hideContextMenu);
  document.removeEventListener("contextmenu", hideContextMenu);
});

// ── Context Menu ───────────────────────────────────────────────────────────
const contextMenuEntry = ref<FileEntry | null>(null);
const contextMenuPos = ref({ x: 0, y: 0 });
const { success: toastSuccess, error: toastError } = useToast();
const { copy: copyToClipboard } = useClipboard();

function getAbsoluteFilePath(relativeFilePath: string) {
  const base = prefs.sessionStateDir;
  const session = store.sessionId;
  if (!base || !session || !relativeFilePath) return "";
  return normalizePath(`${base}/${session}/${relativeFilePath}`);
}

const selectedAbsolutePath = computed(() => {
  if (!sessionFiles.selectedPath) return undefined;
  return getAbsoluteFilePath(sessionFiles.selectedPath);
});

function onContextMenuEntry(event: MouseEvent, entry: FileEntry) {
  event.stopPropagation();
  contextMenuEntry.value = entry;
  contextMenuPos.value = { x: event.clientX, y: event.clientY };
}

function hideContextMenu() {
  contextMenuEntry.value = null;
}

watch(contextMenuEntry, (newVal) => {
  if (newVal) {
    document.addEventListener("click", hideContextMenu);
    document.addEventListener("contextmenu", hideContextMenu);
  } else {
    document.removeEventListener("click", hideContextMenu);
    document.removeEventListener("contextmenu", hideContextMenu);
  }
});

async function onCopyPath() {
  if (!contextMenuEntry.value) return;
  const path = getAbsoluteFilePath(contextMenuEntry.value.path);
  const success = await copyToClipboard(path);
  if (success) {
    toastSuccess(contextMenuEntry.value.isDirectory ? "Copied folder path to clipboard" : "Copied file path to clipboard");
  } else {
    toastError("Failed to copy path");
  }
  hideContextMenu();
}

async function onCopyContents() {
  if (!contextMenuEntry.value || contextMenuEntry.value.isDirectory) return;
  try {
    if (!store.sessionId) return;
    const content = await sessionReadFile(store.sessionId, contextMenuEntry.value.path);
    const success = await copyToClipboard(content);
    if (success) {
      toastSuccess("Copied file contents to clipboard");
    } else {
      toastError("Failed to copy contents");
    }
  } catch (err) {
    toastError(err instanceof Error ? err.message : String(err));
  }
  hideContextMenu();
}

async function onOpenContainingFolder() {
  if (!contextMenuEntry.value || contextMenuEntry.value.isDirectory) return;
  try {
    const fullPath = getAbsoluteFilePath(contextMenuEntry.value.path);
    const parentFolder = pathDirname(fullPath);
    await openInExplorer(parentFolder);
  } catch (err) {
    toastError(err instanceof Error ? err.message : String(err));
  }
  hideContextMenu();
}

async function onOpenFolder() {
  if (!contextMenuEntry.value || !contextMenuEntry.value.isDirectory) return;
  try {
    const fullPath = getAbsoluteFilePath(contextMenuEntry.value.path);
    await openInExplorer(fullPath);
  } catch (err) {
    toastError(err instanceof Error ? err.message : String(err));
  }
  hideContextMenu();
}
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
        @contextmenu-entry="onContextMenuEntry"
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
        :absolute-path="selectedAbsolutePath"
        :content="sessionFiles.fileContent ?? undefined"
        :file-type="sessionFiles.selectedFileType ?? undefined"
        :db-data="sessionFiles.dbData ?? undefined"
        :loading="sessionFiles.fileContentLoading"
        :error="sessionFiles.fileContentError"
      />
    </div>

    <FileContextMenu
      :visible="contextMenuEntry !== null"
      :position="contextMenuPos"
      :entry="contextMenuEntry"
      @copy-path="onCopyPath"
      @copy-contents="onCopyContents"
      @open-containing-folder="onOpenContainingFolder"
      @open-folder="onOpenFolder"
      @dismiss="hideContextMenu"
    />
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
   content was updated on disk by an auto-refresh. Pure inset ring — no
   layout shift. Uses the success colour so the cue reads as "new content
   landed" rather than "this is selected" (which already uses the accent). */
.explorer-tab__viewer--changed::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 0 2px var(--success-fg);
  opacity: 0;
  animation: explorer-viewer-pulse 1.1s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes explorer-viewer-pulse {
  0%   { opacity: 0.7; }
  55%  { opacity: 0.3; }
  100% { opacity: 0; }
}
</style>
