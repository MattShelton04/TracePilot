<script setup lang="ts">
import { useMcpServerDetailContext } from "@/composables/useMcpServerDetail";

const {
  editing,
  configToolFilters,
  configHeaders,
  envEntries,
  revealedKeys,
  toggleReveal,
} = useMcpServerDetailContext();
</script>

<template>
  <!-- Tool Filters (read-only, hidden while editing) -->
  <div v-if="configToolFilters.length > 0 && !editing" class="config-section">
    <div class="config-section-title">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 3h12l-5 6v4l-2 1V9L2 3z"/></svg>
      Tool Filters
    </div>
    <div class="config-card">
      <div class="config-row">
        <div class="config-label">Patterns</div>
        <div class="config-value">
          <div class="tag-list">
            <span v-for="pat in configToolFilters" :key="pat" class="tag tag-mono">{{ pat }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- HTTP Headers (read-only, hidden while editing) -->
  <div v-if="configHeaders.length > 0 && !editing" class="config-section">
    <div class="config-section-title">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h12M2 8h12M2 12h8"/></svg>
      HTTP Headers
    </div>
    <div class="config-card">
      <table class="env-table">
        <tr v-for="[key, value] in configHeaders" :key="key">
          <td><span class="env-key">{{ key }}</span></td>
          <td>
            <div class="env-value-wrap">
              <span class="env-value" :class="{ revealed: revealedKeys.has('h:' + key) }">
                {{ revealedKeys.has('h:' + key) ? value : "••••••••" }}
              </span>
              <button class="toggle-vis" title="Show/hide" @click="toggleReveal('h:' + key)">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
              </button>
            </div>
          </td>
        </tr>
      </table>
    </div>
  </div>

  <!-- Environment Variables (read-only, hidden while editing) -->
  <div v-if="envEntries.length > 0 && !editing" class="config-section">
    <div class="config-section-title">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 6h1m4 0h1M5 10h6"/></svg>
      Environment Variables
    </div>
    <div class="config-card">
      <table class="env-table">
        <tr v-for="[key, value] in envEntries" :key="key">
          <td><span class="env-key">{{ key }}</span></td>
          <td>
            <div class="env-value-wrap">
              <span class="env-value" :class="{ revealed: revealedKeys.has(key) }">
                {{ revealedKeys.has(key) ? value : "••••••••" }}
              </span>
              <button class="toggle-vis" title="Show/hide" @click="toggleReveal(key)">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
              </button>
            </div>
          </td>
        </tr>
      </table>
    </div>
  </div>
</template>
