<script setup lang="ts">
import { FormSwitch } from '@tracepilot/ui';

defineProps<{
  dbPath: string;
  defaultDbPath: string;
  autoIndex: boolean;
}>();

const emit = defineEmits<{
  next: [];
  'update:dbPath': [value: string];
  'update:autoIndex': [value: boolean];
  browse: [];
  reset: [];
}>();
</script>

<template>
  <div class="slide">
    <div class="slide-content slide-form">
      <div class="form-icon">🗄️</div>
      <h2 class="slide-title" tabindex="-1">Where should we store analytics?</h2>
      <p class="slide-desc">
        TracePilot creates a local search index for fast queries.
        Choose where to store the database file.
      </p>

      <div class="path-input-group">
        <input
          :value="dbPath"
          type="text"
          class="path-input"
          placeholder="~/.copilot/tracepilot/index.db"
          spellcheck="false"
          @input="emit('update:dbPath', ($event.target as HTMLInputElement).value)"
        />
        <button class="btn-browse" @click="emit('browse')">Browse…</button>
        <button
          v-if="dbPath !== defaultDbPath"
          class="btn-reset-path"
          title="Reset to default"
          aria-label="Reset database path to default"
          @click="emit('reset')"
        >↺</button>
      </div>

      <p class="form-note">~2 MB per 100 sessions. Will be created automatically.</p>

      <div class="toggle-row">
        <FormSwitch
          :model-value="autoIndex"
          label="Auto-index sessions on launch"
          @update:model-value="emit('update:autoIndex', $event)"
        />
      </div>

      <button class="btn-accent" @click="emit('next')">Continue →</button>
    </div>
  </div>
</template>
