<script setup lang="ts">
import { ErrorState, LoadingSpinner, PageShell } from "@tracepilot/ui";
import WizardStep1Preset from "@/components/tasks/wizard/WizardStep1Preset.vue";
import WizardStep2Variables from "@/components/tasks/wizard/WizardStep2Variables.vue";
import WizardStep3Submit from "@/components/tasks/wizard/WizardStep3Submit.vue";
import { useTaskWizard, WIZARD_STEPS } from "@/composables/useTaskWizard";

const wizard = useTaskWizard();
</script>

<template>
  <PageShell>
    <!-- Header -->
    <div class="wizard-header">
      <button class="back-btn" title="Go back" @click="wizard.goBack()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path
            d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75
               0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 1.06L4.56
               7.25h7.69a.75.75 0 0 1 0 1.5H4.56l3.22 3.22a.75.75
               0 0 1 0 1.06z"
          />
        </svg>
      </button>
      <h1 class="wizard-title">Create Task</h1>
    </div>

    <!-- Step indicator -->
    <div class="step-indicator">
      <template v-for="(step, idx) in WIZARD_STEPS" :key="step.number">
        <button
          :class="[
            'step-dot-group',
            {
              active: wizard.currentStep === step.number,
              completed: wizard.currentStep > step.number,
              clickable:
                step.number < wizard.currentStep && step.number <= wizard.highestStep,
            },
          ]"
          :disabled="step.number >= wizard.currentStep || step.number > wizard.highestStep"
          @click="wizard.goToStep(step.number)"
        >
          <div class="step-dot">
            <svg
              v-if="wizard.currentStep > step.number"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path
                d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25
                   7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75
                   0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75
                   0 0 1 1.06 0z"
              />
            </svg>
            <span v-else>{{ step.number }}</span>
          </div>
          <span class="step-label">{{ step.label }}</span>
        </button>
        <div
          v-if="idx < WIZARD_STEPS.length - 1"
          :class="['step-connector', { filled: wizard.currentStep > step.number }]"
        />
      </template>
    </div>

    <!-- Loading -->
    <div v-if="wizard.presetsLoading" class="wizard-loading">
      <LoadingSpinner size="md" />
      <span>Loading presets…</span>
    </div>

    <!-- Error -->
    <ErrorState
      v-else-if="wizard.presetsError"
      heading="Failed to load presets"
      :message="wizard.presetsError"
      @retry="wizard.reloadPresets()"
    />

    <!-- Step content -->
    <template v-else>
      <Transition name="step-fade" mode="out-in">
        <WizardStep1Preset v-if="wizard.currentStep === 1" key="step-1" :wizard="wizard" />
      </Transition>
      <Transition name="step-fade" mode="out-in">
        <WizardStep2Variables
          v-if="wizard.currentStep === 2"
          key="step-2"
          :wizard="wizard"
        />
      </Transition>
      <Transition name="step-fade" mode="out-in">
        <WizardStep3Submit v-if="wizard.currentStep === 3" key="step-3" :wizard="wizard" />
      </Transition>
    </template>
  </PageShell>
</template>

<style scoped>
/* ── Header ──────────────────────────────────────────────────────────── */
.wizard-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.back-btn:hover {
  background: var(--neutral-subtle);
  color: var(--text-primary);
  border-color: var(--border-accent);
}

.wizard-title {
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

/* ── Step indicator ──────────────────────────────────────────────────── */
.step-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  margin-bottom: 32px;
  padding: 16px 20px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
}

.step-dot-group {
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: none;
  padding: 0;
  font-family: inherit;
}

.step-dot-group:disabled {
  cursor: default;
}

.step-dot-group.clickable {
  cursor: pointer;
}

.step-dot-group.clickable:hover .step-dot {
  border-color: var(--accent-fg);
  box-shadow: 0 0 0 2px var(--accent-subtle);
}

.step-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  border: 2px solid var(--border-default);
  background: var(--canvas-default);
  color: var(--text-placeholder);
  transition: all var(--transition-normal);
  flex-shrink: 0;
}

.step-dot-group.active .step-dot {
  border-color: var(--accent-fg);
  background: var(--accent-subtle);
  color: var(--accent-fg);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.step-dot-group.completed .step-dot {
  border-color: var(--success-fg);
  background: var(--success-subtle);
  color: var(--success-fg);
}

.step-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-placeholder);
  transition: color var(--transition-fast);
  white-space: nowrap;
}

.step-dot-group.active .step-label {
  color: var(--text-primary);
}

.step-dot-group.completed .step-label {
  color: var(--success-fg);
}

.step-connector {
  flex: 1;
  height: 2px;
  background: var(--border-default);
  margin: 0 12px;
  min-width: 24px;
  max-width: 80px;
  border-radius: 1px;
  transition: background var(--transition-normal);
}

.step-connector.filled {
  background: var(--success-fg);
}

/* ── Loading ─────────────────────────────────────────────────────────── */
.wizard-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--text-tertiary);
  font-size: 0.8125rem;
}

/* ── Step transitions ────────────────────────────────────────────────── */
.step-fade-enter-active,
.step-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.step-fade-enter-from {
  opacity: 0;
  transform: translateX(12px);
}

.step-fade-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

/* ── Responsive ──────────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .step-label {
    display: none;
  }

  .step-connector {
    min-width: 16px;
    margin: 0 6px;
  }
}
</style>
