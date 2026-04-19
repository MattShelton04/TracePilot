<script setup lang="ts">
import type { SkillAsset } from "@tracepilot/types";
import { nextTick, ref, toRef } from "vue";
import { useFileBrowserTree } from "@tracepilot/ui";

const props = defineProps<{
  assets: SkillAsset[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  addAsset: [];
  removeAsset: [path: string];
  viewAsset: [asset: SkillAsset];
  newFile: [name: string];
}>();

const { treeStructure, fileCount, collapsedFolders, toggleFolder, formatSize } =
  useFileBrowserTree(toRef(props, "assets"));

// ─── Inline new-file input ─────────────────────────────────
const showNewFileInput = ref(false);
const newFileName = ref("");
const newFileInputEl = ref<HTMLInputElement | null>(null);

function openNewFileInput() {
  newFileName.value = "";
  showNewFileInput.value = true;
  nextTick(() => newFileInputEl.value?.focus());
}

function submitNewFile() {
  const name = newFileName.value.trim();
  if (name) emit("newFile", name);
  showNewFileInput.value = false;
  newFileName.value = "";
}

function cancelNewFile() {
  showNewFileInput.value = false;
  newFileName.value = "";
}

function onNewFileBlur() {
  setTimeout(() => {
    if (showNewFileInput.value) cancelNewFile();
  }, 150);
}
</script>

<template>
  <div class="assets-tree">
    <div class="assets-tree__header">
      <h4 class="assets-tree__title">
        Assets
        <span v-if="fileCount > 0" class="assets-tree__count">{{ fileCount }}</span>
      </h4>
      <div class="assets-tree__actions">
        <button class="assets-tree__btn assets-tree__btn--ghost" @click="openNewFileInput">
          + New File
        </button>
        <button class="assets-tree__btn assets-tree__btn--primary" @click="emit('addAsset')">
          + Add Asset
        </button>
      </div>
    </div>

    <div v-if="loading" class="assets-tree__loading">Loading assets…</div>

    <div v-if="showNewFileInput" class="assets-tree__new-file">
      <input
        ref="newFileInputEl"
        v-model="newFileName"
        class="assets-tree__new-file-input"
        type="text"
        placeholder="filename.md"
        @keyup.enter="submitNewFile"
        @keyup.escape="cancelNewFile"
        @blur="onNewFileBlur"
      />
    </div>

    <div v-else-if="fileCount === 0" class="assets-tree__empty">
      No asset files
    </div>

    <div v-else class="assets-tree__list">
      <!-- Root-level files -->
      <div
        v-for="asset in treeStructure.rootFiles"
        :key="asset.path"
        class="assets-tree__item"
      >
        <svg class="assets-tree__file-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
          <path d="M9 2v4h4"/>
        </svg>
        <span class="assets-tree__name assets-tree__name--clickable" @click="emit('viewAsset', asset)">
          {{ asset.name }}
        </span>
        <span class="assets-tree__size">{{ formatSize(asset.sizeBytes) }}</span>
        <button
          class="assets-tree__remove"
          title="Remove asset"
          @click="emit('removeAsset', asset.path)"
        >
          ✕
        </button>
      </div>

      <!-- Folders -->
      <template v-for="(folderAssets, folder) in treeStructure.folders" :key="folder">
        <button
          class="assets-tree__folder"
          :aria-expanded="!collapsedFolders.has(String(folder))"
          @click="toggleFolder(String(folder))"
        >
          <span class="assets-tree__chevron">
            {{ collapsedFolders.has(String(folder)) ? "▸" : "▾" }}
          </span>
          <svg class="assets-tree__folder-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 4h4l1.5 1.5H14v7.5H2V4z"/>
          </svg>
          <span class="assets-tree__folder-name">{{ folder }}</span>
          <span class="assets-tree__folder-count">({{ folderAssets.length }})</span>
        </button>

        <template v-if="!collapsedFolders.has(String(folder))">
          <div
            v-for="asset in folderAssets"
            :key="asset.path"
            class="assets-tree__item assets-tree__item--nested"
          >
            <svg class="assets-tree__file-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
              <path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
              <path d="M9 2v4h4"/>
            </svg>
            <span class="assets-tree__name assets-tree__name--clickable" @click="emit('viewAsset', asset)">
              {{ asset.name }}
            </span>
            <span class="assets-tree__size">{{ formatSize(asset.sizeBytes) }}</span>
            <button
              class="assets-tree__remove"
              title="Remove asset"
              @click="emit('removeAsset', asset.path)"
            >
              ✕
            </button>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.assets-tree {
  border-radius: var(--radius-lg);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  padding: 14px;
}

.assets-tree__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 8px;
}

.assets-tree__title {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.assets-tree__count {
  background: var(--accent-muted);
  color: var(--accent-fg);
  font-size: 0.625rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 8px;
  text-transform: none;
  letter-spacing: 0;
}

.assets-tree__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.assets-tree__btn {
  padding: 3px 9px;
  border-radius: var(--radius-md);
  font-size: 0.6875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
  white-space: nowrap;
}

.assets-tree__btn--ghost {
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
}

.assets-tree__btn--ghost:hover {
  background: var(--canvas-inset);
  color: var(--text-primary);
}

.assets-tree__btn--primary {
  border: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  color: var(--accent-fg);
}

.assets-tree__btn--primary:hover {
  background: var(--accent-muted);
}

.assets-tree__loading,
.assets-tree__empty {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  text-align: center;
  padding: 16px 0;
}

.assets-tree__list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* ── Folder row ──────────────────────────────────────────── */
.assets-tree__folder {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 5px 6px;
  border: none;
  background: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background var(--transition-fast);
  margin-top: 4px;
}

.assets-tree__folder:first-child {
  margin-top: 0;
}

.assets-tree__folder:hover {
  background: var(--canvas-inset);
}

.assets-tree__chevron {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  width: 10px;
  flex-shrink: 0;
  line-height: 1;
}

.assets-tree__folder-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  color: var(--text-tertiary);
  opacity: 0.7;
}

.assets-tree__folder-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assets-tree__folder-count {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* ── File row ────────────────────────────────────────────── */
.assets-tree__item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 6px;
  border-radius: var(--radius-md);
  transition: background var(--transition-fast);
}

.assets-tree__item--nested {
  padding-left: 22px;
}

.assets-tree__item:hover {
  background: var(--canvas-inset);
}

.assets-tree__file-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  color: var(--text-tertiary);
  opacity: 0.6;
}

.assets-tree__name {
  flex: 1;
  font-size: 0.8125rem;
  color: var(--text-primary);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assets-tree__name--clickable {
  cursor: pointer;
  transition: color var(--transition-fast);
}

.assets-tree__name--clickable:hover {
  color: var(--accent-fg);
  text-decoration: underline;
}

.assets-tree__size {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.assets-tree__remove {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.6875rem;
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
  flex-shrink: 0;
}

.assets-tree__item:hover .assets-tree__remove {
  opacity: 1;
}

.assets-tree__remove:hover {
  color: var(--danger-fg);
  background: var(--danger-muted);
}

/* ── Inline new-file input ───────────────────────────────── */
.assets-tree__new-file {
  padding: 4px 0 6px;
}

.assets-tree__new-file-input {
  width: 100%;
  padding: 4px 8px;
  font-size: 0.8125rem;
  font-family: var(--font-mono);
  background: var(--canvas-inset);
  border: 1px solid var(--accent-emphasis);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  outline: none;
  box-sizing: border-box;
}

.assets-tree__new-file-input:focus {
  border-color: var(--accent-emphasis);
  box-shadow: 0 0 0 2px var(--accent-muted);
}
</style>
