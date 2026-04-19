<script setup lang="ts">
/**
 * FileContentViewer — renders a session file with an appropriate viewer.
 *
 * Dispatches to:
 *  - MarkdownContent for `.md` / `markdown` files
 *  - CodeBlock for text-based files (json, jsonl, yaml, toml, text, etc.)
 *  - SqliteViewer for SQLite databases (table data)
 *  - A placeholder for binary files
 *  - An empty state when no file is selected
 */
import type { SessionDbTable, SessionFileType } from "@tracepilot/types";
import { computed, ref, watch } from "vue";
import CodeBlock from "./renderers/CodeBlock.vue";
import MarkdownContent from "./MarkdownContent.vue";
import { useClipboard } from "../composables/useClipboard";

const props = defineProps<{
  /** Relative path within the session directory (for display + language detection). */
  filePath?: string;
  /** File content to render. */
  content?: string;
  /** Classified file type from the backend. */
  fileType?: SessionFileType;
  /** SQLite table data returned by `session_read_sqlite`. */
  dbData?: SessionDbTable[];
  /** Whether the file is currently loading. */
  loading?: boolean;
  /** Error message if loading failed. */
  error?: string | null;
}>();

const emit = defineEmits<{
  /** Re-emitted from MarkdownContent — parent handles OS open (Tauri). */
  "open-external": [url: string];
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

// ── SQLite table tab state ─────────────────────────────────────────────────
const activeTableIndex = ref(0);
const activeTable = computed(() => props.dbData?.[activeTableIndex.value] ?? null);

// Reset active tab whenever the dataset changes (e.g., user switches SQLite files)
watch(() => props.dbData, () => { activeTableIndex.value = 0; });

// ── Copy to clipboard ──────────────────────────────────────────────────────
const { copy: copyText, copied: textCopied } = useClipboard();
const { copy: copyDb, copied: dbCopied } = useClipboard();

function copyFileContent() {
  if (props.content !== undefined) copyText(props.content);
}

function copyTableAsJson() {
  if (!activeTable.value) return;
  const { columns, rows } = activeTable.value;
  const objects = rows.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]])),
  );
  copyDb(JSON.stringify(objects, null, 2));
}
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

    <!-- SQLite database viewer -->
    <template v-else-if="isSqlite">
      <!-- Has data -->
      <template v-if="dbData && dbData.length > 0">
        <div class="fcv__db-header">
          <svg class="fcv__db-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3"/>
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
          </svg>
          <span class="fcv__db-name">{{ fileName }}</span>
          <span class="fcv__db-meta">{{ dbData.length }} {{ dbData.length === 1 ? 'table' : 'tables' }}</span>
          <button
            v-if="activeTable"
            class="fcv__copy-btn"
            :class="{ 'fcv__copy-btn--copied': dbCopied }"
            :title="dbCopied ? 'Copied!' : 'Copy table as JSON'"
            @click="copyTableAsJson"
          >
            <svg v-if="!dbCopied" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="5" width="9" height="10" rx="1"/>
              <path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v9a1 1 0 001 1h2"/>
            </svg>
            <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 8 6.5 12 13 4"/>
            </svg>
          </button>
        </div>

        <!-- Table tabs -->
        <div class="fcv__db-tabs" role="tablist">
          <button
            v-for="(table, idx) in dbData"
            :key="table.name"
            class="fcv__db-tab"
            :class="{ 'fcv__db-tab--active': activeTableIndex === idx }"
            role="tab"
            :aria-selected="activeTableIndex === idx"
            @click="activeTableIndex = idx"
          >
            {{ table.name }}
            <span class="fcv__db-tab-count">{{ table.rows.length }}</span>
          </button>
        </div>

        <!-- Table content -->
        <div v-if="activeTable" class="fcv__db-content">
          <div v-if="activeTable.rows.length === 0" class="fcv__db-empty">
            No rows in <strong>{{ activeTable.name }}</strong>
          </div>
          <div v-else class="fcv__db-table-wrap">
            <table class="fcv__db-table">
              <thead>
                <tr>
                  <th v-for="col in activeTable.columns" :key="col" class="fcv__db-th">{{ col }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rIdx) in activeTable.rows" :key="rIdx" class="fcv__db-tr">
                  <td v-for="(cell, cIdx) in row" :key="cIdx" class="fcv__db-td">
                    <span v-if="cell === null" class="fcv__db-null">NULL</span>
                    <span v-else>{{ cell }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <!-- Empty database -->
      <div v-else-if="dbData && dbData.length === 0" class="fcv__binary">
        <svg class="fcv__binary-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <ellipse cx="12" cy="5" rx="9" ry="3"/>
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
        </svg>
        <p class="fcv__binary-title">Empty Database</p>
        <p class="fcv__binary-desc"><strong>{{ fileName }}</strong> contains no user tables.</p>
      </div>

      <!-- No data provided yet (fallback placeholder) -->
      <div v-else class="fcv__binary">
        <svg class="fcv__binary-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <ellipse cx="12" cy="5" rx="9" ry="3"/>
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
        </svg>
        <p class="fcv__binary-title">SQLite Database</p>
        <p class="fcv__binary-desc"><strong>{{ fileName }}</strong></p>
      </div>
    </template>

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
        <button
          class="fcv__copy-btn"
          :class="{ 'fcv__copy-btn--copied': textCopied }"
          :title="textCopied ? 'Copied!' : 'Copy file contents'"
          @click="copyFileContent"
        >
          <svg v-if="!textCopied" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="5" width="9" height="10" rx="1"/>
            <path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v9a1 1 0 001 1h2"/>
          </svg>
          <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 8 6.5 12 13 4"/>
          </svg>
        </button>
      </div>

      <div class="fcv__content" :class="{ 'fcv__content--fill': !isMarkdown }">
        <!-- Markdown renderer -->
        <MarkdownContent v-if="isMarkdown" :content="content" @open-external="(url) => emit('open-external', url)" />

        <!-- Code / text renderer (maxLines caps very large files to prevent UI freeze) -->
        <CodeBlock
          v-else
          :code="content"
          :file-path="filePath"
          :language="codeLanguage"
          :line-numbers="true"
          :show-language-badge="true"
          :max-lines="5000"
          :fill-height="true"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.fcv {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
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

/* ── Copy button ─────────────────────────────────────────── */
.fcv__copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  margin-left: auto;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast);
}

