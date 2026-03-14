<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { listSessions } from "@tracepilot/client";
import { SessionList } from "@tracepilot/ui";
import type { SessionListItem } from "@tracepilot/types";

const router = useRouter();
const sessions = ref<SessionListItem[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

function onSelect(sessionId: string) {
  router.push({ name: "session-detail", params: { id: sessionId } });
}

onMounted(async () => {
  try {
    sessions.value = await listSessions();
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div>
    <p v-if="loading">Loading sessions...</p>
    <p v-else-if="error" class="app__error">Error: {{ error }}</p>
    <SessionList v-else :sessions="sessions" @select="onSelect" />
  </div>
</template>
