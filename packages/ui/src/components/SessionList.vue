<script setup lang="ts">
import type { SessionListItem } from '@tracepilot/types';
import SessionCard from './SessionCard.vue';

defineProps<{
  sessions: SessionListItem[];
}>();

const emit = defineEmits<{
  select: [sessionId: string];
}>();
</script>

<template>
  <div v-if="sessions.length === 0" class="empty-state">
    <div class="empty-state-icon">📄</div>
    <div class="empty-state-title">No sessions found</div>
    <div class="empty-state-desc">Sessions appear after using GitHub Copilot CLI.</div>
  </div>
  <div v-else class="grid-cards">
    <SessionCard
      v-for="session in sessions"
      :key="session.id"
      :session="session"
      @select="emit('select', $event)"
    />
  </div>
</template>
