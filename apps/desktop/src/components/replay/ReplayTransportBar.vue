<script setup lang="ts">
/**
 * ReplayTransportBar — transport controls, scrubber, and speed selector.
 */
defineProps<{
  currentStep: number;
  totalSteps: number;
  isPlaying: boolean;
  speed: number;
  elapsedFormatted: string;
  totalFormatted: string;
  scrubberPercent: number;
}>();

const emit = defineEmits<{
  play: [];
  pause: [];
  "toggle-play-pause": [];
  next: [];
  prev: [];
  "set-speed": [speed: number];
  "scrub-click": [event: MouseEvent];
}>();

const speeds = [0.5, 1, 2, 4];
</script>

<template>
  <div class="transport-bar" role="toolbar" aria-label="Replay controls">
    <!-- Transport buttons -->
    <div class="transport-buttons">
      <button
        class="transport-btn"
        :disabled="currentStep === 0"
        aria-label="Previous step (Left arrow)"
        @click="emit('prev')"
      >
        ⏮
      </button>
      <button
        class="transport-btn transport-play"
        :aria-label="isPlaying ? 'Pause (Space)' : 'Play (Space)'"
        @click="isPlaying ? emit('pause') : emit('play')"
      >
        {{ isPlaying ? '⏸' : '▶' }}
      </button>
      <button
        class="transport-btn"
        :disabled="currentStep >= totalSteps - 1"
        aria-label="Next step (Right arrow)"
        @click="emit('next')"
      >
        ⏭
      </button>
    </div>

    <!-- Scrubber -->
    <div class="scrubber" @click="emit('scrub-click', $event)" role="slider"
         :aria-valuenow="currentStep" :aria-valuemin="0" :aria-valuemax="totalSteps - 1"
         aria-label="Replay progress" tabindex="0"
         @keydown.left.prevent="emit('prev')"
         @keydown.right.prevent="emit('next')"
         @keydown.home.prevent="emit('scrub-click', { offsetX: 0, currentTarget: { getBoundingClientRect: () => ({ width: 1 }) } } as unknown as MouseEvent)"
         @keydown.end.prevent="emit('scrub-click', { offsetX: 1, currentTarget: { getBoundingClientRect: () => ({ width: 1 }) } } as unknown as MouseEvent)"
    >
      <span class="scrub-time">{{ elapsedFormatted }}</span>
      <div class="scrub-track">
        <div class="scrub-fill" :style="{ width: scrubberPercent + '%' }">
          <div class="scrub-thumb" />
        </div>
      </div>
      <span class="scrub-time">{{ totalFormatted }}</span>
    </div>

    <!-- Speed selector -->
    <div class="speed-group" role="radiogroup" aria-label="Playback speed">
      <button
        v-for="s in speeds"
        :key="s"
        class="speed-btn"
        :class="{ active: speed === s }"
        :aria-pressed="speed === s"
        @click="emit('set-speed', s)"
      >
        {{ s }}×
      </button>
    </div>

    <!-- Step counter -->
    <span class="step-counter" aria-live="polite">
      Turn {{ currentStep + 1 }} / {{ totalSteps }}
    </span>
  </div>
</template>

<style scoped>
.transport-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}
.transport-buttons { display: flex; gap: 4px; }
.transport-btn {
  width: 34px; height: 34px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-overlay);
  color: var(--text-primary);
  font-size: 0.9rem;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 120ms, border-color 120ms;
}
.transport-btn:hover:not(:disabled) {
  background: var(--canvas-raised);
  border-color: var(--accent-fg);
}
.transport-btn:disabled { opacity: 0.3; cursor: default; }
.transport-play {
  width: 38px; height: 38px;
  border-radius: 50%;
  background: var(--accent-emphasis);
  border-color: var(--accent-emphasis);
  color: var(--text-on-emphasis, #fff);
  font-size: 1rem;
}
.transport-play:hover {
  background: var(--accent-fg) !important;
  border-color: var(--accent-fg) !important;
  box-shadow: 0 0 16px rgba(99, 102, 241, 0.35);
}

.scrubber {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.scrub-time {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  font-family: 'JetBrains Mono', monospace;
  min-width: 40px;
}
.scrub-track {
  flex: 1;
  height: 6px;
  background: var(--neutral-muted);
  border-radius: 3px;
  position: relative;
}
.scrub-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--accent-emphasis) 0%, var(--accent-fg) 60%, var(--done-fg) 100%);
  position: relative;
  transition: width 200ms ease;
}
.scrub-thumb {
  position: absolute;
  right: -7px; top: -5px;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: var(--text-on-emphasis, #fff);
  border: 3px solid var(--accent-fg);
  box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.25), 0 2px 6px rgba(0, 0, 0, 0.3);
  cursor: grab;
  transition: box-shadow 150ms;
}
.scrub-thumb:hover {
  box-shadow: 0 0 0 5px rgba(129, 140, 248, 0.35), 0 2px 8px rgba(0, 0, 0, 0.4);
}

.speed-group { display: inline-flex; }
.speed-btn {
  padding: 4px 10px;
  font-size: 0.6875rem; font-weight: 600;
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 100ms;
}
.speed-btn:first-child { border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
.speed-btn:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.speed-btn:not(:first-child) { margin-left: -1px; }
.speed-btn.active {
  background: var(--accent-muted);
  color: var(--accent-fg);
  border-color: var(--accent-emphasis);
  z-index: 1;
}
.speed-btn:hover:not(.active) { color: var(--text-primary); border-color: var(--accent-fg); }

.step-counter {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
