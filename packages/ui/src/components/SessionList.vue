<script setup lang="ts">
import type { SessionListItem } from "@tracepilot/types";
import SessionCard from "./SessionCard.vue";

defineProps<{
  sessions: SessionListItem[];
}>();

const emit = defineEmits<{
  select: [sessionId: string];
}>();
</script>

<template>
  <div v-if="sessions.length === 0" class="session-list--empty">
    <p>No sessions found.</p>
    <p class="session-list--empty__hint">
      Sessions appear after using GitHub Copilot CLI.
    </p>
  </div>

  <div v-else class="session-list">
    <SessionCard
      v-for="session in sessions"
      :key="session.id"
      :session="session"
      @select="emit('select', $event)"
    />
  </div>
</template>
