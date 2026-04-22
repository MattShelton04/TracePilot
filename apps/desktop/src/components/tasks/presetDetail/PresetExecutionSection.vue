<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";
import PresetDetailSection from "./PresetDetailSection.vue";

defineProps<{ preset: TaskPreset; expanded: boolean }>();

defineEmits<{ toggle: [] }>();
</script>

<template>
  <PresetDetailSection title="⚡ Execution Config" :expanded="expanded" @toggle="$emit('toggle')">
    <div class="detail-kv-grid">
      <div class="detail-kv">
        <span class="detail-kv__label">Timeout</span>
        <span class="detail-kv__value">
          {{ preset.execution.timeoutSeconds }}s
        </span>
      </div>
      <div class="detail-kv">
        <span class="detail-kv__label">Max Retries</span>
        <span class="detail-kv__value">
          {{ preset.execution.maxRetries }}
        </span>
      </div>
      <div class="detail-kv">
        <span class="detail-kv__label">Priority</span>
        <span class="detail-kv__value">
          {{ preset.execution.priority }}
        </span>
      </div>
      <div class="detail-kv">
        <span class="detail-kv__label">Model</span>
        <span class="detail-kv__value">
          {{ preset.execution.modelOverride || "Default" }}
        </span>
      </div>
    </div>
  </PresetDetailSection>
</template>
