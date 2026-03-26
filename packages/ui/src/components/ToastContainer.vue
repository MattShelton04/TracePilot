<script setup lang="ts">
import { reactive } from 'vue';
import { useToast } from '../composables/useToast';

const { toasts, dismiss, pauseTimer, resumeTimer } = useToast();

const hovered = reactive(new Set<string>());

const iconMap: Record<string, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

function onEnter(id: string) {
  hovered.add(id);
  pauseTimer(id);
}

function onLeave(id: string) {
  hovered.delete(id);
  resumeTimer(id);
}

function onAction(action: { label: string; onClick: () => void }, id: string) {
  action.onClick();
  dismiss(id);
}
</script>

<template>
  <div class="toast-container" aria-live="polite">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast-card"
        :class="`toast-${t.type}`"
        role="status"
        :aria-live="t.type === 'error' ? 'assertive' : 'polite'"
        @mouseenter="onEnter(t.id)"
        @mouseleave="onLeave(t.id)"
      >
        <span class="toast-icon">{{ iconMap[t.type] }}</span>

        <div class="toast-body">
          <strong v-if="t.title" class="toast-title">{{ t.title }}</strong>
          <span class="toast-message">{{ t.message }}</span>
          <span v-if="t.description" class="toast-description">{{ t.description }}</span>
          <button
            v-if="t.action"
            class="toast-action"
            @click="onAction(t.action!, t.id)"
          >
            {{ t.action!.label }}
          </button>
        </div>

        <button class="toast-dismiss" aria-label="Dismiss" @click="dismiss(t.id)">✕</button>

        <div
          v-if="t.duration > 0"
          class="toast-progress"
          :class="{ 'toast-progress-paused': hovered.has(t.id) }"
          :style="{ animationDuration: `${t.duration}ms` }"
        />
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
/* ---- Container ---- */
.toast-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 360px;
  pointer-events: none;
}

/* ---- Card ---- */
.toast-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid var(--border-default);
  border-left: 4px solid var(--accent-fg);
  background: var(--canvas-overlay);
  color: var(--text-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  position: relative;
  overflow: hidden;
  pointer-events: auto;
}

.toast-success { border-left-color: var(--success-fg); }
.toast-error   { border-left-color: var(--danger-fg); }
.toast-warning { border-left-color: var(--warning-fg); }
.toast-info    { border-left-color: var(--accent-fg); }

/* ---- Icon ---- */
.toast-icon {
  flex-shrink: 0;
  width: 20px;
  text-align: center;
  font-size: 14px;
  line-height: 20px;
}

.toast-success .toast-icon { color: var(--success-fg); }
.toast-error   .toast-icon { color: var(--danger-fg); }
.toast-warning .toast-icon { color: var(--warning-fg); }
.toast-info    .toast-icon { color: var(--accent-fg); }

/* ---- Body ---- */
.toast-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toast-title {
  font-weight: 600;
  font-size: 13px;
  line-height: 20px;
}

.toast-message {
  font-size: 13px;
  line-height: 18px;
}

.toast-description {
  font-size: 12px;
  line-height: 16px;
  color: var(--text-secondary);
}

/* ---- Action link ---- */
.toast-action {
  background: none;
  border: none;
  padding: 0;
  margin-top: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  width: fit-content;
}

.toast-success .toast-action { color: var(--success-fg); }
.toast-error   .toast-action { color: var(--danger-fg); }
.toast-warning .toast-action { color: var(--warning-fg); }
.toast-info    .toast-action { color: var(--accent-fg); }

/* ---- Dismiss button ---- */
.toast-dismiss {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 14px;
  line-height: 20px;
  padding: 0 2px;
  opacity: 0.6;
  transition: opacity 150ms;
}

.toast-dismiss:hover {
  opacity: 1;
}

/* ---- Progress bar ---- */
.toast-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  width: 100%;
  animation: toast-countdown linear forwards;
}

.toast-success .toast-progress { background: var(--success-muted); }
.toast-error   .toast-progress { background: var(--danger-muted); }
.toast-warning .toast-progress { background: var(--warning-muted); }
.toast-info    .toast-progress { background: var(--accent-muted); }

.toast-progress-paused {
  animation-play-state: paused;
}

@keyframes toast-countdown {
  from { width: 100%; }
  to   { width: 0%; }
}

/* ---- Slide-in transition ---- */
.toast-enter-active {
  transition: all 300ms ease-out;
}

.toast-leave-active {
  transition: all 200ms ease-in;
  position: absolute;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.toast-move {
  transition: transform 200ms ease;
}

/* ---- Reduced motion ---- */
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active,
  .toast-move {
    transition: none;
  }

  .toast-progress {
    animation: none;
  }
}
</style>
