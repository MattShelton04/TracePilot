<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();
const sessionId = route.params.id as string;

function goBack() {
  router.push({ name: "sessions" });
}
</script>

<template>
  <div>
    <button class="back-button" @click="goBack">← Back</button>
    <h2>Session: {{ sessionId }}</h2>
    <p class="app__subtitle">Detail view coming soon...</p>
  </div>
</template>

<style scoped>
.back-button {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 1rem;
}
.back-button:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
