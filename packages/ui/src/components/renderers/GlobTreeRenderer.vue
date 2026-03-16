<script setup lang="ts">
/**
 * GlobTreeRenderer — renders glob results as a hierarchical collapsible
 * file tree with depth-based indentation and directory grouping.
 */
import { computed, reactive } from "vue";
import RendererShell from "./RendererShell.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  'load-full': [];
}>();

const pattern = computed(() =>
  typeof props.args?.pattern === "string" ? props.args.pattern : null
);

const files = computed(() =>
  props.content.split("\n").filter(l => l.trim())
);

const fileCount = computed(() => files.value.length);

// ── Tree construction ──

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  fileCount: number;
}

const tree = computed<TreeNode[]>(() => {
  const root: Record<string, TreeNode> = {};

  for (const filePath of files.value) {
    const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");

      if (!current[part]) {
        current[part] = {
          name: part,
          path: fullPath,
          isDir: !isLast,
          children: [],
          fileCount: 0,
        };
      }

      if (isLast) {
        current[part].fileCount++;
      } else {
        current[part].isDir = true;
        // Build children map
        if (!current[part].children.length) {
          current[part].children = [];
        }
        const childMap: Record<string, TreeNode> = {};
        for (const c of current[part].children) {
          childMap[c.name] = c;
        }
        // Recurse into next level
        const remaining = parts.slice(i + 1);
        let node = current[part];
        // Build remaining path
        let childCurrent = childMap;
        // Simple approach: insert into children list
        let found = node.children.find(c => c.name === parts[i + 1]);
        if (!found) {
          found = {
            name: parts[i + 1],
            path: parts.slice(0, i + 2).join("/"),
            isDir: i + 1 < parts.length - 1,
            children: [],
            fileCount: 0,
          };
          node.children.push(found);
        }
        if (i + 1 === parts.length - 1) {
          found.fileCount++;
        } else {
          found.isDir = true;
        }
        // Continue building deeper levels
        let parent = found;
        for (let j = i + 2; j < parts.length; j++) {
          let child = parent.children.find(c => c.name === parts[j]);
          if (!child) {
            child = {
              name: parts[j],
              path: parts.slice(0, j + 1).join("/"),
              isDir: j < parts.length - 1,
              children: [],
              fileCount: 0,
            };
            parent.children.push(child);
          }
          if (j === parts.length - 1) {
            child.fileCount++;
          } else {
            child.isDir = true;
          }
          parent = child;
        }
        break;
      }
    }
  }

  // Convert root map to sorted array
  return Object.values(root).sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
});

// Collapse state
const collapsed = reactive(new Set<string>());

function toggleDir(path: string) {
  if (collapsed.has(path)) {
    collapsed.delete(path);
  } else {
    collapsed.add(path);
  }
}

function isCollapsed(path: string): boolean {
  return collapsed.has(path);
}

function countFiles(node: TreeNode): number {
  if (!node.isDir) return 1;
  let count = node.fileCount;
  for (const child of node.children) {
    count += countFiles(child);
  }
  return count;
}

function sortChildren(children: TreeNode[]): TreeNode[] {
  return [...children].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function fileIcon(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  const icons: Record<string, string> = {
    ts: "📘", tsx: "📘", js: "📒", jsx: "📒", vue: "💚", json: "📋",
    md: "📝", rs: "🦀", py: "🐍", go: "🐹", css: "🎨", html: "🌐",
    yaml: "⚙️", yml: "⚙️", toml: "⚙️", lock: "🔒", sql: "🗃️",
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
      </div>
      <div class="glob-list" role="tree">
        <!-- Recursive tree rendering via template recursion -->
        <template v-for="node in tree" :key="node.path">
          <component :is="'div'" /><!-- spacer for v-for key -->
          <!-- Directory -->
          <div v-if="node.isDir"
               class="glob-node glob-dir"
               role="treeitem"
               :aria-expanded="!isCollapsed(node.path)"
               @click="toggleDir(node.path)"
               :style="{ paddingLeft: '12px' }">
            <span class="glob-dir-arrow" :class="{ 'glob-dir-arrow--collapsed': isCollapsed(node.path) }">▶</span>
            <span class="glob-dir-icon">📁</span>
            <span class="glob-dir-name">{{ node.name }}</span>
            <span class="glob-dir-count">{{ countFiles(node) }}</span>
          </div>
          <!-- Children of directory -->
          <template v-if="node.isDir && !isCollapsed(node.path)">
            <!-- Only render 1 level deep inline — deeper nesting uses flat indentation -->
            <template v-for="child in sortChildren(node.children)" :key="child.path">
              <div v-if="child.isDir"
                   class="glob-node glob-dir"
                   role="treeitem"
                   :aria-expanded="!isCollapsed(child.path)"
                   @click="toggleDir(child.path)"
                   :style="{ paddingLeft: '28px' }">
                <span class="glob-dir-arrow" :class="{ 'glob-dir-arrow--collapsed': isCollapsed(child.path) }">▶</span>
                <span class="glob-dir-icon">📁</span>
                <span class="glob-dir-name">{{ child.name }}</span>
                <span class="glob-dir-count">{{ countFiles(child) }}</span>
              </div>
              <template v-if="child.isDir && !isCollapsed(child.path)">
                <template v-for="gc in sortChildren(child.children)" :key="gc.path">
                  <div v-if="gc.isDir"
                       class="glob-node glob-dir"
                       role="treeitem"
                       :aria-expanded="!isCollapsed(gc.path)"
                       @click="toggleDir(gc.path)"
                       :style="{ paddingLeft: '44px' }">
                    <span class="glob-dir-arrow" :class="{ 'glob-dir-arrow--collapsed': isCollapsed(gc.path) }">▶</span>
                    <span class="glob-dir-icon">📁</span>
                    <span class="glob-dir-name">{{ gc.name }}</span>
                    <span class="glob-dir-count">{{ countFiles(gc) }}</span>
                  </div>
                  <div v-else class="glob-node glob-file" :style="{ paddingLeft: '44px' }">
                    <span class="glob-file-icon">{{ fileIcon(gc.name) }}</span>
                    <span class="glob-file-name">{{ gc.name }}</span>
                  </div>
                </template>
              </template>
              <div v-if="!child.isDir" class="glob-node glob-file" :style="{ paddingLeft: '28px' }">
                <span class="glob-file-icon">{{ fileIcon(child.name) }}</span>
                <span class="glob-file-name">{{ child.name }}</span>
              </div>
            </template>
          </template>
          <!-- File at root -->
          <div v-if="!node.isDir" class="glob-node glob-file" :style="{ paddingLeft: '12px' }">
            <span class="glob-file-icon">{{ fileIcon(node.name) }}</span>
            <span class="glob-file-name">{{ node.name }}</span>
          </div>
        </template>
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
