<script setup lang="ts">
/** Overview: the session's plan, when it wrote one. */
import { MarkdownContent, SectionPanel } from "@tracepilot/ui";
import { ref } from "vue";
import { useOverviewModel } from "./overviewModel";

const { store, anchor } = useOverviewModel();
const root = anchor("plan");
const isPlanExpanded = ref(true);
</script>

<template>
  <div v-if="store.plan" ref="root" class="overview-anchor">
  <SectionPanel
    title="Session Plan"
    class="mb-6"
  >
    <template #actions>
      <button class="detail-toggle-btn" @click="isPlanExpanded = !isPlanExpanded">
        {{ isPlanExpanded ? 'Hide' : 'Show' }}
      </button>
    </template>
    <div v-if="isPlanExpanded" class="plan-content">
      <MarkdownContent :content="store.plan.content" />
    </div>
  </SectionPanel>
  </div>
</template>

<style scoped>
.detail-toggle-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 0.6875rem;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  transition: all 0.15s;
}

.detail-toggle-btn:hover {
  background: var(--surface-secondary);
  color: var(--text-primary);
}

.plan-content {
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--text-primary);
}
</style>
