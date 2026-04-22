<script setup lang="ts">
import type { AddServerForm } from "./useAddServerForm";

defineProps<{ form: AddServerForm; showAdvanced: boolean }>();

defineEmits<{
  "update:showAdvanced": [value: boolean];
}>();
</script>

<template>
  <div class="form-group">
    <label class="form-label" for="add-description">Description <span class="form-label-optional">(optional)</span></label>
    <textarea
      id="add-description"
      v-model="form.description"
      class="form-textarea-modal"
      placeholder="Optional description"
      rows="2"
    />
  </div>

  <div class="form-group">
    <label class="form-label" for="add-tags">Tags <span class="form-label-optional">(comma-separated)</span></label>
    <input
      id="add-tags"
      v-model="form.tags"
      type="text"
      class="form-input-modal"
      placeholder="e.g., filesystem, code"
    />
  </div>

  <button
    class="advanced-toggle"
    :class="{ open: showAdvanced }"
    type="button"
    @click="$emit('update:showAdvanced', !showAdvanced)"
  >
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 4l4 4-4 4"/></svg>
    Advanced Options
  </button>

  <div v-if="showAdvanced" class="advanced-content">
    <div class="form-group">
      <label class="form-label">Working Directory <span class="form-label-optional">(optional)</span></label>
      <input
        v-model="form.workingDir"
        type="text"
        class="form-input-modal"
        placeholder="/path/to/project"
      />
    </div>
    <div class="form-group">
      <label class="form-label">Scope</label>
      <div class="scope-toggle">
        <button
          class="scope-option-btn"
          :class="{ active: form.scope === 'global' }"
          type="button"
          @click="form.scope = 'global'"
        >
          🌐 Global
        </button>
        <button
          class="scope-option-btn"
          :class="{ active: form.scope === 'project' }"
          type="button"
          @click="form.scope = 'project'"
        >
          📁 Project
        </button>
      </div>
    </div>
  </div>
</template>
