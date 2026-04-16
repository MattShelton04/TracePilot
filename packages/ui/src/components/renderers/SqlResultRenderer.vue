<script setup lang="ts">
/**
 * SqlResultRenderer — renders SQL tool results with syntax-highlighted query,
 * striped table with semantic cell styling, and row count badge.
 */
import { computed } from "vue";
import { highlightSql } from "../../utils/syntaxHighlight";
import RendererShell from "./RendererShell.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();

const query = computed(() => (typeof props.args?.query === "string" ? props.args.query : null));

const description = computed(() =>
  typeof props.args?.description === "string" ? props.args.description : null,
);

/** Highlighted SQL query (safe HTML). */
const highlightedQuery = computed(() => {
  if (!query.value) return "";
  return highlightSql(query.value);
});

/** Parse a markdown pipe table from text. Handles tables embedded in surrounding text. */
function parseMarkdownTable(text: string): { headers: string[]; rows: string[][] } | null {
  const allLines = text.split("\n");

  // Find the header separator line (e.g. "| --- | --- |" or "| :--- | ---: |")
  const sepIdx = allLines.findIndex((l) =>
    /^\s*\|[\s:]*-{2,}[\s:]*(\|[\s:]*-{2,}[\s:]*)*\|\s*$/.test(l),
  );
  if (sepIdx < 1) return null;

  const headerLine = allLines[sepIdx - 1];
  if (!headerLine.includes("|")) return null;

  const parsePipeRow = (line: string): string[] =>
    line
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((c) => c.trim());

  const headers = parsePipeRow(headerLine);
  if (headers.length === 0 || headers.every((h) => h === "")) return null;

  const rows: string[][] = [];
  for (let i = sepIdx + 1; i < allLines.length; i++) {
    const line = allLines[i].trim();
    if (!line.startsWith("|")) break;
    rows.push(parsePipeRow(line));
  }

  if (rows.length === 0) return null;
  return { headers, rows };
}

/** Try to parse the content as a structured result.
 *  Handles: JSON array of objects, newline-delimited JSON objects,
 *  and content with a JSON array embedded in surrounding text. */
const parsedTable = computed<{ headers: string[]; rows: string[][] } | null>(() => {
  if (!props.content) return null;
  const trimmed = props.content.trim();

  // Try direct JSON parse first (most common: [{ ... }, { ... }])
  const tryParse = (text: string): { headers: string[]; rows: string[][] } | null => {
    try {
      const parsed = JSON.parse(text);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        typeof parsed[0] === "object" &&
        parsed[0] !== null
      ) {
        const headers = Object.keys(parsed[0]);
        const rows = parsed.map((obj) => headers.map((h) => String(obj[h] ?? "")));
        return { headers, rows };
      }
    } catch {
      // Not valid JSON
    }
    return null;
  };

  // 1. Direct parse
  const direct = tryParse(trimmed);
  if (direct) return direct;

  // 2. Extract embedded JSON array from surrounding text (e.g. "Results:\n[{...}]")
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const embedded = tryParse(arrayMatch[0]);
    if (embedded) return embedded;
  }

  // 3. Try newline-delimited JSON objects (NDJSON)
  const lines = trimmed.split("\n").filter((l) => l.trim().startsWith("{"));
  if (lines.length > 0) {
    try {
      const objects = lines.map((l) => JSON.parse(l));
      if (objects.length > 0 && typeof objects[0] === "object" && objects[0] !== null) {
        const headers = Object.keys(objects[0]);
        const rows = objects.map((obj) => headers.map((h) => String(obj[h] ?? "")));
        return { headers, rows };
      }
    } catch {
      // Not NDJSON
    }
  }

  // 4. Parse markdown pipe tables (e.g. "| col1 | col2 |\n| --- | --- |\n| val | val |")
  const mdTable = parseMarkdownTable(trimmed);
  if (mdTable) return mdTable;

  return null;
});

