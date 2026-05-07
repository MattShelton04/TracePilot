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
  padding: 4px 10px;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--ob-accent) 18%, var(--border-muted, transparent));
  background: transparent;
  color: var(--text-secondary, #b1bac4);
  font-size: 0.75rem;
  line-height: 1.3;
}

.objective-banner.empty {
  --ob-accent: var(--text-tertiary, #8b949e);
  border-top-color: var(--border-muted, transparent);
}

.ob-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ob-accent);
}

.status-running .ob-dot {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ob-accent) 14%, transparent);
  animation: objectiveDot 1.5s ease-in-out infinite;
}

.objective-banner.empty .ob-dot {
  opacity: 0.45;
}

.ob-label {
  color: var(--text-tertiary, #8b949e);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.02em;
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
  padding: 0;
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
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  color: var(--text-tertiary, #8b949e);
}

.ob-updates {
  color: color-mix(in srgb, var(--ob-accent) 70%, var(--text-tertiary, #8b949e));
  font-variant-numeric: tabular-nums;
}

.ob-status-running {
  color: color-mix(in srgb, var(--ob-accent) 80%, var(--text-secondary, #b1bac4));
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
  padding-left: 8px;
  border-left: 2px solid var(--ob-accent);
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
