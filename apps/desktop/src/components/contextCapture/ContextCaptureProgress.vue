<script setup lang="ts">
import type { CaptureProgress } from "@tracepilot/types";
import { ActionButton, LoadingSpinner, ModalDialog, ProgressBar } from "@tracepilot/ui";

defineProps<{ visible: boolean; progress: CaptureProgress | null }>();
const emit = defineEmits<{ cancel: [] }>();
const stages = [
  "preflight",
  "copyingSession",
  "startingListener",
  "resumingClone",
  "waitingForRequest",
  "parsingSnapshot",
  "savingSnapshot",
  "cleaningUp",
  "complete",
];
</script>

<template>
  <ModalDialog :visible="visible" title="Capturing isolated request">
    <div class="capture-progress">
      <LoadingSpinner size="lg" />
      <strong>{{ progress?.message ?? 'Preparing capture…' }}</strong>
      <ProgressBar
        v-if="progress?.stage === 'copyingSession' && progress.totalBytes"
        :percent="((progress.bytesCopied ?? 0) / progress.totalBytes) * 100"
        aria-label="Session copy progress"
      />
      <ol>
        <li v-for="stage in stages" :key="stage" :class="{ active: progress?.stage === stage }">
          {{ stage.replace(/([A-Z])/g, ' $1') }}
        </li>
      </ol>
      <p>No request is forwarded to a model provider.</p>
    </div>
    <template #footer>
      <ActionButton :disabled="progress?.cancellable === false" @click="emit('cancel')">Cancel</ActionButton>
    </template>
  </ModalDialog>
</template>

<style scoped>
.capture-progress { display: grid; justify-items: center; gap: 14px; min-width: 460px; }
ol { width: 100%; columns: 2; color: var(--text-tertiary); text-transform: capitalize; }
li.active { color: var(--accent-fg); font-weight: 600; }
p { color: var(--text-tertiary); margin: 0; }
</style>
