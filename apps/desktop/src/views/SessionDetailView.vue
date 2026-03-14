<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSessionDetailStore } from "@/stores/sessionDetail";

const route = useRoute();
const router = useRouter();
const store = useSessionDetailStore();

const sessionId = computed(() => route.params.id as string);

const tabs = [
  { name: "overview", routeName: "session-overview", label: "Overview" },
  { name: "conversation", routeName: "session-conversation", label: "Conversation" },
  { name: "events", routeName: "session-events", label: "Events" },
  { name: "todos", routeName: "session-todos", label: "Todos" },
  { name: "metrics", routeName: "session-metrics", label: "Metrics" },
];

const activeTab = computed(() => route.name as string);

function navigate(routeName: string) {
  router.push({ name: routeName, params: route.params });
}

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
  <div class="space-y-4">
    <div class="flex items-center gap-3">
      <button
        class="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        @click="goBack"
      >
        ← Back
      </button>
      <div v-if="store.detail" class="min-w-0 flex-1">
        <h2 class="truncate text-lg font-semibold">
          {{ store.detail.summary || "Untitled Session" }}
        </h2>
        <div class="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
          <span v-if="store.detail.repository" class="text-[var(--accent)]">{{ store.detail.repository }}</span>
          <span v-if="store.detail.branch" class="text-[var(--success)]">{{ store.detail.branch }}</span>
          <span>{{ store.detail.eventCount ?? 0 }} events</span>
          <span>{{ store.detail.turnCount ?? 0 }} turns</span>
        </div>
      </div>
    </div>

    <div v-if="store.loading" class="text-sm text-[var(--text-muted)]">Loading session...</div>
    <div
      v-else-if="store.error"
      class="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-[var(--error)]"
    >
      {{ store.error }}
    </div>

    <nav v-if="store.detail" class="flex border-b border-[var(--border)]">
      <button
        v-for="tab in tabs"
        :key="tab.name"
        class="-mb-px px-4 py-2 text-sm font-medium transition-colors"
        :class="activeTab === tab.routeName
          ? 'border-b-2 border-[var(--accent)] text-[var(--accent)]'
          : 'text-[var(--text-muted)] hover:text-[var(--text)]'"
        @click="navigate(tab.routeName)"
      >
        {{ tab.label }}
      </button>
    </nav>

    <router-view v-if="store.detail" :key="`${sessionId}-${activeTab}`" />
  </div>
</template>
