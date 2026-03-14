<script setup lang="ts">
import type { SessionListItem } from "@tracepilot/types";

defineProps<{
  session: SessionListItem;
}>();

const emit = defineEmits<{
  select: [sessionId: string];
}>();
</script>

<template>
  <div
    class="session-card"
    role="button"
    tabindex="0"
    @click="emit('select', session.id)"
    @keydown.enter="emit('select', session.id)"
  >
    <h3 class="session-card__title">
      {{ session.summary || "Untitled Session" }}
    </h3>
    <div class="session-card__meta">
      <span v-if="session.repository" class="session-card__repo">
        {{ session.repository }}
      </span>
      <span v-if="session.branch" class="session-card__branch">
        {{ session.branch }}
      </span>
    </div>
    <div class="session-card__dates">
      <time v-if="session.createdAt" :datetime="session.createdAt">
        {{ new Date(session.createdAt).toLocaleDateString() }}
      </time>
    </div>
  </div>
</template>
