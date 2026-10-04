<script setup lang="ts">
/**
 * Reasoning effort section of the Metrics tab: the session's user turns per
 * model and effort, with what each took per turn.
 */
import type { SessionEffortUsage } from "@tracepilot/types";
import { SectionPanel, Tooltip } from "@tracepilot/ui";
import { Info } from "lucide-vue-next";
import EffortUsageTable from "@/components/effort/EffortUsageTable.vue";

defineProps<{ usage: SessionEffortUsage }>();
</script>

<template>
  <SectionPanel v-if="usage.entries.length" title="Reasoning Effort" class="mb-6">
    <template #actions>
      <Tooltip text="Each agent turn is one model request. Time / turn runs from the first agent turn to the last one ending.">
        <button type="button" aria-label="About reasoning effort figures" class="text-[var(--text-tertiary)]"><Info :size="14" /></button>
      </Tooltip>
    </template>
    <EffortUsageTable :entries="usage.entries" />
  </SectionPanel>
</template>
