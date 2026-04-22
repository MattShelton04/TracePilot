<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";
import PresetDetailSection from "./PresetDetailSection.vue";

defineProps<{ preset: TaskPreset; expanded: boolean }>();

defineEmits<{ toggle: [] }>();
</script>

<template>
  <PresetDetailSection title="📄 Context Sources" :expanded="expanded" @toggle="$emit('toggle')">
    <div
      v-for="(src, idx) in preset.context.sources"
      :key="idx"
      class="detail-source-card"
    >
      <span class="detail-source-type">{{ src.type }}</span>
      <span v-if="src.label" class="detail-source-label">{{ src.label }}</span>
      <span v-if="src.required" class="detail-required-dot" title="Required" />
    </div>
    <div
      v-if="preset.context.sources.length === 0"
      class="detail-empty-hint"
    >
      No context sources configured
    </div>
    <div class="detail-budget">
      Max {{ preset.context.maxChars.toLocaleString() }} chars ·
      {{ preset.context.format }} format
    </div>
  </PresetDetailSection>
</template>
