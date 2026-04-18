<script setup lang="ts">
import { LoadingSpinner, SectionPanel } from "@tracepilot/ui";
import type { TaskWizard } from "@/composables/useTaskWizard";

defineProps<{
  wizard: TaskWizard;
}>();
</script>

<template>
  <div class="step-content">
    <SectionPanel title="Review Configuration">
      <div class="review-section">
        <h3 class="review-heading">Preset</h3>
        <div class="review-row">
          <span class="review-label">Name</span>
          <span class="review-value">{{ wizard.selectedPreset?.name }}</span>
        </div>
        <div class="review-row">
          <span class="review-label">Description</span>
          <span class="review-value review-value--muted">
            {{ wizard.selectedPreset?.description }}
          </span>
        </div>
      </div>

      <div class="review-section">
        <h3 class="review-heading">Context</h3>
        <div class="review-row">
          <span class="review-label">Sources</span>
          <span class="review-value">{{ wizard.contextSummary }}</span>
        </div>
        <div v-if="wizard.estimatedTokenBudget" class="review-row">
          <span class="review-label">Token Budget</span>
          <span class="review-value">
            ~{{ wizard.estimatedTokenBudget.toLocaleString() }} tokens
          </span>
        </div>
      </div>

      <div v-if="wizard.variables.length > 0" class="review-section">
        <h3 class="review-heading">Parameters</h3>
        <div v-for="variable in wizard.variables" :key="variable.name" class="review-row">
          <span class="review-label">{{ wizard.formatVariableLabel(variable.name) }}</span>
          <span
            :class="[
              'review-value',
              { 'review-value--muted': wizard.displayValue(variable) === '—' },
            ]"
          >
            {{ wizard.displayValue(variable) }}
          </span>
        </div>
      </div>

      <div class="review-section">
        <h3 class="review-heading">Execution</h3>
        <div class="review-row">
          <span class="review-label">Priority</span>
          <span :class="['review-value', `priority--${wizard.priority}`]">
            {{ wizard.priority }}
          </span>
        </div>
        <div class="review-row">
          <span class="review-label">Max Retries</span>
          <span class="review-value">{{ wizard.maxRetries }}</span>
        </div>
        <div v-if="wizard.selectedPreset?.execution.modelOverride" class="review-row">
          <span class="review-label">Model Override</span>
          <span class="review-value font-mono">
            {{ wizard.selectedPreset.execution.modelOverride }}
          </span>
        </div>
        <div class="review-row">
          <span class="review-label">Timeout</span>
          <span class="review-value">
            {{ wizard.selectedPreset?.execution.timeoutSeconds }}s
          </span>
        </div>
      </div>

      <div class="review-section">
        <button
          class="review-heading review-heading--toggle"
          @click="wizard.promptTemplateExpanded = !wizard.promptTemplateExpanded"
        >
          Prompt Template
          <span class="toggle-chevron">
            {{ wizard.promptTemplateExpanded ? "▾" : "▸" }}
          </span>
        </button>
        <pre v-if="wizard.promptTemplateExpanded" class="prompt-template">{{
          wizard.selectedPreset?.prompt.user
        }}</pre>
      </div>
    </SectionPanel>

    <div class="wizard-nav">
      <button class="nav-btn nav-btn--secondary" @click="wizard.goBack()">
        ← Back
      </button>
      <div class="wizard-nav-actions">
        <button
          class="nav-btn nav-btn--secondary"
          :disabled="wizard.submitting"
          @click="wizard.handleSubmit(true)"
        >
          {{ wizard.submitting ? "Creating…" : "Create & View" }}
        </button>
        <button
          class="nav-btn nav-btn--primary nav-btn--submit"
          :disabled="wizard.submitting"
          @click="wizard.handleSubmit(false)"
        >
          <LoadingSpinner v-if="wizard.submitting" size="sm" color="var(--text-on-emphasis)" />
          <span v-else>🚀</span>
          {{ wizard.submitting ? "Creating…" : "Create Task" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-content {
  display: block;
}

.review-section {
  margin-bottom: 20px;
}

.review-section:last-child {
  margin-bottom: 0;
}

.review-heading {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-placeholder);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-subtle);
}

.review-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 6px 0;
  gap: 16px;
}

.review-label {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.review-value {
  font-size: 0.8125rem;
  color: var(--text-primary);
  text-align: right;
  word-break: break-word;
  min-width: 0;
}

.review-value--muted {
  color: var(--text-placeholder);
}

.priority--low {
  color: var(--text-tertiary);
}

.priority--normal {
  color: var(--text-secondary);
}

.priority--high {
  color: var(--warning-fg);
}

.priority--critical {
  color: var(--danger-fg);
  font-weight: 600;
}

.review-heading--toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: none;
  cursor: pointer;
  font-family: inherit;
}

.toggle-chevron {
  font-size: 0.75rem;
  color: var(--text-placeholder);
}

.prompt-template {
  font-family: var(--font-mono, monospace);
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--text-secondary);
  background: var(--canvas-default);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 12px 14px;
  margin: 10px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
}

.wizard-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border-subtle);
}

.wizard-nav-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  font-size: 0.8125rem;
  font-weight: 500;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  border: 1px solid transparent;
}

.nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.nav-btn--secondary {
  color: var(--text-secondary);
  background: var(--canvas-subtle);
  border-color: var(--border-default);
}

.nav-btn--secondary:hover:not(:disabled) {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.nav-btn--primary {
  color: var(--text-on-emphasis);
  background: var(--accent-emphasis);
  border-color: var(--accent-emphasis);
}

.nav-btn--primary:hover:not(:disabled) {
  background: var(--accent-emphasis-hover);
}

.nav-btn--submit {
  padding: 8px 24px;
}
</style>
