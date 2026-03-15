<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { TabNav, Badge, ErrorAlert, SkeletonLoader } from "@tracepilot/ui";

const route = useRoute();
const store = useSessionDetailStore();

const sessionId = computed(() => route.params.id as string);

const tabs = computed(() => [
  { name: "overview", routeName: "session-overview", label: "Overview" },
  { name: "conversation", routeName: "session-conversation", label: "Conversation", count: store.detail?.turnCount },
  { name: "events", routeName: "session-events", label: "Events", count: store.detail?.eventCount },
  { name: "todos", routeName: "session-todos", label: "Todos" },
  { name: "metrics", routeName: "session-metrics", label: "Metrics" },
  { name: "timeline", routeName: "session-timeline", label: "Timeline" },
]);

const currentModel = computed(() =>
  store.detail?.shutdownMetrics?.currentModel ?? "",
);

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
  <div class="page-content">
    <div class="page-content-inner">

      <!-- Loading state -->
      <div v-if="store.loading" style="padding-top: 8px;">
        <SkeletonLoader variant="text" :count="1" />
        <SkeletonLoader variant="badge" :count="3" />
      </div>

      <!-- Error state -->
      <ErrorAlert v-if="store.error" :message="store.error" />

      <!-- Session header + tabs + content -->
      <template v-if="store.detail">
        <h1 class="detail-title">
          {{ store.detail.summary || 'Untitled Session' }}
        </h1>
        <div class="detail-badges">
          <Badge v-if="store.detail.repository" variant="accent">{{ store.detail.repository }}</Badge>
          <Badge v-if="store.detail.branch" variant="success">{{ store.detail.branch }}</Badge>
          <Badge v-if="currentModel" variant="done">{{ currentModel }}</Badge>
          <Badge variant="neutral">{{ store.detail.hostType || 'cli' }}</Badge>
        </div>

        <TabNav :tabs="tabs" />

        <div class="detail-tab-content">
          <router-view :key="`${sessionId}-${String(route.name)}`" />
        </div>
      </template>

    </div>
  </div>
</template>

<style scoped>
.detail-title {
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
  margin: 0 0 8px 0;
}
.detail-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}
.detail-tab-content {
  padding-top: 4px;
}
</style>
