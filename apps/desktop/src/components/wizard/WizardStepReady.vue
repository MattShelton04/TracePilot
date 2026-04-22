<script setup lang="ts">
defineProps<{
  active: boolean;
  sessionDir: string;
  dbPath: string;
  sessionCount: number;
  saving: boolean;
  setupError: string;
}>();

const emit = defineEmits<{
  finish: [];
}>();
</script>

<template>
  <div class="slide">
    <div class="slide-content slide-ready">
      <div class="checkmark-wrapper" :class="{ 'animate-check': active }">
        <svg class="checkmark-svg" viewBox="0 0 52 52">
          <circle
            class="checkmark-circle"
            cx="26"
            cy="26"
            r="24"
            fill="none"
            stroke-width="2"
          />
          <path
            class="checkmark-path"
            d="M15 26l7 7 15-15"
            fill="none"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>

      <h2 class="slide-title" tabindex="-1">You're Ready!</h2>
      <p class="slide-desc">Here's a summary of your configuration</p>

      <div class="config-summary">
        <div class="summary-row">
          <span class="summary-icon">📂</span>
          <div class="summary-text">
            <span class="summary-label">Sessions ({{ sessionCount }})</span>
            <span class="summary-value">{{ sessionDir }}</span>
          </div>
        </div>
        <div class="summary-row">
          <span class="summary-icon">🗄️</span>
          <div class="summary-text">
            <span class="summary-label">Database</span>
            <span class="summary-value">{{ dbPath }}</span>
          </div>
        </div>
      </div>

      <button class="btn-accent btn-lg btn-glow" :disabled="saving" @click="emit('finish')">
        <span v-if="saving" class="btn-loading">
          <span class="spinner spinner-white" />
          <span>Saving configuration…</span>
        </span>
        <span v-else>Launch TracePilot</span>
      </button>
      <p v-if="setupError" class="setup-error" role="alert">
        ⚠ Setup failed: {{ setupError }}. Please try again.
      </p>
      <p class="ready-footer">Change these anytime in Settings → Data &amp; Storage</p>
    </div>
  </div>
</template>

<style scoped src="./wizard-shared.css"></style>

<style scoped>
.checkmark-wrapper {
  width: 72px;
  height: 72px;
}

.checkmark-svg {
  width: 100%;
  height: 100%;
}

.checkmark-circle {
  stroke: var(--success-fg);
  opacity: 0.2;
}

.checkmark-path {
  stroke: var(--success-fg);
  stroke-dasharray: 48;
  stroke-dashoffset: 48;
}

.checkmark-wrapper.animate-check {
  animation: checkScale 500ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.checkmark-wrapper.animate-check .checkmark-path {
  animation: checkDraw 500ms 300ms ease forwards;
}

@keyframes checkScale {
  0% { transform: scale(0); }
  60% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

@keyframes checkDraw {
  to { stroke-dashoffset: 0; }
}

.slide-desc {
  font-size: 0.875rem;
  color: var(--text-secondary, #a1a1aa);
  line-height: 1.5;
  max-width: 440px;
}

.config-summary {
  width: 100%;
  max-width: 440px;
  background: var(--canvas-subtle, #111113);
  border: 1px solid var(--border-muted, rgba(255, 255, 255, 0.06));
  border-radius: var(--radius-lg, 10px);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.summary-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.summary-icon {
  font-size: 18px;
  line-height: 1.4;
}

.summary-text {
  display: flex;
  flex-direction: column;
  text-align: left;
}

.summary-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary, #71717a);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.summary-value {
  font-size: 0.8125rem;
  color: var(--text-secondary, #a1a1aa);
  font-family: 'JetBrains Mono', monospace;
  word-break: break-all;
}

.ready-footer {
  font-size: 0.75rem;
  color: var(--text-placeholder, #52525b);
}

.setup-error {
  color: var(--danger-fg);
  font-size: 0.85rem;
  font-weight: 500;
  margin: 0.5rem 0;
}

@media (prefers-reduced-motion: reduce) {
  .checkmark-wrapper.animate-check { animation: none; transform: scale(1); }
  .checkmark-wrapper.animate-check .checkmark-path { animation: none; stroke-dashoffset: 0; }
}
</style>
