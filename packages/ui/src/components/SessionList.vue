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
  <div v-if="sessions.length === 0" class="flex flex-col items-center justify-center py-20 text-[var(--color-text-secondary)]">
    <svg class="h-12 w-12 mb-4 text-[var(--color-text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
    <p class="text-base font-medium text-[var(--color-text-primary)]">No sessions found</p>
    <p class="text-sm mt-1">Sessions appear after using GitHub Copilot CLI.</p>
  </div>
  <div v-else class="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
    <SessionCard
      v-for="session in sessions"
      :key="session.id"
      :session="session"
      @select="emit('select', $event)"
    />
  </div>
</template>
