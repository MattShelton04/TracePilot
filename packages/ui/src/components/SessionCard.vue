<script setup lang="ts">
import type { SessionListItem } from "@tracepilot/types";

defineProps<{
  session: SessionListItem;
}>();

const emit = defineEmits<{
  select: [sessionId: string];
}>();

function relativeTime(dateStr?: string): string {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}
</script>

<template>
  <div
    class="group cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition-all hover:border-[var(--accent)] hover:shadow-[0_0_0_1px_var(--accent)]"
    role="button"
    tabindex="0"
    @click="emit('select', session.id)"
    @keydown.enter="emit('select', session.id)"
  >
    <h3 class="text-base font-semibold mb-2 truncate">
      {{ session.summary || 'Untitled Session' }}
    </h3>
    <div class="flex flex-wrap gap-2 mb-2">
      <span v-if="session.repository" class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-[var(--accent)]">
        {{ session.repository }}
      </span>
      <span v-if="session.branch" class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-[var(--success)]">
        {{ session.branch }}
      </span>
      <span v-if="session.hostType" class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--border)] text-[var(--text-muted)]">
        {{ session.hostType }}
      </span>
      <span v-if="session.currentModel" class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-400">
        {{ session.currentModel }}
      </span>
    </div>
    <div class="flex items-center gap-4 text-xs text-[var(--text-muted)]">
      <span v-if="session.eventCount != null">{{ session.eventCount }} events</span>
      <span v-if="session.turnCount != null">{{ session.turnCount }} turns</span>
      <span class="ml-auto" :title="session.updatedAt">{{ relativeTime(session.updatedAt) }}</span>
    </div>
  </div>
</template>
