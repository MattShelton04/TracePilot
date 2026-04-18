<script setup lang="ts">
import { EmptyState, formatDuration, SectionPanel } from "@tracepilot/ui";
import { useSessionComparisonContext } from "@/composables/useSessionComparison";
import { sessionDurationMs } from "@/composables/useSessionMetrics";
import { CHART_COLORS } from "@/utils/chartColors";

const comp = useSessionComparisonContext();
</script>

<template>
  <!-- ═══════ Message Length Waveform ═══════ -->
  <div class="chart-grid-2">
    <div class="chart-box">
      <div class="chart-box-header">Message Length by Turn — Session A</div>
      <div class="chart-box-body">
        <EmptyState v-if="comp.waveA.length === 0" compact message="No turns" />
        <div v-else class="waveform-container">
          <div
            v-for="(h, i) in comp.waveA"
            :key="'wa-' + i"
            class="waveform-bar waveform-bar-a"
            :style="{ height: Math.max(h, 8) + '%' }"
            :title="`Turn ${i + 1}`"
          ></div>
        </div>
      </div>
    </div>
    <div class="chart-box">
      <div class="chart-box-header">Message Length by Turn — Session B</div>
      <div class="chart-box-body">
        <EmptyState v-if="comp.waveB.length === 0" compact message="No turns" />
        <div v-else class="waveform-container">
          <div
            v-for="(h, i) in comp.waveB"
            :key="'wb-' + i"
            class="waveform-bar waveform-bar-b"
            :style="{ height: Math.max(h, 8) + '%' }"
            :title="`Turn ${i + 1}`"
          ></div>
        </div>
      </div>
    </div>
  </div>

  <!-- ═══════ Timeline Overlay ═══════ -->
  <SectionPanel title="Timeline Overlay">
    <p class="timeline-desc">Session duration and pacing — each block represents a turn proportional to its duration</p>
    <div class="timeline-section">
      <div class="timeline-label label-a">Session A — {{ formatDuration(sessionDurationMs(comp.dataA.detail)) || '—' }} ({{ comp.dataA.turns.length }} turns)</div>
      <div class="mini-timeline-row">
        <div
          v-for="(pct, i) in comp.timelineA"
          :key="'tla-' + i"
          class="mini-tl-block"
          :style="{
            width: pct + '%',
            background: i % 2 === 0
              ? `linear-gradient(90deg, ${CHART_COLORS.primary}, ${CHART_COLORS.primaryLight})`
              : 'var(--accent-muted)',
          }"
          :title="`Turn ${i + 1}: ${formatDuration(comp.dataA.turns[i]?.durationMs) || '—'}`"
        ></div>
      </div>
    </div>
    <div class="timeline-section">
      <div class="timeline-label label-b">Session B — {{ formatDuration(sessionDurationMs(comp.dataB.detail)) || '—' }} ({{ comp.dataB.turns.length }} turns)</div>
      <div class="mini-timeline-row">
        <div
          v-for="(pct, i) in comp.timelineB"
          :key="'tlb-' + i"
          class="mini-tl-block"
          :style="{
            width: pct + '%',
            background: i % 2 === 0
              ? `linear-gradient(90deg, var(--done-fg), ${CHART_COLORS.secondary})`
              : 'var(--done-muted)',
          }"
          :title="`Turn ${i + 1}: ${formatDuration(comp.dataB.turns[i]?.durationMs) || '—'}`"
        ></div>
      </div>
    </div>
  </SectionPanel>
</template>
