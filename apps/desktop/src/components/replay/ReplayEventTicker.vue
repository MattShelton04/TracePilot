<script setup lang="ts">
/**
 * ReplayEventTicker — scrolling horizontal event ticker at the bottom.
 * Shows session events from all steps up to the current step.
 */
import { computed } from 'vue';
import type { ReplayStep } from '@tracepilot/types';
import { formatTime } from '@tracepilot/ui';

const props = defineProps<{
  steps: ReplayStep[];
  currentStep: number;
}>();

interface TickerEvent {
  type: 'user' | 'assistant' | 'tool' | 'session' | 'context';
  label: string;
  time: string;
}

const tickerEvents = computed<TickerEvent[]>(() => {
  const events: TickerEvent[] = [];

  for (let i = 0; i <= props.currentStep && i < props.steps.length; i++) {
    const step = props.steps[i];
    const time = formatTime(step.timestamp) || '';

    if (step.userMessage) {
      events.push({ type: 'user', label: 'user.message', time });
    }

    if (step.assistantMessages?.length) {
      events.push({ type: 'assistant', label: 'assistant.message', time });
    }

    // Tool call events
    if (step.richToolCalls) {
      for (const tc of step.richToolCalls) {
        const suffix = tc.success === false ? ' ✗' : tc.success === true ? ' ✓' : '';
        events.push({
          type: 'tool',
          label: `tool.${tc.toolName}${suffix}`,
          time: formatTime(tc.startedAt) || time,
        });
      }
    }

    // Session events
    if (step.sessionEvents) {
      for (const se of step.sessionEvents) {
        events.push({
          type: 'session',
          label: se.eventType,
          time: formatTime(se.timestamp) || time,
        });
      }
    }

    // Model switch
    if (step.modelSwitchFrom && step.model) {
      events.push({
        type: 'context',
        label: `model: ${step.modelSwitchFrom} → ${step.model}`,
        time,
      });
    }
  }

  return events;
});

function eventClass(type: string): string {
  return `ev-${type}`;
}
</script>

<template>
  <div v-if="tickerEvents.length > 0" class="event-ticker" aria-label="Event timeline">
    <div class="ticker-track">
      <span
        v-for="(ev, idx) in tickerEvents"
        :key="idx"
        class="ticker-badge"
        :class="eventClass(ev.type)"
      >
        <span class="ticker-time">{{ ev.time }}</span>
        {{ ev.label }}
      </span>
      <!-- Duplicate for seamless loop animation -->
      <span
        v-for="(ev, idx) in tickerEvents"
        :key="'dup-' + idx"
        class="ticker-badge"
        :class="eventClass(ev.type)"
        aria-hidden="true"
      >
        <span class="ticker-time">{{ ev.time }}</span>
        {{ ev.label }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.event-ticker {
  display: flex;
  align-items: center;
  padding: 6px 16px;
  background: var(--canvas-inset);
  border-top: 1px solid var(--border-default);
  border-radius: 0 0 var(--radius-md) var(--radius-md);
  overflow: hidden;
  white-space: nowrap;
  position: relative;
  mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%);
}
.ticker-track {
  display: flex;
  gap: 8px;
  animation: tickerScroll 60s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .ticker-track { animation: none; }
}
@keyframes tickerScroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
.ticker-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: 100px;
  font-size: 0.625rem;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
  border: 1px solid var(--border-subtle);
}
.ticker-time {
  font-family: 'JetBrains Mono', monospace;
  opacity: 0.6;
  font-size: 0.5625rem;
}
.ev-session { background: var(--accent-subtle); color: var(--accent-fg); border-color: rgba(99, 102, 241, 0.15); }
.ev-user { background: var(--success-subtle); color: var(--success-fg); border-color: rgba(52, 211, 153, 0.15); }
.ev-assistant { background: var(--done-subtle); color: var(--done-fg); border-color: rgba(167, 139, 250, 0.15); }
.ev-tool { background: var(--warning-subtle); color: var(--warning-fg); border-color: rgba(251, 191, 36, 0.15); }
.ev-context { background: var(--neutral-subtle); color: var(--text-secondary); }
</style>
