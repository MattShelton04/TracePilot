<script setup lang="ts">
/**
 * FileBrowserTree — generic read-only collapsible file tree.
 *
 * Accepts any entry that satisfies `FileEntry` — works with both
 * `SkillAsset` (skill editor) and `SessionFileEntry` (session explorer)
 * since both extend the shared base type.
 */
import type { FileEntry } from "@tracepilot/types";
import { computed, ref, watch } from "vue";

// Re-export the shared base type so consumers only need to import from here.
export type { FileEntry as FileBrowserEntry };

const props = defineProps<{
  entries: readonly FileEntry[];
  loading?: boolean;
  selectedPath?: string;
  title?: string;
  /** Folders with more entries than this will be auto-collapsed on load. Default: no limit. */
  autoCollapseThreshold?: number;
}>();

const emit = defineEmits<{
  viewFile: [path: string];
}>();

const collapsedFolders = ref<Set<string>>(new Set());
// Track which folders the user has manually toggled so we don't reset them
const userToggledFolders = ref<Set<string>>(new Set());

// Auto-collapse large folders when entries change (unless user has toggled them)
watch(
  () => props.entries,
  (entries) => {
    if (!props.autoCollapseThreshold) return;
    const folders: Record<string, number> = {};
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const parts = entry.path.split("/");
      if (parts.length > 1) {
        const folder = parts.slice(0, -1).join("/");
        folders[folder] = (folders[folder] ?? 0) + 1;
      }
    }
    const next = new Set(collapsedFolders.value);
    for (const [folder, count] of Object.entries(folders)) {
      if (count > props.autoCollapseThreshold! && !userToggledFolders.value.has(folder)) {
        next.add(folder);
      }
    }
    collapsedFolders.value = next;
  },
  { immediate: true },
);

function toggleFolder(folder: string) {
  const next = new Set(collapsedFolders.value);
  userToggledFolders.value = new Set(userToggledFolders.value).add(folder);
  if (next.has(folder)) {
    next.delete(folder);
  } else {
    next.add(folder);
  }
  collapsedFolders.value = next;
}

const treeStructure = computed(() => {
  const folders: Record<string, FileEntry[]> = {};
  const rootFiles: FileEntry[] = [];

  for (const entry of props.entries) {
    if (entry.isDirectory) continue;
    const parts = entry.path.split("/");
    if (parts.length > 1) {
      const folder = parts.slice(0, -1).join("/");
      if (!folders[folder]) folders[folder] = [];
      folders[folder].push(entry);
    } else {
      rootFiles.push(entry);
    }
  }

  // Sort entries within each folder alphabetically
  rootFiles.sort((a, b) => a.name.localeCompare(b.name));
  for (const key of Object.keys(folders)) {
    folders[key].sort((a, b) => a.name.localeCompare(b.name));
  }

  return { rootFiles, folders };
});

const fileCount = computed(() => props.entries.filter((e) => !e.isDirectory).length);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<template>
  <div class="fb-tree">
    <div class="fb-tree__header">
      <h4 class="fb-tree__title">
        {{ title ?? "Files" }}
        <span v-if="fileCount > 0" class="fb-tree__count">{{ fileCount }}</span>
      </h4>
    </div>

    <div v-if="loading" class="fb-tree__loading">Loading files…</div>

    <div v-else-if="fileCount === 0" class="fb-tree__empty">No files</div>

    <div v-else class="fb-tree__list">
      <!-- Root-level files -->
      <div
        v-for="entry in treeStructure.rootFiles"
        :key="entry.path"
        class="fb-tree__item"
        :class="{ 'fb-tree__item--selected': selectedPath === entry.path }"
        role="button"
        tabindex="0"
        @click="emit('viewFile', entry.path)"
        @keyup.enter="emit('viewFile', entry.path)"
      >
        <svg class="fb-tree__file-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
          <path d="M9 2v4h4"/>
        </svg>
        <span class="fb-tree__name">{{ entry.name }}</span>
        <span class="fb-tree__size">{{ formatSize(entry.sizeBytes) }}</span>
      </div>

      <!-- Folders -->
      <template v-for="(folderEntries, folder) in treeStructure.folders" :key="folder">
        <button
          class="fb-tree__folder"
          :aria-expanded="!collapsedFolders.has(String(folder))"
          @click="toggleFolder(String(folder))"
        >
          <span class="fb-tree__chevron">
            {{ collapsedFolders.has(String(folder)) ? "▸" : "▾" }}
          </span>
          <svg class="fb-tree__folder-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 4h4l1.5 1.5H14v7.5H2V4z"/>
          </svg>
          <span class="fb-tree__folder-name">{{ folder }}</span>
          <span class="fb-tree__folder-count">({{ folderEntries.length }})</span>
        </button>

        <template v-if="!collapsedFolders.has(String(folder))">
          <div
            v-for="entry in folderEntries"
            :key="entry.path"
            class="fb-tree__item fb-tree__item--nested"
            :class="{ 'fb-tree__item--selected': selectedPath === entry.path }"
            role="button"
            tabindex="0"
            @click="emit('viewFile', entry.path)"
            @keyup.enter="emit('viewFile', entry.path)"
          >
            <svg class="fb-tree__file-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
              <path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
              <path d="M9 2v4h4"/>
            </svg>
            <span class="fb-tree__name">{{ entry.name }}</span>
            <span class="fb-tree__size">{{ formatSize(entry.sizeBytes) }}</span>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.fb-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.fb-tree__header {
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.fb-tree__title {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.fb-tree__count {
  background: var(--accent-muted);
  color: var(--accent-fg);
  font-size: 0.625rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 8px;
  text-transform: none;
  letter-spacing: 0;
}

.fb-tree__loading,
.fb-tree__empty {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  text-align: center;
  padding: 24px 12px;
}

.fb-tree__list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* ── Folder row ──────────────────────────────────────────── */
.fb-tree__folder {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  background: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background var(--transition-fast);
  margin-top: 4px;
}

.fb-tree__folder:first-child {
  margin-top: 0;
}

.fb-tree__folder:hover {
  background: var(--canvas-inset);
}

.fb-tree__chevron {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  width: 10px;
  flex-shrink: 0;
  line-height: 1;
}

.fb-tree__folder-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  color: var(--text-tertiary);
  opacity: 0.7;
}

.fb-tree__folder-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fb-tree__folder-count {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* ── File row ────────────────────────────────────────────── */
.fb-tree__item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  border-radius: var(--radius-md);
  transition: background var(--transition-fast);
  cursor: pointer;
  user-select: none;
}

.fb-tree__item--nested {
  padding-left: 24px;
}

.fb-tree__item:hover {
  background: var(--canvas-inset);
}

.fb-tree__item--selected {
  background: var(--accent-muted);
}

.fb-tree__item--selected:hover {
  background: var(--accent-muted);
}

.fb-tree__file-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  color: var(--text-tertiary);
  opacity: 0.6;
}

.fb-tree__item--selected .fb-tree__file-icon {
  color: var(--accent-fg);
  opacity: 0.8;
}

.fb-tree__name {
  flex: 1;
  font-size: 0.8125rem;
  color: var(--text-primary);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fb-tree__item--selected .fb-tree__name {
  color: var(--accent-fg);
}

.fb-tree__size {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
