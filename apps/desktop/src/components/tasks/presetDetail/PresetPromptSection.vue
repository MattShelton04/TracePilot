<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";
import PresetDetailSection from "./PresetDetailSection.vue";

defineProps<{ preset: TaskPreset; expanded: boolean }>();

defineEmits<{ toggle: [] }>();
</script>

<template>
  <PresetDetailSection title="💬 Prompt" :expanded="expanded" @toggle="$emit('toggle')">
    <div v-if="preset.prompt.system" class="detail-prompt-block">
      <div class="detail-prompt-label">System</div>
      <pre class="detail-prompt-code">{{ preset.prompt.system }}</pre>
    </div>
    <div v-if="preset.prompt.user" class="detail-prompt-block">
      <div class="detail-prompt-label">User</div>
      <pre class="detail-prompt-code">{{ preset.prompt.user }}</pre>
    </div>
    <div
      v-if="!preset.prompt.system && !preset.prompt.user"
      class="detail-empty-hint"
    >
      No prompt template configured
    </div>
    <table
      v-if="preset.prompt.variables.length > 0"
      class="detail-var-table"
    >
      <thead>
        <tr>
          <th>Variable</th>
          <th>Type</th>
          <th>Required</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in preset.prompt.variables" :key="v.name">
          <td class="detail-var-name">{{ v.name }}</td>
          <td>
            <span class="detail-var-type">{{ v.type }}</span>
          </td>
          <td>
            <span
              v-if="v.required"
              class="detail-required-dot"
              title="Required"
            />
            <span v-else class="detail-optional-text">optional</span>
          </td>
        </tr>
      </tbody>
    </table>
  </PresetDetailSection>
</template>
