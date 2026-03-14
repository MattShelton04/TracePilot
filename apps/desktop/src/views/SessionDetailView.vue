<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { TabNav, Badge } from "@tracepilot/ui";

const route = useRoute();
const router = useRouter();
const store = useSessionDetailStore();

const sessionId = computed(() => route.params.id as string);

const tabs = computed(() => [
  { name: "overview", routeName: "session-overview", label: "Overview" },
  { name: "conversation", routeName: "session-conversation", label: "Conversation", count: store.detail?.turnCount },
  { name: "events", routeName: "session-events", label: "Events", count: store.detail?.eventCount },
  { name: "todos", routeName: "session-todos", label: "Todos" },
  { name: "metrics", routeName: "session-metrics", label: "Metrics" },
]);

const activeTab = computed(() => route.name as string);

function goBack() {
  router.push({ name: "sessions" });
}

onMounted(() => {
  store.loadDetail(sessionId.value);
});

watch(sessionId, (newId) => {
  if (newId) {
    store.loadDetail(newId);
  }
});

onUnmounted(() => {
  store.reset();
});
</script>

<template>
  <div class="space-y-5">
    <!-- Session header -->
    <div v-if="store.detail" class="space-y-3">
      <h1 class="text-xl font-semibold text-[var(--color-text-primary)]">
        {{ store.detail.summary || "Untitled Session" }}
      </h1>
      <div class="flex flex-wrap items-center gap-2">
        <Badge v-if="store.detail.repository" variant="accent">{{ store.detail.repository }}</Badge>
        <Badge v-if="store.detail.branch" variant="success">{{ store.detail.branch }}</Badge>
        <Badge v-if="store.detail.hostType" variant="neutral">{{ store.detail.hostType }}</Badge>
        <span class="text-xs text-[var(--color-text-tertiary)]">{{ store.detail.id }}</span>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="store.loading" class="space-y-4">
      <div class="h-6 bg-[var(--color-border-muted)] rounded w-1/2 animate-pulse" />
      <div class="flex gap-2">
        <div class="h-5 bg-[var(--color-border-muted)] rounded-full w-24 animate-pulse" />
        <div class="h-5 bg-[var(--color-border-muted)] rounded-full w-20 animate-pulse" />
      </div>
    </div>

    <!-- Error state -->
    <div
      v-if="store.error"
      class="rounded-lg border border-[var(--color-danger-fg)]/20 bg-[var(--color-danger-muted)] p-4 text-sm text-[var(--color-danger-fg)]"
    >
      {{ store.error }}
    </div>

    <!-- Tabs -->
    <TabNav v-if="store.detail" :tabs="tabs" />

    <!-- Tab content -->
    <router-view v-if="store.detail" :key="`${sessionId}-${activeTab}`" />
  </div>
</template>
