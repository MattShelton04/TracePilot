<script setup lang="ts">
import { StatCard } from "@tracepilot/ui";

defineProps<{
  heartbeatAgeSecs: number | null | undefined;
  heartbeatColor: "success" | "warning" | "danger";
  lastCycle: number | null;
  activeTaskCount: number;
  lastIngestedCount: number;
}>();
</script>

<template>
  <div class="stats-grid fade-section" style="--stagger: 2">
    <StatCard
      :value="heartbeatAgeSecs != null ? `${heartbeatAgeSecs}s` : '—'"
      label="Heartbeat Age"
      :color="heartbeatColor"
    />
    <StatCard
      :value="lastCycle != null ? lastCycle : '—'"
      label="Last Cycle"
      color="accent"
    />
    <StatCard
      :value="activeTaskCount"
      label="Active Tasks"
      color="accent"
    />
    <StatCard
      :value="lastIngestedCount"
      label="Last Ingested"
      color="done"
    />
  </div>
</template>
