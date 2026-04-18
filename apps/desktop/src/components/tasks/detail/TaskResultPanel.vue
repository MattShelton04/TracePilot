<script setup lang="ts">
import type { Task } from "@tracepilot/types";
import { formatValue, isSimpleValue } from "@/composables/useTaskDetail";

interface Props {
  task: Task;
  resultEntries: Array<[string, unknown]>;
}

defineProps<Props>();
</script>

<template>
  <div class="panel-content">
    <div v-if="task.resultSummary" class="result-card">
      <div class="card-label">Summary</div>
      <div class="result-summary-text">
        {{ task.resultSummary }}
      </div>
    </div>

    <div v-if="resultEntries.length > 0" class="result-card">
      <div class="card-label">Parsed Result</div>
      <div class="kv-table">
        <div v-for="[key, val] in resultEntries" :key="key" class="kv-row">
          <span class="kv-key">{{ key }}</span>
          <span v-if="isSimpleValue(val)" class="kv-val">
            {{ formatValue(val) }}
          </span>
          <pre v-else class="kv-val-block">{{ formatValue(val) }}</pre>
        </div>
      </div>
    </div>

    <div
      v-if="task.schemaValid != null && task.status === 'done'"
      class="schema-badge-row"
    >
      <span :class="task.schemaValid ? 'schema-pass' : 'schema-fail'">
        {{ task.schemaValid ? "✓ Schema Valid" : "✗ Schema Invalid" }}
      </span>
    </div>

    <div
      v-if="
        !task.resultSummary &&
        resultEntries.length === 0 &&
        task.status !== 'done' &&
        task.status !== 'failed'
      "
      class="empty-state"
    >
      <div class="empty-icon">✦</div>
      <div class="empty-heading">No results yet</div>
      <div class="empty-desc">
        This task is
        {{
          task.status === "in_progress"
            ? "currently running"
            : "waiting to be processed"
        }}.
        Results will appear here once complete.
      </div>
    </div>

    <div
      v-if="
        !task.resultSummary &&
        resultEntries.length === 0 &&
        task.status === 'done'
      "
      class="empty-state"
    >
      <div class="empty-icon">○</div>
      <div class="empty-heading">No result data</div>
      <div class="empty-desc">
        The task completed but did not produce result data.
      </div>
    </div>

    <div
      v-if="
        !task.resultSummary &&
        resultEntries.length === 0 &&
        task.status === 'failed'
      "
      class="empty-state"
    >
      <div class="empty-icon empty-icon-danger">✗</div>
      <div class="empty-heading">Task failed</div>
      <div class="empty-desc">
        See the error banner above for details.
      </div>
    </div>
  </div>
</template>
