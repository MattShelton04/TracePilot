<script setup lang="ts">
/** Overview: the checkpoints the session wrote, as an expandable timeline. */
import { SectionPanel } from "@tracepilot/ui";
import { ref } from "vue";
import CheckpointTimeline from "@/components/checkpoints/CheckpointTimeline.vue";
import { useOverviewModel } from "./overviewModel";

const { store, anchor } = useOverviewModel();
const root = anchor("checkpoints");
const timelineRef = ref<InstanceType<typeof CheckpointTimeline> | null>(null);
</script>

<template>
  <div v-if="store.checkpoints.length > 0" ref="root" class="overview-anchor">
  <SectionPanel
    :title="`Checkpoints (${store.checkpoints.length})`"
    class="mb-6"
  >
    <template #actions>
      <button
        class="cp-toggle-all-btn"
        @click="timelineRef?.allExpanded ? timelineRef?.collapseAll() : timelineRef?.expandAll()"
      >
        {{ timelineRef?.allExpanded ? 'Collapse all' : 'Expand all' }}
      </button>
    </template>
    <CheckpointTimeline
      ref="timelineRef"
      :checkpoints="store.checkpoints"
      :focus-number="store.pendingCheckpointFocus"
      @update:focus-number="store.focusCheckpoint($event)"
    />
  </SectionPanel>
  </div>
</template>

<style scoped>
.cp-toggle-all-btn {
  background: none;
  border: none;
  color: var(--accent-fg);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: var(--radius-sm, 4px);
}

.cp-toggle-all-btn:hover {
  background: var(--surface-secondary);
}
</style>
