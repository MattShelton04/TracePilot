<script setup lang="ts">
import type { ValidateSessionDirResult } from '@tracepilot/types';

defineProps<{
  sessionDir: string;
  defaultSessionDir: string;
  validating: boolean;
  validationResult: ValidateSessionDirResult | null;
  validationError: string;
  canContinue: boolean;
}>();

const emit = defineEmits<{
  next: [];
  'update:sessionDir': [value: string];
  validate: [];
  browse: [];
  reset: [];
}>();
</script>

<template>
  <div class="slide">
    <div class="slide-content slide-form">
      <div class="form-icon">📂</div>
      <h2 class="slide-title" tabindex="-1">Where are your sessions?</h2>
      <p class="slide-desc">
        GitHub Copilot stores session data in a local directory.
        TracePilot reads this data to generate analytics.
      </p>

      <div class="path-input-group">
        <input
          :value="sessionDir"
          type="text"
          class="path-input"
          placeholder="~/.copilot/session-state"
          spellcheck="false"
          @input="emit('update:sessionDir', ($event.target as HTMLInputElement).value)"
          @blur="emit('validate')"
          @keydown.enter.prevent="emit('validate')"
        />
        <button class="btn-browse" @click="emit('browse')">Browse…</button>
        <button
          v-if="sessionDir !== defaultSessionDir"
          class="btn-reset-path"
          title="Reset to default"
          aria-label="Reset session directory to default"
          @click="emit('reset')"
        >↺</button>
      </div>

      <div class="validation-area">
        <div v-if="validating" class="validation-msg validating">
          <span class="spinner" />
          Checking directory…
        </div>
        <div v-else-if="validationError" class="validation-msg error">
          ✗ {{ validationError }}
        </div>
        <div
          v-else-if="validationResult?.valid && validationResult.sessionCount > 0"
          class="validation-msg success"
        >
          ✓ Found {{ validationResult.sessionCount }} sessions
        </div>
        <div
          v-else-if="validationResult && validationResult.sessionCount === 0"
          class="validation-msg warning"
        >
          ⚠ No sessions found yet — TracePilot will watch for new sessions
        </div>
      </div>

      <button
        class="btn-accent"
        :disabled="validating || !canContinue"
        @click="emit('next')"
      >
        Continue →
      </button>
    </div>
  </div>
</template>
