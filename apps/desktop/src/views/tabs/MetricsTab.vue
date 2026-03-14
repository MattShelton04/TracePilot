<script setup lang="ts">
import { computed, watch } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { StatCard, Badge } from "@tracepilot/ui";

const store = useSessionDetailStore();

watch(
  () => store.sessionId,
  (id) => {
    if (!id) return;
    void store.loadShutdownMetrics();
  },
  { immediate: true }
);

const metrics = computed(() => store.shutdownMetrics);

const modelEntries = computed(() => {
  if (!metrics.value?.modelMetrics) return [];
  return Object.entries(metrics.value.modelMetrics)
    .map(([name, data]) => ({
      name,
      requests: data.requests?.count ?? 0,
      cost: data.requests?.cost ?? 0,
      inputTokens: data.usage?.inputTokens ?? 0,
      outputTokens: data.usage?.outputTokens ?? 0,
      cacheReadTokens: data.usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: data.usage?.cacheWriteTokens ?? 0,
      totalTokens: (data.usage?.inputTokens ?? 0) + (data.usage?.outputTokens ?? 0),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
});

const totalTokens = computed(() => modelEntries.value.reduce((sum, m) => sum + m.totalTokens, 0));
const totalRequests = computed(() => modelEntries.value.reduce((sum, m) => sum + m.requests, 0));

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCost(c: number): string {
  return c > 0 ? c.toFixed(2) : "—";
}
</script>

<template>
  <div class="space-y-6">
    <div v-if="!metrics" class="py-12 text-center text-sm text-[var(--color-text-secondary)]">
      No shutdown metrics available for this session.
    </div>

    <template v-else>
      <!-- Summary stats -->
      <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard :value="formatNumber(totalTokens)" label="Total Tokens" color="accent" />
        <StatCard :value="totalRequests" label="Total Requests" color="accent" />
        <StatCard :value="metrics.totalPremiumRequests?.toFixed(1) ?? '—'" label="Premium Requests" color="warning" />
        <StatCard :value="modelEntries.length" label="Models Used" color="done" />
      </div>

      <!-- Model table -->
      <div v-if="modelEntries.length > 0" class="overflow-x-auto rounded-lg border border-[var(--color-border-default)]">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-[var(--color-canvas-subtle)] text-xs uppercase tracking-wider text-[var(--color-text-secondary)]">
              <th class="px-5 py-3 text-left font-medium">Model</th>
              <th class="px-5 py-3 text-right font-medium">Requests</th>
              <th class="px-5 py-3 text-right font-medium">Input</th>
              <th class="px-5 py-3 text-right font-medium">Output</th>
              <th class="px-5 py-3 text-right font-medium hidden lg:table-cell">Cache Read</th>
              <th class="px-5 py-3 text-right font-medium hidden lg:table-cell">Cache Write</th>
              <th class="px-5 py-3 text-right font-medium">Total</th>
              <th class="px-5 py-3 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="model in modelEntries"
              :key="model.name"
              class="border-t border-[var(--color-border-muted)] hover:bg-[var(--color-canvas-subtle)]"
            >
              <td class="px-5 py-3"><Badge variant="done">{{ model.name }}</Badge></td>
              <td class="px-5 py-3 text-right text-[var(--color-text-primary)]">{{ model.requests }}</td>
              <td class="px-5 py-3 text-right text-[var(--color-text-secondary)]">{{ formatNumber(model.inputTokens) }}</td>
              <td class="px-5 py-3 text-right text-[var(--color-text-secondary)]">{{ formatNumber(model.outputTokens) }}</td>
              <td class="px-5 py-3 text-right text-[var(--color-text-tertiary)] hidden lg:table-cell">{{ formatNumber(model.cacheReadTokens) }}</td>
              <td class="px-5 py-3 text-right text-[var(--color-text-tertiary)] hidden lg:table-cell">{{ formatNumber(model.cacheWriteTokens) }}</td>
              <td class="px-5 py-3 text-right font-semibold text-[var(--color-text-primary)]">{{ formatNumber(model.totalTokens) }}</td>
              <td class="px-5 py-3 text-right text-[var(--color-warning-fg)]">{{ formatCost(model.cost) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Token distribution -->
      <div v-if="modelEntries.length > 0" class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)] p-5">
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)] mb-4 pb-2 border-b border-[var(--color-border-muted)]">
          Token Distribution
        </h3>
        <div class="space-y-3">
          <div v-for="model in modelEntries" :key="model.name" class="space-y-1">
            <div class="flex justify-between text-xs">
              <span class="text-[var(--color-done-fg)]">{{ model.name }}</span>
              <span class="text-[var(--color-text-secondary)]">
                {{ formatNumber(model.totalTokens) }}
                <span class="text-[var(--color-text-tertiary)]">({{ totalTokens > 0 ? Math.round(model.totalTokens / totalTokens * 100) : 0 }}%)</span>
              </span>
            </div>
            <div
              class="h-2 overflow-hidden rounded-full bg-[var(--color-border-muted)]"
              role="progressbar"
              :aria-valuenow="totalTokens > 0 ? Math.round(model.totalTokens / totalTokens * 100) : 0"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="`${model.name} token usage`"
            >
              <div
                class="h-full rounded-full bg-[var(--color-done-emphasis)] transition-all"
                :style="{ width: totalTokens > 0 ? `${(model.totalTokens / totalTokens) * 100}%` : '0%' }"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Code changes -->
      <div
        v-if="metrics.codeChanges"
        class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)] p-5"
      >
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)] mb-4 pb-2 border-b border-[var(--color-border-muted)]">Code Changes</h3>
        <div class="flex gap-6 text-sm mb-3">
          <div>
            <span class="text-lg font-bold text-[var(--color-success-fg)]">+{{ metrics.codeChanges.linesAdded ?? 0 }}</span>
            <span class="ml-1 text-[var(--color-text-secondary)]">lines added</span>
          </div>
          <div>
            <span class="text-lg font-bold text-[var(--color-danger-fg)]">-{{ metrics.codeChanges.linesRemoved ?? 0 }}</span>
            <span class="ml-1 text-[var(--color-text-secondary)]">lines removed</span>
          </div>
        </div>
        <div v-if="metrics.codeChanges.filesModified?.length" class="space-y-1">
          <div class="text-xs text-[var(--color-text-secondary)]">
            Files modified ({{ metrics.codeChanges.filesModified.length }}):
          </div>
          <div class="max-h-40 space-y-0.5 overflow-y-auto font-mono text-xs text-[var(--color-text-tertiary)]">
            <div v-for="file in metrics.codeChanges.filesModified" :key="file">{{ file }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
