<script setup lang="ts">
/**
 * GlobTreeRenderer — renders glob results as a flat file list
 * with directory grouping and file type icons.
 */
import { computed, ref } from "vue";
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

const MAX_VISIBLE = 100;
const showAll = ref(false);

const visibleFiles = computed(() =>
  showAll.value ? files.value : files.value.slice(0, MAX_VISIBLE)
);

function fileIcon(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const icons: Record<string, string> = {
    ts: "📘", tsx: "📘", js: "📒", jsx: "📒", vue: "💚", json: "📋",
    md: "📝", rs: "🦀", py: "🐍", go: "🐹", css: "🎨", html: "🌐",
    yaml: "⚙️", yml: "⚙️", toml: "⚙️", lock: "🔒", sql: "🗃️",
  };
  return icons[ext ?? ""] ?? "📄";
}

function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function dirName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
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
      <div class="glob-list">
        <div v-for="file in visibleFiles" :key="file" class="glob-item">
          <span class="glob-icon">{{ fileIcon(file) }}</span>
          <span class="glob-dir" v-if="dirName(file)">{{ dirName(file) }}/</span>
          <span class="glob-name">{{ fileName(file) }}</span>
        </div>
      </div>
      <div v-if="!showAll && fileCount > MAX_VISIBLE" class="glob-more">
        <button type="button" class="glob-more-btn" @click="showAll = true">
          Show {{ fileCount - MAX_VISIBLE }} more files
        </button>
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
.glob-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 12px;
}
.glob-item:hover {
  background: var(--neutral-muted);
}
.glob-icon {
  font-size: 0.75rem;
  flex-shrink: 0;
}
.glob-dir {
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.glob-name {
  color: var(--text-secondary);
  white-space: nowrap;
}
.glob-more {
  text-align: center;
  padding: 6px;
  border-top: 1px solid var(--border-muted);
}
.glob-more-btn {
  font-size: 0.6875rem;
  background: none;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm, 6px);
  padding: 3px 10px;
  cursor: pointer;
  color: var(--accent-fg, #818cf8);
}
.glob-more-btn:hover {
  background: var(--neutral-muted);
}
</style>
