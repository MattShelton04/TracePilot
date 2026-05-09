<script setup lang="ts">
/**
 * SqlResultRenderer — renders SQL tool results with syntax-highlighted query,
 * striped table with semantic cell styling, and row count badge.
 */
import type { TurnToolCall } from "@tracepilot/types";
import { Database } from "lucide-vue-next";
import { computed } from "vue";
import { highlightSql } from "../../utils/syntaxHighlight";
import RendererShell, { type RendererShellStatus } from "../RendererShell.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc?: TurnToolCall;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();

const status = computed<RendererShellStatus>(() =>
  props.tc?.success === true ? "success" : props.tc?.success === false ? "error" : "success",
);

const query = computed(() => (typeof props.args?.query === "string" ? props.args.query : null));

const description = computed(() =>
  typeof props.args?.description === "string" ? props.args.description : null,
);

const highlightedQuery = computed(() => {
  if (!query.value) return "";
  return highlightSql(query.value);
});

function parseMarkdownTable(text: string): { headers: string[]; rows: string[][] } | null {
  const allLines = text.split("\n");

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

const parsedTable = computed<{ headers: string[]; rows: string[][] } | null>(() => {
  if (!props.content) return null;
  const trimmed = props.content.trim();

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

  const direct = tryParse(trimmed);
  if (direct) return direct;

  const arrayMatch = trimmed.match(/\[\s*\{[\s\S]*?\}\s*\]/);
  if (arrayMatch) {
    const embedded = tryParse(arrayMatch[0]);
    if (embedded) return embedded;
  }

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

  const mdTable = parseMarkdownTable(trimmed);
  if (mdTable) return mdTable;

  return null;
});

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
    tool-name="SQL"
    :status="status"
    :primary-hint="description ?? undefined"
    :copy-text="content"
  >
    <template #icon><Database :size="16" /></template>
    <div class="sql-result">
      <div v-if="query" class="sql-query-section">
        <div class="sql-query-label">Query</div>
        <!-- eslint-disable vue/no-v-html -->
        <pre class="sql-query-code" v-html="highlightedQuery"></pre>
      </div>

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

      <pre v-else class="sql-plain-output">{{ content }}</pre>
    </div>
    <button v-if="isTruncated" type="button" class="rs-trunc" @click="emit('load-full')">
      Output truncated — Show full
    </button>
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
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.6875rem;
  line-height: 1.5;
}
.sql-query-code :deep(.syn-keyword) { color: var(--syn-keyword); }
.sql-query-code :deep(.syn-string) { color: var(--syn-string); }
.sql-query-code :deep(.syn-number) { color: var(--syn-number); }
.sql-query-code :deep(.syn-comment) { color: var(--text-tertiary); font-style: italic; }
.sql-query-code :deep(.syn-func) { color: var(--syn-func); }
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
  background: var(--accent-muted);
  color: var(--accent-fg);
}
.sql-table-wrap {
  overflow: auto;
  max-height: 400px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
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
  background: var(--canvas-inset);
}
.sql-data-table tr:hover td {
  background: var(--neutral-muted);
}

.sql-cell--null { color: var(--text-tertiary); font-style: italic; }
.sql-cell--number { color: var(--syn-number); }
.sql-cell--boolean { color: var(--syn-keyword); }
.sql-cell--date { color: var(--syn-type); }

.sql-plain-output {
  margin: 0;
  padding: 10px 12px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  max-height: 400px;
  overflow: auto;
}
.rs-trunc {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: 0;
  border-top: 1px solid var(--border-subtle);
  background: var(--canvas-inset);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.rs-trunc:hover { color: var(--text-primary); background: var(--surface-tertiary); }
</style>
