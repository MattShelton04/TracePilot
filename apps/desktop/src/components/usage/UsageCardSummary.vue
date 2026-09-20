<script setup lang="ts">
import UsageSparkline from "./UsageSparkline.vue";

export interface UsageCardStat {
  key: string;
  label: string;
  value: string;
  tone?: "danger" | "muted";
}

defineProps<{
  stats: UsageCardStat[] | null;
  values: number[];
  label: string;
  lastUsed: string | null;
  idleText: string;
  tone?: "danger" | "accent";
}>();
</script>

<template>
  <div class="usage-card-summary">
    <dl v-if="stats" class="usage-card-summary__stats">
      <div v-for="stat in stats" :key="stat.key" class="usage-card-summary__stat">
        <dt>{{ stat.label }}</dt>
        <dd :class="{
          'usage-card-summary__danger': stat.tone === 'danger',
          'usage-card-summary__muted': stat.tone === 'muted',
        }">{{ stat.value }}</dd>
      </div>
    </dl>
    <span v-else class="usage-card-summary__idle">{{ idleText }}</span>
    <div class="usage-card-summary__trend">
      <UsageSparkline
        v-if="values.length > 1"
        :values="values"
        :label="label"
        :width="72"
        :height="18"
        :tone="tone ?? 'accent'"
      />
      <span v-if="lastUsed" class="usage-card-summary__last">{{ lastUsed }}</span>
    </div>
  </div>
</template>

<style scoped>
.usage-card-summary {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.usage-card-summary__stats {
  display: flex;
  flex: 1;
  gap: 8px;
  margin: 0;
  min-width: 0;
}

.usage-card-summary__stat {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: max-content;
}

.usage-card-summary dt {
  font-size: 0.5625rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
}

.usage-card-summary dd {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.usage-card-summary dd.usage-card-summary__danger {
  color: var(--danger-fg);
}

.usage-card-summary dd.usage-card-summary__muted {
  color: var(--text-tertiary);
}

.usage-card-summary__idle {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.usage-card-summary__trend {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  margin-left: auto;
}

.usage-card-summary__last {
  font-size: 0.5625rem;
  color: var(--text-tertiary);
  white-space: nowrap;
}
</style>
