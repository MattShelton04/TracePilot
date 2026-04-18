<script setup lang="ts">
import { useMcpServerDetailContext } from "@/composables/useMcpServerDetail";

const { serverName, iconLetter, statusColor, statusDotClass, statusText } =
  useMcpServerDetailContext();
</script>

<template>
  <div class="detail-server-header">
    <div class="detail-server-icon">{{ iconLetter }}</div>
    <div class="server-meta">
      <div class="detail-server-name">{{ serverName }}</div>
      <div class="detail-badges">
        <span class="status-badge-detail" :style="{ color: `var(--${statusColor}-fg)` }">
          <span class="status-dot-sm" :class="statusDotClass" />
          {{ statusText }}
        </span>
      </div>
    </div>
  </div>
</template>
