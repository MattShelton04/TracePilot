<script setup lang="ts">
import { computed, watch } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";

const store = useSessionDetailStore();

watch(
  () => store.sessionId,
  (id) => {
    if (!id) {
      return;
    }

    void store.loadCheckpoints();
    void store.loadShutdownMetrics();
  },
  { immediate: true }
);

const detail = computed(() => store.detail);
const metrics = computed(() => store.shutdownMetrics);

function formatDate(dateStr?: string): string {
  if (!dateStr) {
    return "—";
  }

  return new Date(dateStr).toLocaleString();
}

function formatDuration(ms?: number): string {
  if (!ms) {
    return "—";
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }

  return `${seconds}s`;
}
</script>

<template>
  <div class="space-y-6">
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div class="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 class="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Session Info</h3>
        <dl class="space-y-2 text-sm">
          <div class="flex justify-between gap-4">
            <dt class="text-[var(--text-muted)]">ID</dt>
            <dd class="font-mono text-xs">{{ detail?.id }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-[var(--text-muted)]">Repository</dt>
            <dd class="text-[var(--accent)]">{{ detail?.repository || "—" }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-[var(--text-muted)]">Branch</dt>
            <dd class="text-[var(--success)]">{{ detail?.branch || "—" }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-[var(--text-muted)]">Working Directory</dt>
            <dd class="max-w-[250px] truncate font-mono text-xs" :title="detail?.cwd">
              {{ detail?.cwd || "—" }}
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-[var(--text-muted)]">Host Type</dt>
            <dd>{{ detail?.hostType || "—" }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-[var(--text-muted)]">Created</dt>
            <dd>{{ formatDate(detail?.createdAt) }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-[var(--text-muted)]">Updated</dt>
            <dd>{{ formatDate(detail?.updatedAt) }}</dd>
          </div>
        </dl>
      </div>

      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
            <div class="text-2xl font-bold text-[var(--accent)]">{{ detail?.eventCount ?? 0 }}</div>
            <div class="mt-1 text-xs text-[var(--text-muted)]">Events</div>
          </div>
          <div class="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
            <div class="text-2xl font-bold text-[var(--accent)]">{{ detail?.turnCount ?? 0 }}</div>
            <div class="mt-1 text-xs text-[var(--text-muted)]">Turns</div>
          </div>
          <div class="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
            <div class="text-2xl font-bold text-[var(--success)]">{{ detail?.checkpointCount ?? 0 }}</div>
            <div class="mt-1 text-xs text-[var(--text-muted)]">Checkpoints</div>
          </div>
          <div class="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
            <div class="text-2xl font-bold text-[var(--warning)]">
              {{ metrics?.totalPremiumRequests?.toFixed(1) ?? "—" }}
            </div>
            <div class="mt-1 text-xs text-[var(--text-muted)]">Premium Requests</div>
          </div>
        </div>

        <div class="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 class="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Session Summary</h3>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--text-muted)]">API Duration</span>
            <span>{{ formatDuration(metrics?.totalApiDurationMs) }}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--text-muted)]">Current Model</span>
            <span class="text-purple-400">{{ metrics?.currentModel ?? "—" }}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--text-muted)]">Shutdown Type</span>
            <span>{{ metrics?.shutdownType ?? "—" }}</span>
          </div>
          <div v-if="metrics?.codeChanges" class="flex justify-between text-sm">
            <span class="text-[var(--text-muted)]">Code Changes</span>
            <span>
              <span class="text-[var(--success)]">+{{ metrics.codeChanges.linesAdded ?? 0 }}</span>
              <span class="ml-1 text-[var(--error)]">-{{ metrics.codeChanges.linesRemoved ?? 0 }}</span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="store.checkpoints.length > 0"
      class="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h3 class="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Checkpoints ({{ store.checkpoints.length }})
      </h3>
      <div class="space-y-2">
        <div
          v-for="cp in store.checkpoints"
          :key="cp.number"
          class="flex items-start gap-3 rounded-md border border-[var(--border)] p-3 text-sm"
        >
          <span
            class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-xs font-bold text-[var(--accent)]"
          >
            {{ cp.number }}
          </span>
          <div class="min-w-0 flex-1">
            <div class="font-medium">{{ cp.title }}</div>
            <div class="font-mono text-xs text-[var(--text-muted)]">{{ cp.filename }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
