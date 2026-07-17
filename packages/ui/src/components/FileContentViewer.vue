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
import { useClipboard } from "../composables/useClipboard";
import MarkdownContent from "./MarkdownContent.vue";
import CodeBlock from "./renderers/CodeBlock.vue";
import SqliteTableView from "./SqliteTableView.vue";
import "../styles/features/file-content-viewer.css";

const props = defineProps<{
  /** Relative path within the session directory (for display + language detection). */
  filePath?: string;
  /** Absolute path on host filesystem. */
  absolutePath?: string;
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

const isJsonl = computed(() => props.fileType === "jsonl");

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

/**
 * Track the selected table by name so silent auto-refresh (which replaces
 * `dbData` with a new array) doesn't reset the user back to index 0. When
 * the dataset changes, re-locate the previously selected table in the new
 * payload; fall back to index 0 only if it no longer exists.
 */
const activeTableName = ref<string | null>(null);
watch(
  () => props.dbData,
  (next, prev) => {
    if (!next || next.length === 0) {
      activeTableIndex.value = 0;
      activeTableName.value = null;
      return;
    }
    const prevName = activeTableName.value ?? prev?.[activeTableIndex.value]?.name ?? null;
    let nextIdx = prevName ? next.findIndex((t) => t.name === prevName) : -1;
    if (nextIdx < 0) {
      // Prefer the `todos` table on first load when present — it's by far the
      // most commonly inspected table in the session.db, and alphabetical
      // ordering happens to put `todo_deps` ahead of `todos`.
      const todosIdx = next.findIndex((t) => t.name === "todos");
      nextIdx = todosIdx >= 0 ? todosIdx : 0;
    }
    activeTableIndex.value = nextIdx;
    activeTableName.value = next[activeTableIndex.value]?.name ?? null;
  },
  { immediate: true },
);

function selectTable(idx: number) {
  activeTableIndex.value = idx;
  activeTableName.value = props.dbData?.[idx]?.name ?? null;
}

// Data / Schema toggle — lifted out of SqliteTableView so the segmented
// control can render inline with the table-tabs strip (one header row,
// not two). Preserved across silent auto-refresh.
type SqliteViewMode = "data" | "schema";
const sqliteViewMode = ref<SqliteViewMode>("data");
const activeTableHasSchema = computed(() => (activeTable.value?.columnInfo?.length ?? 0) > 0);

// ── Copy to clipboard ──────────────────────────────────────────────────────
const { copy: copyText, copied: textCopied } = useClipboard();
const { copy: copyDb, copied: dbCopied } = useClipboard();
const { copy: copyPath, copied: pathCopied } = useClipboard();

function copyFileContent() {
  if (props.content !== undefined) copyText(props.content);
}

function copyTableAsJson() {
  if (!activeTable.value) return;
  const { columns, rows } = activeTable.value;
  const objects = rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
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
            :aria-label="dbCopied ? 'Copied!' : 'Copy table as JSON'"
            @click="copyTableAsJson"
          >
            <svg aria-hidden="true" v-if="!dbCopied" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="5" width="9" height="10" rx="1"/>
              <path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v9a1 1 0 001 1h2"/>
            </svg>
            <svg aria-hidden="true" v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 8 6.5 12 13 4"/>
            </svg>
          </button>
        </div>

        <!-- Table tabs (left) + Data/Schema toggle (right) -->
        <div class="fcv__db-tabs" role="tablist">
          <button
            v-for="(table, idx) in dbData"
            :key="table.name"
            class="fcv__db-tab"
            :class="{ 'fcv__db-tab--active': activeTableIndex === idx }"
            role="tab"
            :aria-selected="activeTableIndex === idx"
            @click="selectTable(idx)"
          >
            {{ table.name }}
            <span class="fcv__db-tab-count">{{ table.rows.length }}</span>
          </button>
          <div class="fcv__db-tabs-spacer" />
          <div
            v-if="activeTable"
            class="fcv__db-view-toggle"
            role="radiogroup"
            aria-label="Table view mode"
          >
            <button
              class="fcv__db-view-btn"
              :class="{ 'fcv__db-view-btn--active': sqliteViewMode === 'data' }"
              role="radio"
              :aria-checked="sqliteViewMode === 'data'"
              @click="sqliteViewMode = 'data'"
            >
              Data
            </button>
            <button
              v-if="activeTableHasSchema"
              class="fcv__db-view-btn"
              :class="{ 'fcv__db-view-btn--active': sqliteViewMode === 'schema' }"
              role="radio"
              :aria-checked="sqliteViewMode === 'schema'"
              @click="sqliteViewMode = 'schema'"
            >
              Schema
            </button>
          </div>
        </div>

        <!-- Table content -->
        <div v-if="activeTable" class="fcv__db-content">
          <SqliteTableView
            :key="filePath"
            v-model:view-mode="sqliteViewMode"
            :table="activeTable"
          />
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
          v-if="absolutePath"
          class="fcv__copy-btn"
          :class="{ 'fcv__copy-btn--copied': pathCopied }"
          :title="pathCopied ? 'Copied path!' : 'Copy file path'"
          :aria-label="pathCopied ? 'Copied path!' : 'Copy file path'"
          @click="copyPath(absolutePath)"
        >
          <svg aria-hidden="true" v-if="!pathCopied" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6.5 9.5A3.2 3.2 0 0 0 11 10l2-2a3.2 3.2 0 1 0-4.5-4.5L7.5 4.5"/>
            <path d="M9.5 6.5A3.2 3.2 0 0 0 5 6l-2 2a3.2 3.2 0 1 0 4.5 4.5l1-1"/>
          </svg>
          <svg aria-hidden="true" v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 8 6.5 12 13 4"/>
          </svg>
        </button>
        <button
          class="fcv__copy-btn"
          :class="{ 'fcv__copy-btn--copied': textCopied }"
          :title="textCopied ? 'Copied!' : 'Copy file contents'"
          :aria-label="textCopied ? 'Copied!' : 'Copy file contents'"
          :style="absolutePath ? { marginLeft: '4px' } : undefined"
          @click="copyFileContent"
        >
          <svg aria-hidden="true" v-if="!textCopied" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="5" width="9" height="10" rx="1"/>
            <path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v9a1 1 0 001 1h2"/>
          </svg>
          <svg aria-hidden="true" v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
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
