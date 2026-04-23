<script setup lang="ts">
/**
 * FileBrowserTree — generic read-only collapsible file tree.
 *
 * Accepts any entry that satisfies `FileEntry` — works with both
 * `SkillAsset` (skill editor) and `SessionFileEntry` (session explorer)
 * since both extend the shared base type.
 */
import type { FileEntry } from "@tracepilot/types";
import { computed, toRef } from "vue";
import { useFileBrowserTree } from "../composables/useFileBrowserTree";

// Re-export the shared base type so consumers only need to import from here.
export type { FileEntry as FileBrowserEntry };

const props = defineProps<{
  entries: readonly FileEntry[];
  loading?: boolean;
  selectedPath?: string;
  title?: string;
  /** Folders with more entries than this will be auto-collapsed on load. Default: no limit. */
  autoCollapseThreshold?: number;
  /**
   * Paths to briefly highlight as newly-added (e.g. green fade-in) — used by
   * the session explorer to indicate files that appeared on auto-refresh.
   * The set is expected to be cleared by the parent after the animation
   * duration; the class simply reflects current membership.
   */
  highlightedPaths?: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  viewFile: [path: string];
}>();

const { treeStructure, fileCount, collapsedFolders, toggleFolder, formatSize } = useFileBrowserTree(
  toRef(props, "entries"),
  {
    get autoCollapseThreshold() {
      return props.autoCollapseThreshold;
    },
  },
);

type FileIconType = "generic" | "markdown" | "json" | "yaml" | "database" | "lock" | "toml" | "log";

function getFileIconType(name: string): FileIconType {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "mdx") return "markdown";
  if (ext === "json" || ext === "jsonl") return "json";
  if (ext === "yaml" || ext === "yml") return "yaml";
  if (ext === "toml") return "toml";
  if (ext === "db" || ext === "sqlite" || ext === "sqlite3") return "database";
  if (ext === "lock" || ext === "pem" || ext === "crt") return "lock";
  if (ext === "log" || ext === "txt") return "log";
  return "generic";
}

