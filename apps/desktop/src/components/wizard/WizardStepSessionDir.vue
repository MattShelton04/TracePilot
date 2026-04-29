<script setup lang="ts">
import type { ValidateSessionDirResult } from "@tracepilot/client";
import { COPILOT_HOME_PLACEHOLDER } from "@tracepilot/types";

defineProps<{
  copilotHome: string;
  sessionDir: string;
  defaultCopilotHome: string;
  defaultSessionDir: string;
  validating: boolean;
  validationResult: ValidateSessionDirResult | null;
  validationError: string;
  canContinue: boolean;
}>();

const emit = defineEmits<{
  next: [];
  "update:copilotHome": [value: string];
  validate: [];
  browse: [];
  reset: [];
}>();
</script>

<template>
  <div class="slide">
    <div class="slide-content slide-form">
      <div class="form-icon">📂</div>
      <h2 class="slide-title" tabindex="-1">Where is your Copilot home?</h2>
      <p class="slide-desc">
        TracePilot derives your sessions directory from Copilot home, then reads that data to generate analytics.
      </p>

      <div class="path-input-group">
        <input
          :value="copilotHome"
          type="text"
          class="path-input"
          :placeholder="COPILOT_HOME_PLACEHOLDER"
          spellcheck="false"
          @input="emit('update:copilotHome', ($event.target as HTMLInputElement).value)"
          @blur="emit('validate')"
          @keydown.enter.prevent="emit('validate')"
        />
        <button class="btn-browse" @click="emit('browse')">Browse…</button>
        <button
          v-if="copilotHome !== defaultCopilotHome"
          class="btn-reset-path"
          title="Reset to default"
          aria-label="Reset Copilot home to default"
          @click="emit('reset')"
        >↺</button>
      </div>
      <div class="derived-path">
        Sessions: <span>{{ sessionDir || defaultSessionDir }}</span>
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

<style scoped src="./wizard-shared.css"></style>
<style scoped src="./wizard-form.css"></style>

<style scoped>
.validation-area {
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.validation-msg {
  font-size: 0.8125rem;
  display: flex;
  align-items: center;
  gap: 6px;
}

.validation-msg.success { color: var(--success-fg); }
.validation-msg.warning { color: var(--warning-fg); }
.validation-msg.error { color: var(--danger-fg); }
.validation-msg.validating { color: var(--text-tertiary); }

.derived-path {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-family: 'JetBrains Mono', monospace;
  max-width: 560px;
  overflow-wrap: anywhere;
}

.derived-path span {
  color: var(--text-secondary);
}
</style>
