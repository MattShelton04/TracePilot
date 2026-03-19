<script setup lang="ts">
defineProps<{
  active: boolean;
  sessionDir: string;
  dbPath: string;
  autoIndex: boolean;
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
            <span class="summary-label">Sessions</span>
            <span class="summary-value">{{ sessionDir }} — {{ sessionCount }} sessions</span>
          </div>
        </div>
        <div class="summary-row">
          <span class="summary-icon">🗄️</span>
          <div class="summary-text">
            <span class="summary-label">Database</span>
            <span class="summary-value">{{ dbPath }}</span>
          </div>
        </div>
        <div class="summary-row">
          <span class="summary-icon">⚡</span>
          <div class="summary-text">
            <span class="summary-label">Auto-index</span>
            <span class="summary-value">{{ autoIndex ? 'Enabled' : 'Disabled' }}</span>
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
