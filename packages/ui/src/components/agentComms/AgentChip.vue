<script setup lang="ts">
/**
 * AgentChip — a named, colour-coded reference to an agent in the session.
 *
 * Resolves any identifier (runtime ID, legacy name, launch call, session ID)
 * through the injected agent directory. Opens the agent's detail when the
 * host view supports it; otherwise renders as plain text. Unknown identifiers
 * fall back to a shortened ID with the full value in the tooltip.
 */
import { computed } from "vue";
import { useAgentDirectory } from "../../composables/useAgentDirectory";
import { getAgentColor } from "../../utils/agentTypes";

const props = defineProps<{
  /** Directory key or any agent identifier. */
  identifier?: string;
  /** Label when the identifier cannot be resolved (defaults to a short ID). */
  fallbackLabel?: string;
  size?: "sm" | "md";
}>();

const { resolve, canOpen, open } = useAgentDirectory();

const entry = computed(() => resolve(props.identifier));

const label = computed(() => {
  if (entry.value) return entry.value.name;
  if (props.fallbackLabel) return props.fallbackLabel;
  const id = props.identifier ?? "";
  return /^[0-9a-f]{8}-/.test(id) ? id.slice(0, 8) : id || "Unknown agent";
});

const color = computed(() => getAgentColor(entry.value?.type ?? "task"));

const title = computed(() => {
  const e = entry.value;
  if (!e) return props.identifier ?? "";
  const parts = [e.name, e.isMain ? "main agent" : e.type];
  if (e.agentId) parts.push(e.agentId);
  return parts.join(" · ");
});

const clickable = computed(() => canOpen(entry.value?.key));

function onClick() {
  if (entry.value) open(entry.value.key);
}
</script>

<template>
  <button
    v-if="clickable"
    type="button"
    :class="['agent-chip', 'agent-chip--clickable', `agent-chip--${size ?? 'sm'}`]"
    :style="{ '--agent-chip-color': color }"
    :title="`${title} — open agent`"
    @click.stop="onClick"
  >
    <span class="agent-chip-dot" aria-hidden="true" />
    <span class="agent-chip-label">{{ label }}</span>
  </button>
  <span
    v-else
    :class="['agent-chip', `agent-chip--${size ?? 'sm'}`, { 'agent-chip--unknown': !entry }]"
    :style="{ '--agent-chip-color': color }"
    :title="title"
  >
    <span class="agent-chip-dot" aria-hidden="true" />
    <span class="agent-chip-label">{{ label }}</span>
  </span>
</template>

<style scoped>
.agent-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-width: 0;
  padding: 1px 8px 1px 6px;
  border: 1px solid color-mix(in srgb, var(--agent-chip-color) 35%, transparent);
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--agent-chip-color) 10%, transparent);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1.6;
  vertical-align: middle;
}
.agent-chip--md {
  font-size: 0.75rem;
  padding: 2px 10px 2px 8px;
}
.agent-chip--clickable {
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.agent-chip--clickable:hover {
  background: color-mix(in srgb, var(--agent-chip-color) 20%, transparent);
  border-color: color-mix(in srgb, var(--agent-chip-color) 60%, transparent);
}
.agent-chip--clickable:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 1px;
}
.agent-chip--unknown {
  font-family: "JetBrains Mono", monospace;
  color: var(--text-secondary);
}
.agent-chip-dot {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--agent-chip-color);
}
.agent-chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
