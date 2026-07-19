<script setup lang="ts">
import "@/styles/features/session-explorer.css";
import { openInExplorer, sessionReadFile } from "@tracepilot/client";
import type { FileEntry, SessionFileSearchMatch, SessionFileType } from "@tracepilot/types";
import {
  FileBrowserTree,
  FileContentViewer,
  normalizePath,
  pathDirname,
  useAutoRefresh,
  useClipboard,
  usePersistedRef,
  useToast,
} from "@tracepilot/ui";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import FileContextMenu from "@/components/session/FileContextMenu.vue";
import { useExplorerContentSearch } from "@/composables/useExplorerContentSearch";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useSessionFiles } from "@/composables/useSessionFiles";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { usePreferencesStore } from "@/stores/preferences";

const store = useSessionDetailContext();
const prefs = usePreferencesStore();

const sessionFiles = useSessionFiles(() => store.sessionId);

// ── Name/path and bounded content search ───────────────────────────────────
interface ExplorerViewModes {
  json: "tree" | "raw";
  jsonl: "records" | "raw";
  csv: "table" | "raw";
}

const explorerViewModes = usePersistedRef<ExplorerViewModes>(
  STORAGE_KEYS.sessionExplorerViewModes,
  { json: "tree", jsonl: "records", csv: "table" },
);
const {
  searchMode,
  searchQuery,
  contentSearch,
  contentSearchLoading,
  contentSearchError,
  runContentSearch,
} = useExplorerContentSearch(() => store.sessionId);
const viewerSearchRequest = ref({ id: 0, query: "", line: 0 });

const filteredFiles = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (searchMode.value !== "name" || !query) return sessionFiles.files;
  return sessionFiles.files.filter(
    (entry) => !entry.isDirectory && entry.path.toLowerCase().includes(query),
  );
});

async function onViewFile(path: string) {
  const entry = sessionFiles.files.find((f) => f.path === path);
  const fileType: SessionFileType = entry?.fileType ?? "text";
  await sessionFiles.selectFile(path, fileType);
}

async function onContentSearchMatch(match: SessionFileSearchMatch) {
  await onViewFile(match.path);
  const loadedLines = sessionFiles.fileContent?.split("\n").length ?? 0;
  if (sessionFiles.fileCanLoadMore && match.lineNumber > loadedLines) {
    await sessionFiles.loadFullFile();
  }
  viewerSearchRequest.value = {
    id: viewerSearchRequest.value.id + 1,
    query: searchQuery.value.trim(),
    line: match.lineNumber,
  };
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
  onRefresh: async () => {
    await sessionFiles.reload();
  },
  enabled: computed(() => prefs.autoRefreshEnabled),
  intervalSeconds: computed(() => prefs.autoRefreshIntervalSeconds),
});

const manualRefreshing = ref(false);
const refreshComplete = ref(false);
let refreshFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

async function refreshExplorer() {
  if (manualRefreshing.value) return;
  manualRefreshing.value = true;
  refreshComplete.value = false;
  if (refreshFeedbackTimer) clearTimeout(refreshFeedbackTimer);
  try {
    await sessionFiles.reload({ silent: false });
    if (searchMode.value === "content" && searchQuery.value.trim().length >= 2) {
      await runContentSearch({ background: true });
    }
    if (!sessionFiles.filesError && !contentSearchError.value) {
      refreshComplete.value = true;
      refreshFeedbackTimer = setTimeout(() => {
        refreshComplete.value = false;
        refreshFeedbackTimer = null;
      }, 1_400);
    }
  } finally {
    manualRefreshing.value = false;
  }
}

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
  if (refreshFeedbackTimer) clearTimeout(refreshFeedbackTimer);
});

// ── Context Menu ───────────────────────────────────────────────────────────
type ExplorerContextEntry = FileEntry & { fileType?: SessionFileType };
const contextMenuEntry = ref<ExplorerContextEntry | null>(null);
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
    toastSuccess(
      contextMenuEntry.value.isDirectory
        ? "Copied folder path to clipboard"
        : "Copied file path to clipboard",
    );
  } else {
    toastError("Failed to copy path");
  }
  hideContextMenu();
}

