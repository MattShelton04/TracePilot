<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";
import { formatDate } from "@tracepilot/ui";
import { infoLine, taskTypeColorClass } from "./presetDetailHelpers";

defineProps<{ preset: TaskPreset }>();

defineEmits<{ close: [] }>();
</script>

<template>
  <div class="detail-panel__header">
    <div class="detail-header__top">
      <div class="detail-header__left">
        <span
          class="badge badge--type"
          :class="taskTypeColorClass(preset.taskType)"
        >
          {{ preset.taskType }}
        </span>
        <span class="badge badge--version">v{{ preset.version ?? 1 }}</span>
        <span v-if="preset.builtin" class="badge badge--builtin">builtin</span>
      </div>
      <button class="detail-close" @click="$emit('close')" title="Close">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          width="14"
          height="14"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
    <h2 class="detail-header__name">{{ preset.name }}</h2>
    <p v-if="preset.description" class="detail-header__desc">
      {{ preset.description }}
    </p>
    <div v-if="preset.tags.length > 0" class="detail-header__tags">
      <span v-for="tag in preset.tags" :key="tag" class="tag-pill">
        {{ tag }}
      </span>
    </div>
    <div class="detail-header__info">
      <span class="meta-item">{{ infoLine(preset) }}</span>
      <span class="meta-item">Updated {{ formatDate(preset.updatedAt) }}</span>
    </div>
  </div>
</template>
