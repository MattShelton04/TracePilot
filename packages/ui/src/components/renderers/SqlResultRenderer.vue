<script setup lang="ts">
/**
 * SqlResultRenderer — renders SQL tool results with the query and tabular data.
 */
import { computed } from "vue";
import RendererShell from "./RendererShell.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  'load-full': [];
}>();

const query = computed(() =>
  typeof props.args?.query === "string" ? props.args.query : null
);

const description = computed(() =>
  typeof props.args?.description === "string" ? props.args.description : null
);

/** Try to parse the content as a structured result. */
const parsedTable = computed<{ headers: string[]; rows: string[][] } | null>(() => {
  if (!props.content) return null;
  try {
    const parsed = JSON.parse(props.content);
    // Array of objects → table
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object") {
      const headers = Object.keys(parsed[0]);
      const rows = parsed.map(obj =>
        headers.map(h => String(obj[h] ?? ""))
      );
      return { headers, rows };
    }
  } catch {
    // Not JSON — fall through to plain text
  }
  return null;
});
</script>

<template>
  <RendererShell
    :label="description ?? 'SQL'"
    :copy-content="content"
    :is-truncated="isTruncated"
    @load-full="emit('load-full')"
  >
    <div class="sql-result">
      <!-- Query display -->
      <div v-if="query" class="sql-query-section">
        <div class="sql-query-label">Query</div>
        <pre class="sql-query-code">{{ query }}</pre>
      </div>

      <!-- Table result -->
      <div v-if="parsedTable" class="sql-table-section">
        <div class="sql-table-label">Result ({{ parsedTable.rows.length }} row{{ parsedTable.rows.length !== 1 ? 's' : '' }})</div>
        <div class="sql-table-wrap">
          <table class="sql-data-table">
            <thead>
              <tr>
                <th v-for="h in parsedTable.headers" :key="h" scope="col">{{ h }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in parsedTable.rows" :key="i">
                <td v-for="(cell, j) in row" :key="j">{{ cell }}</td>
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
  margin-bottom: 4px;
}
.sql-query-code {
  margin: 0;
  padding: 6px 10px;
  background: var(--canvas-inset);
  border-radius: var(--radius-sm, 6px);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--accent-fg, #818cf8);
  font-size: 0.6875rem;
  line-height: 1.5;
}
.sql-table-section {
  padding: 8px 12px;
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
  border-bottom: 1px solid var(--border-muted);
  position: sticky;
  top: 0;
}
.sql-data-table td {
  padding: 4px 10px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-muted);
}
.sql-data-table tr:hover td {
  background: var(--neutral-muted);
}
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
