<script setup lang="ts">
import { useMcpServerDetailContext } from "@/composables/useMcpServerDetail";

const { server, statusColor, statusText, latencyDisplay, tokensFormatted } =
  useMcpServerDetailContext();
</script>

<template>
  <div v-if="server">
    <div class="config-section-title" style="margin-top: 4px">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 8h2l2-4 3 8 2-4h3"/></svg>
      Health
    </div>
    <div class="health-grid">
      <div class="health-stat">
        <div class="health-stat-label">Status</div>
        <div class="health-stat-value" :style="{ color: `var(--${statusColor}-fg)` }">
          {{ statusText }}
        </div>
      </div>
      <div class="health-stat">
        <div class="health-stat-label">Response</div>
        <div class="health-stat-value mono">
          <template v-if="latencyDisplay != null">
            <span class="success-text">{{ latencyDisplay }}</span><span class="unit">ms</span>
          </template>
          <template v-else>—</template>
        </div>
      </div>
      <div class="health-stat">
        <div class="health-stat-label">Tools</div>
        <div class="health-stat-value">
          {{ server.tools.length }}<span class="unit"> total</span>
        </div>
      </div>
      <div class="health-stat">
        <div class="health-stat-label">Context Cost</div>
        <div class="health-stat-value mono" style="color: var(--accent-fg)">
          {{ tokensFormatted }}<span class="unit"> tok</span>
        </div>
      </div>
    </div>

    <div v-if="server.health?.errorMessage" class="health-error">
      <span class="health-error-label">Error</span>
      <code class="health-error-message">{{ server.health.errorMessage }}</code>
    </div>
  </div>
</template>
