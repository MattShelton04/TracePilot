<script setup lang="ts">
import {
  type FormatNameCountDto,
  getSourceFormatDiagnostics,
  type SourceFormatDiagnostics,
} from "@tracepilot/client";
import { ActionButton, Heading, toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";

interface Group {
  id: string;
  title: string;
  column: string;
  rows: FormatNameCountDto[];
  empty: string;
}

const diagnostics = shallowRef<SourceFormatDiagnostics | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const guard = useAsyncGuard();
onBeforeUnmount(() => guard.invalidate());

// Read what indexing recorded; nothing is reparsed.
async function load() {
  const token = guard.start();
  loading.value = true;
  error.value = null;
  try {
    const result = await getSourceFormatDiagnostics("claudeCode");
    if (guard.isValid(token)) diagnostics.value = result;
  } catch (e) {
    if (guard.isValid(token)) error.value = toErrorMessage(e);
  } finally {
    if (guard.isValid(token)) loading.value = false;
  }
}

onMounted(load);

const sessionsLabel = computed(() => {
  const count = diagnostics.value?.sessions ?? 0;
  return `${count} indexed session${count === 1 ? "" : "s"}`;
});

const groups = computed<Group[]>(() => {
  const value = diagnostics.value;
  if (!value) return [];
  return [
    {
      id: "records",
      title: "Unmapped record types",
      column: "Type",
      rows: value.unmappedRecordTypes,
      empty: "None. Every record type is mapped.",
    },
    {
      id: "attachments",
      title: "Unmapped attachment types",
      column: "Type",
      rows: value.unmappedAttachmentTypes,
      empty: "None. Every attachment type is known.",
    },
    {
      id: "versions",
      title: "Claude Code versions",
      column: "Version",
      rows: value.versions,
      empty: "None recorded yet. Versions appear after the next index.",
    },
  ];
});
</script>

<template>
  <div class="setting-row setting-row-stacked" data-testid="claude-code-format-diagnostics">
    <div class="diagnostics-header">
      <div class="setting-info">
        <div class="setting-label">Claude Code format diagnostics</div>
        <div class="setting-description">
          Record and attachment types TracePilot doesn't map yet, and the Claude Code versions
          that wrote your sessions, counted while indexing. Names and counts only, so they are safe
          to paste into an issue.
        </div>
      </div>
      <ActionButton size="sm" :disabled="loading" @click="load">
        {{ loading ? "Refreshing…" : "Refresh" }}
      </ActionButton>
    </div>

    <div v-if="error" class="setting-result setting-result-danger" role="alert">
      Couldn't load format diagnostics: {{ error }}
    </div>
    <div v-else-if="diagnostics" class="diagnostics-body">
      <div class="setting-description">{{ sessionsLabel }}</div>
      <section
        v-for="group in groups"
        :key="group.id"
        class="diagnostics-group"
        :aria-labelledby="`claude-diagnostics-${group.id}`"
      >
        <Heading :id="`claude-diagnostics-${group.id}`" :level="4" as="h4">
          {{ group.title }}
        </Heading>
        <p v-if="group.rows.length === 0" class="diagnostics-empty">{{ group.empty }}</p>
        <table v-else class="data-table diagnostics-table" :aria-label="group.title">
          <thead>
            <tr>
              <th>{{ group.column }}</th>
              <th class="diagnostics-count">Sessions</th>
              <th class="diagnostics-count">Records</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in group.rows" :key="row.name">
              <td class="diagnostics-name">{{ row.name }}</td>
              <td class="diagnostics-count">{{ row.sessions }}</td>
              <td class="diagnostics-count">{{ row.records }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>

<style scoped>
.diagnostics-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.diagnostics-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}

.diagnostics-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.diagnostics-empty {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.diagnostics-table {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.diagnostics-table th,
.diagnostics-table td {
  padding: 4px 12px;
}

.diagnostics-table tbody tr:last-child td {
  border-bottom: none;
}

.diagnostics-name {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.diagnostics-count {
  width: 96px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
