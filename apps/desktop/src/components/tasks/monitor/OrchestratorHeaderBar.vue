<script setup lang="ts">
import RefreshToolbar from "@/components/RefreshToolbar.vue";
import type { OrchestratorMonitorModelTier } from "./types";

defineProps<{
  isStopped: boolean;
  starting: boolean;
  stopping: boolean;
  hasModels: boolean;
  selectedModel: string;
  selectedModelName: string;
  selectedModelTier: string;
  modelTiers: OrchestratorMonitorModelTier[];
  showModelPicker: boolean;
  modelDropdownStyle: Record<string, string>;
  refreshing: boolean;
  autoRefreshEnabled: boolean;
  autoRefreshInterval: number;
}>();

const emit = defineEmits<{
  (e: "toggle-model-picker"): void;
  (e: "close-model-picker"): void;
  (e: "select-model", id: string): void;
  (e: "start"): void;
  (e: "stop"): void;
  (e: "refresh"): void;
  (e: "update:autoRefreshEnabled", v: boolean): void;
  (e: "update:autoRefreshInterval", v: number): void;
}>();
</script>

<template>
  <div class="page-header fade-section" style="--stagger: 0">
    <h1 class="page-title">Orchestrator Monitor</h1>
    <div class="header-actions">
      <div v-if="isStopped && hasModels" class="model-picker">
        <button class="model-picker-toggle" @click="emit('toggle-model-picker')">
          <span class="model-picker-label">Model</span>
          <span class="model-picker-value">{{ selectedModelName }}</span>
          <span class="model-picker-tier" :class="'tier-' + selectedModelTier">{{ selectedModelTier }}</span>
          <svg class="model-picker-chevron" :class="{ open: showModelPicker }" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" />
          </svg>
        </button>
        <Teleport to="body">
          <div v-if="showModelPicker" class="orch-monitor-model-overlay" @click="emit('close-model-picker')" />
          <div v-if="showModelPicker" class="orch-monitor-model-dropdown" :style="modelDropdownStyle">
            <div class="model-picker-header">Select Model</div>
            <div v-for="tier in modelTiers" :key="tier.id" class="model-tier-group">
              <div class="model-tier-label">
                <span class="tier-badge" :class="'tier-' + tier.id">{{ tier.label }}</span>
                <span class="tier-desc">{{ tier.desc }}</span>
              </div>
              <button
                v-for="m in tier.models"
                :key="m.id"
                class="model-option"
                :class="{ active: m.id === selectedModel }"
                @click="emit('select-model', m.id)"
              >
                <span class="model-option-name">{{ m.name }}</span>
                <svg v-if="m.id === selectedModel" class="model-check" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M6.5 12l-4-4 1.4-1.4 2.6 2.6 5.6-5.6L13.5 5z" />
                </svg>
              </button>
            </div>
          </div>
        </Teleport>
      </div>
      <button
        v-if="isStopped"
        class="action-btn start-btn"
        :disabled="starting"
        @click="emit('start')"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4 2l10 6-10 6z" />
        </svg>
        {{ starting ? "Starting…" : "Start" }}
      </button>
      <button
        v-else
        class="action-btn stop-btn"
        :disabled="stopping"
        @click="emit('stop')"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <rect x="3" y="3" width="10" height="10" rx="1" />
        </svg>
        {{ stopping ? "Stopping…" : "Stop" }}
      </button>
      <RefreshToolbar
        :refreshing="refreshing"
        :auto-refresh-enabled="autoRefreshEnabled"
        :interval-seconds="autoRefreshInterval"
        @refresh="emit('refresh')"
        @update:auto-refresh-enabled="emit('update:autoRefreshEnabled', $event)"
        @update:interval-seconds="emit('update:autoRefreshInterval', $event)"
      />
    </div>
  </div>
</template>
