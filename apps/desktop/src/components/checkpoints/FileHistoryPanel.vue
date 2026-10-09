<script setup lang="ts">
/**
 * FileHistoryPanel — read-only rewind points from a source's file history
 * (Claude Code's `file-history-snapshot` records), on the checkpoint
 * timeline. Each point lists the tracked files as they were before its
 * prompt ran; a version's content is read only when the user opens it.
 * TracePilot never restores files.
 */
import type { FileCheckpoint } from "@tracepilot/client";
import type { CheckpointEntry } from "@tracepilot/types";
import { SectionPanel } from "@tracepilot/ui";
import { computed, ref } from "vue";
import { useFileVersion } from "@/composables/session/useFileVersion";
import CheckpointTimeline from "./CheckpointTimeline.vue";
import FileHistoryFiles from "./FileHistoryFiles.vue";

const props = defineProps<{
  checkpoints: FileCheckpoint[];
  sessionId: string | null;
}>();

const timelineRef = ref<InstanceType<typeof CheckpointTimeline> | null>(null);
const { openKey, content, loading, error, toggle } = useFileVersion(() => props.sessionId);

const byNumber = computed(() => new Map(props.checkpoints.map((cp) => [cp.number, cp])));

const entries = computed<CheckpointEntry[]>(() =>
  props.checkpoints.map((cp) => ({
    number: cp.number,
    title: cp.prompt ?? `Before prompt ${cp.number}`,
    filename: cp.messageId,
    content: undefined,
  })),
);
</script>

<template>
  <SectionPanel :title="`Checkpoints (${checkpoints.length})`">
    <template #actions>
      <button
        class="fh-toggle-all"
        @click="timelineRef?.allExpanded ? timelineRef?.collapseAll() : timelineRef?.expandAll()"
      >
        {{ timelineRef?.allExpanded ? "Collapse all" : "Expand all" }}
      </button>
    </template>
    <p class="fh-note">
      Files as they were before each prompt ran. Read-only: TracePilot never restores files.
    </p>
    <CheckpointTimeline ref="timelineRef" :checkpoints="entries">
      <template #body="{ checkpoint }">
        <FileHistoryFiles
          v-if="byNumber.get(checkpoint.number)"
          :checkpoint="byNumber.get(checkpoint.number)!"
          :open-key="openKey"
          :content="content"
          :loading="loading"
          :error="error"
          @toggle="toggle"
        />
      </template>
    </CheckpointTimeline>
  </SectionPanel>
</template>

<style scoped>
.fh-note {
  margin: 0 0 8px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.fh-toggle-all {
  padding: 2px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
}

.fh-toggle-all:hover {
  color: var(--text-primary);
  background: var(--surface-secondary);
}
</style>