async function onCopyContents() {
  if (!contextMenuEntry.value || contextMenuEntry.value.isDirectory) return;
  if (
    contextMenuEntry.value.fileType === "binary" ||
    contextMenuEntry.value.fileType === "image" ||
    contextMenuEntry.value.fileType === "sqlite"
  ) {
    hideContextMenu();
    return;
  }
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

const viewerLoading = computed(() => {
  if (sessionFiles.selectedFileType === "sqlite") return sessionFiles.dbDataLoading;
  if (sessionFiles.selectedFileType === "image") return sessionFiles.imageLoading;
  return sessionFiles.fileContentLoading;
});

const viewerError = computed(() => {
  if (sessionFiles.selectedFileType === "sqlite") return sessionFiles.dbDataError;
  if (sessionFiles.selectedFileType === "image") return sessionFiles.imageError;
  return sessionFiles.fileContentError;
});

const selectedContextCanCopyContents = computed(
  () =>
    !contextMenuEntry.value?.isDirectory &&
    !["binary", "image", "sqlite"].includes(contextMenuEntry.value?.fileType ?? ""),
);

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
      <div class="explorer-search">
        <div class="explorer-search__row">
          <div class="explorer-search__input-wrap">
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="searchMode === 'name' ? 'Filter names and paths…' : 'Search file contents…'"
              :aria-label="searchMode === 'name' ? 'Filter file names and paths' : 'Search file contents'"
            />
            <button
              v-if="searchQuery"
              type="button"
              class="explorer-search__clear"
              title="Clear search"
              aria-label="Clear search"
              @click="searchQuery = ''"
            >
              ×
            </button>
          </div>
          <button
            type="button"
            class="explorer-search__refresh"
            :class="{
              'explorer-search__refresh--spinning': manualRefreshing,
              'explorer-search__refresh--complete': refreshComplete,
            }"
            :title="manualRefreshing ? 'Refreshing files…' : refreshComplete ? 'Files refreshed' : 'Refresh files'"
            :aria-label="manualRefreshing ? 'Refreshing files' : refreshComplete ? 'Files refreshed' : 'Refresh files'"
            :disabled="manualRefreshing"
            @click="refreshExplorer"
          >
            <svg v-if="refreshComplete && !manualRefreshing" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
              <path d="M3 8.5l3 3L13 4.5"/>
            </svg>
            <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
              <path d="M13 5V2.5L11.2 4.3A5.5 5.5 0 1 0 13.4 9"/>
            </svg>
          </button>
        </div>
        <div class="explorer-search__modes" role="radiogroup" aria-label="Explorer search mode">
          <button
            type="button"
            :class="{ active: searchMode === 'name' }"
            role="radio"
            :aria-checked="searchMode === 'name'"
            @click="searchMode = 'name'"
          >
            Name/path
          </button>
          <button
            type="button"
            :class="{ active: searchMode === 'content' }"
            role="radio"
            :aria-checked="searchMode === 'content'"
            @click="searchMode = 'content'"
          >
            Content
          </button>
        </div>
      </div>

      <div v-if="sessionFiles.filesError" class="explorer-search__error">
        <span>{{ sessionFiles.filesError }}</span>
        <button type="button" @click="refreshExplorer">Retry</button>
      </div>

      <div v-else-if="searchMode === 'content'" class="explorer-results">
        <div v-if="searchQuery.trim().length < 2" class="explorer-results__empty">
          Enter at least 2 characters to search readable artifacts. events.jsonl, images,
          databases, and binary files are skipped.
        </div>
        <div v-else-if="contentSearchLoading" class="explorer-results__empty">
          Searching session files…
        </div>
        <div v-else-if="contentSearchError" class="explorer-search__error">
          {{ contentSearchError }}
        </div>
        <template v-else-if="contentSearch">
          <div class="explorer-results__meta">
            {{ contentSearch.matches.length }} matches in {{ contentSearch.scannedFiles }} files
            <span v-if="contentSearch.truncated"> · bounded results</span>
          </div>
          <button
            v-for="match in contentSearch.matches"
            :key="`${match.path}:${match.lineNumber}`"
            type="button"
            class="explorer-result"
            @click="onContentSearchMatch(match)"
          >
            <span class="explorer-result__path">{{ match.path }}</span>
            <span class="explorer-result__line">L{{ match.lineNumber }}</span>
            <span class="explorer-result__excerpt">{{ match.excerpt }}</span>
          </button>
          <div v-if="contentSearch.matches.length === 0" class="explorer-results__empty">
            No content matches.
          </div>
        </template>
      </div>

      <FileBrowserTree
        v-else
        :entries="filteredFiles"
        :loading="sessionFiles.filesLoading"
        :selected-path="sessionFiles.selectedPath ?? undefined"
        :highlighted-paths="highlightedPaths"
        :title="searchQuery.trim() ? 'Matching Files' : 'Session Files'"
        :auto-collapse-threshold="10"
        :force-expanded="Boolean(searchQuery.trim())"
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
        :image-preview="sessionFiles.imagePreview ?? undefined"
        :can-load-more="sessionFiles.fileCanLoadMore"
        :json-mode="explorerViewModes.json"
        :jsonl-mode="explorerViewModes.jsonl"
        :csv-mode="explorerViewModes.csv"
        :search-request-id="viewerSearchRequest.id"
        :initial-search-query="viewerSearchRequest.query"
        :initial-search-line="viewerSearchRequest.line"
        :loading="viewerLoading"
        :error="viewerError"
        @load-full="sessionFiles.loadFullFile"
        @update:json-mode="explorerViewModes.json = $event"
        @update:jsonl-mode="explorerViewModes.jsonl = $event"
        @update:csv-mode="explorerViewModes.csv = $event"
      />
    </div>

    <FileContextMenu
      :visible="contextMenuEntry !== null"
      :position="contextMenuPos"
      :entry="contextMenuEntry"
      :can-copy-contents="selectedContextCanCopyContents"
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

