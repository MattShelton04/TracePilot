<script setup lang="ts">
import { CheckCircle2, XCircle } from "lucide-vue-next";
import { useOrchestrationHomeStore } from "@/stores/orchestrationHome";

const store = useOrchestrationHomeStore();
</script>

<template>
  <div class="health-bar">
    <div class="health-item">
      <span class="health-label">Copilot CLI</span>
      <span class="health-val" :class="store.systemDeps?.copilotAvailable ? 'ok' : 'err'">
        <component
          :is="store.systemDeps?.copilotAvailable ? CheckCircle2 : XCircle"
          :size="14"
          :stroke-width="1.75"
          aria-hidden="true"
        />
        v{{ store.copilotVersionStr }}
      </span>
    </div>
    <span class="health-divider" />
    <div class="health-item">
      <span class="health-label">Git</span>
      <span class="health-val" :class="store.systemDeps?.gitAvailable ? 'ok' : 'err'">
        <component
          :is="store.systemDeps?.gitAvailable ? CheckCircle2 : XCircle"
          :size="14"
          :stroke-width="1.75"
          aria-hidden="true"
        />
        v{{ store.systemDeps?.gitVersion ?? 'N/A' }}
      </span>
    </div>
    <span class="health-divider" />
    <div class="health-item">
      <span class="health-label">Sessions</span>
      <span class="health-val" :class="store.activeSessions > 0 ? 'ok' : 'warn'">
        {{ store.activeSessions }} active
      </span>
    </div>
  </div>
</template>

<style scoped>
.health-bar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 14px 20px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
  font-size: 0.8125rem;
  margin-bottom: 12px;
}

.health-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.health-label {
  color: var(--text-secondary);
  font-weight: 500;
}

.health-val {
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.health-val.ok {
  color: var(--success-fg);
}

.health-val.warn {
  color: var(--warning-fg);
}

.health-val.err {
  color: var(--danger-fg);
}

.health-divider {
  width: 1px;
  height: 18px;
  background: var(--border-muted);
  flex-shrink: 0;
}
</style>
