<script setup lang="ts">
/**
 * FileContentViewer — renders a session file with an appropriate viewer.
 *
 * Dispatches to:
 *  - MarkdownContent for `.md` / `markdown` files
 *  - Structured viewers for JSON, JSONL, and CSV/TSV
 *  - ImageFileViewer for sanitized raster previews
 *  - CodeBlock for other text-based files
 *  - SqliteViewer for SQLite databases (table data)
 *  - A placeholder for binary files
 *  - An empty state when no file is selected
 */
import type { SessionDbTable, SessionFileType, SessionImagePreview } from "@tracepilot/types";
import { computed, nextTick, ref, watch } from "vue";
import { useClipboard } from "../composables/useClipboard";
import CsvFileViewer from "./file-viewers/CsvFileViewer.vue";
import ImageFileViewer from "./file-viewers/ImageFileViewer.vue";
import JsonFileViewer from "./file-viewers/JsonFileViewer.vue";
import JsonlFileViewer from "./file-viewers/JsonlFileViewer.vue";
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
  /** Sanitized raster preview returned by `session_read_image_preview`. */
  imagePreview?: SessionImagePreview;
  /** Whether a larger bounded text read is available on explicit request. */
  canLoadMore?: boolean;
  /** Persisted rendered/raw preference for Markdown files. */
  markdownMode?: "rendered" | "raw";
  /** Persisted structured/raw preference for JSON files. */
  jsonMode?: "tree" | "raw";
  /** Persisted structured/raw preference for JSONL files. */
  jsonlMode?: "records" | "raw";
  /** Persisted structured/raw preference for CSV/TSV files. */
  csvMode?: "table" | "raw";
  /** Monotonic request ID used to focus a session-wide content-search match. */
  searchRequestId?: number;
  /** Query supplied by a session-wide content-search result. */
  initialSearchQuery?: string;
  /** One-based line supplied by a session-wide content-search result. */
  initialSearchLine?: number;
  /** Whether the file is currently loading. */
  loading?: boolean;
  /** Error message if loading failed. */
  error?: string | null;
}>();

const emit = defineEmits<{
  /** Re-emitted from MarkdownContent — parent handles OS open (Tauri). */
  "open-external": [url: string];
  "load-full": [];
  "update:markdown-mode": [mode: "rendered" | "raw"];
  "update:json-mode": [mode: "tree" | "raw"];
  "update:jsonl-mode": [mode: "records" | "raw"];
  "update:csv-mode": [mode: "table" | "raw"];
}>();

const isMarkdown = computed(
  () =>
    props.fileType === "markdown" ||
    (props.filePath?.endsWith(".md") ?? false) ||
    (props.filePath?.endsWith(".markdown") ?? false),
);

const isSqlite = computed(() => props.fileType === "sqlite");

const isImage = computed(() => props.fileType === "image");

const isBinary = computed(() => props.fileType === "binary");

const isJsonl = computed(() => props.fileType === "jsonl");
const isJson = computed(() => props.fileType === "json");
const isCsv = computed(() => props.fileType === "csv");
const effectiveMarkdownMode = computed(() => props.markdownMode ?? "rendered");
const MAX_MARKDOWN_RENDER_BYTES = 512 * 1024;
const largeMarkdownRenderEnabled = ref(false);
const markdownRenderAllowed = computed(
  () =>
    props.content === undefined ||
    props.content.length <= MAX_MARKDOWN_RENDER_BYTES ||
    largeMarkdownRenderEnabled.value,
);

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

// ── Search within the selected text file ───────────────────────────────────
interface FileSearchMatch {
  line: number;
  column: number;
}

const MAX_FILE_SEARCH_MATCHES = 10_000;
const fileSearchOpen = ref(false);
const fileSearchQuery = ref("");
const activeFileSearchIndex = ref(0);
const fileSearchInput = ref<HTMLInputElement | null>(null);

const fileSearchMatches = computed<FileSearchMatch[]>(() => {
  const query = fileSearchQuery.value.trim();
  if (!query || props.content === undefined) return [];
  const needle = query.toLocaleLowerCase();
  const matches: FileSearchMatch[] = [];
  const sourceLines = props.content.split("\n");
  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
    const source = sourceLines[lineIndex];
    const lower = source.toLocaleLowerCase();
    let column = lower.indexOf(needle);
    while (column >= 0) {
      matches.push({ line: lineIndex + 1, column });
      if (matches.length >= MAX_FILE_SEARCH_MATCHES) return matches;
      column = lower.indexOf(needle, column + needle.length);
    }
  }
  return matches;
});

const activeFileSearchMatch = computed(() => fileSearchMatches.value[activeFileSearchIndex.value]);
const fileSearchWasCapped = computed(
  () => fileSearchMatches.value.length >= MAX_FILE_SEARCH_MATCHES,
);

function focusFileSearch() {
  fileSearchOpen.value = true;
  void nextTick(() => {
    fileSearchInput.value?.focus();
    fileSearchInput.value?.select();
  });
}

