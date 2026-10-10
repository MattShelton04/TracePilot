<script setup lang="ts">
import { LoadingSpinner } from "@tracepilot/ui";
import { AlertCircle, CheckCircle2, CircleHelp, Sparkles } from "lucide-vue-next";
import type { UpdateState } from "@/composables/useUpdateStatus";

defineProps<{ state: UpdateState }>();
</script>

<template>
  <span class="update-status-icon" :class="`update-status-icon--${state}`" aria-hidden="true">
    <LoadingSpinner v-if="state === 'checking'" size="sm" color="currentColor" />
    <AlertCircle v-else-if="state === 'error'" :size="16" :stroke-width="2" />
    <Sparkles v-else-if="state === 'available'" :size="16" :stroke-width="2" />
    <CheckCircle2 v-else-if="state === 'current'" :size="16" :stroke-width="2" />
    <CircleHelp v-else :size="16" :stroke-width="2" />
  </span>
</template>

<style scoped>
.update-status-icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--neutral-subtle);
  color: var(--text-tertiary);
}

.update-status-icon--available {
  background: var(--accent-subtle);
  color: var(--accent-fg);
}

.update-status-icon--current {
  background: var(--success-subtle);
  color: var(--success-fg);
}

.update-status-icon--error {
  background: var(--danger-subtle);
  color: var(--danger-fg);
}
</style>
