<script setup lang="ts">
/** AgentStatusPill — an agent's runtime state as a toned status pill. */
import { computed } from "vue";
import type { AgentRuntimeStatus } from "../../utils/agentComms";
import StatusPill, { type StatusPillTone } from "../StatusPill.vue";

const props = defineProps<{ status: AgentRuntimeStatus; size?: "xs" | "sm" }>();

const TONES: Record<AgentRuntimeStatus, StatusPillTone> = {
  running: "accent",
  pending: "attention",
  idle: "done",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
  unknown: "neutral",
};

const LABELS: Record<AgentRuntimeStatus, string> = {
  running: "Running",
  pending: "Queued work",
  idle: "Idle",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  unknown: "Unknown",
};

const tone = computed(() => TONES[props.status]);
const label = computed(() => LABELS[props.status]);
</script>

<template>
  <StatusPill :tone="tone" :label="label" :size="size ?? 'xs'" />
</template>
