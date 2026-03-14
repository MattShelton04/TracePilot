<script setup lang="ts">
import { computed, watch } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { StatCard, Badge } from "@tracepilot/ui";

const store = useSessionDetailStore();

watch(
  () => store.sessionId,
  (id) => {
    if (!id) return;
    void store.loadCheckpoints();
    void store.loadShutdownMetrics();
  },
  { immediate: true }
);

// Retry loading when detail finishes (guards against race with loadDetail clearing loaded set)
watch(
  () => store.detail,
  (d) => {
    if (!d) return;
    void store.loadCheckpoints();
    void store.loadShutdownMetrics();
  }
);

const detail = computed(() => store.detail);
const metrics = computed(() => store.shutdownMetrics);

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString();
}

function formatDuration(ms?: number): string {
  if (ms == null) return "—";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
</script>

<template>
  <div class="space-y-6">
    <!-- Stats row -->
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard :value="detail?.eventCount ?? 0" label="Events" color="accent" />
      <StatCard :value="detail?.turnCount ?? 0" label="Turns" color="accent" />
      <StatCard :value="detail?.checkpointCount ?? 0" label="Checkpoints" color="success" />
      <StatCard
        :value="metrics?.totalPremiumRequests?.toFixed(1) ?? '—'"
        label="Premium Requests"
        color="warning"
      />
    </div>

    <!-- Two-column layout -->
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- Session Info -->
      <div class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)] p-4">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
          Session Info
        </h3>
        <dl class="space-y-2.5 text-sm">
          <div class="flex justify-between gap-4">
            <dt class="text-[var(--color-text-secondary)]">ID</dt>
            <dd class="font-mono text-xs text-[var(--color-text-tertiary)] truncate max-w-[200px]" :title="detail?.id">{{ detail?.id }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-[var(--color-text-secondary)]">Repository</dt>
            <dd><Badge v-if="detail?.repository" variant="accent">{{ detail.repository }}</Badge><span v-else class="text-[var(--color-text-tertiary)]">—</span></dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-[var(--color-text-secondary)]">Branch</dt>
            <dd><Badge v-if="detail?.branch" variant="success">{{ detail.branch }}</Badge><span v-else class="text-[var(--color-text-tertiary)]">—</span></dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-[var(--color-text-secondary)]">Working Directory</dt>
            <dd class="max-w-[250px] truncate font-mono text-xs text-[var(--color-text-tertiary)]" :title="detail?.cwd">
              {{ detail?.cwd || "—" }}
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-[var(--color-text-secondary)]">Host Type</dt>
            <dd>{{ detail?.hostType || "—" }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-[var(--color-text-secondary)]">Created</dt>
            <dd class="text-[var(--color-text-secondary)]">{{ formatDate(detail?.createdAt) }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-[var(--color-text-secondary)]">Updated</dt>
            <dd class="text-[var(--color-text-secondary)]">{{ formatDate(detail?.updatedAt) }}</dd>
          </div>
        </dl>
      </div>

      <!-- Session Summary -->
      <div class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)] p-4">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
          Session Summary
        </h3>
        <dl class="space-y-2.5 text-sm">
          <div class="flex justify-between">
            <dt class="text-[var(--color-text-secondary)]">API Duration</dt>
            <dd>{{ formatDuration(metrics?.totalApiDurationMs) }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-[var(--color-text-secondary)]">Current Model</dt>
            <dd><Badge v-if="metrics?.currentModel" variant="done">{{ metrics.currentModel }}</Badge><span v-else class="text-[var(--color-text-tertiary)]">—</span></dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-[var(--color-text-secondary)]">Shutdown Type</dt>
            <dd>{{ metrics?.shutdownType ?? "—" }}</dd>
          </div>
          <div v-if="metrics?.codeChanges" class="flex justify-between">
            <dt class="text-[var(--color-text-secondary)]">Code Changes</dt>
            <dd class="flex gap-2">
              <span class="text-[var(--color-success-fg)]">+{{ metrics.codeChanges.linesAdded ?? 0 }}</span>
              <span class="text-[var(--color-danger-fg)]">-{{ metrics.codeChanges.linesRemoved ?? 0 }}</span>
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <!-- Checkpoints -->
    <div
      v-if="store.checkpoints.length > 0"
      class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)] p-4"
    >
      <h3 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
        Checkpoints ({{ store.checkpoints.length }})
      </h3>
      <div class="space-y-2">
        <div
          v-for="cp in store.checkpoints"
          :key="cp.number"
          class="flex items-start gap-3 rounded-md border border-[var(--color-border-muted)] bg-[var(--color-canvas-default)] p-3 text-sm"
        >
          <span
            class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-muted)] text-xs font-bold text-[var(--color-accent-fg)]"
          >
            {{ cp.number }}
          </span>
          <div class="min-w-0 flex-1">
            <div class="font-medium text-[var(--color-text-primary)]">{{ cp.title }}</div>
            <div class="font-mono text-xs text-[var(--color-text-tertiary)]">{{ cp.filename }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
