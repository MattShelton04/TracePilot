<script setup lang="ts">
import type { ShutdownMetrics } from "@tracepilot/types";
import { SectionPanel, StatCard } from "@tracepilot/ui";
import { computed, ref } from "vue";
import { useClientPager } from "@/composables/useClientPager";

const props = defineProps<{
  metrics: ShutdownMetrics;
}>();
const query = ref("");
const files = computed(() => props.metrics.codeChanges?.filesModified ?? []);
const filteredFiles = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  return search
    ? files.value.filter((file) => file.toLocaleLowerCase().includes(search))
    : files.value;
});
const PAGE_SIZE = 20;
const { page, pageCount, pageRows } = useClientPager(filteredFiles, PAGE_SIZE, [query]);
</script>

<template>
  <SectionPanel v-if="metrics.codeChanges" title="Code Changes" class="mb-6">
    <div class="grid-3 mb-4">
      <StatCard :value="metrics.codeChanges.filesModified?.length ?? 0" label="Files Modified" color="accent" />
      <StatCard :value="`+${metrics.codeChanges.linesAdded ?? 0}`" label="Lines Added" color="success" />
      <StatCard :value="`−${metrics.codeChanges.linesRemoved ?? 0}`" label="Lines Removed" color="danger" />
    </div>
    <template v-if="files.length">
      <div class="files-toolbar">
        <input v-model="query" type="search" class="form-input" aria-label="Filter modified files" placeholder="Filter files by path…" />
        <span class="text-xs text-[var(--text-tertiary)]">{{ filteredFiles.length }} of {{ files.length }} files</span>
      </div>
      <div class="files-list" tabindex="0" role="region" aria-label="Modified files">
      <table class="data-table files-table" aria-label="Modified files">
        <thead>
          <tr>
            <th>File</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="file in pageRows" :key="file">
            <td class="font-mono text-xs text-[var(--text-secondary)]">{{ file }}</td>
          </tr>
          <tr v-if="!filteredFiles.length"><td>No files match this path.</td></tr>
        </tbody>
      </table>
      </div>
      <nav v-if="pageCount > 1" class="files-pagination" aria-label="Modified files pages">
        <button class="btn btn-secondary" :disabled="page === 0" @click="page--">Previous files</button>
        <span class="text-xs">{{ page + 1 }} / {{ pageCount }}</span>
        <button class="btn btn-secondary" :disabled="page + 1 >= pageCount" @click="page++">Next files</button>
      </nav>
    </template>
  </SectionPanel>
</template>

<style scoped>
.files-toolbar,
.files-pagination {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.files-toolbar { margin-bottom: 12px; }
.files-toolbar input { flex: 1; min-width: 160px; max-width: 400px; }
.files-pagination { margin-top: 12px; }
.files-list {
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}
.files-table { table-layout: fixed; width: 100%; }
.files-table td { overflow-wrap: anywhere; white-space: normal; }
</style>
