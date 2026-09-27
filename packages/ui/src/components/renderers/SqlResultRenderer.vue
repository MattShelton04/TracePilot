<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import { Database } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { parseSqlResult } from "../../utils/sqlResult";
import { highlightSql } from "../../utils/syntaxHighlight";
import { toolCallStatus } from "../../utils/toolCallStatus";
import RendererScrollRegion from "../RendererScrollRegion.vue";
import RendererShell from "../RendererShell.vue";
import RendererTruncationFooter from "../RendererTruncationFooter.vue";
import RecordedToolResponse from "./RecordedToolResponse.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  tc?: TurnToolCall;
  isTruncated?: boolean;
}>();
const emit = defineEmits<{ "load-full": [] }>();
const status = computed(() => toolCallStatus(props.tc));
const query = computed(() => (typeof props.args?.query === "string" ? props.args.query : ""));
const description = computed(() =>
  typeof props.args?.description === "string" ? props.args.description : undefined,
);
const highlightedQuery = computed(() => highlightSql(query.value));
const parsedTable = computed(() => parseSqlResult(props.content));
const PAGE_SIZE = 200;
const page = ref(0);
const rowCount = computed(() => parsedTable.value?.rows.length ?? 0);
const pageCount = computed(() => Math.max(1, Math.ceil(rowCount.value / PAGE_SIZE)));
const visibleRows = computed(
  () => parsedTable.value?.rows.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE) ?? [],
);
const numericColumns = computed(
  () =>
    parsedTable.value?.headers.map((_, index) => {
      const cells =
        parsedTable.value?.rows
          .map((row) => row[index])
          .filter((value) => value.kind !== "null" && value.kind !== "missing") ?? [];
      return cells.length > 0 && cells.every((value) => value.kind === "number");
    }) ?? [],
);

watch(
  () => props.tc?.toolCallId,
  () => {
    page.value = 0;
  },
);
watch(pageCount, (count) => {
  page.value = Math.min(page.value, count - 1);
});
</script>

