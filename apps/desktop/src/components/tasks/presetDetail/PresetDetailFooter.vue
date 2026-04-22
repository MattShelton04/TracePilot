<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";

defineProps<{ preset: TaskPreset }>();

defineEmits<{
  run: [preset: TaskPreset];
  duplicate: [preset: TaskPreset];
  edit: [preset: TaskPreset];
  delete: [preset: TaskPreset];
}>();
</script>

<template>
  <div class="detail-panel__footer">
    <button class="btn btn--accent btn--sm" @click="$emit('run', preset)">
      <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
        <path d="M4 2l10 6-10 6z" />
      </svg>
      Run Task
    </button>
    <button class="btn btn--secondary btn--sm" @click="$emit('duplicate', preset)">
      Duplicate
    </button>
    <button class="btn btn--secondary btn--sm" @click="$emit('edit', preset)">
      Edit
    </button>
    <button
      class="btn btn--ghost btn--sm"
      :disabled="preset.builtin"
      @click="$emit('delete', preset)"
    >
      Delete
    </button>
  </div>
</template>
