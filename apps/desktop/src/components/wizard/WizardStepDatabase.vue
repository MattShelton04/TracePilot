<script setup lang="ts">
defineProps<{
  dbPath: string;
  defaultDbPath: string;
}>();

const emit = defineEmits<{
  next: [];
  "update:dbPath": [value: string];
  browse: [];
  reset: [];
}>();

function sanitizePath(raw: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally stripping control chars for path sanitization
  return raw.replace(/[\x00-\x1f]/g, "");
}

function onPathInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  emit("update:dbPath", sanitizePath(raw));
}
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
          @input="onPathInput"
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

      <p class="form-note">Will be created automatically.</p>

      <button class="btn-accent" @click="emit('next')">Continue →</button>
    </div>
  </div>
</template>
