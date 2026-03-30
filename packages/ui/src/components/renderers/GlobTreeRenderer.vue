<script setup lang="ts">
/**
 * GlobTreeRenderer — renders glob results as a hierarchical collapsible
 * file tree with unlimited depth via a flattened list approach.
 */
import { computed, reactive } from "vue";
import RendererShell from "./RendererShell.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();

const pattern = computed(() =>
  typeof props.args?.pattern === "string" ? props.args.pattern : null,
);

/** The search root path from args — used to make tree relative. */
const searchRoot = computed(() =>
  typeof props.args?.path === "string"
    ? props.args.path.replace(/\\/g, "/").replace(/\/+$/, "")
    : null,
);

const files = computed(() => props.content.split("\n").filter((l) => l.trim()));

/** Strip the search root prefix from paths to build a relative tree. */
const relativePaths = computed(() => {
  const root = searchRoot.value;
  if (!root) return files.value;
  return files.value
    .map((f) => {
      const norm = f.replace(/\\/g, "/");
      if (norm.startsWith(`${root}/`)) return norm.slice(root.length + 1);
      if (norm.startsWith(root)) return norm.slice(root.length);
      return norm;
    })
    .filter((p) => p);
});

const fileCount = computed(() => files.value.length);

// ── Tree construction ──

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
          path: parts.slice(0, i + 1).join("/"),
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

// ── Flatten tree into a renderable list with depth ──

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

function fileIcon(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  const icons: Record<string, string> = {
    ts: "📘",
    tsx: "📘",
    js: "📒",
    jsx: "📒",
    vue: "💚",
    json: "📋",
    md: "📝",
    rs: "🦀",
    py: "🐍",
    go: "🐹",
    css: "🎨",
    html: "🌐",
    yaml: "⚙️",
    yml: "⚙️",
    toml: "⚙️",
    lock: "🔒",
    sql: "🗃️",
  };
  return icons[ext ?? ""] ?? "📄";
}
</script>

<template>
  <RendererShell
    :label="pattern ?? 'Glob Results'"
    :copy-content="content"
    :is-truncated="isTruncated"
    @load-full="emit('load-full')"
  >
    <div class="glob-tree">
      <div class="glob-stats">
        <span class="glob-stat">📁 {{ fileCount }} file{{ fileCount !== 1 ? 's' : '' }} matched</span>
        <span v-if="searchRoot" class="glob-root-path" :title="searchRoot">{{ searchRoot }}</span>
      </div>
      <div class="glob-list" role="tree">
        <div v-for="item in flatList" :key="item.node.path"
             :class="['glob-node', item.node.isDir ? 'glob-dir' : 'glob-file']"
             :style="{ paddingLeft: (12 + item.depth * 16) + 'px' }"
             :role="item.node.isDir ? 'treeitem' : undefined"
             :aria-expanded="item.node.isDir ? !collapsed.has(item.node.path) : undefined"
             @click="item.node.isDir && toggleDir(item.node.path)">
          <!-- Directory -->
          <template v-if="item.node.isDir">
            <span class="glob-dir-arrow" :class="{ 'glob-dir-arrow--collapsed': collapsed.has(item.node.path) }">▶</span>
            <span class="glob-dir-icon">📁</span>
            <span class="glob-dir-name">{{ item.node.name }}</span>
            <span class="glob-dir-count">{{ countFiles(item.node) }}</span>
          </template>
          <!-- File -->
          <template v-else>
            <span class="glob-file-icon">{{ fileIcon(item.node.name) }}</span>
            <span class="glob-file-name">{{ item.node.name }}</span>
          </template>
        </div>
      </div>
    </div>
  </RendererShell>
</template>

<style scoped>
.glob-tree {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
}
.glob-stats {
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-muted);
}
.glob-stat {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.glob-root-path {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  color: var(--text-tertiary);
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-left: auto;
}
.glob-list {
  max-height: 400px;
  overflow: auto;
}
.glob-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 12px;
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
  font-size: 0.75rem;
  flex-shrink: 0;
}
.glob-dir-name {
  color: var(--text-secondary);
  font-weight: 500;
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
  font-size: 0.75rem;
  flex-shrink: 0;
}
.glob-file-name {
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
