<script setup lang="ts">
defineProps<{
  stateLabel: string;
  stateColorClass: string;
  heartbeatDisplay: string;
  ringDasharray: string;
  isRunning: boolean;
  pid: number | null | undefined;
  uptimeDisplay: string | null;
  sessionUuid: string | null;
  needsRestart: boolean;
  error: string | null;
}>();

const emit = defineEmits<(e: "view-session") => void>();
</script>

<template>
  <section class="status-hero fade-section" style="--stagger: 1" aria-label="Orchestrator status">
    <div class="status-ring-container" :class="stateColorClass">
      <svg class="status-ring" width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border-default)" stroke-width="4" />
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke="var(--state-color)"
          stroke-width="4"
          stroke-linecap="round"
          :stroke-dasharray="ringDasharray"
          stroke-dashoffset="0"
          class="status-ring-progress"
        />
        <circle
          cx="60"
          cy="60"
          r="8"
          fill="var(--state-color)"
          class="status-ring-dot"
          :class="{ pulsing: isRunning }"
        />
      </svg>
    </div>
    <div class="status-info" :class="stateColorClass">
      <div class="status-label">{{ stateLabel }}</div>
      <div class="status-heartbeat">
        Last heartbeat: <strong>{{ heartbeatDisplay }}</strong>
      </div>
      <div class="hero-meta">
        <div v-if="pid" class="hero-meta-item">
          <span class="hero-meta-label">PID</span>
          <span class="hero-meta-value">{{ pid }}</span>
        </div>
        <div v-if="uptimeDisplay" class="hero-meta-item">
          <span class="hero-meta-label">Uptime</span>
          <span class="hero-meta-value">{{ uptimeDisplay }}</span>
        </div>
      </div>
      <div class="hero-actions">
        <button v-if="sessionUuid" class="session-hero-btn" @click="emit('view-session')">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path
              d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"
            />
          </svg>
          View Session
        </button>
      </div>
      <div v-if="needsRestart" class="needs-restart-badge">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path
            d="M8.22 1.754a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368L8.22 1.754zm-1.763-.707c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575L6.457 1.047zM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-.25-5.25a.75.75 0 0 0-1.5 0v2.5a.75.75 0 0 0 1.5 0v-2.5z"
          />
        </svg>
        Needs Restart
      </div>
      <div v-if="error" class="inline-error">
        {{ error }}
      </div>
    </div>
  </section>
</template>
