<script setup lang="ts">
/**
 * The files the session changed, as a folder tree relative to the
 * repository, with the lines added and removed in the header. Short trees
 * open fully; long ones open their top level, and a filter narrows to
 * matching paths with every folder open.
 */
import type { ShutdownMetrics } from "@tracepilot/types";
import { formatNumberFull } from "@tracepilot/types";
import { ChevronRight, FileText, Folder, Search } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { buildFileTree, type FileTreeNode, filterFileTree, folderPaths } from "@/utils/metricsView";

const props = defineProps<{
  metrics: ShutdownMetrics;
  /** Repository root and working directory; paths inside them are shown relative. */
  roots?: readonly (string | null | undefined)[];
}>();

const OPEN_ALL_MAX = 40;
const ROW_LIMIT = 200;

const changes = computed(() => props.metrics.codeChanges ?? null);
const files = computed(() => changes.value?.filesModified ?? []);
const added = computed(() => changes.value?.linesAdded ?? null);
const removed = computed(() => changes.value?.linesRemoved ?? null);
const tree = computed(() => buildFileTree(files.value, props.roots ?? []));
/** Distinct files: one file recorded under several spellings counts once. */
const fileCount = computed(() => tree.value.files);
const query = ref("");
const filtered = computed(() => filterFileTree(tree.value, query.value));
const filtering = computed(() => query.value.trim() !== "");

const open = ref(new Set<string>());
const limit = ref(ROW_LIMIT);
// Refreshes rebuild the tree; folders already shown keep the user's choice,
// and only folders seen for the first time take the default.
const seen = new Set<string>();
watch(
  tree,
  (node) => {
    const defaults = new Set(folderPaths(node, node.files <= OPEN_ALL_MAX ? Infinity : 1));
    const next = new Set(open.value);
    for (const path of folderPaths(node)) {
      if (seen.has(path)) continue;
      seen.add(path);
      if (defaults.has(path)) next.add(path);
    }
    open.value = next;
  },
  { immediate: true },
);
watch(query, () => {
  limit.value = ROW_LIMIT;
});

interface Row {
  node: FileTreeNode;
  depth: number;
  open: boolean;
}
const rows = computed(() => {
  const out: Row[] = [];
  const walk = (node: FileTreeNode, depth: number) => {
    for (const child of node.children) {
      const isOpen = !child.isFile && (filtering.value || open.value.has(child.path));
      out.push({ node: child, depth, open: isOpen });
      if (isOpen) walk(child, depth + 1);
    }
  };
  if (filtered.value) walk(filtered.value, 0);
  return out;
});
const shownRows = computed(() => rows.value.slice(0, limit.value));
const allFolders = computed(() => folderPaths(tree.value));
const allOpen = computed(() => allFolders.value.every((path) => open.value.has(path)));

function toggle(path: string) {
  const next = new Set(open.value);
  if (!next.delete(path)) next.add(path);
  open.value = next;
}
function toggleAll() {
  open.value = allOpen.value ? new Set() : new Set(allFolders.value);
}

/** Five blocks split between added and removed lines, like a diffstat. */
const blocks = computed(() => {
  const a = added.value ?? 0;
  const r = removed.value ?? 0;
  const total = a + r;
  if (total === 0) return [];
  // Either side that changed anything keeps at least one block.
  const green = Math.max(a ? 1 : 0, Math.min(Math.round((a / total) * 5), r ? 4 : 5));
  const red = Math.min(5 - green, Math.max(r ? 1 : 0, Math.round((r / total) * 5)));
  return Array.from({ length: 5 }, (_, i) => (i < green ? "add" : i < green + red ? "del" : ""));
});
</script>