.explorer-search {
  padding: 7px 8px 6px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.explorer-search__row {
  display: flex;
  gap: 5px;
}

.explorer-search__input-wrap {
  position: relative;
  min-width: 0;
  flex: 1;
}

.explorer-search__input-wrap input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 5px 26px 5px 7px;
  outline: none;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  color: var(--text-primary);
  font-size: 0.6875rem;
}

.explorer-search__input-wrap input:focus {
  border-color: var(--accent-fg);
  box-shadow: 0 0 0 1px var(--accent-muted);
}

.explorer-search__clear {
  position: absolute;
  top: 50%;
  right: 4px;
  display: grid;
  width: 20px;
  height: 20px;
  padding: 0;
  transform: translateY(-50%);
  place-items: center;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}

.explorer-search__clear:hover {
  background: var(--neutral-muted);
  color: var(--text-primary);
}

.explorer-search__row > .explorer-search__refresh {
  display: grid;
  width: 27px;
  height: 27px;
  box-sizing: border-box;
  padding: 5px 7px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  place-items: center;
  background: var(--canvas-subtle);
  color: var(--text-secondary);
  cursor: pointer;
}

.explorer-search__refresh:hover:not(:disabled) {
  background: var(--neutral-muted);
  color: var(--text-primary);
}

.explorer-search__refresh:disabled {
  cursor: wait;
}

.explorer-search__refresh--complete {
  border-color: var(--success-fg);
  color: var(--success-fg);
}

.explorer-search__refresh svg {
  width: 14px;
  height: 14px;
}

.explorer-search__refresh--spinning svg {
  animation: explorer-refresh-spin 0.75s linear infinite;
}

@keyframes explorer-refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

.explorer-search__modes {
  display: flex;
  gap: 2px;
  margin-top: 5px;
}

.explorer-search__modes button {
  flex: 1;
  padding: 3px 5px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.625rem;
}

.explorer-search__modes button.active {
  background: var(--accent-muted);
  color: var(--accent-fg);
}

.explorer-search__error {
  margin: 8px;
  padding: 8px;
  border: 1px solid var(--danger-subtle);
  border-radius: var(--radius-sm);
  background: var(--danger-muted);
  color: var(--danger-fg);
  font-size: 0.6875rem;
}

.explorer-search__error button {
  margin-left: 6px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-decoration: underline;
}

.explorer-results {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 5px;
}

.explorer-results__meta,
.explorer-results__empty {
  padding: 8px;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  line-height: 1.4;
}

.explorer-result {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 6px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.explorer-result:hover {
  background: var(--canvas-inset);
}

.explorer-result__path {
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.explorer-result__line {
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 0.625rem;
}

.explorer-result__excerpt {
  grid-column: 1 / -1;
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
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
