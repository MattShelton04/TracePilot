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
  <EmptyState v-if="sessions.length === 0" title="No sessions found" description="Sessions appear after using GitHub Copilot CLI.">
    <template #icon>📄</template>
  </EmptyState>
  <div v-else class="grid-cards">
    <SessionCard
      v-for="session in sessions"
      :key="session.id"
      :session="session"
      @select="(_, id) => emit('select', id)"
    />
  </div>
</template>
