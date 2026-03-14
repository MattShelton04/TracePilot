<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { TabNav, Badge, ErrorAlert, SkeletonLoader } from "@tracepilot/ui";

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
  <div class="space-y-6">
    <!-- Session header -->
    <div v-if="store.detail" class="space-y-3 pb-2">
      <div class="flex items-start justify-between gap-4">
        <div class="space-y-2">
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)] leading-tight">
            {{ store.detail.summary || "Untitled Session" }}
          </h1>
          <div class="flex flex-wrap items-center gap-2">
            <Badge v-if="store.detail.repository" variant="accent">{{ store.detail.repository }}</Badge>
            <Badge v-if="store.detail.branch" variant="success">{{ store.detail.branch }}</Badge>
            <Badge v-if="store.detail.hostType" variant="neutral">{{ store.detail.hostType }}</Badge>
            <span class="text-xs text-[var(--color-text-tertiary)] font-mono">{{ store.detail.id }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="store.loading" class="space-y-4">
      <SkeletonLoader variant="text" :count="1" />
      <SkeletonLoader variant="badge" :count="2" />
    </div>

    <!-- Error state -->
    <ErrorAlert v-if="store.error" :message="store.error" />

    <!-- Tabs -->
    <TabNav v-if="store.detail" :tabs="tabs" />

    <!-- Tab content (extra top spacing for breathing room below tabs) -->
    <div v-if="store.detail" class="pt-1">
      <router-view :key="`${sessionId}-${activeTab}`" />
    </div>
  </div>
</template>
