<script setup lang="ts">
import { TRACEPILOT_HOME_PLACEHOLDER } from "@tracepilot/types";

defineProps<{
  tracepilotHome: string;
  dbPath: string;
  defaultTracepilotHome: string;
}>();

const emit = defineEmits<{
  next: [];
  "update:tracepilotHome": [value: string];
  browse: [];
  reset: [];
}>();

function sanitizePath(raw: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally stripping control chars for path sanitization
  return raw.replace(/[\x00-\x1f]/g, "");
}

function onPathInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  emit("update:tracepilotHome", sanitizePath(raw));
}
</script>

<template>
  <div class="slide">
      <div class="slide-content slide-form">
        <div class="form-icon">🗄️</div>
        <h2 class="slide-title" tabindex="-1">Where should TracePilot store data?</h2>
        <p class="slide-desc">
          TracePilot keeps its local database, task data, presets, and backups
          in one app-owned directory.
        </p>

        <div class="path-input-group">
          <input
            :value="tracepilotHome"
            type="text"
            class="path-input"
            :placeholder="TRACEPILOT_HOME_PLACEHOLDER"
            spellcheck="false"
            @input="onPathInput"
          />
        <button class="btn-browse" @click="emit('browse')">Browse…</button>
        <button
          v-if="tracepilotHome !== defaultTracepilotHome"
          class="btn-reset-path"
          title="Reset to default"
          aria-label="Reset TracePilot data directory to default"
          @click="emit('reset')"
        >↺</button>
      </div>

      <p class="form-note">Database: <code>{{ dbPath }}</code></p>

      <button class="btn-accent" @click="emit('next')">Continue →</button>
    </div>
  </div>
</template>

<style scoped src="./wizard-shared.css"></style>
<style scoped src="./wizard-form.css"></style>

<style scoped>
.form-note {
  font-size: 0.75rem;
  color: var(--text-tertiary, #71717a);
  margin-top: -4px;
}
</style>
