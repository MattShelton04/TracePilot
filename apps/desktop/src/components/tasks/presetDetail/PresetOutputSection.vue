<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";
import PresetDetailSection from "./PresetDetailSection.vue";

defineProps<{ preset: TaskPreset; expanded: boolean }>();

defineEmits<{ toggle: [] }>();
</script>

<template>
  <PresetDetailSection title="📤 Output Config" :expanded="expanded" @toggle="$emit('toggle')">
    <div class="detail-kv-grid">
      <div class="detail-kv">
        <span class="detail-kv__label">Format</span>
        <span class="detail-kv__value">{{ preset.output.format }}</span>
      </div>
      <div class="detail-kv">
        <span class="detail-kv__label">Validation</span>
        <span class="detail-kv__value">{{ preset.output.validation }}</span>
      </div>
    </div>
    <div
      v-if="Object.keys(preset.output.schema).length > 0"
      class="detail-prompt-block"
    >
      <div class="detail-prompt-label">Schema</div>
      <pre class="detail-prompt-code">{{
        JSON.stringify(preset.output.schema, null, 2)
      }}</pre>
    </div>
  </PresetDetailSection>
</template>
