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

    void store.loadShutdownMetrics();
  },
  { immediate: true }
);

const metrics = computed(() => store.shutdownMetrics);

const modelEntries = computed(() => {
  if (!metrics.value?.modelMetrics) {
    return [];
  }

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

const totalTokens = computed(() => modelEntries.value.reduce((sum, model) => sum + model.totalTokens, 0));

const totalRequests = computed(() => modelEntries.value.reduce((sum, model) => sum + model.requests, 0));

function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }

  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }

  return n.toLocaleString();
}

function formatCost(c: number): string {
  return c > 0 ? c.toFixed(2) : "—";
}
</script>

<template>
  <div class="space-y-6">
    <div v-if="!metrics" class="py-8 text-center text-sm text-[var(--text-muted)]">
      No shutdown metrics available for this session.
    </div>

    <template v-else>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div class="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
          <div class="text-2xl font-bold text-[var(--accent)]">{{ formatNumber(totalTokens) }}</div>
          <div class="mt-1 text-xs text-[var(--text-muted)]">Total Tokens</div>
        </div>
        <div class="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
          <div class="text-2xl font-bold text-[var(--accent)]">{{ totalRequests }}</div>
          <div class="mt-1 text-xs text-[var(--text-muted)]">Total Requests</div>
        </div>
        <div class="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
          <div class="text-2xl font-bold text-[var(--warning)]">
            {{ metrics.totalPremiumRequests?.toFixed(1) ?? "—" }}
          </div>
          <div class="mt-1 text-xs text-[var(--text-muted)]">Premium Requests</div>
        </div>
        <div class="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
          <div class="text-2xl font-bold text-purple-400">{{ modelEntries.length }}</div>
          <div class="mt-1 text-xs text-[var(--text-muted)]">Models Used</div>
        </div>
      </div>

      <div v-if="modelEntries.length > 0" class="overflow-hidden rounded-lg border border-[var(--border)]">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-[var(--surface)] text-xs uppercase tracking-wider text-[var(--text-muted)]">
              <th class="px-4 py-2 text-left">Model</th>
              <th class="px-4 py-2 text-right">Requests</th>
              <th class="px-4 py-2 text-right">Input</th>
              <th class="px-4 py-2 text-right">Output</th>
              <th class="px-4 py-2 text-right">Cache Read</th>
              <th class="px-4 py-2 text-right">Cache Write</th>
              <th class="px-4 py-2 text-right">Total Tokens</th>
              <th class="px-4 py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="model in modelEntries"
              :key="model.name"
              class="border-t border-[var(--border)] hover:bg-[var(--surface)]/50"
            >
              <td class="px-4 py-2 font-medium text-purple-400">{{ model.name }}</td>
              <td class="px-4 py-2 text-right">{{ model.requests }}</td>
              <td class="px-4 py-2 text-right">{{ formatNumber(model.inputTokens) }}</td>
              <td class="px-4 py-2 text-right">{{ formatNumber(model.outputTokens) }}</td>
              <td class="px-4 py-2 text-right text-[var(--text-muted)]">{{ formatNumber(model.cacheReadTokens) }}</td>
              <td class="px-4 py-2 text-right text-[var(--text-muted)]">{{ formatNumber(model.cacheWriteTokens) }}</td>
              <td class="px-4 py-2 text-right font-semibold">{{ formatNumber(model.totalTokens) }}</td>
              <td class="px-4 py-2 text-right text-[var(--warning)]">{{ formatCost(model.cost) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4" v-if="modelEntries.length > 0">
        <h3 class="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Token Distribution</h3>
        <div v-for="model in modelEntries" :key="model.name" class="space-y-1">
          <div class="flex justify-between text-xs">
            <span class="text-purple-400">{{ model.name }}</span>
            <span class="text-[var(--text-muted)]">{{ formatNumber(model.totalTokens) }}</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-[var(--border)]">
            <div
              class="h-full rounded-full bg-purple-500 transition-all"
              :style="{ width: totalTokens > 0 ? `${(model.totalTokens / totalTokens) * 100}%` : '0%' }"
            />
          </div>
        </div>
      </div>

      <div
        v-if="metrics.codeChanges"
        class="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <h3 class="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Code Changes</h3>
        <div class="flex gap-6 text-sm">
          <div>
            <span class="text-lg font-bold text-[var(--success)]">+{{ metrics.codeChanges.linesAdded ?? 0 }}</span>
            <span class="ml-1 text-[var(--text-muted)]">lines added</span>
          </div>
          <div>
            <span class="text-lg font-bold text-[var(--error)]">-{{ metrics.codeChanges.linesRemoved ?? 0 }}</span>
            <span class="ml-1 text-[var(--text-muted)]">lines removed</span>
          </div>
        </div>
        <div v-if="metrics.codeChanges.filesModified?.length" class="space-y-1">
          <div class="text-xs text-[var(--text-muted)]">
            Files modified ({{ metrics.codeChanges.filesModified.length }}):
          </div>
          <div class="max-h-40 space-y-0.5 overflow-y-auto font-mono text-xs text-[var(--text-muted)]">
            <div v-for="file in metrics.codeChanges.filesModified" :key="file">{{ file }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
