<script setup lang="ts">
/**
 * FileContentViewer — renders a session file with an appropriate viewer.
 *
 * Dispatches to:
 *  - MarkdownContent for `.md` / `markdown` files
 *  - CodeBlock for text-based files (json, jsonl, yaml, toml, text, etc.)
 *  - A database placeholder for SQLite files
 *  - An empty state when no file is selected
 */
import type { SessionFileType } from "@tracepilot/types";
import { computed } from "vue";
import CodeBlock from "./renderers/CodeBlock.vue";
import MarkdownContent from "./MarkdownContent.vue";

const props = defineProps<{
  /** Relative path within the session directory (for display + language detection). */
  filePath?: string;
  /** File content to render. */
  content?: string;
  /** Classified file type from the backend. */
  fileType?: SessionFileType;
  /** Whether the file is currently loading. */
  loading?: boolean;
  /** Error message if loading failed. */
  error?: string | null;
}>();

const isMarkdown = computed(
  () =>
    props.fileType === "markdown" ||
    (props.filePath?.endsWith(".md") ?? false) ||
    (props.filePath?.endsWith(".markdown") ?? false),
);

const isSqlite = computed(() => props.fileType === "sqlite");

const isBinary = computed(() => props.fileType === "binary");

const isJsonl= computed(() => props.fileType === "jsonl");

const codeLanguage = computed(() => {
  if (isJsonl.value) return "json";
  return undefined; // let CodeBlock auto-detect from filePath
});

const fileName = computed(() => {
  if (!props.filePath) return null;
  return props.filePath.split("/").pop() ?? props.filePath;
});
</script>

<template>
  <div class="fcv">
    <!-- No file selected -->
    <div v-if="!filePath && !loading" class="fcv__empty">
      <svg class="fcv__empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
        <polyline points="13 2 13 9 20 9"/>
      </svg>
      <p class="fcv__empty-text">Select a file to view its contents</p>
    </div>

    <!-- Loading state -->
    <div v-else-if="loading" class="fcv__loading">
      <div class="fcv__spinner" />
      <span>Loading{{ fileName ? ` ${fileName}` : "" }}…</span>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="fcv__error">
      <svg class="fcv__error-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <circle cx="8" cy="8" r="6"/>
        <line x1="8" y1="5" x2="8" y2="8"/>
        <circle cx="8" cy="11" r="0.5" fill="currentColor"/>
      </svg>
      <span class="fcv__error-text">{{ error }}</span>
    </div>

    <!-- SQLite placeholder -->
    <div v-else-if="isSqlite" class="fcv__binary">
      <svg class="fcv__binary-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3"/>
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
      </svg>
      <p class="fcv__binary-title">SQLite Database</p>
      <p class="fcv__binary-desc">
        <strong>{{ fileName }}</strong> is a binary SQLite database file.<br>
        Use an external tool (e.g. DB Browser for SQLite) to inspect its contents.
      </p>
    </div>

    <!-- Binary file placeholder -->
    <div v-else-if="isBinary" class="fcv__binary">
      <svg class="fcv__binary-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
      <p class="fcv__binary-title">Binary File</p>
      <p class="fcv__binary-desc">
        <strong>{{ fileName }}</strong> is a binary file and cannot be displayed as text.
      </p>
    </div>

    <!-- File header + rendered content -->
    <template v-else-if="content !== undefined">
      <div class="fcv__file-header">
        <svg class="fcv__file-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
          <path d="M9 2v4h4"/>
        </svg>
        <span class="fcv__file-name">{{ filePath }}</span>
      </div>

      <div class="fcv__content">
        <!-- Markdown renderer -->
        <MarkdownContent v-if="isMarkdown" :content="content" />

        <!-- Code / text renderer -->
        <CodeBlock
          v-else
          :code="content"
          :file-path="filePath"
          :language="codeLanguage"
          :line-numbers="true"
          :show-language-badge="true"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.fcv {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ── Empty / placeholder states ──────────────────────────── */
.fcv__empty,
.fcv__binary {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  padding: 32px;
  text-align: center;
  color: var(--text-tertiary);
}

.fcv__empty-icon,
.fcv__binary-icon {
  width: 40px;
  height: 40px;
  opacity: 0.4;
}

.fcv__empty-text {
  font-size: 0.875rem;
  margin: 0;
}

.fcv__binary-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0;
}

.fcv__binary-desc {
  font-size: 0.8125rem;
  line-height: 1.5;
  max-width: 320px;
  margin: 0;
}

/* ── Loading ─────────────────────────────────────────────── */
.fcv__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  font-size: 0.875rem;
  color: var(--text-tertiary);
}

.fcv__spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-default);
  border-top-color: var(--accent-fg);
  border-radius: 50%;
  animation: fcv-spin 0.75s linear infinite;
}

@keyframes fcv-spin {
  to { transform: rotate(360deg); }
}

/* ── Error ───────────────────────────────────────────────── */
.fcv__error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 16px;
  padding: 12px 14px;
  background: var(--danger-muted);
  border: 1px solid var(--danger-subtle);
  border-radius: var(--radius-md);
  color: var(--danger-fg);
  font-size: 0.8125rem;
}

.fcv__error-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin-top: 1px;
}

.fcv__error-text {
  line-height: 1.4;
}

/* ── File header ─────────────────────────────────────────── */
.fcv__file-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  flex-shrink: 0;
}

.fcv__file-icon {
  width: 13px;
  height: 13px;
  color: var(--text-tertiary);
  opacity: 0.7;
  flex-shrink: 0;
}

.fcv__file-name {
  font-size: 0.75rem;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Content area ────────────────────────────────────────── */
.fcv__content {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.fcv__content :deep(.markdown-content) {
  padding: 16px 20px;
}
</style>