const iconTypeByPath = computed(() => {
  const map = new Map<string, FileIconType>();
  for (const entry of props.entries) {
    if (!entry.isDirectory) map.set(entry.path, getFileIconType(entry.name));
  }
  return map;
});
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
        :class="{
          'fb-tree__item--selected': selectedPath === entry.path,
          'fb-tree__item--new': highlightedPaths?.has(entry.path),
        }"
        role="button"
        tabindex="0"
        @click="emit('viewFile', entry.path)"
        @keyup.enter="emit('viewFile', entry.path)"
      >
        <svg class="fb-tree__file-icon" :class="`fb-tree__file-icon--${iconTypeByPath.get(entry.path) ?? 'generic'}`" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <!-- generic / default -->
          <template v-if="(iconTypeByPath.get(entry.path) ?? 'generic') === 'generic'">
            <path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
            <path d="M9 2v4h4"/>
          </template>
          <!-- markdown -->
          <template v-else-if="(iconTypeByPath.get(entry.path) ?? 'generic') === 'markdown'">
            <path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
            <path d="M9 2v4h4"/>
            <path d="M5 9h6M5 11h4" stroke-width="1.1"/>
          </template>
          <!-- json / jsonl -->
          <template v-else-if="(iconTypeByPath.get(entry.path) ?? 'generic') === 'json'">
            <path d="M6 3c-1 0-1.5 1-1.5 2v1c0 .8-.5 1.2-.5 1.5s.5.7.5 1.5v1c0 1 .5 2 1.5 2"/>
            <path d="M10 3c1 0 1.5 1 1.5 2v1c0 .8.5 1.2.5 1.5s-.5.7-.5 1.5v1c0 1-.5 2-1.5 2"/>
          </template>
          <!-- yaml -->
          <template v-else-if="(iconTypeByPath.get(entry.path) ?? 'generic') === 'yaml'">
            <path d="M3 4h10M3 8h10M3 12h6"/>
          </template>
          <!-- toml -->
          <template v-else-if="(iconTypeByPath.get(entry.path) ?? 'generic') === 'toml'">
            <path d="M3 3h10v10H3z"/>
            <path d="M3 7h10M7 3v10" stroke-width="1.1"/>
          </template>
          <!-- database -->
          <template v-else-if="(iconTypeByPath.get(entry.path) ?? 'generic') === 'database'">
            <ellipse cx="8" cy="5" rx="5" ry="1.8"/>
            <path d="M3 5v3c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V5"/>
            <path d="M3 8v3c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V8"/>
          </template>
          <!-- lock -->
          <template v-else-if="(iconTypeByPath.get(entry.path) ?? 'generic') === 'lock'">
            <rect x="4" y="7" width="8" height="7" rx="1"/>
            <path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>
          </template>
          <!-- log / txt -->
          <template v-else>
            <path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
            <path d="M9 2v4h4"/>
            <path d="M5 9h6M5 11h6M5 13h3" stroke-width="1.1"/>
          </template>
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
            :class="{
              'fb-tree__item--selected': selectedPath === entry.path,
              'fb-tree__item--new': highlightedPaths?.has(entry.path),
            }"
            role="button"
            tabindex="0"
            @click="emit('viewFile', entry.path)"
            @keyup.enter="emit('viewFile', entry.path)"
          >
            <svg class="fb-tree__file-icon" :class="`fb-tree__file-icon--${iconTypeByPath.get(entry.path) ?? 'generic'}`" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
              <template v-if="(iconTypeByPath.get(entry.path) ?? 'generic') === 'generic'">
                <path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
                <path d="M9 2v4h4"/>
              </template>
              <template v-else-if="(iconTypeByPath.get(entry.path) ?? 'generic') === 'markdown'">
                <path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
                <path d="M9 2v4h4"/>
                <path d="M5 9h6M5 11h4" stroke-width="1.1"/>
              </template>
              <template v-else-if="(iconTypeByPath.get(entry.path) ?? 'generic') === 'json'">
                <path d="M6 3c-1 0-1.5 1-1.5 2v1c0 .8-.5 1.2-.5 1.5s.5.7.5 1.5v1c0 1 .5 2 1.5 2"/>
                <path d="M10 3c1 0 1.5 1 1.5 2v1c0 .8.5 1.2.5 1.5s-.5.7-.5 1.5v1c0 1-.5 2-1.5 2"/>
              </template>
              <template v-else-if="(iconTypeByPath.get(entry.path) ?? 'generic') === 'yaml'">
                <path d="M3 4h10M3 8h10M3 12h6"/>
              </template>
              <template v-else-if="(iconTypeByPath.get(entry.path) ?? 'generic') === 'toml'">
                <path d="M3 3h10v10H3z"/>
                <path d="M3 7h10M7 3v10" stroke-width="1.1"/>
              </template>
              <template v-else-if="(iconTypeByPath.get(entry.path) ?? 'generic') === 'database'">
                <ellipse cx="8" cy="5" rx="5" ry="1.8"/>
                <path d="M3 5v3c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V5"/>
                <path d="M3 8v3c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V8"/>
              </template>
              <template v-else-if="(iconTypeByPath.get(entry.path) ?? 'generic') === 'lock'">
                <rect x="4" y="7" width="8" height="7" rx="1"/>
                <path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>
              </template>
              <template v-else>
                <path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
                <path d="M9 2v4h4"/>
                <path d="M5 9h6M5 11h6M5 13h3" stroke-width="1.1"/>
              </template>
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
  display: flex;
  align-items: center;
  padding: 8px 12px;
  min-height: 36px;
  box-sizing: border-box;
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
  opacity: 0.9;
}

/* ── New-file highlight (auto-refresh) ──────────────────────────────── */
/* Pure background + inset-shadow fade — no size / border / margin change
   so the list doesn't layout-shift when entries gain/lose the class.
   Uses accent colour (matches the selected-state pill) rather than raw
   green so the cue feels consistent with the rest of the app chrome. */
.fb-tree__item--new {
  animation: fb-tree-new-fade 1.1s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes fb-tree-new-fade {
  0% {
    background: color-mix(in srgb, var(--accent-fg) 18%, transparent);
    box-shadow: inset 2px 0 0 var(--accent-fg);
  }
  60% {
    background: color-mix(in srgb, var(--accent-fg) 7%, transparent);
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--accent-fg) 55%, transparent);
  }
  100% {
    background: transparent;
    box-shadow: inset 2px 0 0 transparent;
  }
}
/* Selected takes precedence over the fade background */
.fb-tree__item--selected.fb-tree__item--new {
  animation: none;
}

/* File-type icon accent colours */
.fb-tree__file-icon--markdown { color: var(--accent-fg); opacity: 0.75; }
.fb-tree__file-icon--json     { color: #d4a843; opacity: 0.85; }
.fb-tree__file-icon--yaml     { color: #e8834e; opacity: 0.85; }
.fb-tree__file-icon--toml     { color: #e8834e; opacity: 0.75; }
.fb-tree__file-icon--database { color: #5b9bd5; opacity: 0.9; }
.fb-tree__file-icon--lock     { color: var(--text-tertiary); opacity: 0.5; }
.fb-tree__file-icon--log      { color: var(--text-tertiary); opacity: 0.55; }

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