.fcv__copy-btn svg {
  width: 13px;
  height: 13px;
}

.fcv__copy-btn:hover {
  color: var(--text-primary);
  background: var(--neutral-muted);
}

.fcv__copy-btn--copied {
  color: var(--success-fg, #2da44e);
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
  min-height: 0;
  overflow-y: auto;
  padding: 0;
}

/* When a CodeBlock owns the scroll (fill-height mode), this container must
   not scroll itself — it just passes the bounded height down to the child. */
.fcv__content--fill {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.fcv__content :deep(.markdown-content) {
  padding: 16px 20px;
}

/* ── SQLite database viewer ──────────────────────────────── */
.fcv__db-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  flex-shrink: 0;
}

.fcv__db-icon {
  width: 14px;
  height: 14px;
  color: var(--accent-fg);
  flex-shrink: 0;
}

.fcv__db-name {
  font-size: 0.75rem;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fcv__db-meta {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.fcv__db-tabs {
  display: flex;
  gap: 2px;
  padding: 4px 8px 0;
  border-bottom: 1px solid var(--border-default);
  background: var(--canvas-default);
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: thin;
}

.fcv__db-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  font-size: 0.75rem;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  transition: color var(--transition-fast), background var(--transition-fast);
}

.fcv__db-tab:hover {
  color: var(--text-primary);
  background: var(--canvas-subtle);
}

.fcv__db-tab--active {
  color: var(--accent-fg);
  border-bottom-color: var(--accent-fg);
  font-weight: 500;
}

.fcv__db-tab-count {
  font-size: 0.6875rem;
  padding: 1px 5px;
  border-radius: 99px;
  background: var(--neutral-muted);
  color: var(--text-secondary);
}

.fcv__db-content {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.fcv__db-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
}

.fcv__db-table-wrap {
  overflow: auto;
  padding: 0;
}

.fcv__db-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
  font-family: var(--font-mono);
}

.fcv__db-th {
  position: sticky;
  top: 0;
  padding: 7px 10px;
  text-align: left;
  font-weight: 600;
  background: var(--canvas-subtle);
  border-bottom: 1px solid var(--border-default);
  color: var(--text-secondary);
  white-space: nowrap;
  z-index: 1;
}

.fcv__db-tr:nth-child(even) {
  background: var(--canvas-subtle);
}

.fcv__db-tr:hover {
  background: var(--neutral-muted);
}

.fcv__db-td {
  padding: 5px 10px;
  border-bottom: 1px solid var(--border-muted);
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: top;
  color: var(--text-primary);
}

.fcv__db-null {
  color: var(--text-tertiary);
  font-style: italic;
}
</style>
