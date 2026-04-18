<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";

defineProps<{
  open: boolean;
  preset: TaskPreset | null;
}>();

defineEmits<{
  (e: "confirm"): void;
  (e: "cancel"): void;
}>();
</script>

<template>
  <div
    v-if="open"
    class="preset-modal-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Delete preset confirmation"
    tabindex="-1"
    @click.self="$emit('cancel')"
    @keydown.escape="$emit('cancel')"
  >
    <div class="preset-modal">
      <div class="preset-modal__header">
        <h3 class="preset-modal__title">Delete Preset</h3>
        <button class="preset-modal__close" @click="$emit('cancel')">✕</button>
      </div>
      <div class="preset-modal__body">
        <p class="preset-modal__confirm-text">
          Are you sure you want to delete
          <strong>{{ preset?.name }}</strong
          >? This action cannot be undone.
        </p>
      </div>
      <div class="preset-modal__footer">
        <button class="btn btn--secondary" @click="$emit('cancel')">Cancel</button>
        <button class="btn btn--danger" @click="$emit('confirm')">Delete</button>
      </div>
    </div>
  </div>
</template>
