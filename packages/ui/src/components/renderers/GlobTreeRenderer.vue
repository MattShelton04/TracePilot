<script setup lang="ts">
/**
 * GlobTreeRenderer — renders glob results as a hierarchical collapsible file tree.
 */

import type { TurnToolCall } from "@tracepilot/types";
import { File, Folder, FolderTree } from "lucide-vue-next";
import { computed, reactive } from "vue";
import { toolCallStatus } from "../../utils/toolCallStatus";
import { normalizeGlobPaths } from "../../utils/toolSearchResults";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  isTruncated?: boolean;
  tc?: TurnToolCall;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();

const pattern = computed(() =>
  typeof props.args?.pattern === "string" ? props.args.pattern : null,
);

const searchRoot = computed(() =>
  typeof props.args?.path === "string"
    ? props.args.path.replace(/\\/g, "/").replace(/\/+$/, "")
    : null,
);

const status = computed(() => toolCallStatus(props.tc));
const parsed = computed(() => normalizeGlobPaths(props.content, searchRoot.value));
const relativePaths = computed(() => parsed.value.paths);
const fileCount = computed(() => relativePaths.value.length);

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };

  for (const filePath of paths) {
    const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = current.children.find((c) => c.name === part);

      if (!child) {
        child = {
          name: part,
          path: `${filePath.startsWith("/") ? "/" : ""}${parts.slice(0, i + 1).join("/")}`,
          isDir: !isLast,
          children: [],
        };
        current.children.push(child);
      }

      if (!isLast) {
        child.isDir = true;
        current = child;
      }
    }
  }

  return sortNodes(root.children);
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes]
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((n) => (n.isDir ? { ...n, children: sortNodes(n.children) } : n));
}

const tree = computed(() => buildTree(relativePaths.value));

interface FlatNode {
  node: TreeNode;
  depth: number;
}

const collapsed = reactive(new Set<string>());

function toggleDir(path: string) {
  if (collapsed.has(path)) {
    collapsed.delete(path);
  } else {
    collapsed.add(path);
  }
}

const flatList = computed<FlatNode[]>(() => {
  const result: FlatNode[] = [];
  function walk(nodes: TreeNode[], depth: number) {
    for (const node of nodes) {
      result.push({ node, depth });
      if (node.isDir && !collapsed.has(node.path)) {
        walk(node.children, depth + 1);
      }
    }
  }
  walk(tree.value, 0);
  return result;
});

function countFiles(node: TreeNode): number {
  if (!node.isDir) return 1;
  let count = 0;
  for (const child of node.children) {
    count += countFiles(child);
  }
  return count;
}

function fullPath(node: TreeNode): string {
  if (/^(?:[A-Za-z]:|\/)/.test(node.path) || !searchRoot.value) return node.path;
  return `${searchRoot.value}/${node.path}`;
}
</script>

<template>
  <RendererShell
    tool-name="Glob"
    :status="status"
    :primary-hint="pattern ?? undefined"
    :copy-text="content"
  >
    <template #icon><FolderTree :size="16" /></template>
    <div class="glob-tree">
      <div class="glob-stats">
        <span class="glob-stat">{{ fileCount }} file{{ fileCount !== 1 ? 's' : '' }} matched</span>
        <span v-if="searchRoot" class="glob-root-path" :title="searchRoot">{{ searchRoot }}</span>
      </div>
      <RendererScrollRegion class="glob-list" label="file list"><div role="group" aria-label="Matched files">
        <component :is="item.node.isDir ? 'button' : 'div'" v-for="item in flatList" :key="item.node.path"
             :class="['glob-node', item.node.isDir ? 'glob-dir' : 'glob-file']"
             :style="{ paddingLeft: (12 + item.depth * 16) + 'px' }"
             :type="item.node.isDir ? 'button' : undefined"
             :title="fullPath(item.node)"
             :aria-label="item.node.isDir ? `${item.node.name}, ${countFiles(item.node)} files` : undefined"
             :aria-expanded="item.node.isDir ? !collapsed.has(item.node.path) : undefined"
             @click="item.node.isDir && toggleDir(item.node.path)">
          <template v-if="item.node.isDir">
            <span class="glob-dir-arrow" :class="{ 'glob-dir-arrow--collapsed': collapsed.has(item.node.path) }">▶</span>
            <Folder :size="14" class="glob-dir-icon" />
            <span class="glob-dir-name">{{ item.node.name }}</span>
            <span class="glob-dir-count">{{ countFiles(item.node) }}</span>
          </template>
          <template v-else>
            <File :size="14" class="glob-file-icon" />
            <span class="glob-file-name">{{ item.node.name }}</span>
          </template>
        </component>
      </div></RendererScrollRegion>
      <p v-if="!fileCount && !parsed.notices.length" class="glob-empty">No files matched.</p>
      <pre v-if="parsed.notices.length" class="glob-notices">{{ parsed.notices.join('\n') }}</pre>
    </div>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.glob-tree {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
}
.glob-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-muted);
}
.glob-stat {
  font-size: 12px;
  color: var(--text-tertiary);
}
.glob-root-path {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  color: var(--text-tertiary);

  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-left: auto;
}
.glob-list { min-width: 0; }
.glob-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border: 0;
  width: 100%;
  min-width: 0;
  background: transparent;
  text-align: left;
  font: inherit;
  cursor: default;
}
.glob-node:hover {
  background: var(--neutral-muted);
}
.glob-dir {
  cursor: pointer;
}
.glob-dir-arrow {
  font-size: 0.5rem;
  color: var(--text-tertiary);
  transition: transform 0.15s;
  transform: rotate(90deg);
  width: 10px;
  flex-shrink: 0;
}
.glob-dir-arrow--collapsed {
  transform: rotate(0deg);
}
.glob-dir-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}
.glob-dir-name {
  color: var(--text-secondary);
  font-weight: 500;
  overflow-wrap: anywhere;
  min-width: 0;
}
.glob-dir-count {
  font-size: 0.5625rem;
  padding: 0 5px;
  border-radius: 9999px;
  background: var(--neutral-muted);
  color: var(--text-tertiary);
  flex-shrink: 0;
  margin-left: auto;
}
.glob-file-icon {
  margin-left: 16px;
  flex-shrink: 0;
  color: var(--text-tertiary);
}
.glob-file-name {
  color: var(--text-secondary);
  min-width: 0;
  overflow-wrap: anywhere;
}
.glob-dir:focus-visible { outline: 2px solid var(--accent-emphasis); outline-offset: -2px; }
.glob-notices, .glob-empty { margin: 0; padding: 12px; color: var(--text-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
.glob-stats { flex-wrap: wrap; }
</style>