<template>
  <RendererShell tool-name="SQL" :status="status" :primary-hint="description" :copy-text="content">
    <template #icon><Database :size="16" /></template>
    <div class="sql-result">
      <div v-if="query" class="sql-query-section">
        <div class="sql-section-label">Query</div>
        <RendererScrollRegion label="query" :max-height="160" :key="`query-${tc?.toolCallId}`">
          <!-- Input is HTML-escaped by highlightSql. -->
          <pre class="sql-query-code" v-html="highlightedQuery"></pre>
        </RendererScrollRegion>
      </div>

      <div v-if="parsedTable" class="sql-table-section">
        <pre v-if="parsedTable.before" class="sql-result-note">{{ parsedTable.before }}</pre>
        <div class="sql-table-header">
          <span class="sql-section-label">Result</span>
          <span class="sql-row-count">{{ rowCount }} {{ rowCount === 1 ? 'row' : 'rows' }}</span>
        </div>
        <RendererScrollRegion v-if="parsedTable.headers.length" label="rows" :max-height="360" :key="`rows-${tc?.toolCallId}`" class="sql-table-wrap">
          <table class="sql-data-table" aria-label="SQL query results">
            <thead><tr>
              <th v-for="(header, index) in parsedTable.headers" :key="index" scope="col" :class="{ 'sql-column--number': numericColumns[index] }">{{ header || '(unnamed column)' }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="(row, index) in visibleRows" :key="page * PAGE_SIZE + index">
                <td v-for="(value, column) in row" :key="column" :class="[`sql-cell--${value.kind}`, { 'sql-column--number': numericColumns[column] }]" :title="value.kind === 'missing' ? 'Field not present in this row' : value.kind === 'empty' ? 'Empty string' : undefined">{{ value.text }}</td>
              </tr>
            </tbody>
          </table>
        </RendererScrollRegion>
        <p v-if="!rowCount" class="sql-empty">No rows returned.</p>
        <p v-else-if="!parsedTable.headers.length" class="sql-empty">{{ rowCount }} {{ rowCount === 1 ? 'row has' : 'rows have' }} no fields. Open the complete response to inspect {{ rowCount === 1 ? 'it' : 'them' }}.</p>
        <nav v-if="pageCount > 1" class="sql-pagination" aria-label="Result pages">
          <span>Rows {{ page * PAGE_SIZE + 1 }}–{{ Math.min((page + 1) * PAGE_SIZE, rowCount) }} of {{ rowCount }}</span>
          <button type="button" :disabled="page === 0" @click="page--">Previous</button>
          <button type="button" :disabled="page + 1 >= pageCount" @click="page++">Next</button>
        </nav>
        <pre v-if="parsedTable.after" class="sql-result-note">{{ parsedTable.after }}</pre>
        <RecordedToolResponse :content="content" class="sql-raw-response" />
      </div>

      <RendererScrollRegion v-else label="response" :key="`response-${tc?.toolCallId}`">
        <pre v-if="content" class="sql-plain-output">{{ content }}</pre>
        <p v-else class="sql-empty">{{ status === 'pending' ? 'Waiting for query results…' : status === 'error' ? 'The query returned no output.' : 'Query completed with no output.' }}</p>
      </RendererScrollRegion>
    </div>
    <RendererTruncationFooter v-if="isTruncated" @load-full="emit('load-full')" />
  </RendererShell>
</template>

<style scoped>
.sql-result { min-width: 0; font-size: 13px; }
.sql-query-section { padding: 12px; border-bottom: 1px solid var(--border-muted); }
.sql-section-label { font-size: 12px; font-weight: 600; color: var(--text-tertiary); }
.sql-query-code {
  margin: 8px 0 0; padding: 8px 10px; background: var(--canvas-inset);
  border-radius: var(--radius-sm); white-space: pre-wrap; overflow-wrap: anywhere;
  font: 13px/1.6 var(--font-mono, monospace);
}
.sql-query-code :deep(.syn-keyword) { color: var(--syn-keyword); }
.sql-query-code :deep(.syn-string) { color: var(--syn-string); }
.sql-query-code :deep(.syn-number) { color: var(--syn-number); }
.sql-query-code :deep(.syn-comment) { color: var(--text-tertiary); font-style: italic; }
.sql-query-code :deep(.syn-func) { color: var(--syn-func); }
.sql-query-code :deep(.syn-operator) { color: var(--text-tertiary); }
.sql-table-section { padding: 12px; min-width: 0; }
.sql-table-header { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.sql-row-count { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.sql-table-wrap { border: 1px solid var(--border-muted); border-radius: var(--radius-sm); overflow: hidden; }
.sql-data-table { width: 100%; border-collapse: collapse; font: 13px/1.5 var(--font-mono, monospace); }
.sql-data-table th {
  text-align: left; padding: 8px 12px; background: var(--canvas-inset); color: var(--text-secondary);
  font-weight: 600; border-bottom: 1px solid var(--border-default); white-space: nowrap;
  position: sticky; top: 0; z-index: var(--z-base, 1);
}
.sql-data-table td { padding: 8px 12px; color: var(--text-primary); border-bottom: 1px solid var(--border-muted); vertical-align: top; min-width: 5ch; max-width: 36rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.sql-data-table tr:last-child td { border-bottom: 0; }
.sql-data-table tbody tr:nth-child(even) td { background: var(--canvas-inset); }
.sql-data-table tbody tr:hover td { background: var(--neutral-muted); }
.sql-data-table td.sql-cell--null, .sql-data-table td.sql-cell--missing, .sql-data-table td.sql-cell--empty { color: var(--text-tertiary); font-style: italic; }
.sql-data-table td.sql-cell--number { color: var(--syn-number); font-variant-numeric: tabular-nums; }
.sql-data-table .sql-column--number { text-align: right; }
.sql-data-table td.sql-cell--boolean { color: var(--syn-keyword); }
.sql-plain-output, .sql-result-note { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-secondary); font: 13px/1.6 var(--font-mono, monospace); }
.sql-plain-output { padding: 12px; }
.sql-result-note { margin: 8px 0 12px; }
.sql-empty { margin: 0; padding: 12px; color: var(--text-tertiary); font-size: 13px; }
.sql-table-section > .sql-empty { padding: 8px 0; }
.sql-raw-response { margin-top: 8px; }
.sql-pagination { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 0; font-size: 12px; color: var(--text-secondary); }
.sql-pagination span { margin-right: auto; }
.sql-pagination button { border: 1px solid var(--border-muted); border-radius: var(--radius-sm); padding: 4px 8px; color: var(--accent-fg); background: var(--canvas-inset); cursor: pointer; }
.sql-pagination button:disabled { opacity: 0.5; cursor: default; }
.sql-pagination button:focus-visible { outline: 2px solid var(--accent-emphasis); outline-offset: 2px; }
</style>
