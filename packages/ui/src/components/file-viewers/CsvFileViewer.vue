<script setup lang="ts">
import Papa from "papaparse";
import { computed, ref } from "vue";
import CodeBlock from "../renderers/CodeBlock.vue";

const props = defineProps<{
  content: string;
  filePath?: string;
  mode?: "table" | "raw";
  searchQuery?: string;
  activeSearchLine?: number;
  activeSearchColumn?: number;
}>();
const emit = defineEmits<{
  "update:mode": [mode: "table" | "raw"];
}>();

const MAX_ROWS = 2_000;
const MAX_COLUMNS = 200;
const mode = computed({
  get: () => props.mode ?? "table",
  set: (value: "table" | "raw") => emit("update:mode", value),
});
const effectiveMode = computed(() => (props.searchQuery?.trim() ? "raw" : mode.value));
const filterQuery = ref("");
const configuredDelimiter = computed(() =>
  props.filePath?.toLowerCase().endsWith(".tsv") ? "\t" : "",
);
const parsed = computed(() => {
  if (effectiveMode.value !== "table") {
    return Papa.parse<string[]>("", {
      delimiter: configuredDelimiter.value,
      skipEmptyLines: "greedy",
    });
  }
  return Papa.parse<string[]>(props.content, {
    delimiter: configuredDelimiter.value,
    skipEmptyLines: "greedy",
    preview: MAX_ROWS + 1,
  });
});
const delimiterLabel = computed(() => {
  const delimiter = parsed.value.meta.delimiter;
  if (delimiter === "\t") return "tab";
  if (delimiter === ",") return "comma";
  if (delimiter === ";") return "semicolon";
  if (delimiter === "|") return "pipe";
  return JSON.stringify(delimiter);
});
const rows = computed(() => parsed.value.data.slice(0, MAX_ROWS + 1));
const headers = computed(() =>
  (rows.value[0] ?? []).slice(0, MAX_COLUMNS).map((value, index) => value || `Column ${index + 1}`),
);
const dataRows = computed(() => rows.value.slice(1));
const filteredRows = computed(() => {
  const needle = filterQuery.value.trim().toLowerCase();
  if (!needle) return dataRows.value;
  return dataRows.value.filter((row) =>
    row.some((cell) => String(cell).toLowerCase().includes(needle)),
  );
});
</script>

<template>
  <div class="csv-viewer">
    <div class="csv-viewer__toolbar">
      <div class="csv-viewer__modes" role="radiogroup" aria-label="CSV view mode">
        <button type="button" :class="{ active: effectiveMode === 'table' }" @click="mode = 'table'">Table</button>
        <button type="button" :class="{ active: effectiveMode === 'raw' }" @click="mode = 'raw'">Raw</button>
      </div>
      <input
        v-if="effectiveMode === 'table'"
        v-model="filterQuery"
        class="csv-viewer__search"
        type="search"
        placeholder="Filter rows…"
        aria-label="Filter CSV rows"
      />
      <span class="csv-viewer__meta">
        {{ filteredRows.length }} rows · {{ headers.length }} columns
        <template v-if="parsed.meta.delimiter"> · {{ delimiterLabel }} delimiter</template>
        <template v-if="parsed.errors.length"> · {{ parsed.errors.length }} parse warnings</template>
        <template v-if="parsed.meta.truncated"> · first {{ MAX_ROWS }} shown</template>
      </span>
    </div>

    <div v-if="effectiveMode === 'table'" class="csv-viewer__table-wrap">
      <table class="csv-viewer__table">
        <thead>
          <tr>
            <th class="csv-viewer__row-number">#</th>
            <th v-for="(header, index) in headers" :key="index">{{ header }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in filteredRows" :key="rowIndex">
            <td class="csv-viewer__row-number">{{ rowIndex + 1 }}</td>
            <td v-for="(_, columnIndex) in headers" :key="columnIndex">
              {{ row[columnIndex] ?? "" }}
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="filteredRows.length === 0" class="csv-viewer__empty">No matching rows</div>
    </div>
    <CodeBlock
      v-else
      :code="content"
      :file-path="filePath"
      language="csv"
      :line-numbers="true"
      :show-language-badge="false"
      :max-lines="10000"
      :fill-height="true"
      :search-query="searchQuery"
      :active-search-line="activeSearchLine"
      :active-search-column="activeSearchColumn"
    />
  </div>
</template>

<style scoped>
.csv-viewer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.csv-viewer__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border-muted);
}

.csv-viewer__modes {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
}

.csv-viewer__modes button {
  padding: 3px 9px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.6875rem;
}

.csv-viewer__modes button.active {
  background: var(--accent-emphasis);
  color: var(--text-on-emphasis);
}

.csv-viewer__search {
  width: min(240px, 35%);
  padding: 5px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  color: var(--text-primary);
  font-size: 0.75rem;
}

.csv-viewer__meta {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.csv-viewer__table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.csv-viewer__table {
  border-collapse: collapse;
  min-width: 100%;
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.csv-viewer__table th,
.csv-viewer__table td {
  max-width: 360px;
  padding: 6px 9px;
  overflow: hidden;
  border-right: 1px solid var(--border-muted);
  border-bottom: 1px solid var(--border-muted);
  color: var(--text-primary);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csv-viewer__table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--canvas-subtle);
  color: var(--text-secondary);
  font-weight: 600;
}

.csv-viewer__table tbody tr:nth-child(even) { background: var(--canvas-subtle); }
.csv-viewer__table tbody tr:hover { background: var(--neutral-muted); }
.csv-viewer__row-number { color: var(--text-tertiary) !important; user-select: none; }
.csv-viewer__empty { padding: 24px; text-align: center; color: var(--text-tertiary); }
</style>
