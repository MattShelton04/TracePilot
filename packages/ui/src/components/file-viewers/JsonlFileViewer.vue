<script setup lang="ts">
import { computed, ref } from "vue";
import CodeBlock from "../renderers/CodeBlock.vue";
import JsonTreeNode from "./JsonTreeNode.vue";

const props = defineProps<{
  content: string;
  filePath?: string;
  mode?: "records" | "raw";
  searchQuery?: string;
  activeSearchLine?: number;
  activeSearchColumn?: number;
}>();
const emit = defineEmits<{
  "update:mode": [mode: "records" | "raw"];
}>();

interface JsonlRecord {
  line: number;
  value: unknown;
  raw: string;
  error: string | null;
  label: string;
}

const MAX_RECORDS = 2_000;
const mode = computed({
  get: () => props.mode ?? "records",
  set: (value: "records" | "raw") => emit("update:mode", value),
});
const effectiveMode = computed(() => (props.searchQuery?.trim() ? "raw" : mode.value));
const query = ref("");
const records = computed<JsonlRecord[]>(() =>
  props.content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, MAX_RECORDS)
    .map((raw, index) => {
      try {
        const value = JSON.parse(raw) as unknown;
        const object =
          value && typeof value === "object" ? (value as Record<string, unknown>) : null;
        const type = typeof object?.type === "string" ? object.type : null;
        const id = typeof object?.id === "string" ? object.id.slice(0, 8) : null;
        return {
          line: index + 1,
          value,
          raw,
          error: null,
          label: [type, id].filter(Boolean).join(" · ") || `Record ${index + 1}`,
        };
      } catch (error) {
        return {
          line: index + 1,
          value: raw,
          raw,
          error: error instanceof Error ? error.message : String(error),
          label: `Invalid record ${index + 1}`,
        };
      }
    }),
);
const totalLines = computed(
  () => props.content.split(/\r?\n/).filter((line) => line.trim().length > 0).length,
);
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return records.value;
  return records.value.filter(
    (record) =>
      record.label.toLowerCase().includes(needle) || record.raw.toLowerCase().includes(needle),
  );
});
const invalidCount = computed(() => records.value.filter((record) => record.error).length);
</script>

<template>
  <div class="jsonl-viewer">
    <div class="jsonl-viewer__toolbar">
      <div class="jsonl-viewer__modes" role="radiogroup" aria-label="JSONL view mode">
        <button type="button" :class="{ active: effectiveMode === 'records' }" @click="mode = 'records'">Records</button>
        <button type="button" :class="{ active: effectiveMode === 'raw' }" @click="mode = 'raw'">Raw</button>
      </div>
      <input
        v-if="effectiveMode === 'records'"
        v-model="query"
        class="jsonl-viewer__search"
        type="search"
        placeholder="Filter records…"
        aria-label="Filter JSONL records"
      />
      <span class="jsonl-viewer__meta">
        {{ filtered.length }} / {{ totalLines }} records
        <template v-if="invalidCount"> · {{ invalidCount }} invalid</template>
        <template v-if="totalLines > MAX_RECORDS"> · first {{ MAX_RECORDS }} structured</template>
      </span>
    </div>

    <div v-if="effectiveMode === 'records'" class="jsonl-viewer__records">
      <details v-for="record in filtered" :key="record.line" class="jsonl-viewer__record">
        <summary>
          <span class="jsonl-viewer__line">L{{ record.line }}</span>
          <span>{{ record.label }}</span>
          <span v-if="record.error" class="jsonl-viewer__invalid">Invalid JSON</span>
        </summary>
        <div v-if="record.error" class="jsonl-viewer__error">{{ record.error }}</div>
        <JsonTreeNode :value="record.value" :initially-expanded="true" />
      </details>
      <div v-if="filtered.length === 0" class="jsonl-viewer__empty">No matching records</div>
    </div>
    <CodeBlock
      v-else
      :code="content"
      :file-path="filePath"
      language="json"
      :line-numbers="true"
      :show-language-badge="false"
      :max-lines="5000"
      :fill-height="true"
      :search-query="searchQuery"
      :active-search-line="activeSearchLine"
      :active-search-column="activeSearchColumn"
    />
  </div>
</template>

<style scoped>
.jsonl-viewer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.jsonl-viewer__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border-muted);
}

.jsonl-viewer__modes {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
}

.jsonl-viewer__modes button {
  padding: 3px 9px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.6875rem;
}

.jsonl-viewer__modes button.active {
  background: var(--accent-emphasis);
  color: var(--text-on-emphasis);
}

.jsonl-viewer__search {
  width: min(260px, 35%);
  padding: 5px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  color: var(--text-primary);
  font-size: 0.75rem;
}

.jsonl-viewer__meta {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.jsonl-viewer__records {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.jsonl-viewer__record {
  margin-bottom: 4px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  background: var(--canvas-default);
}

.jsonl-viewer__record summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  cursor: pointer;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.jsonl-viewer__line { color: var(--text-tertiary); }
.jsonl-viewer__invalid { margin-left: auto; color: var(--danger-fg); }
.jsonl-viewer__error { padding: 6px 10px; color: var(--danger-fg); font-size: 0.6875rem; }
.jsonl-viewer__record > :deep(.json-node) { padding: 4px 10px 10px; }
.jsonl-viewer__empty { padding: 24px; text-align: center; color: var(--text-tertiary); }
</style>