function closeFileSearch() {
  fileSearchOpen.value = false;
  fileSearchQuery.value = "";
  activeFileSearchIndex.value = 0;
}

function moveFileSearch(direction: 1 | -1) {
  const count = fileSearchMatches.value.length;
  if (count === 0) return;
  activeFileSearchIndex.value = (activeFileSearchIndex.value + direction + count) % count;
}

watch(fileSearchQuery, () => {
  activeFileSearchIndex.value = 0;
});

watch(fileSearchMatches, (matches) => {
  if (matches.length === 0) {
    activeFileSearchIndex.value = 0;
  } else if (activeFileSearchIndex.value >= matches.length) {
    activeFileSearchIndex.value = matches.length - 1;
  }
});

watch(
  () => props.filePath,
  () => {
    closeFileSearch();
    largeMarkdownRenderEnabled.value = false;
  },
);

watch(
  () => props.searchRequestId,
  async (requestId) => {
    if (!requestId || !props.initialSearchQuery) return;
    fileSearchOpen.value = true;
    fileSearchQuery.value = props.initialSearchQuery;
    await nextTick();
    const targetLine = props.initialSearchLine;
    const targetIndex = targetLine
      ? fileSearchMatches.value.findIndex((match) => match.line === targetLine)
      : -1;
    activeFileSearchIndex.value = targetIndex >= 0 ? targetIndex : 0;
  },
  { immediate: true },
);
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

    <!-- Sanitized raster image preview -->
    <template v-else-if="isImage">
      <div class="fcv__file-header">
        <svg class="fcv__file-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <rect x="2" y="3" width="12" height="10" rx="1"/>
          <circle cx="5.5" cy="6.5" r="1"/>
          <path d="M3.5 12l3.5-3 2.5 2 1.5-1.5 2 2"/>
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
      </div>
      <ImageFileViewer v-if="imagePreview" :preview="imagePreview" :file-path="filePath" />
      <div v-else class="fcv__binary">
        <p class="fcv__binary-title">Image Preview</p>
        <p class="fcv__binary-desc"><strong>{{ fileName }}</strong> has no preview data.</p>
      </div>
    </template>

    <!-- SQLite database viewer -->
    <template v-else-if="isSqlite">
      <div class="fcv__db-header">
        <svg class="fcv__db-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <ellipse cx="12" cy="5" rx="9" ry="3"/>
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
        </svg>
        <span class="fcv__db-name">{{ fileName }}</span>
        <span v-if="dbData" class="fcv__db-meta">{{ dbData.length }} {{ dbData.length === 1 ? 'table' : 'tables' }}</span>
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
          <svg aria-hidden="true" v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 8 6.5 12 13 4"/></svg>
        </button>
        <button
          v-if="activeTable"
          class="fcv__copy-btn"
          :class="{ 'fcv__copy-btn--copied': dbCopied }"
          :title="dbCopied ? 'Copied!' : 'Copy table as JSON'"
          :aria-label="dbCopied ? 'Copied!' : 'Copy table as JSON'"
          @click="copyTableAsJson"
        >
          <svg aria-hidden="true" v-if="!dbCopied" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="10" rx="1"/><path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v9a1 1 0 001 1h2"/></svg>
          <svg aria-hidden="true" v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 8 6.5 12 13 4"/></svg>
        </button>
      </div>
      <!-- Has data -->
      <template v-if="dbData && dbData.length > 0">
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
    <template v-else-if="isBinary">
      <div class="fcv__file-header">
        <svg class="fcv__file-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M9 2v4h4"/></svg>
        <span class="fcv__file-name">{{ filePath }}</span>
        <button v-if="absolutePath" class="fcv__copy-btn" :class="{ 'fcv__copy-btn--copied': pathCopied }" :title="pathCopied ? 'Copied path!' : 'Copy file path'" :aria-label="pathCopied ? 'Copied path!' : 'Copy file path'" @click="copyPath(absolutePath)">
          <svg aria-hidden="true" v-if="!pathCopied" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6.5 9.5A3.2 3.2 0 0 0 11 10l2-2a3.2 3.2 0 1 0-4.5-4.5L7.5 4.5"/><path d="M9.5 6.5A3.2 3.2 0 0 0 5 6l-2 2a3.2 3.2 0 1 0 4.5 4.5l1-1"/></svg>
          <svg aria-hidden="true" v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 8 6.5 12 13 4"/></svg>
        </button>
      </div>
      <div class="fcv__binary">
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
    </template>

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
          :class="{ 'fcv__copy-btn--active': fileSearchOpen }"
          title="Find in file"
          aria-label="Find in file"
          :aria-expanded="fileSearchOpen"
          @click="fileSearchOpen ? closeFileSearch() : focusFileSearch()"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
            <circle cx="7" cy="7" r="4.25"/><path d="M10.2 10.2L14 14"/>
          </svg>
        </button>
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

      <div v-if="fileSearchOpen" class="fcv__find">
        <svg class="fcv__find-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
          <circle cx="7" cy="7" r="4.25"/>
          <path d="M10.2 10.2L14 14"/>
        </svg>
        <input
          ref="fileSearchInput"
          v-model="fileSearchQuery"
          type="text"
          placeholder="Find in file…"
          aria-label="Find in selected file"
          @keydown.enter.prevent="moveFileSearch($event.shiftKey ? -1 : 1)"
          @keydown.esc.prevent="closeFileSearch"
        />
        <span class="fcv__find-count" aria-live="polite">
          <template v-if="fileSearchQuery.trim()">
            {{ fileSearchMatches.length ? activeFileSearchIndex + 1 : 0 }}/{{ fileSearchMatches.length
            }}<template v-if="fileSearchWasCapped">+</template>
          </template>
        </span>
        <button
          type="button"
          title="Previous match"
          aria-label="Previous match"
          :disabled="fileSearchMatches.length === 0"
          @click="moveFileSearch(-1)"
        >
          ↑
        </button>
        <button
          type="button"
          title="Next match"
          aria-label="Next match"
          :disabled="fileSearchMatches.length === 0"
          @click="moveFileSearch(1)"
        >
          ↓
        </button>
        <button type="button" title="Close find" aria-label="Close find" @click="closeFileSearch">
          ×
        </button>
      </div>

      <div v-if="canLoadMore" class="fcv__load-more">
        <span>This file is larger than the 1 MiB preview.</span>
        <button type="button" @click="emit('load-full')">Load up to 16 MiB</button>
      </div>

      <div class="fcv__content" :class="{ 'fcv__content--fill': !isMarkdown || effectiveMarkdownMode === 'rendered' || effectiveMarkdownMode === 'raw' }">
        <!-- Markdown renderer -->
        <template v-if="isMarkdown">
          <div class="fcv__markdown-container">
            <div class="fcv__markdown-modes" role="radiogroup" aria-label="Markdown view mode">
              <button type="button" :class="{ active: effectiveMarkdownMode === 'rendered' }" @click="emit('update:markdown-mode', 'rendered')">Rendered</button>
              <button type="button" :class="{ active: effectiveMarkdownMode === 'raw' }" @click="emit('update:markdown-mode', 'raw')">Raw</button>
            </div>
            <div v-if="effectiveMarkdownMode === 'rendered' && markdownRenderAllowed" class="fcv__markdown-body">
              <MarkdownContent
                :content="content"
                :search-query="fileSearchQuery"
                :active-search-index="activeFileSearchIndex"
                @open-external="(url) => emit('open-external', url)"
              />
            </div>
            <div v-else-if="effectiveMarkdownMode === 'rendered'" class="fcv__render-disabled">
              <strong>Large Markdown preview</strong>
              <span>Rendered view is paused above 512 KiB to keep the explorer responsive.</span>
              <button type="button" @click="largeMarkdownRenderEnabled = true">Render anyway</button>
            </div>
            <CodeBlock
              v-else
              :code="content"
              :file-path="filePath"
              :line-numbers="true"
              :show-language-badge="true"
              :max-lines="10000"
              :fill-height="true"
              :search-query="fileSearchQuery"
              :active-search-line="activeFileSearchMatch?.line"
              :active-search-column="activeFileSearchMatch?.column"
            />
          </div>
        </template>

        <JsonFileViewer
          v-else-if="isJson"
          :content="content"
          :file-path="filePath"
          :mode="jsonMode"
          :search-query="fileSearchQuery"
          :active-search-line="activeFileSearchMatch?.line"
          :active-search-column="activeFileSearchMatch?.column"
          @update:mode="emit('update:json-mode', $event)"
        />

        <JsonlFileViewer
          v-else-if="isJsonl"
          :content="content"
          :file-path="filePath"
          :mode="jsonlMode"
          :search-query="fileSearchQuery"
          :active-search-line="activeFileSearchMatch?.line"
          :active-search-column="activeFileSearchMatch?.column"
          @update:mode="emit('update:jsonl-mode', $event)"
        />

        <CsvFileViewer
          v-else-if="isCsv"
          :content="content"
          :file-path="filePath"
          :mode="csvMode"
          :search-query="fileSearchQuery"
          :active-search-line="activeFileSearchMatch?.line"
          :active-search-column="activeFileSearchMatch?.column"
          @update:mode="emit('update:csv-mode', $event)"
        />

        <!-- Code / text renderer (maxLines caps very large files to prevent UI freeze) -->
        <CodeBlock
          v-else
          :code="content"
          :file-path="filePath"
          :language="codeLanguage"
          :line-numbers="true"
          :show-language-badge="true"
          :max-lines="10000"
          :fill-height="true"
          :search-query="fileSearchQuery"
          :active-search-line="activeFileSearchMatch?.line"
          :active-search-column="activeFileSearchMatch?.column"
        />
      </div>
    </template>
  </div>
</template>
