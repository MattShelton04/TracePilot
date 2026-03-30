<script setup lang="ts">
import type { SessionListItem } from "@tracepilot/types";
import EmptyState from "./EmptyState.vue";
import SessionCard from "./SessionCard.vue";

defineProps<{
  sessions: SessionListItem[];
}>();

const emit = defineEmits<{
  select: [sessionId: string];
}>();
</script>

<template>
  <EmptyState v-if="sessions.length === 0" icon="📄" title="No sessions found" message="Sessions appear after using GitHub Copilot CLI." />
  <div v-else class="grid-cards">
    <SessionCard
      v-for="session in sessions"
      :key="session.id"
      :session="session"
      @select="emit('select', $event)"
    />
  </div>
</template>
