<script setup lang="ts">
import { useMcpServerDetailContext } from "@/composables/useMcpServerDetail";

const { healthChecking, deleting, handleCheckHealth, handleExportJson, handleDelete } =
  useMcpServerDetailContext();
</script>

<template>
  <!-- Actions -->
  <div class="config-section">
    <div class="config-section-title">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 8h2l2-4 3 8 2-4h3"/></svg>
      Actions
    </div>
    <div class="actions-row">
      <button class="btn" :disabled="healthChecking" @click="handleCheckHealth">
        <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" :class="{ spinning: healthChecking }"><path d="M2 8h2l2-4 3 8 2-4h3"/></svg>
        {{ healthChecking ? "Testing…" : "Test Connection" }}
      </button>
      <button class="btn" @click="handleExportJson">
        <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 10v3h8v-3M8 2v8M5 5l3-3 3 3"/></svg>
        Export JSON
      </button>
    </div>
  </div>

  <!-- Danger Zone -->
  <div class="danger-zone">
    <div class="danger-zone-text">
      <div class="danger-zone-title">Remove Server</div>
      <div class="danger-zone-desc">
        This will remove the server configuration and disconnect all active sessions.
      </div>
    </div>
    <button class="btn btn-danger-action" :disabled="deleting" @click="handleDelete">
      <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5"/><path d="M3 4l1 9a2 2 0 002 2h4a2 2 0 002-2l1-9"/></svg>
      {{ deleting ? "Removing…" : "Remove" }}
    </button>
  </div>
</template>