<template>
  <OverviewPanel v-if="changes" title="Changed files" data-testid="metrics-code-changes">
    <template #aside>
      <span v-if="added != null" class="changes__add">+{{ formatNumberFull(added) }}</span>
      <span v-if="removed != null" class="changes__del">−{{ formatNumberFull(removed) }}</span>
      <span v-if="blocks.length" class="changes__blocks" aria-hidden="true"><i v-for="(kind, i) in blocks" :key="i" :class="kind && `changes__block--${kind}`" /></span>
      <span>{{ formatNumberFull(fileCount) }} file{{ fileCount === 1 ? "" : "s" }}</span>
    </template>

    <p v-if="!files.length" class="ad-empty">
      <b>No file list recorded</b>
      The CLI recorded the line counts above but not which files changed.
    </p>
    <template v-else>
      <div class="changes__tools">
        <label class="changes__search">
          <Search :size="13" aria-hidden="true" />
          <input v-model="query" type="search" class="form-input" aria-label="Filter changed files" placeholder="Filter by path" />
        </label>
        <span v-if="filtering" class="changes__count">{{ formatNumberFull(filtered?.files ?? 0) }} of {{ formatNumberFull(fileCount) }} files</span>
        <button v-if="allFolders.length && !filtering" type="button" class="ad-link changes__all" @click="toggleAll">
          {{ allOpen ? "Collapse all" : "Expand all" }}
        </button>
      </div>
      <div class="changes__tree" role="tree" aria-label="Changed files" tabindex="-1">
        <template v-for="row in shownRows" :key="row.node.path + (row.node.isFile ? ':f' : ':d')">
          <button
            v-if="!row.node.isFile"
            type="button"
            role="treeitem"
            class="changes__row changes__row--dir"
            :aria-expanded="row.open"
            :aria-level="row.depth + 1"
            :disabled="filtering"
            :style="{ paddingLeft: `${8 + row.depth * 16}px` }"
            @click="toggle(row.node.path)"
          >
            <ChevronRight :size="12" class="changes__chev" :class="{ 'changes__chev--open': row.open }" aria-hidden="true" />
            <Folder :size="13" aria-hidden="true" />
            <span class="changes__name">{{ row.node.name }}/</span>
            <em>{{ row.node.files }}</em>
          </button>
          <div
            v-else
            role="treeitem"
            class="changes__row"
            :aria-level="row.depth + 1"
            :title="row.node.path"
            :style="{ paddingLeft: `${26 + row.depth * 16}px` }"
          >
            <FileText :size="13" aria-hidden="true" />
            <span class="changes__name">{{ row.node.name }}</span>
          </div>
        </template>
        <p v-if="!rows.length" class="changes__none">No files match this path.</p>
      </div>
      <button v-if="rows.length > shownRows.length" type="button" class="ad-link changes__more" @click="limit = rows.length">
        Show {{ formatNumberFull(rows.length - shownRows.length) }} more rows
      </button>
    </template>
  </OverviewPanel>
</template>

<style scoped>
.changes__add,
.changes__del {
  font: 500 12px / 16px var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.changes__add {
  color: var(--success-fg);
}
.changes__del {
  color: var(--danger-fg);
}
.changes__blocks {
  display: inline-flex;
  gap: 2px;
  margin-left: -6px;
}
.changes__blocks i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--surface-tertiary);
}
.changes__blocks .changes__block--add {
  background: var(--success-emphasis);
}
.changes__blocks .changes__block--del {
  background: var(--danger-emphasis);
}
.changes__tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 10px;
}
.changes__search {
  position: relative;
  flex: 1;
  min-width: 160px;
  max-width: 360px;
  color: var(--text-tertiary);
}
.changes__search svg {
  position: absolute;
  top: 50%;
  left: 9px;
  transform: translateY(-50%);
  pointer-events: none;
}
.changes__search input {
  width: 100%;
  padding-left: 28px;
}
.changes__count {
  font-size: 12px;
  color: var(--text-tertiary);
}
.changes__all {
  margin-left: auto;
}
.changes__tree {
  display: flex;
  flex-direction: column;
  max-height: 360px;
  overflow: auto;
  padding: 4px 0;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  background: var(--canvas-default);
}
.changes__row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  min-width: 0;
  height: 24px;
  padding-right: 10px;
  font: 12px / 16px var(--font-mono);
  color: var(--text-secondary);
  text-align: left;
}
.changes__row svg {
  flex-shrink: 0;
  color: var(--text-tertiary);
}
.changes__row--dir {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}
.changes__row--dir:disabled {
  cursor: default;
}
.changes__row--dir:hover:not(:disabled) {
  background: var(--state-hover-overlay);
}
.changes__row--dir:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: -2px;
}
.changes__row--dir em {
  margin-left: auto;
  padding-left: 12px;
  font-style: normal;
  font-size: 11px;
  color: var(--text-tertiary);
}
.changes__chev {
  transition: transform var(--transition-fast);
}
.changes__chev--open {
  transform: rotate(90deg);
}
.changes__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.changes__none {
  margin: 0;
  padding: 12px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.changes__more {
  margin-top: 8px;
  align-self: flex-start;
}
@media (prefers-reduced-motion: reduce) {
  .changes__chev {
    transition: none;
  }
}
</style>
