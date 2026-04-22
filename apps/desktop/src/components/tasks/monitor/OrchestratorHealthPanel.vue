<script setup lang="ts">
import { SectionPanel } from "@tracepilot/ui";

defineProps<{
  healthExpanded: boolean;
  healthStatus: string | null | undefined;
  needsRestart: boolean;
  error: string | null;
  truncateError: (err: string | null, len?: number) => string;
}>();

const emit = defineEmits<(e: "toggle") => void>();
</script>

<template>
  <SectionPanel title="Health &amp; Recovery" class="fade-section" style="--stagger: 7">
    <template #actions>
      <button class="collapse-toggle" @click="emit('toggle')">
        {{ healthExpanded ? "Collapse" : "Expand" }}
      </button>
    </template>
    <div class="health-summary">
      <div class="health-badge" :class="healthStatus ?? 'stopped'">
        <span class="health-dot" />
        {{ healthStatus ?? "unknown" }}
      </div>
      <span v-if="error" class="health-error-inline">
        {{ truncateError(error, 50) }}
      </span>
    </div>
    <div v-if="healthExpanded" class="health-grid">
      <div class="health-item">
        <span class="health-item-label">Needs Restart</span>
        <span class="health-item-value">{{ needsRestart ? "Yes" : "No" }}</span>
      </div>
      <div class="health-item">
        <span class="health-item-label">Last Error</span>
        <span class="health-item-value">{{ error ?? "None" }}</span>
      </div>
      <div class="health-item">
        <span class="health-item-label">Poll Interval</span>
        <span class="health-item-value">5 000 ms</span>
      </div>
      <div class="health-item">
        <span class="health-item-label">Stale Threshold</span>
        <span class="health-item-value">60 s</span>
      </div>
      <div class="health-policy">
        <strong>Recovery Policy:</strong> The orchestrator always starts a fresh Copilot session on launch —
        it never resumes a prior session. If the process is detected as stale or crashed, a full restart is
        triggered with a new session UUID.
      </div>
    </div>
  </SectionPanel>
</template>
