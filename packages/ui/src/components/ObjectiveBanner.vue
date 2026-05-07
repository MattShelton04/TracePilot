<script setup lang="ts">
import { computed } from "vue";
import type { CurrentObjective } from "../utils/objective";

type ObjectiveScope = "session" | "subagent";
type ObjectiveStatus = "running" | "completed" | "failed" | "idle";

const props = withDefaults(
  defineProps<{
    objective: CurrentObjective | null;
    scope?: ObjectiveScope;
    label?: string;
    status?: ObjectiveStatus;
    accentColor?: string;
  }>(),
  {
    scope: "session",
    label: "Objective",
    status: "running",
  },
);

const emit = defineEmits<{
  reveal: [info: { eventIndex?: number; toolCallId?: string }];
}>();

const hasObjective = computed(() => !!props.objective);
const canReveal = computed(
  () => props.objective?.eventIndex != null || !!props.objective?.toolCallId,
);

const statusLabel = computed(() => {
  if (!hasObjective.value) return "Awaiting";
  switch (props.status) {
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "idle":
      return "Idle";
    default:
      return "Running";
  }
});

const updateBadge = computed(() => {
  const n = props.objective?.updateCount ?? 0;
  return n > 1 ? `+${n - 1}` : null;
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
    <span class="ob-dot" aria-hidden="true" />
    <span class="ob-label">{{ label }}</span>
    <button
      v-if="hasObjective && canReveal"
      type="button"
      class="ob-text"
      :title="objective!.text"
      @click="handleClick"
    >
      {{ objective!.text }}
    </button>
    <span v-else-if="hasObjective" class="ob-text ob-text-static" :title="objective!.text">
      {{ objective!.text }}
    </span>
    <span v-else class="ob-text empty-text">No objective yet</span>
    <span
      v-if="updateBadge"
      class="ob-updates"
      :title="`Objective changed ${objective?.updateCount} times`"
    >
      {{ updateBadge }}
    </span>
    <span :class="['ob-status', `ob-status-${status}`]">{{ statusLabel }}</span>
  </section>
</template>

<style scoped>
.objective-banner {
  --ob-accent: var(--accent-fg, #58a6ff);
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid color-mix(in srgb, var(--ob-accent) 20%, var(--border-default, transparent));
  border-radius: var(--radius-md, 8px);
  background: color-mix(in srgb, var(--ob-accent) 6%, var(--canvas-overlay, var(--canvas-default, #0d1117)));
  color: var(--text-secondary, #b1bac4);
  font-size: 0.75rem;
  line-height: 1.3;
}

.objective-banner.empty {
  --ob-accent: var(--text-tertiary, #8b949e);
  background: var(--canvas-subtle, var(--canvas-default, #0d1117));
}

.ob-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ob-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ob-accent) 12%, transparent);
}

.status-running .ob-dot {
  animation: objectiveDot 1.5s ease-in-out infinite;
}

.objective-banner.empty .ob-dot {
  opacity: 0.45;
  box-shadow: none;
}

.ob-label {
  color: var(--text-tertiary, #8b949e);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.ob-text {
  min-width: 0;
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--text-primary, #f0f6fc);
  font: inherit;
  font-weight: 500;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

button.ob-text {
  cursor: pointer;
}

button.ob-text:hover,
button.ob-text:focus-visible {
  color: var(--ob-accent);
  outline: none;
}

.ob-text-static,
.empty-text {
  cursor: default;
}

.empty-text {
  color: var(--text-tertiary, #8b949e);
  font-weight: 400;
}

.ob-updates,
.ob-status {
  justify-self: end;
  border-radius: var(--radius-full, 999px);
  background: color-mix(in srgb, var(--ob-accent) 12%, transparent);
  color: color-mix(in srgb, var(--ob-accent) 82%, var(--text-primary, #f0f6fc));
  font-size: 0.625rem;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.ob-updates {
  padding: 3px 5px;
}

.ob-status {
  padding: 4px 7px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ob-status-completed {
  color: var(--success-fg, #3fb950);
}

.ob-status-failed {
  color: var(--danger-fg, #f85149);
}

.ob-status-idle {
  color: var(--text-tertiary, #8b949e);
}

.objective-banner.scope-subagent {
  border-left-width: 3px;
}

@keyframes objectiveDot {
  50% {
    box-shadow: 0 0 0 5px color-mix(in srgb, var(--ob-accent) 0%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-running .ob-dot {
    animation: none;
  }
}
</style>
