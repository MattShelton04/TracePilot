<script setup lang="ts">
import { ActionButton } from "@tracepilot/ui";
import { computed } from "vue";
import UpdateStatusIcon from "@/components/updates/UpdateStatusIcon.vue";
import { useUpdateCheck } from "@/composables/useUpdateCheck";
import { useUpdateStatus } from "@/composables/useUpdateStatus";

/**
 * Compact update check for the release notes dialog, sharing its state with
 * Settings → Updates. Installing hands off to the update dialog via `update`.
 */
const emit = defineEmits<{
  update: [];
  preview: [];
}>();

const { updateCheckLoading, runUpdateCheck } = useUpdateCheck();
const { latest, state, headline, detail } = useUpdateStatus();

const checkLabel = computed(() =>
  state.value === "unknown" ? "Check for updates" : "Check again",
);
</script>

<template>
  <section
    class="update-panel"
    :class="`update-panel--${state}`"
    aria-label="Updates"
    data-testid="update-status-panel"
  >
    <UpdateStatusIcon :state="state" />
    <div class="update-panel-text" role="status">
      <span class="update-panel-headline">{{ headline }}</span>
      <span v-if="detail" class="update-panel-detail">{{ detail }}</span>
    </div>
    <div class="update-panel-actions">
      <template v-if="state === 'available'">
        <ActionButton size="sm" @click="emit('preview')">Preview changes</ActionButton>
        <ActionButton size="sm" variant="primary" @click="emit('update')">
          Update to {{ latest }}
        </ActionButton>
      </template>
      <ActionButton v-else size="sm" :loading="updateCheckLoading" @click="runUpdateCheck(true)">
        {{ checkLabel }}
      </ActionButton>
    </div>
  </section>
</template>

<style scoped>
.update-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 12px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  transition:
    border-color var(--duration-normal) var(--ease-out),
    background-color var(--duration-normal) var(--ease-out);
}

.update-panel--available {
  border-color: var(--accent-muted);
}

.update-panel-text {
  display: flex;
  flex: 1 1 160px;
  flex-direction: column;
  min-width: 0;
  line-height: 1.5;
}

.update-panel-headline {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
}

.update-panel-detail {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  overflow-wrap: anywhere;
}

.update-panel--error .update-panel-detail {
  color: var(--danger-fg);
}

.update-panel-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  margin-left: auto;
}

@media (prefers-reduced-motion: reduce) {
  .update-panel {
    transition: none;
  }
}
</style>
