<script setup lang="ts">
import type { ShutdownMetrics } from "@tracepilot/types";
import { SectionPanel, StatCard } from "@tracepilot/ui";

defineProps<{
  metrics: ShutdownMetrics;
}>();
</script>

<template>
  <SectionPanel v-if="metrics.codeChanges" title="Code Changes" class="mb-6">
    <div class="grid-3 mb-4">
      <StatCard :value="metrics.codeChanges.filesModified?.length ?? 0" label="Files Modified" color="accent" />
      <StatCard :value="`+${metrics.codeChanges.linesAdded ?? 0}`" label="Lines Added" color="success" />
      <StatCard :value="`−${metrics.codeChanges.linesRemoved ?? 0}`" label="Lines Removed" color="danger" />
    </div>
    <div v-if="metrics.codeChanges.filesModified?.length" class="section-panel">
      <table class="data-table" aria-label="Modified files">
        <thead>
          <tr>
            <th>File</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="file in metrics.codeChanges.filesModified" :key="file">
            <td class="font-mono text-xs text-[var(--text-secondary)]">{{ file }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </SectionPanel>
</template>
