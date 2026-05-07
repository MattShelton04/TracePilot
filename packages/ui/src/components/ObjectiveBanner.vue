<script setup lang="ts">
/**
 * ObjectiveBanner — persistent display of the *current* session or subagent
 * objective (latest `report_intent`). Mirrors what the CLI surfaces as a
 * progress bar so users can always see what the agent is currently aiming
 * at, without scanning inline events.
 *
 * The banner intentionally adopts the existing accent‑subtle pill idiom
 * used by the chat view's intent pill so it feels native, not generic.
 */
import { computed } from "vue";
import type { CurrentObjective } from "../utils/objective";

type ObjectiveScope = "session" | "subagent";
type ObjectiveStatus = "running" | "completed" | "failed" | "idle";

const props = withDefaults(
  defineProps<{
    objective: CurrentObjective | null;
    /** "session" gets a generic accent; "subagent" inherits the agent color. */
    scope?: ObjectiveScope;
    /** Optional override label (defaults to "Current objective"). */
    label?: string;
    /** Drives the right‑hand status pill. */
    status?: ObjectiveStatus;
    /** Custom accent color (used by the subagent variant). */
    accentColor?: string;
    /** Hide the leading 🎯 icon (for embeds that already show one). */
    hideIcon?: boolean;
  }>(),
  {
    scope: "session",
    label: "Current objective",
    status: "running",
    hideIcon: false,
  },
);

const emit = defineEmits<{
  /**
   * Emitted when the user clicks the objective text. Hosts can use this to
   * scroll to / reveal the originating `report_intent` event.
   */
  reveal: [info: { eventIndex?: number; toolCallId?: string }];
}>();

const hasObjective = computed(() => !!props.objective);
const canReveal = computed(
  () => props.objective?.eventIndex != null || !!props.objective?.toolCallId,
);

const statusLabel = computed(() => {
  switch (props.status) {
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "idle":
      return hasObjective.value ? "Idle" : "Awaiting objective";
    default:
      return hasObjective.value ? "In progress" : "Awaiting objective";
  }
});

const updateBadge = computed(() => {
  const n = props.objective?.updateCount ?? 0;
  return n > 1 ? `Updated ${n}×` : null;
});

const ariaText = computed(() => {
  if (!props.objective) return `${props.label}: none reported yet.`;
  return `${props.label}: ${props.objective.text}.`;
});

const accentStyle = computed(() =>
  props.accentColor && props.scope === "subagent" ? { "--ob-accent": props.accentColor } : {},
);

function handleClick() {
  if (!props.objective || !canReveal.value) return;
  emit("reveal", {
    eventIndex: props.objective.eventIndex,
    toolCallId: props.objective.toolCallId,
  });
}

function handleKey(ev: KeyboardEvent) {
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    handleClick();
  }
}
</script>

<template>
  <section
    class="objective-banner"
    :class="[`scope-${scope}`, `status-${status}`, { empty: !hasObjective }]"
    :style="accentStyle"
    role="status"
    aria-live="polite"
    :aria-label="ariaText"
    :data-objective-event-idx="objective?.eventIndex ?? undefined"
  >
    <span v-if="!hideIcon" class="ob-icon" aria-hidden="true">🎯</span>
    <div class="ob-body">
      <span class="ob-label">{{ label }}</span>
      <button
        v-if="hasObjective && canReveal"
        type="button"
        class="ob-text"
        :title="objective!.text"
        @click="handleClick"
        @keydown="handleKey"
      >
        {{ objective!.text }}
      </button>
      <span v-else-if="hasObjective" class="ob-text ob-text-static" :title="objective!.text">
        {{ objective!.text }}
      </span>
      <span v-else class="ob-text empty-text">No objective reported yet</span>
    </div>
    <span v-if="updateBadge" class="ob-updates" :title="`Objective changed ${objective?.updateCount} times`">{{ updateBadge }}</span>
    <span :class="['ob-status', `ob-status-${status}`]">{{ statusLabel }}</span>
    <span v-if="status === 'running' && hasObjective" class="ob-progress" aria-hidden="true" />
  </section>
</template>

<style scoped>
.objective-banner {
  --ob-accent: var(--accent-fg, #58a6ff);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-md, 6px);
  background: color-mix(in srgb, var(--ob-accent) 8%, var(--canvas-inset, var(--canvas-default, #0d1117)));
  border: 1px solid color-mix(in srgb, var(--ob-accent) 25%, transparent);
  font-size: 0.8125rem;
  line-height: 1.35;
  min-width: 0;
  position: relative;
  overflow: hidden;
}

.objective-banner.empty {
  --ob-accent: var(--text-tertiary, #6e7681);
  background: var(--canvas-inset, var(--canvas-default, #0d1117));
}

.ob-icon {
  flex-shrink: 0;
  font-size: 14px;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--ob-accent) 35%, transparent));
}

.objective-banner.empty .ob-icon {
  filter: none;
  opacity: 0.55;
}

.ob-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.ob-label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-tertiary, #8b949e);
}

.ob-text {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0;
  text-align: left;
  font: inherit;
  color: var(--ob-accent);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.ob-text:hover,
.ob-text:focus-visible {
  text-decoration: underline;
  outline: none;
}

.ob-text.empty-text {
  cursor: default;
  color: var(--text-tertiary, #8b949e);
  font-weight: 400;
  font-style: italic;
}

.ob-text-static {
  cursor: default;
}

.ob-updates {
  flex-shrink: 0;
  font-size: 0.6875rem;
  color: var(--text-secondary, #b1bac4);
  background: var(--neutral-subtle, rgba(110, 118, 129, 0.1));
  padding: 1px 7px;
  border-radius: var(--radius-full, 100px);
}

.ob-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-full, 100px);
  background: color-mix(in srgb, var(--ob-accent) 18%, transparent);
  color: var(--ob-accent);
  white-space: nowrap;
}

.ob-status-running::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 38%, transparent);
  animation: objectivePulse 1.4s ease-out infinite;
}

.ob-status-completed {
  background: var(--success-subtle, rgba(46, 160, 67, 0.15));
  color: var(--success-fg, #3fb950);
}

.ob-status-failed {
  background: var(--danger-subtle, rgba(248, 81, 73, 0.15));
  color: var(--danger-fg, #f85149);
}

.ob-status-idle {
  background: var(--neutral-subtle, rgba(110, 118, 129, 0.1));
  color: var(--text-tertiary, #8b949e);
}

.ob-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in srgb, var(--ob-accent) 20%, transparent) 20%,
    var(--ob-accent) 48%,
    color-mix(in srgb, var(--ob-accent) 20%, transparent) 76%,
    transparent 100%
  );
  transform: translateX(-100%);
  animation: objectiveProgressSweep 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  opacity: 0.75;
}

@keyframes objectivePulse {
  70% {
    box-shadow: 0 0 0 6px color-mix(in srgb, currentColor 0%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 0%, transparent);
  }
}

@keyframes objectiveProgressSweep {
  to {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ob-status-running::before,
  .ob-progress {
    animation: none;
  }

  .ob-progress {
    transform: none;
  }
}

/* Subagent variant sits flush inside the panel and is slightly more compact. */
.objective-banner.scope-subagent {
  padding: 6px 10px;
}
</style>
