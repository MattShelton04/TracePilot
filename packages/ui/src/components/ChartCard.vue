<!--
  @slots
    default — chart body (SVG / canvas / DataGrid)
    footer  — legend, "View as table" toggle, drill-through link
    actions — header-right action buttons (e.g. download CSV)
    subtitle — optional override for `subtitle` prop content (rich nodes)
  Card frame for analytics / orchestration charts. Hairline border, no shadow.
  Audited against ChartFrame.vue: ChartFrame is an SVG geometry helper
  (axes / grid / tooltip overlay) — different responsibility. Both are kept.
  See design-system/pages/16-analytics-dashboard.md §ChartCard.
-->
<script setup lang="ts">
import Heading from "./Heading.vue";

export type ChartCardState = "idle" | "loading" | "empty" | "error";

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  state?: ChartCardState;
  /** Grid span (1440px reference grid). */
  span?: 4 | 6 | 12;
  density?: "comfortable" | "compact";
  /** Accessible summary, attached via aria-describedby. */
  ariaSummary?: string;
}

const props = withDefaults(defineProps<ChartCardProps>(), {
  state: "idle",
  span: 6,
  density: "comfortable",
});

const summaryId = `cc-summary-${Math.random().toString(36).slice(2, 9)}`;
void props;
</script>

<template>
  <section
    data-tp-component="ChartCard"
    class="chart-card"
    :class="[
      `chart-card--span-${span}`,
      `chart-card--${density}`,
      `chart-card--state-${state}`,
    ]"
    :aria-describedby="ariaSummary ? summaryId : undefined"
    :aria-busy="state === 'loading' || undefined"
  >
    <header class="chart-card__header">
      <div class="chart-card__titles">
        <Heading :level="3" class="chart-card__title">{{ title }}</Heading>
        <p v-if="$slots.subtitle || subtitle" class="chart-card__sub">
          <slot name="subtitle">{{ subtitle }}</slot>
        </p>
      </div>
      <div v-if="$slots.actions" class="chart-card__actions">
        <slot name="actions" />
      </div>
    </header>
    <div
      v-if="state === 'loading'"
      class="chart-card__refresh-bar"
      aria-hidden="true"
    />
    <div class="chart-card__body">
      <slot />
    </div>
    <p v-if="ariaSummary" :id="summaryId" class="chart-card__sr">{{ ariaSummary }}</p>
    <footer v-if="$slots.footer" class="chart-card__footer">
      <slot name="footer" />
    </footer>
  </section>
</template>

<style scoped>
.chart-card {
  display: flex;
  flex-direction: column;
  background: var(--canvas-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  min-height: 240px;
  overflow: hidden;
  position: relative;
}

.chart-card--compact {
  min-height: 200px;
}

.chart-card__header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
}

.chart-card--compact .chart-card__header {
  padding: 8px 12px;
}

.chart-card__titles {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chart-card__title {
  margin: 0;
}

.chart-card__sub {
  margin: 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-secondary);
}

.chart-card__actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.chart-card__body {
  flex: 1;
  padding: 8px 16px;
  min-height: 0;
}

.chart-card--compact .chart-card__body {
  padding: 4px 12px;
}

.chart-card__footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-top: 1px solid var(--border-subtle);
  font-size: 12px;
  line-height: 16px;
  color: var(--text-secondary);
}

.chart-card__refresh-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--accent-emphasis);
  transform-origin: left;
  animation: chart-card-refresh 1.2s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .chart-card__refresh-bar {
    animation: none;
    opacity: 0.6;
  }
}

@keyframes chart-card-refresh {
  0% {
    transform: scaleX(0);
  }
  50% {
    transform: scaleX(0.6);
  }
  100% {
    transform: scaleX(1);
  }
}

.chart-card__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