/** Detect cell type for semantic coloring. */
function cellClass(value: string): string {
  if (value === "null" || value === "NULL" || value === "") return "sql-cell--null";
  if (/^-?\d+(\.\d+)?$/.test(value)) return "sql-cell--number";
  if (value === "true" || value === "false") return "sql-cell--boolean";
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return "sql-cell--date";
  return "";
}
</script>

<template>
  <RendererShell
    :label="description ?? 'SQL'"
    :copy-content="content"
    :is-truncated="isTruncated"
    @load-full="emit('load-full')"
  >
    <div class="sql-result">
      <!-- Query display with syntax highlighting -->
      <div v-if="query" class="sql-query-section">
        <div class="sql-query-label">Query</div>
        <!-- eslint-disable vue/no-v-html -->
        <pre class="sql-query-code" v-html="highlightedQuery"></pre>
      </div>

      <!-- Table result -->
      <div v-if="parsedTable" class="sql-table-section">
        <div class="sql-table-header">
          <span class="sql-table-label">Result</span>
          <span class="sql-row-count">{{ parsedTable.rows.length }} row{{ parsedTable.rows.length !== 1 ? 's' : '' }}</span>
        </div>
        <div class="sql-table-wrap">
          <table class="sql-data-table">
            <thead>
              <tr>
                <th v-for="h in parsedTable.headers" :key="h" scope="col">{{ h }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in parsedTable.rows" :key="i" :class="{ 'sql-row--striped': i % 2 === 1 }">
                <td v-for="(cell, j) in row" :key="j" :class="cellClass(cell)">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Plain text fallback -->
      <pre v-else class="sql-plain-output">{{ content }}</pre>
    </div>
  </RendererShell>
</template>

<style scoped>
.sql-result {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
}
.sql-query-section {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-muted);
}
.sql-query-label, .sql-table-label {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.sql-query-code {
  margin: 4px 0 0 0;
  padding: 6px 10px;
  background: var(--canvas-inset);
  border-radius: var(--radius-sm, 6px);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.6875rem;
  line-height: 1.5;
}
/* SQL syntax highlight classes */
.sql-query-code :deep(.syn-keyword) { color: var(--syn-keyword, #c084fc); }
.sql-query-code :deep(.syn-string) { color: var(--syn-string, #34d399); }
.sql-query-code :deep(.syn-number) { color: var(--syn-number, #fb923c); }
.sql-query-code :deep(.syn-comment) { color: var(--text-tertiary); font-style: italic; }
.sql-query-code :deep(.syn-func) { color: var(--syn-func, #fbbf24); }
.sql-query-code :deep(.syn-operator) { color: var(--text-tertiary); }

.sql-table-section { padding: 8px 12px; }
.sql-table-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.sql-row-count {
  font-size: 0.5625rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 9999px;
  background: var(--accent-muted, rgba(99, 102, 241, 0.15));
  color: var(--accent-fg, #818cf8);
}
.sql-table-wrap {
  overflow: auto;
  max-height: 400px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm, 6px);
}
.sql-data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.6875rem;
}
.sql-data-table th {
  text-align: left;
  padding: 5px 10px;
  background: var(--canvas-inset);
  color: var(--text-tertiary);
  font-weight: 600;
  border-bottom: 2px solid var(--border-muted);
  position: sticky;
  top: 0;
  z-index: 1;
}
.sql-data-table td {
  padding: 4px 10px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-muted);
}
.sql-row--striped td {
  background: rgba(255, 255, 255, 0.02);
}
.sql-data-table tr:hover td {
  background: var(--neutral-muted);
}

/* Semantic cell styles */
.sql-cell--null { color: var(--text-tertiary); font-style: italic; }
.sql-cell--number { color: var(--syn-number, #fb923c); }
.sql-cell--boolean { color: var(--syn-keyword, #c084fc); }
.sql-cell--date { color: var(--syn-type, #38bdf8); }

.sql-plain-output {
  margin: 0;
  padding: 10px 12px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  max-height: 400px;
  overflow: auto;
}
</style>
