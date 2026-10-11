<script setup lang="ts">
import type { ValidateSessionDirResult } from "@tracepilot/client";
import { COPILOT_HOME_PLACEHOLDER } from "@tracepilot/types";
import { FormSwitch } from "@tracepilot/ui";
import { AlertTriangle, FolderOpen } from "lucide-vue-next";

defineProps<{
  copilotHome: string;
  sessionDir: string;
  defaultCopilotHome: string;
  defaultSessionDir: string;
  validating: boolean;
  validationResult: ValidateSessionDirResult | null;
  validationError: string;
  canContinue: boolean;
  /** The default Claude Code folder, when it holds sessions; else null. The switch defaults on. */
  claudeCode: { dir: string; sessionCount: number } | null;
  includeClaudeCode: boolean;
}>();

const emit = defineEmits<{
  next: [];
  "update:copilotHome": [value: string];
  validate: [];
  browse: [];
  reset: [];
  "update:includeClaudeCode": [value: boolean];
}>();
</script>

<template>
  <div class="slide">
    <div class="slide-content slide-form">
      <div class="form-icon" aria-hidden="true">
        <FolderOpen :size="40" :stroke-width="1.5" />
      </div>
      <h2 class="slide-title" tabindex="-1">Where is your Copilot home?</h2>
      <p class="slide-desc">
        TracePilot derives your sessions directory from Copilot home, then reads that data to generate analytics.
      </p>

      <div class="path-input-group">
        <input
          :value="copilotHome"
          type="text"
          class="path-input"
          aria-label="Copilot home directory"
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

      <div class="validation-area" role="status" aria-live="polite">
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
          <AlertTriangle :size="14" :stroke-width="1.5" aria-hidden="true" />
          No sessions found yet — TracePilot will watch for new sessions
        </div>
      </div>

      <div v-if="claudeCode" class="claude-option">
        <div class="claude-option-text">
          <div id="setup-claude-code-label" class="claude-option-label">
            Also index Claude Code sessions <span class="claude-option-tag">(experimental)</span>
          </div>
          <div class="claude-option-desc">
            Found {{ claudeCode.sessionCount }} Claude Code
            {{ claudeCode.sessionCount === 1 ? "session" : "sessions" }} in
            <span class="claude-option-path">{{ claudeCode.dir }}</span>. You can change this
            later in Settings → Claude Code. Claude Code deletes transcripts after 30 days by
            default.
          </div>
        </div>
        <FormSwitch
          :model-value="includeClaudeCode"
          aria-labelledby="setup-claude-code-label"
          @update:model-value="emit('update:includeClaudeCode', $event)"
        />
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

.claude-option {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  max-width: 480px;
  padding: 12px 16px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  text-align: left;
}

.claude-option-text {
  flex: 1;
  min-width: 0;
}

.claude-option-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.claude-option-tag {
  font-weight: 400;
  color: var(--warning-fg);
}

.claude-option-desc {
  margin-top: 4px;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--text-tertiary);
}

.claude-option-path {
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
</style>
